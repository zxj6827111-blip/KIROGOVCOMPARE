import express from 'express';
import { dbQuery, dbType } from '../config/db-llm';
import { sqlValue } from '../config/sqlite';
import { authMiddleware } from '../middleware/auth';

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
 * 
 * Response:
 *   {
 *     "code": 200,
 *     "msg": "success",
 *     "data": [
 *       {
 *         "year": 2024,
 *         "org_id": "city_1001",
 *         "org_name": "南京市",
 *         "org_type": "city",
 *         "app_new": 1250,
 *         ...
 *       }
 *     ]
 *   }
 */
router.get('/annual-data', async (req, res) => {
  try {
    const yearParam = typeof req.query.year === 'string' ? req.query.year.trim() : '';
    const orgIdParam = typeof req.query.org_id === 'string' ? req.query.org_id.trim() : '';

    const conditions: string[] = [];

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
      conditions.push(`year = ${sqlValue(yearNum)}`);
    }

    // Org ID filter - support both string format (city_1001) and numeric region_id
    if (orgIdParam) {
      // Check if it's a numeric ID
      const numericId = Number(orgIdParam);
      if (!Number.isNaN(numericId) && Number.isFinite(numericId)) {
        // Numeric ID - match against the numeric part of org_id or direct region_id
        conditions.push(`org_id LIKE ${sqlValue(`%_${numericId}`)}`);
      } else {
        // String ID - exact match
        conditions.push(`org_id = ${sqlValue(orgIdParam)}`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Query the aggregation VIEW
    const rows = await dbQuery(`
      SELECT
        id,
        year,
        org_id,
        org_name,
        org_type,
        parent_id,
        reg_published,
        reg_active,
        doc_published,
        doc_active,
        action_licensing,
        action_punishment,
        app_new,
        app_carried_over,
        source_natural,
        outcome_public,
        outcome_partial,
        outcome_unable,
        outcome_not_open,
        outcome_ignore,
        app_carried_forward,
        rev_total,
        rev_corrected,
        lit_total,
        lit_corrected
      FROM gov_open_annual_stats
      ${whereClause}
      ORDER BY year DESC, org_name ASC
      LIMIT 500
    `);

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
        reg_published: Number(row.reg_published) || 0,
        reg_active: Number(row.reg_active) || 0,
        doc_published: Number(row.doc_published) || 0,
        doc_active: Number(row.doc_active) || 0,
        action_licensing: Number(row.action_licensing) || 0,
        action_punishment: Number(row.action_punishment) || 0,
        // 依申请公开
        app_new: Number(row.app_new) || 0,
        app_carried_over: Number(row.app_carried_over) || 0,
        source_natural: Number(row.source_natural) || 0,
        outcome_public: Number(row.outcome_public) || 0,
        outcome_partial: Number(row.outcome_partial) || 0,
        outcome_unable: Number(row.outcome_unable) || 0,
        outcome_not_open: Number(row.outcome_not_open) || 0,
        outcome_ignore: Number(row.outcome_ignore) || 0,
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
    const rows = await dbQuery(`
      SELECT DISTINCT year
      FROM gov_open_annual_stats
      ORDER BY year DESC
    `);

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
    if (yearParam) {
      const yearNum = Number(yearParam);
      if (Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2100) {
        whereClause = `WHERE year = ${sqlValue(yearNum)}`;
      }
    }

    const rows = await dbQuery(`
      SELECT DISTINCT org_id, org_name, org_type, parent_id
      FROM gov_open_annual_stats
      ${whereClause}
      ORDER BY org_type, org_name ASC
    `);

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

export default router;
