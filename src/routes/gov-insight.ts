import express from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import {
  cleanExcerpt,
  extractAnnualReportSummary,
  loadTextFromStoragePath,
  normalizePlainText,
} from '../utils/annualReportSummary';
import { buildPrefixedModelValue, resolveFirstNonEmpty } from '../utils/aiEnv';

const router = express.Router();

function resolveGovInsightReportModel(): string {
  const provider = String(
    process.env.GOV_INSIGHT_REPORT_PROVIDER ||
    process.env.LLM_REPORT_PROVIDER ||
    process.env.LLM_PROVIDER
  )
    .trim()
    .toLowerCase();

  const model = resolveFirstNonEmpty(
    process.env.GOV_INSIGHT_REPORT_MODEL,
    process.env.LLM_REPORT_MODEL,
    process.env.OPENAI_MODEL,
    process.env.LLM_MODEL
  );

  return buildPrefixedModelValue(provider, model);
}

function toFiniteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveGovInsightRequestConfig(rawConfig: unknown): Record<string, unknown> {
  if (rawConfig && typeof rawConfig === 'object') {
    return rawConfig as Record<string, unknown>;
  }

  return {
    temperature: toFiniteNumber(process.env.GOV_INSIGHT_REPORT_TEMPERATURE, 0.3),
    thinkingBudget: toFiniteNumber(process.env.GOV_INSIGHT_REPORT_THINKING_BUDGET, 0),
    responseMimeType: (process.env.GOV_INSIGHT_REPORT_RESPONSE_MIME_TYPE || 'application/json').trim(),
    maxOutputTokens: toFiniteNumber(process.env.GOV_INSIGHT_REPORT_MAX_OUTPUT_TOKENS, 4096),
    timeoutMs: toFiniteNumber(process.env.GOV_INSIGHT_REPORT_TIMEOUT_MS, 600000),
  };
}

const parseRegionId = (orgId: unknown): number | null => {
  if (typeof orgId === 'number' && Number.isFinite(orgId)) {
    return orgId;
  }

  if (typeof orgId === 'string') {
    const match = orgId.match(/\d+/);
    if (match) return parseInt(match[0], 10);
  }

  return null;
};

const isRegionAllowed = (regionId: number, allowedRegionIds: number[] | null): boolean => {
  if (!allowedRegionIds) return true;
  return allowedRegionIds.includes(regionId);
};

const serializeGovInsightJob = (row: Record<string, any>) => ({
  id: Number(row.id),
  regionId: Number(row.region_id),
  orgId: String(row.org_id || ''),
  orgName: String(row.org_name || ''),
  year: Number(row.year),
  status: String(row.status || 'queued'),
  progress: Number(row.progress || 0),
  stepCode: String(row.step_code || 'QUEUED'),
  stepName: String(row.step_name || '等待处理'),
  model: String(row.model || ''),
  errorCode: row.error_code ? String(row.error_code) : '',
  errorMessage: row.error_message ? String(row.error_message) : '',
  retryCount: Number(row.retry_count || 0),
  maxRetries: Number(row.max_retries || 0),
  createdAt: row.created_at,
  startedAt: row.started_at,
  finishedAt: row.finished_at,
});

// Optional auth - allow public access for dashboard display
// If you need authentication, uncomment the next line:
// router.use(authMiddleware);

/**
 * GET /api/gov-insight/annual-data
 * 
 * 政务公开智慧治理大屏数据接口
 * 
 * Query Parameters:
 *   - year (optional): 年份, e.g. 2024
 *   - org_id (optional): 单位ID, e.g. "city_1001" or numeric region_id
 */
router.get('/annual-data', async (req, res) => {
  try {
    const yearParam = typeof req.query.year === 'string' ? req.query.year.trim() : '';
    const orgIdParam = typeof req.query.org_id === 'string' ? req.query.org_id.trim() : '';
    const includeChildren = req.query.include_children === 'true';

    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    // Year filter
    if (yearParam) {
      const yearNum = Number(yearParam);
      if (!Number.isInteger(yearNum) || yearNum < 1900 || yearNum > 2100) {
        return res.status(400).json({
          code: 400,
          msg: 'Invalid year parameter',
          data: null,
        });
      }
      conditions.push(`year = $${paramIndex++}`);
      params.push(yearNum);
    }

    // Org ID filter - support both string format (city_1001) and numeric region_id
    // Org ID filter - support both string format (city_1001) and numeric region_id
    if (orgIdParam) {
      // Check if it's a numeric ID
      let numericId = Number(orgIdParam);
      if (Number.isNaN(numericId) || !Number.isFinite(numericId)) {
        // Try to extract from string
        const match = orgIdParam.match(/(\d+)$/);
        if (match) {
          numericId = Number(match[1]);
        }
      }

      if (!Number.isNaN(numericId) && numericId > 0) {
        if (includeChildren) {
          // fetch direct children IDs first to support grandchild data
          const childrenRes = await pool.query('SELECT id FROM regions WHERE parent_id = $1', [numericId]);
          const childIds = childrenRes.rows.map((r: any) => r.id);
          const allParentIds = [numericId, ...childIds];

          // condition: record's parent is one of these IDs (so record is child or grandchild)
          // OR record IS one of these IDs (if using IDs as org_id, though usually import_...)
          // Optimizing: just check parent_id column in stats view.
          // Note: parent_id in stats view is usually a string (e.g. "824").

          // We must be careful with parameter indexing. 
          // We will generate placeholders like $2, $3...
          const placeholders = allParentIds.map((_, i) => `$${paramIndex + i}`).join(', ');

          conditions.push(`(
            split_part(org_id, '_', 2) IN (${placeholders}) -- Matches org_id like 'city_721'
            OR 
            parent_id IN (${placeholders}) -- Matches parent_id column '721' or '824'
          )`);

          params.push(...allParentIds.map(String)); // Ensure strings for comparison if mixed types
          paramIndex += allParentIds.length;

        } else {
          // Single org logic
          conditions.push(`(org_id LIKE $${paramIndex} OR parent_id LIKE $${paramIndex})`);
          params.push(`%_${numericId}`);
          paramIndex++;
        }
      } else {
        // Fallback for non-numeric strict match
        conditions.push(`org_id = $${paramIndex++}`);
        params.push(orgIdParam);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Query the aggregation VIEW
    const result = await pool.query(`
      SELECT
        id,
        year,
        org_id,
        org_name,
        org_type,
        parent_id,
        reg_published,
        reg_active,
        reg_abolished,
        doc_published,
        doc_active,
        doc_abolished,
        action_licensing,
        action_punishment,
        action_force,
        fees_amount,
        app_new,
        app_carried_over,
        source_natural,
        outcome_public,
        outcome_partial,
        outcome_unable,
        outcome_unable_no_info,
        outcome_unable_need_creation,
        outcome_unable_unclear,
        outcome_not_open,
        outcome_not_open_state_secret,
        outcome_not_open_law_forbidden,
        outcome_not_open_danger,
        outcome_not_open_process,
        outcome_not_open_internal,
        outcome_not_open_third_party,
        outcome_not_open_enforcement,
        outcome_not_open_admin_query,
        outcome_ignore,
        outcome_complaint,
        outcome_ignore_repeat,
        outcome_publication,
        outcome_massive,
        outcome_confirm,
        outcome_other,
        outcome_overdue_correction,
        outcome_overdue_fee,
        outcome_other_reasons,
        app_carried_forward,
        rev_total,
        rev_corrected,
        lit_total,
        lit_corrected
      FROM gov_open_annual_stats
      ${whereClause}
      ORDER BY year DESC, org_name ASC
      LIMIT 2000
    `, params);

    const rows = result.rows;

    return res.json({
      code: 200,
      msg: 'success',
      data: rows.map((row: any) => ({
        year: row.year,
        org_id: row.org_id,
        org_name: row.org_name,
        org_type: row.org_type,
        parent_id: row.parent_id,
        // 规章/规范性文件
        // 规章/规范性文件
        reg_published: Number(row.reg_published) || 0,
        reg_active: Number(row.reg_active) || 0,
        reg_abolished: Number(row.reg_abolished) || 0,
        doc_published: Number(row.doc_published) || 0,
        doc_active: Number(row.doc_active) || 0,
        doc_abolished: Number(row.doc_abolished) || 0,
        action_licensing: Number(row.action_licensing) || 0,
        action_punishment: Number(row.action_punishment) || 0,
        action_force: Number(row.action_force) || 0,
        fees_amount: row.fees_amount == null ? null : Number(row.fees_amount),
        // 依申请公开
        app_new: Number(row.app_new) || 0,
        app_carried_over: Number(row.app_carried_over) || 0,
        source_natural: Number(row.source_natural) || 0,
        outcome_public: Number(row.outcome_public) || 0,
        outcome_partial: Number(row.outcome_partial) || 0,
        outcome_unable: Number(row.outcome_unable) || 0,
        outcome_unable_no_info: Number(row.outcome_unable_no_info) || 0,
        outcome_unable_need_creation: Number(row.outcome_unable_need_creation) || 0,
        outcome_unable_unclear: Number(row.outcome_unable_unclear) || 0,
        outcome_not_open: Number(row.outcome_not_open) || 0,
        outcome_not_open_state_secret: Number(row.outcome_not_open_state_secret) || 0,
        outcome_not_open_law_forbidden: Number(row.outcome_not_open_law_forbidden) || 0,
        outcome_not_open_danger: Number(row.outcome_not_open_danger) || 0,
        outcome_not_open_process: Number(row.outcome_not_open_process) || 0,
        outcome_not_open_internal: Number(row.outcome_not_open_internal) || 0,
        outcome_not_open_third_party: Number(row.outcome_not_open_third_party) || 0,
        outcome_not_open_enforcement: Number(row.outcome_not_open_enforcement) || 0,
        outcome_not_open_admin_query: Number(row.outcome_not_open_admin_query) || 0,
        outcome_ignore: Number(row.outcome_ignore) || 0,
        outcome_complaint: Number(row.outcome_complaint) || 0,
        outcome_ignore_repeat: Number(row.outcome_ignore_repeat) || 0,
        outcome_publication: Number(row.outcome_publication) || 0,
        outcome_massive: Number(row.outcome_massive) || 0,
        outcome_confirm: Number(row.outcome_confirm) || 0,
        outcome_other: Number(row.outcome_other) || 0,
        outcome_overdue_correction: Number(row.outcome_overdue_correction) || 0,
        outcome_overdue_fee: Number(row.outcome_overdue_fee) || 0,
        outcome_other_reasons: Number(row.outcome_other_reasons) || 0,
        app_carried_forward: Number(row.app_carried_forward) || 0,
        // 复议诉讼
        rev_total: Number(row.rev_total) || 0,
        rev_corrected: Number(row.rev_corrected) || 0,
        lit_total: Number(row.lit_total) || 0,
        lit_corrected: Number(row.lit_corrected) || 0,
      })),
    });
  } catch (error) {
    console.error('[GovInsight] Failed to fetch annual data:', error);
    return res.status(500).json({
      code: 500,
      msg: 'Internal server error',
      data: null,
    });
  }
});

/**
 * GET /api/gov-insight/years
 * 
 * 获取可用年份列表
 */
router.get('/years', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT year
      FROM gov_open_annual_stats
      ORDER BY year DESC
    `);
    const rows = result.rows;

    return res.json({
      code: 200,
      msg: 'success',
      data: rows.map((row: any) => row.year),
    });
  } catch (error) {
    console.error('[GovInsight] Failed to fetch years:', error);
    return res.status(500).json({
      code: 500,
      msg: 'Internal server error',
      data: null,
    });
  }
});

/**
 * GET /api/gov-insight/orgs
 * 
 * 获取可用单位列表
 */
router.get('/orgs', async (req, res) => {
  try {
    const yearParam = typeof req.query.year === 'string' ? req.query.year.trim() : '';

    let whereClause = '';
    const params: any[] = [];
    if (yearParam) {
      const yearNum = Number(yearParam);
      if (Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2100) {
        whereClause = `WHERE year = $1`;
        params.push(yearNum);
      }
    }

    const result = await pool.query(`
      SELECT DISTINCT org_id, org_name, org_type, parent_id
      FROM gov_open_annual_stats
      ${whereClause}
      ORDER BY org_type, org_name ASC
    `, params);
    const rows = result.rows;

    return res.json({
      code: 200,
      msg: 'success',
      data: rows.map((row: any) => ({
        id: row.org_id,
        name: row.org_name,
        type: row.org_type,
        parent_id: row.parent_id,
      })),
    });
  } catch (error) {
    console.error('[GovInsight] Failed to fetch orgs:', error);
    return res.status(500).json({
      code: 500,
      msg: 'Internal server error',
      data: null,
    });
  }
});

/**
 * GET /api/gov-insight/annual-report-summary
 *
 * 获取指定单位年度报告的原文摘要
 */
router.get('/annual-report-summary', async (req, res) => {
  try {
    const { org_id, year } = req.query;
    if (!org_id || !year) {
      return res.status(400).json({ code: 400, msg: 'Missing params', data: null });
    }

    const regionId = parseRegionId(org_id);
    const yearNum = Number(year);
    if (!regionId || !Number.isInteger(yearNum)) {
      return res.status(400).json({ code: 400, msg: 'Invalid params', data: null });
    }

    const result = await pool.query(
      `
      SELECT
        r.id AS report_id,
        r.unit_name,
        rv.storage_path,
        rv.raw_text
      FROM reports r
      LEFT JOIN report_versions rv ON rv.id = r.active_version_id
      WHERE r.region_id = $1 AND r.year = $2
      LIMIT 1
      `,
      [regionId, yearNum]
    );

    if (result.rows.length === 0) {
      return res.json({ code: 200, msg: 'not_found', data: null });
    }

    const row = result.rows[0];
    let rawText = normalizePlainText(row.raw_text || '');

    if (!rawText && row.storage_path) {
      try {
        rawText = await loadTextFromStoragePath(row.storage_path);
      } catch (fileError) {
        console.warn('[GovInsight] Failed to load annual report from storage path:', fileError);
      }
    }

    if (!rawText) {
      return res.json({
        code: 200,
        msg: 'empty',
        data: {
          title: '',
          publishDate: '',
          available: false,
          rawTextPreview: '',
          highlights: [],
          problemSnippets: [],
          improvements: [],
          sections: {
            proactiveDisclosure: '',
            requestDisclosure: '',
            platformConstruction: '',
            supervision: '',
            problems: '',
            improvements: '',
          },
        },
      });
    }

    const summary = extractAnnualReportSummary(rawText);

    return res.json({
      code: 200,
      msg: 'success',
      data: {
        ...summary,
        available: true,
        unitName: row.unit_name,
        rawTextPreview: cleanExcerpt(rawText, 500),
      },
    });
  } catch (error) {
    console.error('[GovInsight] Failed to fetch annual report summary:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

/**
 * POST /api/gov-insight/ai-report/jobs
 *
 * 创建或复用后台 AI 报告生成任务
 */
router.post('/ai-report/jobs', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const {
      org_id,
      org_name,
      year,
      prompt,
      model,
      systemInstruction,
      config,
    } = req.body || {};

    const regionId = parseRegionId(org_id);
    const yearNum = Number(year);
    const resolvedModel = String(model || resolveGovInsightReportModel()).trim();
    const resolvedConfig = resolveGovInsightRequestConfig(config);

    if (!regionId || !Number.isInteger(yearNum) || !prompt || !resolvedModel) {
      return res.status(400).json({ code: 400, msg: 'Missing or invalid params', data: null });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (!isRegionAllowed(regionId, allowedRegionIds)) {
      return res.status(403).json({ code: 403, msg: 'forbidden', data: null });
    }

    const statsRes = await pool.query(
      `
      SELECT org_name
      FROM gov_open_annual_stats
      WHERE split_part(org_id, '_', 2) = $1 AND year = $2
      ORDER BY CASE WHEN org_id = $3 THEN 0 ELSE 1 END, org_name ASC
      LIMIT 1
      `,
      [String(regionId), yearNum, String(org_id)]
    );

    if (statsRes.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: 'report_data_not_found', data: null });
    }

    const activeJobRes = await pool.query(
      `
      SELECT *
      FROM gov_insight_report_jobs
      WHERE region_id = $1 AND year = $2 AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [regionId, yearNum]
    );

    if (activeJobRes.rows.length > 0) {
      return res.json({
        code: 200,
        msg: 'success',
        data: {
          reused: true,
          job: serializeGovInsightJob(activeJobRes.rows[0]),
        },
      });
    }

    const resolvedOrgName = String(org_name || statsRes.rows[0]?.org_name || org_id);

    try {
      const insertRes = await pool.query(
        `
        INSERT INTO gov_insight_report_jobs (
          region_id,
          org_id,
          org_name,
          year,
          model,
          prompt_text,
          system_instruction,
          request_config,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
        `,
        [
          regionId,
          String(org_id),
          resolvedOrgName,
          yearNum,
          resolvedModel,
          String(prompt),
          systemInstruction ? String(systemInstruction) : null,
          JSON.stringify(resolvedConfig),
          req.user?.id || null,
        ]
      );

      return res.status(201).json({
        code: 200,
        msg: 'success',
        data: {
          reused: false,
          job: serializeGovInsightJob(insertRes.rows[0]),
        },
      });
    } catch (insertError: any) {
      if (insertError?.code === '23505') {
        const reusedRes = await pool.query(
          `
          SELECT *
          FROM gov_insight_report_jobs
          WHERE region_id = $1 AND year = $2 AND status IN ('queued', 'running')
          ORDER BY created_at DESC
          LIMIT 1
          `,
          [regionId, yearNum]
        );

        if (reusedRes.rows.length > 0) {
          return res.json({
            code: 200,
            msg: 'success',
            data: {
              reused: true,
              job: serializeGovInsightJob(reusedRes.rows[0]),
            },
          });
        }
      }

      throw insertError;
    }
  } catch (error) {
    console.error('[GovInsight] Failed to create AI report job:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

/**
 * GET /api/gov-insight/ai-report/jobs/latest
 *
 * 获取某单位年度的最近一条 AI 报告生成任务
 */
router.get('/ai-report/jobs/latest', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const orgId = typeof req.query.org_id === 'string' ? req.query.org_id.trim() : '';
    const yearNum = Number(req.query.year);
    const regionId = parseRegionId(orgId);

    if (!regionId || !Number.isInteger(yearNum)) {
      return res.status(400).json({ code: 400, msg: 'Invalid params', data: null });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (!isRegionAllowed(regionId, allowedRegionIds)) {
      return res.status(403).json({ code: 403, msg: 'forbidden', data: null });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM gov_insight_report_jobs
      WHERE region_id = $1 AND year = $2
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [regionId, yearNum]
    );

    if (result.rows.length === 0) {
      return res.json({ code: 200, msg: 'not_found', data: null });
    }

    return res.json({
      code: 200,
      msg: 'success',
      data: serializeGovInsightJob(result.rows[0]),
    });
  } catch (error) {
    console.error('[GovInsight] Failed to fetch latest AI report job:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

/**
 * GET /api/gov-insight/ai-report/jobs/:jobId
 *
 * 获取 AI 报告后台任务状态
 */
router.get('/ai-report/jobs/:jobId', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const jobId = Number(req.params.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      return res.status(400).json({ code: 400, msg: 'Invalid job ID', data: null });
    }

    const result = await pool.query(
      `
      SELECT *
      FROM gov_insight_report_jobs
      WHERE id = $1
      LIMIT 1
      `,
      [jobId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: 'Job not found', data: null });
    }

    const job = result.rows[0];
    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (!isRegionAllowed(Number(job.region_id), allowedRegionIds)) {
      return res.status(403).json({ code: 403, msg: 'forbidden', data: null });
    }

    return res.json({
      code: 200,
      msg: 'success',
      data: serializeGovInsightJob(job),
    });
  } catch (error) {
    console.error('[GovInsight] Failed to fetch AI report job:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

/**
 * POST /api/gov-insight/ai-report/save
 * 
 * 保存 AI 辅助决策报告
 */
router.post('/ai-report/save', async (req, res) => {
  try {
    const { org_id, org_name, year, content, model } = req.body;
    const resolvedModel = String(model || resolveGovInsightReportModel()).trim();

    // Validate inputs
    if (!org_id || !year || !content) {
      return res.status(400).json({
        code: 400,
        msg: 'Missing required fields',
        data: null,
      });
    }

    // Parse numeric region_id from string org_id (e.g. "city_3201" -> 3201)
    // If not parseable, we might need a mapping or assume it's direct.
    // For now, assume format prefix_ID or just ID.
    const regionId = parseRegionId(org_id);

    if (!regionId) {
      return res.status(400).json({ code: 400, msg: 'Invalid org_id format', data: null });
    }

    // Upsert logic
    await pool.query(`
      INSERT INTO ai_decision_reports (region_id, org_name, year, content_json, model_used, updated_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (region_id, year) 
      DO UPDATE SET 
        content_json = EXCLUDED.content_json,
        model_used = EXCLUDED.model_used,
        updated_at = NOW()
    `, [regionId, org_name, year, JSON.stringify(content), resolvedModel]);

    return res.json({ code: 200, msg: 'success', data: null });
  } catch (error) {
    console.error('[GovInsight] Failed to save AI report:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

/**
 * GET /api/gov-insight/ai-report
 * 
 * 获取 AI 辅助决策报告
 */
router.get('/ai-report', async (req, res) => {
  try {
    const { org_id, year } = req.query;
    if (!org_id || !year) {
      return res.status(400).json({ code: 400, msg: 'Missing params', data: null });
    }

    const regionId = parseRegionId(org_id);

    const result = await pool.query(`
      SELECT content_json, model_used, updated_at
      FROM ai_decision_reports
      WHERE region_id = $1 AND year = $2
      LIMIT 1
    `, [regionId, year]);

    if (result.rows.length === 0) {
      return res.json({ code: 200, msg: 'not_found', data: null });
    }

    return res.json({
      code: 200,
      msg: 'success',
      data: {
        content: result.rows[0].content_json,
        model: result.rows[0].model_used,
        updatedAt: result.rows[0].updated_at
      }
    });

  } catch (error) {
    console.error('[GovInsight] Failed to fetch AI report:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

export default router;
