import express from 'express';
import { dbQuery, dbType } from '../config/db-llm';
import pool from '../config/database-llm';
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
    // org_id param might be "region_123" or just "123"
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

    // Org ID filter
    if (orgIdParam) {
      // Extract numeric ID if it starts with "region_" or "city_" etc
      const match = orgIdParam.match(/(\d+)$/);
      if (match) {
        const id = Number(match[1]);
        conditions.push(`region_id = ${sqlValue(id)}`);
      } else {
        // Fallback for exact match? If data uses numeric region_id, this won't work well.
        // But the View now returns region_id (int).
        // If param is string name? No, usually ID.
        // Assuming param is correct ID format.
        // If strict numeric, good.
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Query the aggregation VIEW
    // The view now returns: id (report_x), year, region_id, org_name, level, stats...
    const rows = await dbQuery(`
      SELECT
        id,
        year,
        region_id,
        org_name,
        level,
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
      LIMIT 1000
    `);

    // We also need correct parent_id from the regions table, because the view doesn't have it anymore.
    // OPTIMIZATION: Instead of joining in SQL (which we removed to simplify View),
    // we fetch regions map or join here? 
    // Actually, distinct region_ids from result => fetch their parents?
    // OR just fetch all regions to memory cached?
    // Let's do a quick lookup query for the involved regions.

    // Collect Region IDs
    const regionIds = Array.from(new Set(rows.map((r: any) => r.region_id)));
    let regionMap = new Map<number, any>();

    if (regionIds.length > 0) {
      // Fetch parents for these regions
      // We can iterate chunks if too many, but for now 1000 limit is fine.
      // SQLite 'IN' list limit is usually 999.
      if (dbType === 'sqlite') {
        // Fetch all regions simpler if list is long? 
        // Let's just fetch ALL regions always. It's fast (hundreds of rows).
        const allRegions = await new Promise<any[]>((resolve, reject) => {
          pool.all('SELECT id, parent_id, level FROM regions', (err: any, rows: any[]) => {
            if (err) reject(err); else resolve(rows || []);
          });
        });
        allRegions.forEach(r => regionMap.set(r.id, r));
      } else {
        const res = await dbQuery('SELECT id, parent_id, level FROM regions');
        res.forEach((r: any) => regionMap.set(r.id, r));
      }
    }

    return res.json({
      code: 200,
      msg: 'success',
      data: rows.map((row: any) => {
        const regionInfo = regionMap.get(row.region_id);
        const parentId = regionInfo?.parent_id;
        const level = regionInfo?.level || row.level || 1;

        // Map Level to Org Type
        let type = 'other';
        if (level === 2) type = 'city';
        if (level === 3) type = 'district';
        if (level === 4) type = 'department';
        if (level === 1) type = 'city';

        return {
          year: row.year,

          // Reconstruct Frontend ID format
          org_id: `region_${row.region_id}`,
          org_name: row.org_name,
          org_type: type,
          parent_id: parentId ? `region_${parentId}` : null,

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
        };
      }),
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

    // 1. Fetch Authoritative Region Tree (Recursive) - Same logic as llm-regions.ts
    // We fetch ALL regions to build the correct skeleton
    let regions: any[] = [];
    if (dbType === 'sqlite') {
      regions = await new Promise<any[]>((resolve, reject) => {
        pool.all('SELECT id, code, name, province, parent_id, level, sort_order FROM regions ORDER BY level, sort_order, id', (err: any, rows: any[]) => {
          if (err) reject(err);
          else resolve(rows || []);
        });
      });
    } else {
      const result = await dbQuery('SELECT id, code, name, province, parent_id, level, sort_order FROM regions ORDER BY level, sort_order, id');
      regions = result; // dbQuery returns rows directly
    }

    // 2. Fetch Active Data from View (just to know which orgs have data)
    let whereClause = '';
    if (yearParam) {
      const yearNum = Number(yearParam);
      if (Number.isInteger(yearNum) && yearNum >= 1900 && yearNum <= 2100) {
        whereClause = `WHERE year = ${sqlValue(yearNum)}`;
      }
    }
    const viewRows = await dbQuery(`
      SELECT DISTINCT region_id
      FROM gov_open_annual_stats
      ${whereClause}
    `);
    const activeRegionIds = new Set(viewRows.map((r: any) => r.region_id));

    // 3. Construct Output List
    // Convert numeric IDs to string format for frontend compatibility if needed, 
    // OR keep numeric if frontend adapter updates.
    // The previous frontend expected "city_X", "district_X". 
    // To match City Management, we should ideally use numeric IDs.
    // BUT the Frontend Adapter (adapter.ts) uses "string" org_id.
    // Let's standardise on "region_{id}" to be safe and consistent, 
    // or just "{id}" string.
    // Let's use "region_{id}" prefix to avoid type confusion.

    const result = regions.map(r => {
      // Determine type based on level
      let type = 'other';
      if (r.level === 2) type = 'city';
      if (r.level === 3) type = 'district';
      if (r.level === 4) type = 'department';
      // Province (level 1) considered 'city' type in old logic? 
      // City Management uses just 'Region'. 
      // GovInsight expects 'city' or 'district'.
      if (r.level === 1) type = 'city'; // Treat Province as root "city" container

      return {
        id: `region_${r.id}`,
        name: r.name,
        type: type,
        parent_id: r.parent_id ? `region_${r.parent_id}` : null,
        // Optional: mark if has data
        has_data: activeRegionIds.has(r.id)
      };
    });

    return res.json({
      code: 200,
      msg: 'success',
      data: result,
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
