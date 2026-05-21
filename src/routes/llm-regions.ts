import express, { Request, Response } from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/auth';

const router = express.Router();

type MigrationReportRow = {
  id: number | string;
  year: number;
  unit_name: string;
  active_version_id: number | string | null;
  created_at: string;
  upload_time: string;
  migration_action?: 'move' | 'replace_target';
};

type MigrationComparisonRow = {
  id: number | string;
  region_id: number | string;
  year_a: number;
  year_b: number;
  left_report_id: number | string;
  right_report_id: number | string;
  created_at: string;
};

function getReportUploadTime(report: MigrationReportRow | null | undefined): number | null {
  if (!report) return null;
  const value = report.upload_time || report.created_at;
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function resolveReportConflict(sourceReport: MigrationReportRow, targetReport: MigrationReportRow) {
  const sourceTime = getReportUploadTime(sourceReport);
  const targetTime = getReportUploadTime(targetReport);

  if (sourceTime !== null && targetTime !== null) {
    if (sourceTime > targetTime) {
      return { resolution: 'keep_source', winner: 'source', loser: 'target' };
    }
    if (targetTime > sourceTime) {
      return { resolution: 'keep_target', winner: 'target', loser: 'source' };
    }
  }

  return { resolution: 'blocked_same_upload_time', winner: null, loser: null };
}

async function deleteReportsForMigration(client: any, reportIds: number[]) {
  const uniqueReportIds = [...new Set(reportIds.filter(id => Number.isInteger(id) && id > 0))];
  if (uniqueReportIds.length === 0) {
    return [];
  }

  const reportsResult = await client.query(
    `SELECT id, region_id, year, unit_name
     FROM reports
     WHERE id = ANY($1::int[])
     ORDER BY year ASC, id ASC`,
    [uniqueReportIds]
  );

  const versionResult = await client.query(
    `SELECT id
     FROM report_versions
     WHERE report_id = ANY($1::int[])`,
    [uniqueReportIds]
  );
  const versionIds = versionResult.rows.map((row: any) => Number(row.id));

  if (versionIds.length > 0) {
    await client.query('DELETE FROM cells WHERE version_id = ANY($1::int[])', [versionIds]);
    await client.query('DELETE FROM notifications WHERE related_version_id = ANY($1::int[])', [versionIds]);
  }

  await client.query(
    `DELETE FROM comparisons
     WHERE left_report_id = ANY($1::int[])
        OR right_report_id = ANY($1::int[])`,
    [uniqueReportIds]
  );
  await client.query('DELETE FROM fact_active_disclosure WHERE report_id = ANY($1::int[])', [uniqueReportIds]);
  await client.query('DELETE FROM fact_application WHERE report_id = ANY($1::int[])', [uniqueReportIds]);
  await client.query('DELETE FROM fact_legal_proceeding WHERE report_id = ANY($1::int[])', [uniqueReportIds]);
  await client.query('DELETE FROM quality_issues WHERE report_id = ANY($1::int[])', [uniqueReportIds]);
  await client.query('DELETE FROM derived_unit_year_metrics WHERE report_id = ANY($1::int[])', [uniqueReportIds]);
  await client.query('DELETE FROM jobs WHERE report_id = ANY($1::int[])', [uniqueReportIds]);
  await client.query('DELETE FROM gov_open_annual_stats_v2 WHERE source_report_id = ANY($1::int[])', [uniqueReportIds]);
  await client.query('DELETE FROM reports WHERE id = ANY($1::int[])', [uniqueReportIds]);

  return reportsResult.rows;
}

async function buildReportMigrationPreview(sourceRegionId: number, targetRegionId: number) {
  if (!Number.isInteger(sourceRegionId) || sourceRegionId < 1 || !Number.isInteger(targetRegionId) || targetRegionId < 1) {
    const error: any = new Error('source_region_id and target_region_id are required');
    error.statusCode = 400;
    throw error;
  }

  if (sourceRegionId === targetRegionId) {
    const error: any = new Error('源区域和目标区域不能相同');
    error.statusCode = 400;
    throw error;
  }

  const regionResult = await pool.query(
    `SELECT id, name, parent_id, level
     FROM regions
     WHERE id = ANY($1::int[])`,
    [[sourceRegionId, targetRegionId]]
  );
  const regionMap = new Map(regionResult.rows.map((row: any) => [Number(row.id), row]));
  const sourceRegion = regionMap.get(sourceRegionId);
  const targetRegion = regionMap.get(targetRegionId);

  if (!sourceRegion || !targetRegion) {
    const error: any = new Error(!sourceRegion ? 'Source region not found' : 'Target region not found');
    error.statusCode = 404;
    throw error;
  }

  const descendantResult = await pool.query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM regions WHERE id = $1
       UNION ALL
       SELECT r.id FROM regions r JOIN descendants d ON r.parent_id = d.id
     )
     SELECT id FROM descendants WHERE id = $2 LIMIT 1`,
    [sourceRegionId, targetRegionId]
  );
  if (descendantResult.rows.length > 0) {
    const error: any = new Error('目标区域不能选择源区域或其下级区域');
    error.statusCode = 400;
    throw error;
  }

  const sourceReportsResult = await pool.query(
    `SELECT r.id,
            r.year,
            r.unit_name,
            r.active_version_id,
            r.created_at,
            COALESCE(latest_version.created_at, r.created_at) AS upload_time
     FROM reports r
     LEFT JOIN LATERAL (
       SELECT rv.created_at
       FROM report_versions rv
       WHERE rv.report_id = r.id
       ORDER BY rv.created_at DESC, rv.id DESC
       LIMIT 1
     ) latest_version ON true
     WHERE r.region_id = $1
     ORDER BY year ASC, id ASC`,
    [sourceRegionId]
  );
  const sourceReports: MigrationReportRow[] = sourceReportsResult.rows;
  const years = sourceReports.map((report: MigrationReportRow) => Number(report.year));
  const targetReportsResult = years.length > 0
    ? await pool.query(
      `SELECT r.id,
              r.year,
              r.unit_name,
              r.active_version_id,
              r.created_at,
              COALESCE(latest_version.created_at, r.created_at) AS upload_time
       FROM reports r
       LEFT JOIN LATERAL (
         SELECT rv.created_at
         FROM report_versions rv
         WHERE rv.report_id = r.id
         ORDER BY rv.created_at DESC, rv.id DESC
         LIMIT 1
       ) latest_version ON true
       WHERE r.region_id = $1
         AND r.year = ANY($2::int[])
       ORDER BY year ASC, id ASC`,
      [targetRegionId, years]
    )
    : { rows: [] };

  const targetReportsByYear = new Map(
    targetReportsResult.rows.map((report: MigrationReportRow) => [Number(report.year), report])
  );
  const movableReports: MigrationReportRow[] = [];
  const sourceReportsToDelete: MigrationReportRow[] = [];
  const targetReportsToDelete: MigrationReportRow[] = [];
  const blockedConflicts: any[] = [];
  const conflictReports = sourceReports.map((report: MigrationReportRow) => {
    const targetReport = targetReportsByYear.get(Number(report.year)) || null;
    if (!targetReport) {
      movableReports.push({ ...report, migration_action: 'move' });
      return {
        source_report: report,
        target_report: null,
        status: 'movable',
        resolution: 'move',
        winner: 'source',
        loser: null
      };
    }

    const decision = resolveReportConflict(report, targetReport);
    if (decision.resolution === 'keep_source') {
      movableReports.push({ ...report, migration_action: 'replace_target' });
      targetReportsToDelete.push(targetReport);
    } else if (decision.resolution === 'keep_target') {
      sourceReportsToDelete.push(report);
    } else {
      blockedConflicts.push({ source_report: report, target_report: targetReport });
    }

    return {
      source_report: report,
      target_report: targetReport,
      status: 'conflict',
      resolution: decision.resolution,
      winner: decision.winner,
      loser: decision.loser
    };
  });

  const movableReportIds = movableReports.map((report: MigrationReportRow) => Number(report.id));
  const sourceReportsToDeleteIds = sourceReportsToDelete.map((report: MigrationReportRow) => Number(report.id));
  const targetReportsToDeleteIds = targetReportsToDelete.map((report: MigrationReportRow) => Number(report.id));
  const allSourceReportIds = sourceReports.map((report: MigrationReportRow) => Number(report.id));
  const comparisonsResult = await pool.query(
    `SELECT id, region_id, year_a, year_b, left_report_id, right_report_id, created_at
     FROM comparisons
     WHERE region_id = $1
       OR left_report_id = ANY($2::int[])
       OR right_report_id = ANY($2::int[])
     ORDER BY id ASC`,
    [sourceRegionId, allSourceReportIds]
  );
  const movableReportIdSet = new Set(movableReportIds);
  const rawComparisons: MigrationComparisonRow[] = comparisonsResult.rows;
  const candidateComparisons = rawComparisons.filter((comparison: MigrationComparisonRow) => (
    movableReportIdSet.has(Number(comparison.left_report_id))
    && movableReportIdSet.has(Number(comparison.right_report_id))
  ));
  const targetComparisonResult = candidateComparisons.length > 0
    ? await pool.query(
      `SELECT id, year_a, year_b, left_report_id, right_report_id
       FROM comparisons
       WHERE region_id = $1
         AND year_a = ANY($2::int[])
         AND year_b = ANY($3::int[])`,
      [
        targetRegionId,
        candidateComparisons.map((comparison: MigrationComparisonRow) => Number(comparison.year_a)),
        candidateComparisons.map((comparison: MigrationComparisonRow) => Number(comparison.year_b))
      ]
    )
    : { rows: [] };
  const targetReportsToDeleteIdSet = new Set(targetReportsToDeleteIds);
  const targetComparisonKeys = new Set(
    targetComparisonResult.rows
      .filter((comparison: any) => (
        !targetReportsToDeleteIdSet.has(Number(comparison.left_report_id))
        && !targetReportsToDeleteIdSet.has(Number(comparison.right_report_id))
      ))
      .map((comparison: any) => `${Number(comparison.year_a)}:${Number(comparison.year_b)}`)
  );
  const comparisons = rawComparisons.map((comparison: MigrationComparisonRow) => {
    const leftMovable = movableReportIdSet.has(Number(comparison.left_report_id));
    const rightMovable = movableReportIdSet.has(Number(comparison.right_report_id));
    const leftDeleted = sourceReportsToDeleteIds.includes(Number(comparison.left_report_id));
    const rightDeleted = sourceReportsToDeleteIds.includes(Number(comparison.right_report_id));
    const targetComparisonKey = `${Number(comparison.year_a)}:${Number(comparison.year_b)}`;
    const migrationStatus = leftDeleted || rightDeleted
      ? 'will_delete_with_old_report'
      : leftMovable && rightMovable
      ? (targetComparisonKeys.has(targetComparisonKey) ? 'blocked_by_target_comparison' : 'will_move')
      : 'blocked_by_conflict';

    return {
      ...comparison,
      migration_status: migrationStatus
    };
  });

  return {
    source_region: sourceRegion,
    target_region: targetRegion,
    source_reports: sourceReports,
    target_conflicts: conflictReports.filter((item: any) => item.status === 'conflict'),
    movable_reports: movableReports,
    source_reports_to_delete: sourceReportsToDelete,
    target_reports_to_delete: targetReportsToDelete,
    blocked_conflicts: blockedConflicts,
    comparisons,
    summary: {
      source_report_count: sourceReports.length,
      movable_report_count: movableReports.length,
      conflict_report_count: conflictReports.filter((item: any) => item.status === 'conflict').length,
      source_wins_count: targetReportsToDelete.length,
      target_wins_count: sourceReportsToDelete.length,
      blocked_conflict_count: blockedConflicts.length,
      deleted_report_count: sourceReportsToDelete.length + targetReportsToDelete.length,
      executable_change_count: movableReports.length + sourceReportsToDelete.length + targetReportsToDelete.length,
      comparison_count: comparisons.length,
      movable_comparison_count: comparisons.filter((item: any) => item.migration_status === 'will_move').length,
      blocked_comparison_count: comparisons.filter((item: any) => item.migration_status !== 'will_move').length
    }
  };
}

// POST /api/regions - 创建区域（支持层级）
router.post('/', authMiddleware, requirePermission('manage_regions'), async (req: Request, res: Response) => {
  try {
    const { code, name, province } = req.body;
    // 兼容前端 parentId / parent_id 传参
    const parent_id = req.body.parent_id ?? req.body.parentId ?? null;

    if (!code || !name) {
      return res.status(400).json({ error: 'code and name are required' });
    }

    // 计算 level：若 parent_id 存在则查询父级 level，否则为 1
    let level = 1;
    if (parent_id) {
      const parentIdNumber = Number(parent_id);
      if (!Number.isFinite(parentIdNumber)) {
        return res.status(400).json({ error: 'parent_id must be a number' });
      }

      const parentResult = await pool.query('SELECT level FROM regions WHERE id = $1', [parentIdNumber]);
      if (parentResult.rows.length === 0) {
        return res.status(404).json({ error: 'Parent region not found' });
      }
      const parentLevel = Number(parentResult.rows[0].level);
      const normalizedParentLevel = Number.isFinite(parentLevel) && parentLevel >= 1 ? parentLevel : 1;
      level = normalizedParentLevel + 1;
    }

    if (!Number.isFinite(level)) {
      return res.status(400).json({ error: 'Level calculation failed' });
    }
    if (level < 1 || level > 4) {
      return res.status(400).json({ error: 'Region level must be between 1 and 4' });
    }

    const levelValue = level;

    // Get max sort_order for new region
    let maxSortOrder = 0;
    const maxResult = await pool.query('SELECT MAX(sort_order) as max_order FROM regions');
    maxSortOrder = maxResult.rows[0]?.max_order || 0;

    const newSortOrder = maxSortOrder + 1;

    const insertSql = 'INSERT INTO regions (code, name, province, parent_id, level, sort_order) VALUES ($1, $2, $3, $4, $5, $6)';
    const params = [code, name, province || null, parent_id ? Number(parent_id) : null, levelValue, newSortOrder];

    const result = await pool.query(
      `${insertSql} RETURNING id, code, name, province, parent_id, level, sort_order`,
      params
    );

    res.status(201).json(result.rows[0]);

  } catch (error: any) {
    console.error('Error creating region:', error);
    if (error.message?.includes('UNIQUE constraint failed') || error.code === '23505') {
      return res.status(409).json({ error: 'Region code already exists' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/regions - 获取区域列表（带层级）
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const user = authReq.user;

    // Logic: If user has dataScope.regions, filter the query
    let filterNames: string[] = [];
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      filterNames = user.dataScope.regions;
    }

    if (filterNames.length > 0) {
      // Note: pg usually uses $1, $2... and ANY($1) for arrays
      const sql = `
            WITH RECURSIVE allowed_tree AS (
              SELECT id, code, name, province, parent_id, level, sort_order
              FROM regions 
              WHERE name = ANY($1)
              UNION ALL
              SELECT r.id, r.code, r.name, r.province, r.parent_id, r.level, r.sort_order
              FROM regions r 
              JOIN allowed_tree d ON r.parent_id = d.id
            )
            SELECT DISTINCT id, code, name, province, parent_id, level, sort_order FROM allowed_tree ORDER BY level, sort_order, id
          `;
      const result = await pool.query(sql, [filterNames]);
      // Fix Orphaned Nodes (same as SQLite):
      // If a node's parent is NOT in the result set, set parent_id to null
      // This ensures frontend treats them as "roots" and displays them
      const validIds = new Set(result.rows?.map((r: any) => r.id));
      const safeRows = result.rows?.map((r: any) => ({
        ...r,
        parent_id: (r.parent_id && validIds.has(r.parent_id)) ? r.parent_id : null
      })) || [];
      res.json({ data: safeRows });
    } else {
      const result = await pool.query('SELECT id, code, name, province, parent_id, level, sort_order FROM regions ORDER BY level, sort_order, id');
      res.json({ data: result.rows });
    }

  } catch (error) {
    console.error('Error fetching regions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/regions/:id - 获取区域详情
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const result = await pool.query('SELECT id, code, name, province, parent_id, level, sort_order FROM regions WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Region not found' });
    }

    res.json(result.rows[0]);

  } catch (error) {
    console.error('Error fetching region:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/regions/:id - 修改区域（名称、排序、分类等级等）
router.put('/:id', authMiddleware, requirePermission('manage_regions'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, sort_order, level } = req.body;

    if (!name && sort_order === undefined && level === undefined) {
      return res.status(400).json({ error: 'At least one field (name, sort_order, or level) is required' });
    }

    // Validate level if provided
    if (level !== undefined) {
      const levelNum = Number(level);
      if (!Number.isFinite(levelNum) || levelNum < 1 || levelNum > 4) {
        return res.status(400).json({ error: 'Level must be between 1 and 4' });
      }
    }

    // Build update query dynamically
    const updates: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (name) {
      updates.push(`name = $${paramIndex++}`);
      params.push(name);
    }
    if (sort_order !== undefined) {
      updates.push(`sort_order = $${paramIndex++}`);
      params.push(sort_order);
    }
    if (level !== undefined) {
      updates.push(`level = $${paramIndex++}`);
      params.push(Number(level));
    }
    updates.push(`updated_at = NOW()`);

    const updateSql = `UPDATE regions SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
    params.push(id);

    const result = await pool.query(
      `${updateSql} RETURNING id, code, name, province, parent_id, level, sort_order`,
      params
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Region not found' });
    }

    res.json(result.rows[0]);

  } catch (error: any) {
    console.error('Error updating region:', error);
    if (error.message === 'Region not found') {
      return res.status(404).json({ error: 'Region not found' });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/regions/reorder - 批量更新排序
router.post('/reorder', authMiddleware, requirePermission('manage_regions'), async (req: Request, res: Response) => {
  try {
    const { orders } = req.body;
    // orders: [{ id: number, sort_order: number }, ...]

    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: 'orders array is required' });
    }

    // PostgreSQL: Simple sequential updates (no transaction needed for idempotent updates)
    for (const item of orders) {
      await pool.query('UPDATE regions SET sort_order = $1, updated_at = NOW() WHERE id = $2',
        [item.sort_order, item.id]);
    }

    res.json({ success: true, updated: orders.length });
  } catch (error) {
    console.error('Error reordering regions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/regions/report-migration/preview - 预检区域下报告迁移
router.post('/report-migration/preview', authMiddleware, requirePermission('manage_regions'), async (req: Request, res: Response) => {
  try {
    const sourceRegionId = Number(req.body.source_region_id ?? req.body.sourceRegionId);
    const targetRegionId = Number(req.body.target_region_id ?? req.body.targetRegionId);
    const preview = await buildReportMigrationPreview(sourceRegionId, targetRegionId);
    res.json({ data: preview });
  } catch (error: any) {
    console.error('Error previewing report migration:', error);
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
  }
});

// POST /api/regions/report-migration/execute - 执行无冲突报告迁移
router.post('/report-migration/execute', authMiddleware, requirePermission('manage_regions'), async (req: Request, res: Response) => {
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    const sourceRegionId = Number(req.body.source_region_id ?? req.body.sourceRegionId);
    const targetRegionId = Number(req.body.target_region_id ?? req.body.targetRegionId);
    const preview = await buildReportMigrationPreview(sourceRegionId, targetRegionId);
    const movableReportIds = preview.movable_reports.map((report: MigrationReportRow) => Number(report.id));
    const movableReportYears = preview.movable_reports.map((report: MigrationReportRow) => Number(report.year));
    const sourceReportIdsToDelete = preview.source_reports_to_delete.map((report: MigrationReportRow) => Number(report.id));
    const targetReportIdsToDelete = preview.target_reports_to_delete.map((report: MigrationReportRow) => Number(report.id));
    const reportIdsToDelete = [...sourceReportIdsToDelete, ...targetReportIdsToDelete];
    const movableComparisonIds = preview.comparisons
      .filter((comparison: any) => comparison.migration_status === 'will_move')
      .map((comparison: any) => Number(comparison.id));

    if (preview.summary.executable_change_count === 0) {
      return res.status(409).json({
        error: '没有可执行的迁移或冲突处理。请确认冲突报告上传时间后再试。',
        data: preview
      });
    }

    await client.query('BEGIN');
    transactionStarted = true;

    const deletedReports = await deleteReportsForMigration(client, reportIdsToDelete);

    const updateReportsResult = await client.query(
      `UPDATE reports
       SET region_id = $1,
           updated_at = NOW()
       WHERE region_id = $2
         AND id = ANY($3::int[])
       RETURNING id, year, unit_name`,
      [targetRegionId, sourceRegionId, movableReportIds]
    );

    const moveComparisonsResult = await client.query(
      `UPDATE comparisons
       SET region_id = $1,
           updated_at = NOW()
       WHERE region_id = $2
         AND id = ANY($3::int[])
       RETURNING id, year_a, year_b`,
      [targetRegionId, sourceRegionId, movableComparisonIds]
    );

    await client.query(
      `DELETE FROM derived_unit_year_metrics
       WHERE report_id = ANY($1::int[])`,
      [movableReportIds]
    );
    await client.query(
      `DELETE FROM derived_region_year_metrics
       WHERE region_id = ANY($1::int[])`,
      [[sourceRegionId, targetRegionId]]
    );
    await client.query(
      `DELETE FROM gov_open_annual_stats_v2
       WHERE source_report_id = ANY($1::int[])
          OR (region_id = $2 AND year = ANY($3::int[]))`,
      [[...movableReportIds, ...reportIdsToDelete], sourceRegionId, movableReportYears]
    );
    await client.query(
      `UPDATE gov_open_annual_stats_v2
       SET parent_region_id = $1,
           updated_at = NOW()
       WHERE parent_region_id = $2`,
      [targetRegionId, sourceRegionId]
    );
    await client.query(
      `UPDATE gov_open_annual_stats_v2
       SET city_region_id = $1,
           updated_at = NOW()
       WHERE city_region_id = $2`,
      [targetRegionId, sourceRegionId]
    );
    await client.query(
      `UPDATE canonical_units
       SET parent_region_id = $1
       WHERE parent_region_id = $2`,
      [targetRegionId, sourceRegionId]
    );
    await client.query(
      `UPDATE canonical_units
       SET city_region_id = $1
       WHERE city_region_id = $2`,
      [targetRegionId, sourceRegionId]
    );
    await client.query(
      `UPDATE canonical_unit_mapping_overrides
       SET parent_region_id = $1
       WHERE parent_region_id = $2`,
      [targetRegionId, sourceRegionId]
    );
    await client.query(
      `UPDATE canonical_unit_mapping_overrides
       SET city_region_id = $1
       WHERE city_region_id = $2`,
      [targetRegionId, sourceRegionId]
    );

    await client.query('COMMIT');
    transactionStarted = false;

    const updatedPreview = await buildReportMigrationPreview(sourceRegionId, targetRegionId);
    res.json({
      success: true,
      message: '迁移完成。冲突年份已按报告上传时间保留最新报告。',
      moved_reports: updateReportsResult.rows,
      moved_comparisons: moveComparisonsResult.rows,
      deleted_reports: deletedReports,
      data: updatedPreview
    });
  } catch (error: any) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => undefined);
    }
    console.error('Error executing report migration:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: '目标区域已有同年份报告或比对记录，请刷新预检后再试。' });
    }
    res.status(error.statusCode || 500).json({ error: error.message || 'Internal server error' });
  } finally {
    client.release();
  }
});

// DELETE /api/regions/:id - 删除区域
router.delete('/:id', authMiddleware, requirePermission('manage_regions'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Use Recursive CTE to identify all descendant IDs and the ID itself
    const recursiveQuery = `
      WITH RECURSIVE descendants AS (
        SELECT id FROM regions WHERE id = $1
        UNION ALL
        SELECT r.id FROM regions r JOIN descendants d ON r.parent_id = d.id
      )
      SELECT id FROM descendants
    `;

    const result = await pool.query(recursiveQuery, [id]);
    const idsToDelete = result.rows.map((r: any) => r.id);

    if (idsToDelete.length === 0) {
      return res.status(404).json({ error: 'Region not found' });
    }

    const dependencyResult = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM reports WHERE region_id = ANY($1::int[])) AS report_count,
        (SELECT COUNT(*)::int FROM comparisons WHERE region_id = ANY($1::int[])) AS comparison_count
    `, [idsToDelete]);
    const dependency = dependencyResult.rows[0] || {};
    const reportCount = Number(dependency.report_count || 0);
    const comparisonCount = Number(dependency.comparison_count || 0);

    if (reportCount > 0 || comparisonCount > 0) {
      return res.status(409).json({
        error: '该区域已有业务数据，不能直接删除。请先清理关联数据后再删除。',
        details: `关联年报 ${reportCount} 份，关联比对记录 ${comparisonCount} 条。`,
        blockers: {
          reports: reportCount,
          comparisons: comparisonCount
        }
      });
    }

    // Simplest: `DELETE FROM regions WHERE id = ANY(...)`
    await pool.query('DELETE FROM regions WHERE id = ANY($1::int[])', [idsToDelete]);

    res.json({ message: `Successfully deleted ${idsToDelete.length} regions` });

  } catch (error: any) {
    console.error('Error deleting region:', error);
    if (error?.code === '23503') {
      return res.status(409).json({
        error: '该区域已有业务数据引用，不能直接删除。',
        details: error.detail || error.message || ''
      });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
