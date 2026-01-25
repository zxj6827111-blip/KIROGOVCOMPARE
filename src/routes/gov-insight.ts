import express from 'express';
import pool from '../config/database-llm';

const router = express.Router();

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
        outcome_not_open_danger,
        outcome_not_open_process,
        outcome_not_open_internal,
        outcome_not_open_third_party,
        outcome_not_open_admin_query,
        outcome_ignore,
        outcome_ignore_repeat,
        outcome_other,
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
        outcome_not_open_danger: Number(row.outcome_not_open_danger) || 0,
        outcome_not_open_process: Number(row.outcome_not_open_process) || 0,
        outcome_not_open_internal: Number(row.outcome_not_open_internal) || 0,
        outcome_not_open_third_party: Number(row.outcome_not_open_third_party) || 0,
        outcome_not_open_admin_query: Number(row.outcome_not_open_admin_query) || 0,
        outcome_ignore: Number(row.outcome_ignore) || 0,
        outcome_ignore_repeat: Number(row.outcome_ignore_repeat) || 0,
        outcome_other: Number(row.outcome_other) || 0,
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
 * POST /api/gov-insight/ai-report/save
 * 
 * 保存 AI 辅助决策报告
 */
router.post('/ai-report/save', async (req, res) => {
  try {
    const { org_id, org_name, year, content, model } = req.body;

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
    let regionId = null;
    if (typeof org_id === 'number') {
      regionId = org_id;
    } else if (typeof org_id === 'string') {
      const match = org_id.match(/\d+/);
      if (match) regionId = parseInt(match[0], 10);
    }

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
    `, [regionId, org_name, year, JSON.stringify(content), model]);

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

    let regionId = null;
    if (typeof org_id === 'string') {
      const match = org_id.match(/\d+/);
      if (match) regionId = parseInt(match[0], 10);
    }

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
