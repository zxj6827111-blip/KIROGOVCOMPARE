import express from 'express';
import pool from '../config/database-llm';
import { authMiddleware, optionalAuthMiddleware, requirePermission, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import {
  cleanExcerpt,
  extractAnnualReportSummary,
  loadTextFromStoragePath,
  normalizePlainText,
} from '../utils/annualReportSummary';
import { resolveUnifiedLlmConfig } from '../utils/aiEnv';
import { govInsightReportPayloadService } from '../services/GovInsightReportPayloadService';
import {
  buildGovInsightNarrativeResponseSchema,
  buildStoredNarrativeEnvelope,
  extractGovInsightStoredEnvelope,
  GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
  GOVINSIGHT_PAYLOAD_VERSION,
  GOVINSIGHT_PROMPT_VERSION,
  reconcileGovInsightNarrativeWithPayload,
  synthesizeGovInsightNarrativeFromPayload,
  validateGovInsightNarrative,
  validateGovInsightReportPayload,
  validateGovInsightStoredEnvelope,
} from '../services/GovInsightReportProtocol';
import { govInsightLeaderCockpitService } from '../services/GovInsightLeaderCockpitService';

const router = express.Router();

function resolveGovInsightReportModel(): string {
  return resolveUnifiedLlmConfig({
    providerEnvKeys: ['GOV_INSIGHT_REPORT_PROVIDER', 'LLM_REPORT_PROVIDER', 'LLM_PROVIDER'],
    modelEnvKeys: ['GOV_INSIGHT_REPORT_MODEL', 'LLM_REPORT_MODEL', 'OPENAI_MODEL', 'LLM_MODEL'],
  }).modelValue;
}

function toFiniteNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveGovInsightRequestConfig(rawConfig: unknown): Record<string, unknown> {
  const defaults = {
    temperature: toFiniteNumber(process.env.GOV_INSIGHT_REPORT_TEMPERATURE, 0.3),
    thinkingBudget: toFiniteNumber(process.env.GOV_INSIGHT_REPORT_THINKING_BUDGET, 0),
    responseMimeType: (process.env.GOV_INSIGHT_REPORT_RESPONSE_MIME_TYPE || 'application/json').trim(),
    maxOutputTokens: toFiniteNumber(process.env.GOV_INSIGHT_REPORT_MAX_OUTPUT_TOKENS, 4096),
    timeoutMs: toFiniteNumber(process.env.GOV_INSIGHT_REPORT_TIMEOUT_MS, 600000),
    apiMode: (process.env.GOV_INSIGHT_REPORT_OPENAI_API_MODE || process.env.OPENAI_API_MODE || 'responses').trim().toLowerCase(),
    reasoningEffort: (process.env.GOV_INSIGHT_REPORT_OPENAI_REASONING_EFFORT || process.env.OPENAI_REASONING_EFFORT || 'xhigh').trim().toLowerCase(),
    responseSchema: buildGovInsightNarrativeResponseSchema(),
    responseSchemaName: 'govinsight_formal_report_v2',
    responseSchemaDescription: 'Structured formal GovInsight decision report JSON.',
  };

  if (rawConfig && typeof rawConfig === 'object') {
    const provided = rawConfig as Record<string, unknown>;
    return {
      ...defaults,
      ...provided,
      responseSchema: provided.responseSchema || defaults.responseSchema,
      responseSchemaName: provided.responseSchemaName || defaults.responseSchemaName,
      responseSchemaDescription: provided.responseSchemaDescription || defaults.responseSchemaDescription,
    };
  }

  return defaults;
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

const canBypassGovInsightAiAuth = (): boolean => process.env.NODE_ENV !== 'production';

const ensureGovInsightAiAuth = (req: AuthRequest, res: express.Response): boolean => {
  if (req.user || canBypassGovInsightAiAuth()) {
    return true;
  }

  res.status(401).json({ code: 401, msg: '未登录，请先登录', data: null });
  return false;
};

const parseBooleanParam = (value: unknown, fallback = false): boolean => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
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

const resolveStoredReportEnvelope = (row: Record<string, any>) => {
  const extracted = extractGovInsightStoredEnvelope(row.content_json);
  const toNullableDbNumber = (value: unknown): number | null => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  return {
    extracted,
    reportPayload:
      row.report_payload_json ||
      extracted?.reportPayload ||
      null,
    protocolVersion:
      row.protocol_version ||
      extracted?.protocolVersion ||
      null,
    reportFormat:
      extracted?.reportFormat ||
      null,
    payloadVersion:
      row.payload_version ||
      extracted?.payloadVersion ||
      null,
    promptVersion:
      row.prompt_version ||
      extracted?.promptVersion ||
      null,
    outputSchemaVersion:
      row.output_schema_version ||
      extracted?.outputSchemaVersion ||
      null,
    materializeStatus:
      row.materialize_status ||
      extracted?.materializeStatus ||
      null,
    sourceJobId:
      toNullableDbNumber(row.source_job_id) ??
      extracted?.sourceJobId ??
      null,
    sourceReportVersionId:
      toNullableDbNumber(row.source_report_version_id) ??
      extracted?.sourceReportVersionId ??
      null,
    modelUsed:
      row.model_used ||
      extracted?.modelUsed ||
      null,
  };
};

const resolveEffectiveReportPayload = async (
  regionId: number,
  year: number,
  storedPayload: Record<string, unknown> | null
): Promise<{
  payload: Record<string, unknown> | null;
  payloadSource: 'stored' | 'rebuilt' | 'missing';
  storedPayloadErrors: string[];
}> => {
  if (storedPayload) {
    const validation = validateGovInsightReportPayload(storedPayload);
    if (validation.valid) {
      return {
        payload: storedPayload,
        payloadSource: 'stored',
        storedPayloadErrors: [],
      };
    }
  }

  const storedPayloadErrors = storedPayload
    ? validateGovInsightReportPayload(storedPayload).errors
    : [];

  try {
    const rebuiltPayload = await govInsightReportPayloadService.build(regionId, year);
    const rebuiltValidation = validateGovInsightReportPayload(rebuiltPayload);
    if (!rebuiltValidation.valid) {
      return {
        payload: null,
        payloadSource: 'missing',
        storedPayloadErrors: storedPayloadErrors.length ? storedPayloadErrors : rebuiltValidation.errors,
      };
    }
    return {
      payload: rebuiltPayload as unknown as Record<string, unknown>,
      payloadSource: 'rebuilt',
      storedPayloadErrors,
    };
  } catch {
    return {
      payload: null,
      payloadSource: 'missing',
      storedPayloadErrors,
    };
  }
};

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

    conditions.push(`s.materialize_status <> 'blocked_unknown_unit_type'`);

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
      conditions.push(`s.year = $${paramIndex++}`);
      params.push(yearNum);
    }

    // Org ID filter - canonical org_id or numeric region_id
    if (orgIdParam) {
      let numericId = Number(orgIdParam);
      if (Number.isNaN(numericId) || !Number.isFinite(numericId)) {
        const match = orgIdParam.match(/(\d+)$/);
        if (match) {
          numericId = Number(match[1]);
        }
      }

      if (!Number.isNaN(numericId) && numericId > 0) {
        if (includeChildren) {
          const childrenRes = await pool.query(
            'SELECT region_id FROM canonical_units WHERE parent_region_id = $1 ORDER BY region_id ASC',
            [numericId]
          );
          const childIds = childrenRes.rows.map((r: any) => Number(r.region_id));
          const allParentIds = [numericId, ...childIds];
          const placeholders = allParentIds.map((_, i) => `$${paramIndex + i}`).join(', ');
          conditions.push(`(s.region_id IN (${placeholders}) OR s.parent_region_id IN (${placeholders}))`);
          params.push(...allParentIds);
          paramIndex += allParentIds.length;
        } else {
          conditions.push(`(s.region_id = $${paramIndex} OR s.parent_region_id = $${paramIndex})`);
          params.push(numericId);
          paramIndex++;
        }
      } else {
        conditions.push(`s.org_id = $${paramIndex++}`);
        params.push(orgIdParam);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(`
      SELECT
        s.region_id,
        s.year,
        s.org_id,
        s.org_name,
        s.unit_type AS org_type,
        CASE
          WHEN s.parent_region_id IS NULL THEN NULL
          WHEN parent_cu.unit_type IS NOT NULL THEN CONCAT(parent_cu.unit_type, '_', s.parent_region_id)
          ELSE CONCAT('unknown_', s.parent_region_id)
        END AS parent_id,
        s.unit_type AS canonical_unit_type,
        s.parent_region_id::text AS canonical_parent_region_id,
        s.city_region_id::text AS city_region_id,
        s.materialize_status,
        s.is_official,
        s.metric_version,
        s.mapping_version,
        s.reg_published,
        s.reg_active,
        s.reg_abolished,
        s.doc_published,
        s.doc_active,
        s.doc_abolished,
        s.action_licensing,
        s.action_punishment,
        s.action_force,
        s.fees_amount,
        s.app_new,
        s.app_carried_over,
        s.source_natural,
        s.outcome_public,
        s.outcome_partial,
        s.outcome_unable,
        s.outcome_unable_no_info,
        s.outcome_unable_need_creation,
        s.outcome_unable_unclear,
        s.outcome_not_open,
        s.outcome_not_open_state_secret,
        s.outcome_not_open_law_forbidden,
        s.outcome_not_open_danger,
        s.outcome_not_open_process,
        s.outcome_not_open_internal,
        s.outcome_not_open_third_party,
        s.outcome_not_open_enforcement,
        s.outcome_not_open_admin_query,
        s.outcome_ignore,
        s.outcome_complaint,
        s.outcome_ignore_repeat,
        s.outcome_publication,
        s.outcome_massive,
        s.outcome_confirm,
        s.outcome_other,
        s.outcome_overdue_correction,
        s.outcome_overdue_fee,
        s.outcome_other_reasons,
        s.app_carried_forward,
        s.rev_total,
        s.rev_corrected,
        s.lit_total,
        s.lit_corrected
      FROM gov_open_annual_stats_v2 s
      LEFT JOIN canonical_units parent_cu ON parent_cu.region_id = s.parent_region_id
      ${whereClause}
      ORDER BY s.year DESC, s.org_name ASC
      LIMIT 2000
    `, params);

    const rows = result.rows;

    return res.json({
      code: 200,
      msg: 'success',
      data: rows.map((row: any) => ({
        region_id: Number(row.region_id),
        year: row.year,
        org_id: row.org_id,
        org_name: row.org_name,
        org_type: row.org_type,
        parent_id: row.parent_id,
        canonical_unit_type: row.canonical_unit_type,
        canonical_parent_region_id: row.canonical_parent_region_id,
        city_region_id: row.city_region_id,
        materialize_status: row.materialize_status,
        is_official: row.is_official === true,
        metric_version: row.metric_version,
        mapping_version: row.mapping_version,
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
      FROM gov_open_annual_stats_v2
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
        whereClause = `WHERE s.materialize_status <> 'blocked_unknown_unit_type' AND s.year = $1`;
        params.push(yearNum);
      }
    }
    if (!whereClause) {
      whereClause = `WHERE s.materialize_status <> 'blocked_unknown_unit_type'`;
    }

    const result = await pool.query(`
      WITH RECURSIVE ranked_orgs AS (
        SELECT
          s.region_id,
          s.org_id,
          s.org_name,
          s.unit_type,
          s.parent_region_id,
          s.city_region_id,
          s.materialize_status,
          s.is_official,
          s.year,
          s.updated_at,
          ROW_NUMBER() OVER (
            PARTITION BY s.region_id
            ORDER BY
              CASE s.materialize_status
                WHEN 'official' THEN 0
                WHEN 'preview' THEN 1
                WHEN 'blocked_mapping_pending' THEN 2
                WHEN 'blocked_unknown_unit_type' THEN 3
                ELSE 4
              END ASC,
              s.year DESC,
              s.updated_at DESC
          ) AS rn
        FROM gov_open_annual_stats_v2 s
        ${whereClause}
      ),
      selected_orgs AS (
        SELECT
          ro.region_id,
          ro.org_id,
          ro.org_name,
          ro.unit_type,
          ro.parent_region_id,
          ro.city_region_id,
          ro.materialize_status,
          ro.is_official
        FROM ranked_orgs ro
        WHERE ro.rn = 1
      ),
      canonical_tree AS (
        SELECT
          cu.region_id,
          r.name AS region_name,
          cu.unit_type,
          cu.parent_region_id,
          cu.city_region_id
        FROM canonical_units cu
        INNER JOIN regions r ON r.id = cu.region_id
        WHERE cu.unit_type <> 'unknown'
      )
      SELECT
        ct.region_id,
        COALESCE(so.org_id, CONCAT(ct.unit_type, '_', ct.region_id)) AS org_id,
        COALESCE(NULLIF(so.org_name, ''), ct.region_name) AS org_name,
        ct.unit_type,
        CASE
          WHEN ct.parent_region_id IS NULL THEN NULL
          WHEN parent_cu.unit_type IS NOT NULL THEN CONCAT(parent_cu.unit_type, '_', ct.parent_region_id)
          ELSE CONCAT('unknown_', ct.parent_region_id)
        END AS parent_id,
        ct.parent_region_id::text AS canonical_parent_region_id,
        ct.city_region_id::text AS city_region_id,
        COALESCE(so.materialize_status, 'hierarchy_only') AS materialize_status,
        COALESCE(so.is_official, false) AS is_official
      FROM canonical_tree ct
      LEFT JOIN selected_orgs so ON so.region_id = ct.region_id
      LEFT JOIN canonical_units parent_cu ON parent_cu.region_id = ct.parent_region_id
      ORDER BY
        CASE ct.unit_type
          WHEN 'province' THEN 0
          WHEN 'city' THEN 1
          WHEN 'district' THEN 2
          WHEN 'functional_zone' THEN 3
          WHEN 'town_street' THEN 4
          WHEN 'department' THEN 5
          ELSE 99
        END ASC,
        COALESCE(NULLIF(so.org_name, ''), ct.region_name) ASC
    `, params);
    const rows = result.rows;

    return res.json({
      code: 200,
      msg: 'success',
      data: rows.map((row: any) => ({
        region_id: Number(row.region_id),
        id: row.org_id,
        name: row.org_name,
        type: row.unit_type,
        parent_id: row.parent_id,
        canonical_unit_type: row.unit_type,
        canonical_parent_region_id: row.canonical_parent_region_id,
        city_region_id: row.city_region_id,
        materialize_status: row.materialize_status,
        is_official: row.is_official === true,
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
      try {
        const payload = await govInsightReportPayloadService.build(regionId, yearNum);
        const synthesizedNarrative = synthesizeGovInsightNarrativeFromPayload(payload);
        if (!synthesizedNarrative) {
          return res.json({ code: 200, msg: 'not_found', data: null });
        }

        const transientEnvelope = buildStoredNarrativeEnvelope({
          narrative: synthesizedNarrative,
          reportContent: synthesizedNarrative,
          reportPayload: payload,
          materializeStatus: payload.materializeStatus,
          sourceReportVersionId: payload.sourceReportVersionId,
          modelUsed: 'system/report_payload_v1_fallback',
          promptVersion: GOVINSIGHT_PROMPT_VERSION,
          payloadVersion: payload.version || GOVINSIGHT_PAYLOAD_VERSION,
          outputSchemaVersion: GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
        });

        return res.json({
          code: 200,
          msg: 'success',
          data: {
            content: transientEnvelope,
            model: 'system/report_payload_v1_fallback',
            updatedAt: new Date().toISOString(),
            protocolVersion: 'gov_insight_ai_report_v1',
            reportFormat: 'govInsightFormalReportV2',
            payloadVersion: payload.version || GOVINSIGHT_PAYLOAD_VERSION,
            promptVersion: GOVINSIGHT_PROMPT_VERSION,
            outputSchemaVersion: GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
            materializeStatus: payload.materializeStatus,
            sourceJobId: null,
            sourceReportVersionId: payload.sourceReportVersionId ?? null,
            payloadSource: 'rebuilt',
            storedPayloadErrors: ['stored_report_missing_transient_payload_fallback'],
            reportPayload: payload,
            transient: true,
          }
        });
      } catch (payloadError) {
        console.warn('[GovInsight] No stored AI report and transient payload synthesis failed:', payloadError);
        return res.json({ code: 200, msg: 'not_found', data: null });
      }
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
 * GET /api/gov-insight/leader-cockpit/model
 *
 * 获取领导驾驶舱总览模型（后端权威口径）
 */
router.get('/leader-cockpit/model', authMiddleware, async (req: AuthRequest, res) => {
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

    const model = await govInsightLeaderCockpitService.buildModel(regionId, yearNum);
    if (!model) {
      return res.json({ code: 200, msg: 'not_found', data: null });
    }

    return res.json({ code: 200, msg: 'success', data: model });
  } catch (error) {
    console.error('[GovInsight] Failed to fetch leader cockpit model:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

/**
 * GET /api/gov-insight/leader-cockpit/comparison
 *
 * 获取领导驾驶舱区县/部门对比模型（后端权威口径）
 */
router.get('/leader-cockpit/comparison', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const orgId = typeof req.query.org_id === 'string' ? req.query.org_id.trim() : '';
    const yearNum = Number(req.query.year);
    const regionId = parseRegionId(orgId);
    const viewLevel = typeof req.query.view_level === 'string' ? req.query.view_level.trim() : '';
    const disclosureMethod = typeof req.query.disclosure_method === 'string'
      ? req.query.disclosure_method.trim()
      : 'substantive';
    const correctionMethod = typeof req.query.correction_method === 'string'
      ? req.query.correction_method.trim()
      : 'reconsideration';

    if (!regionId || !Number.isInteger(yearNum)) {
      return res.status(400).json({ code: 400, msg: 'Invalid params', data: null });
    }

    if (viewLevel !== 'district' && viewLevel !== 'department') {
      return res.status(400).json({ code: 400, msg: 'Invalid view_level', data: null });
    }

    if (disclosureMethod !== 'substantive' && disclosureMethod !== 'absolute') {
      return res.status(400).json({ code: 400, msg: 'Invalid disclosure_method', data: null });
    }

    if (correctionMethod !== 'reconsideration' && correctionMethod !== 'comprehensive') {
      return res.status(400).json({ code: 400, msg: 'Invalid correction_method', data: null });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (!isRegionAllowed(regionId, allowedRegionIds)) {
      return res.status(403).json({ code: 403, msg: 'forbidden', data: null });
    }

    const model = await govInsightLeaderCockpitService.buildComparisonModel(regionId, yearNum, viewLevel, {
      disclosureMethod,
      correctionMethod,
      includesCarryOver: parseBooleanParam(req.query.includes_carry_over, false),
      enableStableSample: parseBooleanParam(req.query.enable_stable_sample, true),
    });

    if (!model) {
      return res.json({ code: 200, msg: 'not_found', data: null });
    }

    return res.json({ code: 200, msg: 'success', data: model });
  } catch (error) {
    console.error('[GovInsight] Failed to fetch leader cockpit comparison model:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

/**
 * POST /api/gov-insight/ai-report/jobs
 *
 * 创建或复用后台 AI 报告生成任务
 */
router.post('/ai-report/jobs', optionalAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!ensureGovInsightAiAuth(req, res)) return;

    const {
      org_id,
      org_name,
      year,
      prompt,
      systemInstruction,
      config,
      use_backend_payload,
    } = req.body || {};

    const regionId = parseRegionId(org_id);
    const yearNum = Number(year);
    const resolvedModel = resolveGovInsightReportModel();
    const resolvedMaxRetries = 0;
    const resolvedConfig = resolveGovInsightRequestConfig(config);
    const useBackendPayload = use_backend_payload !== false;

    if (!regionId || !Number.isInteger(yearNum) || !resolvedModel) {
      return res.status(400).json({ code: 400, msg: 'Missing or invalid params', data: null });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (!isRegionAllowed(regionId, allowedRegionIds)) {
      return res.status(403).json({ code: 403, msg: 'forbidden', data: null });
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

    const regionRes = await pool.query(
      `
      SELECT name
      FROM regions
      WHERE id = $1
      LIMIT 1
      `,
      [regionId]
    );
    if (regionRes.rows.length === 0) {
      return res.status(404).json({ code: 404, msg: 'region_not_found', data: null });
    }

    let reportPayload: Record<string, unknown> | null = null;
    let promptText = typeof prompt === 'string' ? prompt.trim() : '';
    let resolvedSourceReportVersionId: number | null = null;
    let resolvedOrgName = String(org_name || regionRes.rows[0]?.name || org_id);

    if (useBackendPayload || !promptText) {
      const payload = await govInsightReportPayloadService.build(regionId, yearNum);
      reportPayload = payload as unknown as Record<string, unknown>;
      resolvedOrgName = payload.orgName || resolvedOrgName;
      resolvedSourceReportVersionId = payload.sourceReportVersionId ?? null;
      if (!promptText) {
        promptText = govInsightReportPayloadService.buildPrompt(payload);
      }
    }

    if (!promptText) {
      return res.status(400).json({ code: 400, msg: 'Missing or invalid params', data: null });
    }

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
          report_payload_json,
          report_payload_version,
          prompt_version,
          output_schema_version,
          source_report_version_id,
          max_retries,
          created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        RETURNING *
        `,
        [
          regionId,
          String(org_id),
          resolvedOrgName,
          yearNum,
          resolvedModel,
          promptText,
          systemInstruction ? String(systemInstruction) : null,
          JSON.stringify(resolvedConfig),
          reportPayload ? JSON.stringify(reportPayload) : null,
          reportPayload ? GOVINSIGHT_PAYLOAD_VERSION : null,
          GOVINSIGHT_PROMPT_VERSION,
          GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
          resolvedSourceReportVersionId,
          resolvedMaxRetries,
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
router.get('/ai-report/jobs/latest', optionalAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!ensureGovInsightAiAuth(req, res)) return;

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
router.get('/ai-report/jobs/:jobId', optionalAuthMiddleware, async (req: AuthRequest, res) => {
  try {
    if (!ensureGovInsightAiAuth(req, res)) return;

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
 * GET /api/gov-insight/ai-report/payload
 * 
 * 保存 AI 辅助决策报告
 */
router.get('/ai-report/payload', authMiddleware, async (req: AuthRequest, res) => {
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

    const payload = await govInsightReportPayloadService.build(regionId, yearNum);
    return res.json({ code: 200, msg: 'success', data: payload });
  } catch (error) {
    console.error('[GovInsight] Failed to fetch AI report payload:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

/**
 * POST /api/gov-insight/ai-report/save
 *
 * 获取后端构建的 report_payload_v1
 */
router.post('/ai-report/save', authMiddleware, async (req: AuthRequest, res) => {
  try {
    const { org_id, org_name, year, content } = req.body;
    const resolvedModel = resolveGovInsightReportModel();

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

    const contentValidation = validateGovInsightNarrative(content);
    if (!contentValidation.valid) {
      return res.status(400).json({
        code: 400,
        msg: `Invalid report content: ${contentValidation.errors.slice(0, 5).join('; ')}`,
        data: null,
      });
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (!isRegionAllowed(regionId, allowedRegionIds)) {
      return res.status(403).json({ code: 403, msg: 'forbidden', data: null });
    }

    let reportPayload: Record<string, unknown> | null = null;
    let sourceReportVersionId: number | null = null;
    let materializeStatus: string | null = null;

    try {
      const payload = await govInsightReportPayloadService.build(regionId, Number(year));
      const payloadValidation = validateGovInsightReportPayload(payload);
      if (!payloadValidation.valid) {
        throw new Error(`invalid_report_payload: ${payloadValidation.errors.slice(0, 5).join('; ')}`);
      }
      reportPayload = payload as unknown as Record<string, unknown>;
      sourceReportVersionId = payload.sourceReportVersionId ?? null;
      materializeStatus = payload.materializeStatus;
    } catch (payloadError) {
      console.warn('[GovInsight] Failed to build payload during report save, storing report content only:', payloadError);
    }

    const reconciledContent = reconcileGovInsightNarrativeWithPayload(
      content && typeof content === 'object' ? (content as Record<string, unknown>) : null,
      reportPayload
    );

    const storedEnvelope = buildStoredNarrativeEnvelope({
      narrative: reconciledContent || (content && typeof content === 'object' ? content : null),
      reportContent: reconciledContent || (content && typeof content === 'object' ? content : null),
      reportPayload,
      materializeStatus,
      sourceReportVersionId,
      modelUsed: resolvedModel,
    });
    const envelopeValidation = validateGovInsightStoredEnvelope(storedEnvelope);
    if (!envelopeValidation.valid) {
      return res.status(400).json({
        code: 400,
        msg: `Invalid report envelope: ${envelopeValidation.errors.slice(0, 5).join('; ')}`,
        data: null,
      });
    }

    // Upsert logic
    await pool.query(`
      INSERT INTO ai_decision_reports (
        region_id,
        org_name,
        year,
        content_json,
        model_used,
        protocol_version,
        payload_version,
        prompt_version,
        output_schema_version,
        materialize_status,
        source_report_version_id,
        report_payload_json,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'gov_insight_ai_report_v1', $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (region_id, year) 
      DO UPDATE SET 
        org_name = EXCLUDED.org_name,
        content_json = EXCLUDED.content_json,
        model_used = EXCLUDED.model_used,
        protocol_version = EXCLUDED.protocol_version,
        payload_version = EXCLUDED.payload_version,
        prompt_version = EXCLUDED.prompt_version,
        output_schema_version = EXCLUDED.output_schema_version,
        materialize_status = EXCLUDED.materialize_status,
        source_report_version_id = EXCLUDED.source_report_version_id,
        report_payload_json = EXCLUDED.report_payload_json,
        updated_at = NOW()
    `, [
      regionId,
      org_name,
      year,
      JSON.stringify(storedEnvelope),
      resolvedModel,
      reportPayload ? GOVINSIGHT_PAYLOAD_VERSION : null,
      GOVINSIGHT_PROMPT_VERSION,
      GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
      materializeStatus,
      sourceReportVersionId,
      reportPayload ? JSON.stringify(reportPayload) : null,
    ]);

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
    const yearNum = Number(year);
    if (!regionId || !Number.isInteger(yearNum)) {
      return res.status(400).json({ code: 400, msg: 'Invalid params', data: null });
    }

    const result = await pool.query(`
      SELECT
        content_json,
        model_used,
        updated_at,
        protocol_version,
        payload_version,
        prompt_version,
        output_schema_version,
        materialize_status,
        source_job_id,
        source_report_version_id,
        report_payload_json
      FROM ai_decision_reports
      WHERE region_id = $1 AND year = $2
      LIMIT 1
    `, [regionId, yearNum]);

    if (result.rows.length === 0) {
      return res.json({ code: 200, msg: 'not_found', data: null });
    }

    const stored = resolveStoredReportEnvelope(result.rows[0]);
    const effectivePayload = await resolveEffectiveReportPayload(regionId, yearNum, stored.reportPayload as Record<string, unknown> | null);

    return res.json({
      code: 200,
      msg: 'success',
      data: {
        content: result.rows[0].content_json,
        model: stored.modelUsed,
        updatedAt: result.rows[0].updated_at,
        protocolVersion: stored.protocolVersion,
        reportFormat: stored.reportFormat,
        payloadVersion: stored.payloadVersion,
        promptVersion: stored.promptVersion,
        outputSchemaVersion: stored.outputSchemaVersion,
        materializeStatus: stored.materializeStatus,
        sourceJobId: stored.sourceJobId,
        sourceReportVersionId: stored.sourceReportVersionId,
        payloadSource: effectivePayload.payloadSource,
        storedPayloadErrors: effectivePayload.storedPayloadErrors,
        reportPayload: effectivePayload.payload,
      }
    });

  } catch (error) {
    console.error('[GovInsight] Failed to fetch AI report:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

/**
 * GET /api/gov-insight/ai-report/replay
 *
 * 获取正式报告的协议元信息、有效 payload 与可回放 prompt
 */
router.get('/ai-report/replay', authMiddleware, requirePermission('manage_jobs'), async (req: AuthRequest, res) => {
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
      SELECT
        content_json,
        model_used,
        updated_at,
        protocol_version,
        payload_version,
        prompt_version,
        output_schema_version,
        materialize_status,
        source_job_id,
        source_report_version_id,
        report_payload_json
      FROM ai_decision_reports
      WHERE region_id = $1 AND year = $2
      LIMIT 1
      `,
      [regionId, yearNum]
    );

    if (result.rows.length === 0) {
      return res.json({ code: 200, msg: 'not_found', data: null });
    }

    const row = result.rows[0];
    const stored = resolveStoredReportEnvelope(row);

    let effectivePayload = stored.reportPayload as Record<string, unknown> | null;
    let payloadSource: 'stored' | 'rebuilt' = 'stored';
    let storedPayloadErrors: string[] = [];

    if (effectivePayload) {
      const payloadValidation = validateGovInsightReportPayload(effectivePayload);
      if (!payloadValidation.valid) {
        storedPayloadErrors = payloadValidation.errors;
        effectivePayload = null;
        payloadSource = 'rebuilt';
      }
    }

    if (!effectivePayload) {
      const rebuiltPayload = await govInsightReportPayloadService.build(regionId, yearNum);
      const payloadValidation = validateGovInsightReportPayload(rebuiltPayload);
      if (!payloadValidation.valid) {
        throw new Error(`invalid_rebuilt_payload: ${payloadValidation.errors.slice(0, 5).join('; ')}`);
      }
      effectivePayload = rebuiltPayload as unknown as Record<string, unknown>;
      payloadSource = 'rebuilt';
    }

    const promptText = govInsightReportPayloadService.buildPrompt(effectivePayload as any);

    return res.json({
      code: 200,
      msg: 'success',
      data: {
        regionId,
        year: yearNum,
        updatedAt: row.updated_at,
        modelUsed: stored.modelUsed,
        reportFormat: stored.reportFormat,
        protocolVersion: stored.protocolVersion,
        payloadVersion: stored.payloadVersion,
        promptVersion: stored.promptVersion,
        outputSchemaVersion: stored.outputSchemaVersion,
        materializeStatus: stored.materializeStatus,
        sourceJobId: stored.sourceJobId,
        sourceReportVersionId: stored.sourceReportVersionId,
        storedPayloadErrors,
        payloadSource,
        reportPayload: effectivePayload,
        promptText,
      },
    });
  } catch (error) {
    console.error('[GovInsight] Failed to fetch AI report replay context:', error);
    return res.status(500).json({ code: 500, msg: 'Internal server error', data: null });
  }
});

export default router;
