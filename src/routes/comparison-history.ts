import express, { Request, Response } from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import pdfExportService from '../services/PdfExportService';
import { calculateReportMetrics } from '../utils/reportAnalysis';
import { ComparisonReportData } from '../services/PdfExportService';
import { calculateDiffs, renderDiffHtml } from '../utils/diffRenderer';
import { compareRegionsByCityManagementOrder } from '../utils/regionSort';
import { hasParsedContent } from '../utils/parsedContent';

const router = express.Router();

const LEGACY_EJS_COMPARISON_PDF_ROUTE = 'POST /api/comparisons/:id/export/pdf';
const LEGACY_EJS_COMPARISON_PDF_REPLACEMENT = '/api/pdf-jobs';
const LEGACY_EJS_EXPOSED_HEADERS = [
  'Content-Disposition',
  'Content-Length',
  'Content-Type',
  'Deprecation',
  'Link',
  'X-Kiro-Deprecated-Route',
  'X-Kiro-Legacy-Export-Path',
  'X-Kiro-Legacy-Export-Trace',
  'X-Kiro-Replacement-Route',
].join(', ');
const LEGACY_EJS_TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,80}$/;

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

function normalizeLegacyEjsClientTraceId(value: string | string[] | undefined): string | null {
  const traceId = firstHeaderValue(value)?.trim();
  if (!traceId || !LEGACY_EJS_TRACE_ID_PATTERN.test(traceId)) {
    return null;
  }
  return traceId;
}

function createGeneratedLegacyEjsExportTraceId(comparisonId: number): string {
  const safeComparisonId = Number.isFinite(comparisonId) ? String(comparisonId) : 'invalid';
  return `legacy-ejs-${safeComparisonId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createLegacyEjsExportTraceId(req: Request, comparisonId: number): string {
  return (
    normalizeLegacyEjsClientTraceId(req.headers['x-request-id']) ||
    normalizeLegacyEjsClientTraceId(req.headers['x-correlation-id']) ||
    createGeneratedLegacyEjsExportTraceId(comparisonId)
  );
}

function setLegacyEjsExportHeaders(res: Response, traceId: string): void {
  res.setHeader('Deprecation', 'true');
  res.setHeader('Link', `<${LEGACY_EJS_COMPARISON_PDF_REPLACEMENT}>; rel="successor-version"`);
  res.setHeader('X-Kiro-Deprecated-Route', LEGACY_EJS_COMPARISON_PDF_ROUTE);
  res.setHeader('X-Kiro-Replacement-Route', LEGACY_EJS_COMPARISON_PDF_REPLACEMENT);
  res.setHeader('X-Kiro-Legacy-Export-Path', 'comparison-ejs');
  res.setHeader('X-Kiro-Legacy-Export-Trace', traceId);
  res.setHeader('Access-Control-Expose-Headers', LEGACY_EJS_EXPOSED_HEADERS);
}

function parseDbJson(value: any): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

interface ActiveParsedReport {
  reportId: number;
  regionId: number;
  year: number;
  activeVersionId: number | null;
  versionId: number | null;
  parsedJson: any;
  ready: boolean;
  notReadyReason: string | null;
}

async function fetchActiveParsedReport(reportId: number): Promise<ActiveParsedReport | null> {
  const result = await pool.query(
    `SELECT
       r.id AS report_id,
       r.region_id,
       r.year,
       r.active_version_id,
       rv.id AS version_id,
       rv.parsed_json
     FROM reports r
     LEFT JOIN report_versions rv ON rv.id = r.active_version_id
     WHERE r.id = $1
     LIMIT 1`,
    [reportId]
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const parsedJson = parseDbJson(row.parsed_json);
  const hasActiveVersion = Boolean(row.version_id);
  const ready = hasActiveVersion && hasParsedContent(parsedJson);
  let notReadyReason: string | null = null;
  if (!hasActiveVersion) {
    notReadyReason = 'not_published';
  } else if (!hasParsedContent(parsedJson)) {
    notReadyReason = 'empty_parsed_content';
  }

  return {
    reportId: Number(row.report_id),
    regionId: Number(row.region_id),
    year: Number(row.year),
    activeVersionId: row.active_version_id ? Number(row.active_version_id) : null,
    versionId: row.version_id ? Number(row.version_id) : null,
    parsedJson,
    ready,
    notReadyReason,
  };
}

function collectNotReadySides(
  leftReport: ActiveParsedReport | null,
  rightReport: ActiveParsedReport | null
): Array<{ side: 'left' | 'right'; report_id: number | null; reason: string }> {
  const sides: Array<{ side: 'left' | 'right'; report_id: number | null; reason: string }> = [];
  if (!leftReport || !leftReport.ready) {
    sides.push({
      side: 'left',
      report_id: leftReport?.reportId ?? null,
      reason: leftReport?.notReadyReason || 'report_not_found',
    });
  }
  if (!rightReport || !rightReport.ready) {
    sides.push({
      side: 'right',
      report_id: rightReport?.reportId ?? null,
      reason: rightReport?.notReadyReason || 'report_not_found',
    });
  }
  return sides;
}

async function countOpenReviewIssues(versionId: number | null): Promise<number> {
  if (!versionId) {
    return 0;
  }
  const result = await pool.query(
    `SELECT COUNT(*) AS count
     FROM report_consistency_items
     WHERE report_version_id = $1
       AND auto_status IN ('FAIL', 'UNCERTAIN')
       AND COALESCE(human_status, 'pending') = 'pending'`,
    [versionId]
  );
  return Number(result.rows[0]?.count || 0);
}

async function ensureComparisonJob(comparisonId: number, reportId: number, versionId: number | null): Promise<number> {
  const existingJobRes = await pool.query(
    `SELECT id
     FROM jobs
     WHERE comparison_id = $1
       AND kind = 'compare'
       AND status IN ('queued', 'running')
     ORDER BY id DESC
     LIMIT 1`,
    [comparisonId]
  );
  const existingJob = existingJobRes.rows[0];
  if (existingJob?.id) {
    return Number(existingJob.id);
  }

  const newJobRes = await pool.query(
    `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, comparison_id)
     VALUES ($1, $2, 'compare', 'queued', 0, 'QUEUED', '等待处理', $3)
     RETURNING id`,
    [reportId, versionId, comparisonId]
  );
  return Number(newJobRes.rows[0].id);
}

/**
 * GET /api/comparisons/history
 * Get comparison history list with pagination
 */
router.get('/history', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const regionId = req.query.region_id;
    const regionName = req.query.region_name as string;
    const year = req.query.year;
    const offset = (page - 1) * pageSize;

    // Build conditions
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (regionId) {
      conditions.push(`c.region_id = $${paramIndex++}`);
      params.push(Number(regionId));
    }
    if (regionName) {
      conditions.push(`r.name LIKE $${paramIndex++}`);
      params.push(`%${regionName}%`);
    }
    if (year) {
      const y = Number(year);
      if (!isNaN(y)) {
        conditions.push(`(c.year_a = $${paramIndex++} OR c.year_b = $${paramIndex++})`);
        params.push(y);
        params.push(y); // Push twice for OR
      }
    }

    // DATA SCOPE FILTER
    const user = req.user;
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      const scopeNames = user.dataScope.regions;
      const scopeIdsQuery = `
        WITH RECURSIVE allowed_ids AS (
            SELECT id FROM regions WHERE name = ANY($1::text[])
            UNION ALL
            SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
        )
        SELECT id FROM allowed_ids
      `;
      try {
        const allowedRowsRes = await pool.query(scopeIdsQuery, [scopeNames]);
        const allowedIds = allowedRowsRes.rows.map((row: any) => row.id);
        if (allowedIds.length > 0) {
          conditions.push(`c.region_id = ANY($${paramIndex++}::int[])`);
          params.push(allowedIds);
        } else {
          conditions.push('1=0');
        }
      } catch (e) {
        console.error('Error calculating scope IDs in comparison history:', e);
        conditions.push('1=0');
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countRes = await pool.query(`
      SELECT COUNT(*) as total 
      FROM comparisons c 
      LEFT JOIN regions r ON c.region_id = r.id
      ${whereClause}
    `, params);
    const total = parseInt(countRes.rows[0]?.total) || 0;

    // Get paginated results
    const queryParams = [...params, pageSize, offset];
    // paramIndex points to next available index, so we can use it for limit/offset
    // Adjust params usage if needed. Actually constructing the query string dynamically with $N is tricky if we append params.
    // Let's rely on paramIndex.

    // Fix logic: we need correct indices for limit/offset
    const limitIndex = paramIndex++;
    const offsetIndex = paramIndex++;

    const comparisonsRes = await pool.query(`
      SELECT 
        c.id,
        c.region_id,
        c.year_a,
        c.year_b,
        c.left_report_id,
        c.right_report_id,
        c.similarity,
        c.check_status,
        c.created_at,
        r.name as region_name
      FROM comparisons c
      LEFT JOIN regions r ON c.region_id = r.id
      ${whereClause}
      ORDER BY c.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `, queryParams);

    const comparisons = comparisonsRes.rows;

    res.json({
      data: comparisons.map((c: any) => ({
        id: c.id,
        regionId: c.region_id,
        regionName: c.region_name || '未知地区',
        yearA: c.year_a,
        yearB: c.year_b,
        leftReportId: c.left_report_id,
        rightReportId: c.right_report_id,
        similarity: c.similarity,
        checkStatus: c.check_status,
        createdAt: c.created_at,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('Error fetching comparison history:', error);
    res.status(500).json({ error: '获取比对历史失败' });
  }
});

/**
 * GET /api/comparisons/tree
 * Get hierarchical tree structure with aggregate statistics (server-side tree building)
 * Returns tree skeleton without individual comparison records for fast initial load
 */
router.get('/tree', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const showIssuesOnly = req.query.showIssuesOnly === 'true';
    const yearFilter = req.query.year ? Number(req.query.year) : undefined;
    const regionNameFilter = req.query.region_name as string;

    // DATA SCOPE FILTER - Get allowed region IDs
    let allowedRegionIds: number[] | null = null;
    const user = req.user;
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      const scopeNames = user.dataScope.regions;
      const scopeIdsQuery = `
        WITH RECURSIVE allowed_ids AS (
            SELECT id FROM regions WHERE name = ANY($1::text[])
            UNION ALL
            SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
        )
        SELECT id FROM allowed_ids
      `;
      try {
        const allowedRowsRes = await pool.query(scopeIdsQuery, [scopeNames]);
        allowedRegionIds = allowedRowsRes.rows.map((row: any) => row.id);
        if (allowedRegionIds.length === 0) {
          return res.json({ tree: [], grandTotal: 0, grandTotalIssues: 0 });
        }
      } catch (e) {
        console.error('Error calculating scope IDs in tree:', e);
        return res.json({ tree: [], grandTotal: 0, grandTotalIssues: 0 });
      }
    }

    // 1. Fetch all regions and build lookup index for O(1) parent traversal
    const regionsRes = await pool.query(`
      SELECT id, name, parent_id, level, sort_order
      FROM regions
      ORDER BY level ASC, sort_order ASC, name ASC
    `);
    const allRegions = regionsRes.rows;
    const allRegionMap = new Map<number, any>();
    for (const region of allRegions) {
      allRegionMap.set(Number(region.id), region);
    }

    // Filter regions by allowed IDs if data scope is set
    const scopedRegions = allowedRegionIds
      ? allRegions.filter((r: any) => allowedRegionIds!.includes(Number(r.id)))
      : allRegions;

    // Include required ancestors to keep hierarchy complete for scoped users
    const combinedRegionMap = new Map<number, any>();
    for (const region of scopedRegions) {
      combinedRegionMap.set(Number(region.id), region);
    }

    for (const region of scopedRegions) {
      let parentId = Number(region.parent_id);
      while (parentId && !combinedRegionMap.has(parentId)) {
        const parent = allRegionMap.get(parentId);
        if (!parent) {
          break;
        }
        combinedRegionMap.set(parentId, parent);
        parentId = Number(parent.parent_id);
      }
    }

    // 2. Build conditions for comparison aggregation
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (allowedRegionIds) {
      conditions.push(`c.region_id = ANY($${paramIndex++}::int[])`);
      params.push(allowedRegionIds);
    }
    if (yearFilter && !isNaN(yearFilter)) {
      conditions.push(`(c.year_a = $${paramIndex++} OR c.year_b = $${paramIndex++})`);
      params.push(yearFilter);
      params.push(yearFilter);
    }
    if (regionNameFilter) {
      conditions.push(`r.name LIKE $${paramIndex++}`);
      params.push(`%${regionNameFilter}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // 3. Get aggregated counts per region
    const statsRes = await pool.query(`
      SELECT 
        c.region_id,
        COUNT(*) as total_comparisons,
        COUNT(*) FILTER (WHERE (c.check_status IS NOT NULL AND c.check_status != '正常') OR (c.similarity IS NOT NULL AND c.similarity > 60)) as total_issues
      FROM comparisons c
      LEFT JOIN regions r ON c.region_id = r.id
      ${whereClause}
      GROUP BY c.region_id
    `, params);

    const statsMap = new Map<number, { total: number; issues: number }>();
    for (const row of statsRes.rows) {
      statsMap.set(Number(row.region_id), {
        total: parseInt(row.total_comparisons) || 0,
        issues: parseInt(row.total_issues) || 0
      });
    }

    // 4. Build tree structure
    interface TreeNode {
      id: number;
      name: string;
      level: number;
      totalComparisons: number;
      totalIssues: number;
      children: TreeNode[];
    }

    // Build children adjacency map once to avoid repeated scans
    const childrenByParent = new Map<number, any[]>();
    for (const region of combinedRegionMap.values()) {
      const parentId = Number(region.parent_id) || 0;
      if (!childrenByParent.has(parentId)) {
        childrenByParent.set(parentId, []);
      }
      childrenByParent.get(parentId)!.push(region);
    }

    for (const regions of childrenByParent.values()) {
      regions.sort(compareRegionsByCityManagementOrder);
    }

    const nodeMemo = new Map<number, TreeNode | null>();

    // Recursive function to build node and accumulate stats from children
    const buildNode = (regionId: number, visiting: Set<number> = new Set()): TreeNode | null => {
      if (nodeMemo.has(regionId)) {
        return nodeMemo.get(regionId)!;
      }
      if (visiting.has(regionId)) {
        nodeMemo.set(regionId, null);
        return null; // Cycle protection
      }

      const region = combinedRegionMap.get(regionId);
      if (!region) {
        nodeMemo.set(regionId, null);
        return null;
      }

      const nextVisiting = new Set(visiting);
      nextVisiting.add(regionId);

      const childRegions = childrenByParent.get(regionId) || [];
      const children: TreeNode[] = [];
      for (const childRegion of childRegions) {
        const childNode = buildNode(Number(childRegion.id), nextVisiting);
        if (childNode) {
          children.push(childNode);
        }
      }

      // Get direct stats for this region
      const directStats = statsMap.get(regionId) || { total: 0, issues: 0 };

      // Accumulate from children
      let totalComparisons = directStats.total;
      let totalIssues = directStats.issues;
      for (const child of children) {
        totalComparisons += child.totalComparisons;
        totalIssues += child.totalIssues;
      }

      // If showIssuesOnly and no issues in subtree, skip
      if (showIssuesOnly && totalIssues === 0) {
        nodeMemo.set(regionId, null);
        return null;
      }

      // Skip nodes with no comparisons in subtree (unless they have children with comparisons)
      if (totalComparisons === 0 && children.length === 0) {
        nodeMemo.set(regionId, null);
        return null;
      }

      const node = {
        id: regionId,
        name: region.name,
        level: region.level || 1,
        totalComparisons,
        totalIssues,
        children
      };
      nodeMemo.set(regionId, node);
      return node;
    };

    // Find root nodes (no parent or parent not in our set)
    const rootNodes: TreeNode[] = [];
    const combinedRegions = Array.from(combinedRegionMap.values());
    for (const r of combinedRegions) {
      const parentId = Number(r.parent_id);
      if (!parentId || !combinedRegionMap.has(parentId)) {
        const node = buildNode(Number(r.id));
        if (node) {
          rootNodes.push(node);
        }
      }
    }

    // Sort root nodes with the same order rule as City Management.
    rootNodes.sort((a, b) => {
      const regionA = combinedRegionMap.get(a.id) ?? { id: a.id, name: a.name, level: a.level, sort_order: 0 };
      const regionB = combinedRegionMap.get(b.id) ?? { id: b.id, name: b.name, level: b.level, sort_order: 0 };
      return compareRegionsByCityManagementOrder(regionA, regionB);
    });

    // Calculate grand totals
    let grandTotal = 0;
    let grandTotalIssues = 0;
    for (const node of rootNodes) {
      grandTotal += node.totalComparisons;
      grandTotalIssues += node.totalIssues;
    }

    res.json({
      tree: rootNodes,
      grandTotal,
      grandTotalIssues
    });
  } catch (error) {
    console.error('Error fetching comparison tree:', error);
    res.status(500).json({ error: '获取比对树结构失败' });
  }
});

/**
 * GET /api/comparisons/by-region
 * Get paginated comparisons for a specific region (lazy loading for tree nodes)
 */
router.get('/by-region', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const regionId = req.query.region_id ? Number(req.query.region_id) : undefined;
    if (!regionId || isNaN(regionId)) {
      return res.status(400).json({ error: '缺少有效的 region_id 参数' });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 50));
    const offset = (page - 1) * pageSize;
    const showIssuesOnly = req.query.showIssuesOnly === 'true';
    const yearFilter = req.query.year ? Number(req.query.year) : undefined;

    // DATA SCOPE CHECK
    const user = req.user;
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      const scopeNames = user.dataScope.regions;
      const scopeIdsQuery = `
        WITH RECURSIVE allowed_ids AS (
            SELECT id FROM regions WHERE name = ANY($1::text[])
            UNION ALL
            SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
        )
        SELECT id FROM allowed_ids
      `;
      try {
        const allowedRowsRes = await pool.query(scopeIdsQuery, [scopeNames]);
        const allowedIds = allowedRowsRes.rows.map((row: any) => row.id);
        if (!allowedIds.includes(regionId)) {
          return res.status(403).json({ error: '无权限访问该地区' });
        }
      } catch (e) {
        console.error('Error calculating scope IDs in by-region:', e);
        return res.status(403).json({ error: '无权限访问该地区' });
      }
    }

    // Build conditions
    const conditions: string[] = [`c.region_id = $1`];
    const params: any[] = [regionId];
    let paramIndex = 2;

    if (showIssuesOnly) {
      conditions.push(`(c.check_status IS NOT NULL AND c.check_status != '正常')`);
    }
    if (yearFilter && !isNaN(yearFilter)) {
      conditions.push(`(c.year_a = $${paramIndex++} OR c.year_b = $${paramIndex++})`);
      params.push(yearFilter);
      params.push(yearFilter);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Get total count
    const countRes = await pool.query(`
      SELECT COUNT(*) as total 
      FROM comparisons c 
      ${whereClause}
    `, params);
    const total = parseInt(countRes.rows[0]?.total) || 0;

    // Get paginated results
    const limitIndex = paramIndex++;
    const offsetIndex = paramIndex++;
    const queryParams = [...params, pageSize, offset];

    const comparisonsRes = await pool.query(`
      SELECT 
        c.id,
        c.region_id,
        c.year_a,
        c.year_b,
        c.left_report_id,
        c.right_report_id,
        c.similarity,
        c.check_status,
        c.created_at,
        r.name as region_name
      FROM comparisons c
      LEFT JOIN regions r ON c.region_id = r.id
      ${whereClause}
      ORDER BY c.year_b DESC, c.year_a DESC, c.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `, queryParams);

    res.json({
      data: comparisonsRes.rows.map((c: any) => ({
        id: c.id,
        regionId: c.region_id,
        regionName: c.region_name || '未知地区',
        yearA: c.year_a,
        yearB: c.year_b,
        leftReportId: c.left_report_id,
        rightReportId: c.right_report_id,
        similarity: c.similarity,
        checkStatus: c.check_status,
        createdAt: c.created_at,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (error) {
    console.error('Error fetching comparisons by region:', error);
    res.status(500).json({ error: '获取地区比对记录失败' });
  }
});

/**
 * GET /api/comparisons/grouped
 * Get comparisons grouped by region for card-style display
 */
router.get('/grouped', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const hasIssuesOnly = req.query.hasIssuesOnly === 'true';
    const regionId = req.query.region_id ? Number(req.query.region_id) : undefined;

    // Build conditions
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (hasIssuesOnly) {
      conditions.push(`(c.check_status IS NOT NULL AND c.check_status != '正常')`);
    }
    if (regionId) {
      conditions.push(`c.region_id = $${paramIndex++}`);
      params.push(regionId);
    }

    // DATA SCOPE FILTER
    const user = req.user;
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      const scopeNames = user.dataScope.regions;
      const scopeIdsQuery = `
        WITH RECURSIVE allowed_ids AS (
            SELECT id FROM regions WHERE name = ANY($1::text[])
            UNION ALL
            SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
        )
        SELECT id FROM allowed_ids
      `;
      try {
        const allowedRowsRes = await pool.query(scopeIdsQuery, [scopeNames]);
        const allowedIds = allowedRowsRes.rows.map((row: any) => row.id);
        if (allowedIds.length > 0) {
          conditions.push(`c.region_id = ANY($${paramIndex++}::int[])`);
          params.push(allowedIds);
        } else {
          conditions.push('1=0');
        }
      } catch (e) {
        console.error('Error calculating scope IDs in grouped:', e);
        conditions.push('1=0');
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get all comparisons with region info
    const comparisonsRes = await pool.query(`
      SELECT 
        c.id,
        c.region_id,
        c.year_a,
        c.year_b,
        c.similarity,
        c.check_status,
        c.created_at,
        r.name as region_name,
        r.level as region_level
      FROM comparisons c
      LEFT JOIN regions r ON c.region_id = r.id
      ${whereClause}
      ORDER BY r.name ASC, c.year_b DESC, c.year_a DESC
    `, params);

    const comparisons = comparisonsRes.rows;

    // Group by region
    const regionMap = new Map<number, any>();
    for (const c of comparisons) {
      const rid = c.region_id;
      if (!regionMap.has(rid)) {
        regionMap.set(rid, {
          region_id: rid,
          region_name: c.region_name || '未知地区',
          region_level: c.region_level,
          total_comparisons: 0,
          with_issues: 0,
          comparisons: []
        });
      }
      const region = regionMap.get(rid)!;
      region.total_comparisons++;

      const hasIssue = c.check_status && c.check_status !== '正常';
      if (hasIssue) region.with_issues++;

      region.comparisons.push({
        id: c.id,
        year_a: c.year_a,
        year_b: c.year_b,
        similarity: c.similarity,
        check_status: c.check_status,
        has_issue: hasIssue,
        created_at: c.created_at
      });
    }

    // Convert to array and sort by issue count
    const regions = Array.from(regionMap.values());
    regions.sort((a, b) => b.with_issues - a.with_issues || b.total_comparisons - a.total_comparisons);

    // Calculate totals
    const totalComparisons = comparisons.length;
    const totalWithIssues = comparisons.filter((c: any) => c.check_status && c.check_status !== '正常').length;

    res.json({
      data: {
        total_comparisons: totalComparisons,
        total_with_issues: totalWithIssues,
        region_count: regions.length,
        regions
      }
    });
  } catch (error) {
    console.error('Error fetching grouped comparisons:', error);
    res.status(500).json({ error: '获取分组比对失败' });
  }
});

/**
 * POST /api/comparisons/create
 * Create a new comparison record (Seems duplicate of llm-comparisons/comparisons, but keeping for compatibility)
 */
router.post('/create', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { region_id, year_a, year_b, left_report_id, right_report_id } = req.body;

    console.log('Creating comparison:', { region_id, year_a, year_b, left_report_id, right_report_id });

    if (!region_id || !year_a || !year_b || !left_report_id || !right_report_id) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    if (Number(year_a) === Number(year_b)) {
      return res.status(400).json({ error: '不允许同年度比较：year_a 和 year_b 必须不同' });
    }

    let leftReport = await fetchActiveParsedReport(Number(left_report_id));
    let rightReport = await fetchActiveParsedReport(Number(right_report_id));
    if (!leftReport || !rightReport) {
      return res.status(404).json({ error: '报告不存在' });
    }

    if (leftReport.regionId !== rightReport.regionId) {
      return res.status(400).json({ error: '两份报告必须属于同一地区' });
    }

    if (Number(region_id) !== leftReport.regionId) {
      return res.status(400).json({ error: '地区与报告不匹配' });
    }

    if (leftReport.year === rightReport.year) {
      return res.status(400).json({ error: '不允许同年度比较：两份报告必须来自不同年份' });
    }

    if (leftReport.year > rightReport.year) {
      [leftReport, rightReport] = [rightReport, leftReport];
    }

    const notReadySides = collectNotReadySides(leftReport, rightReport);
    if (notReadySides.length > 0) {
      return res.status(409).json({
        error: '报告尚未发布或解析内容为空，暂不能生成比对',
        error_code: 'PARSE_NOT_READY',
        details: { not_ready_sides: notReadySides },
      });
    }

    const metrics = calculateReportMetrics(leftReport.parsedJson, rightReport.parsedJson);
    const similarity = metrics.similarity;
    let checkStatus: string | null = metrics.checkStatus;

    const leftIssues = await countOpenReviewIssues(leftReport.versionId);
    const rightIssues = await countOpenReviewIssues(rightReport.versionId);
    if (leftIssues > 0 || rightIssues > 0) {
      const issueDesc: string[] = [];
      if (checkStatus && checkStatus.startsWith('异常')) {
        issueDesc.push(checkStatus.replace('异常(', '').replace(')', ''));
      }
      if (leftIssues > 0) issueDesc.push(`${leftReport.year}年校验${leftIssues}项`);
      if (rightIssues > 0) issueDesc.push(`${rightReport.year}年校验${rightIssues}项`);
      checkStatus = `异常(${issueDesc.join('|')})`;
    } else if (!checkStatus) {
      checkStatus = '正常';
    }

    const comparisonRes = await pool.query(`
      INSERT INTO comparisons (
        region_id,
        year_a,
        year_b,
        left_report_id,
        right_report_id,
        similarity,
        check_status,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      ON CONFLICT (region_id, year_a, year_b)
      DO UPDATE SET
        left_report_id = EXCLUDED.left_report_id,
        right_report_id = EXCLUDED.right_report_id,
        similarity = EXCLUDED.similarity,
        check_status = EXCLUDED.check_status,
        updated_at = NOW()
      RETURNING id
    `, [
      leftReport.regionId,
      leftReport.year,
      rightReport.year,
      leftReport.reportId,
      rightReport.reportId,
      similarity,
      checkStatus || null,
    ]);
    const comparisonId = Number(comparisonRes.rows[0]?.id);

    if (!comparisonId) {
      return res.status(500).json({ error: '创建失败' });
    }

    const jobId = await ensureComparisonJob(comparisonId, leftReport.reportId, leftReport.versionId);

    res.json({
      success: true,
      message: '比对任务已创建',
      comparisonId,
      jobId,
    });
  } catch (error: any) {
    console.error('Error creating comparison:', error);
    res.status(500).json({ error: `创建比对失败: ${error.message}` });
  }
});

/**
 * GET /api/comparisons/:id/result
 * Get comparison result details with both reports' content (Similar to llm-comparisons)
 */
router.get('/:id/result', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!comparisonId || Number.isNaN(comparisonId)) {
      return res.status(400).json({ error: '无效的比对ID' });
    }

    // Get comparison info
    const comparisonsRes = await pool.query(`
      SELECT c.*, r.name as region_name
      FROM comparisons c
      LEFT JOIN regions r ON c.region_id = r.id
      WHERE c.id = $1
    `, [comparisonId]);
    const comparison = comparisonsRes.rows[0];

    if (!comparison) {
      return res.status(404).json({ error: '比较不存在' });
    }

    // DATA SCOPE CHECK
    const user = req.user;
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      const scopeNames = user.dataScope.regions;
      const scopeIdsQuery = `
        WITH RECURSIVE allowed_ids AS (
            SELECT id FROM regions WHERE name = ANY($1::text[])
            UNION ALL
            SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
        )
        SELECT id FROM allowed_ids
      `;
      try {
        const allowedRowsRes = await pool.query(scopeIdsQuery, [scopeNames]);
        const allowedIds = allowedRowsRes.rows.map((row: any) => row.id);
        if (!allowedIds.includes(Number(comparison.region_id))) {
          return res.status(403).json({ error: '无权限访问该地区' });
        }
      } catch (e) {
        console.error('Error calculating scope IDs in comparison result:', e);
        return res.status(403).json({ error: '无权限访问该地区' });
      }
    }

    // Get content from published active versions only.
    const leftReport = await fetchActiveParsedReport(Number(comparison.left_report_id));
    const rightReport = await fetchActiveParsedReport(Number(comparison.right_report_id));
    const notReadySides = collectNotReadySides(leftReport, rightReport);
    if (notReadySides.length > 0) {
      return res.status(409).json({
        error: '比对内容尚未就绪：报告未发布或解析内容为空',
        error_code: 'COMPARISON_CONTENT_NOT_READY',
        details: { not_ready_sides: notReadySides },
      });
    }

    const resultsRes = await pool.query(`
      SELECT cr.diff_json, cr.created_at
      FROM comparison_results cr
      WHERE cr.comparison_id = $1
    `, [comparisonId]);

    const leftContent = leftReport!.parsedJson;
    const rightContent = rightReport!.parsedJson;
    const diffJson = parseDbJson(resultsRes.rows[0]?.diff_json);
    const metrics = calculateReportMetrics(leftContent, rightContent);

    res.json({
      id: comparison.id,
      region_name: comparison.region_name,
      year_a: comparison.year_a,
      year_b: comparison.year_b,
      left_report_id: comparison.left_report_id,
      right_report_id: comparison.right_report_id,
      left_content: leftContent,
      right_content: rightContent,
      diff_json: diffJson,
      similarity: comparison.similarity,
      section_metrics: {
        text: metrics.textSectionMetrics,
        average: metrics.similarity,
        method: metrics.method,
      },
      check_status: comparison.check_status,
      created_at: comparison.created_at,
    });
  } catch (error) {
    console.error('Error fetching comparison result:', error);
    res.status(500).json({ error: '获取比对结果失败' });
  }
});

/**
 * DELETE /api/comparisons/:id
 * Delete a comparison record
 */
router.delete('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!comparisonId || Number.isNaN(comparisonId)) {
      return res.status(400).json({ error: '无效的比对ID' });
    }

    const existingRes = await pool.query('SELECT id FROM comparisons WHERE id = $1', [comparisonId]);
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: '比较不存在' });
    }

    await pool.query('DELETE FROM comparisons WHERE id = $1', [comparisonId]);

    res.json({ success: true, message: '删除成功' });
  } catch (error) {
    console.error('Error deleting comparison:', error);
    res.status(500).json({ error: '删除失败' });
  }
});

/**
 * POST /api/comparisons/:id/export/pdf
 * Export comparison to PDF with optional watermark.
 * Deprecated legacy EJS compatibility path. Prefer /api/pdf-jobs for user-facing comparison PDF exports.
 */
router.post('/:id/export/pdf', authMiddleware, async (req: AuthRequest, res: Response) => {
  let legacyTraceId = '';
  try {
    const comparisonId = Number(req.params.id);
    legacyTraceId = createLegacyEjsExportTraceId(req, comparisonId);
    setLegacyEjsExportHeaders(res, legacyTraceId);
    if (!comparisonId || Number.isNaN(comparisonId)) {
      return res.status(400).json({ error: '无效的比对ID' });
    }

    const { watermark_text, watermark_opacity } = req.body;
    console.warn(
      `[ComparisonHistory][DeprecatedLegacyEjsPdfExport] trace=${legacyTraceId} route="${LEGACY_EJS_COMPARISON_PDF_ROUTE}" replacement="${LEGACY_EJS_COMPARISON_PDF_REPLACEMENT}" comparison=${comparisonId} user=${req.user?.id ?? 'unknown'}`
    );

    const comparisonRes = await pool.query(`
      SELECT 
        c.id,
        c.region_id,
        c.year_a,
        c.year_b,
        c.left_report_id,
        c.right_report_id,
        r.name as region_name
      FROM comparisons c
      LEFT JOIN regions r ON c.region_id = r.id
      WHERE c.id = $1
    `, [comparisonId]);
    const comparison = comparisonRes.rows[0];

    if (!comparison) {
      return res.status(404).json({ error: '比较不存在' });
    }

    // DATA SCOPE CHECK
    const user = req.user;
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      const scopeNames = user.dataScope.regions;
      const scopeIdsQuery = `
        WITH RECURSIVE allowed_ids AS (
            SELECT id FROM regions WHERE name = ANY($1::text[])
            UNION ALL
            SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
        )
        SELECT id FROM allowed_ids
      `;
      try {
        const allowedRowsRes = await pool.query(scopeIdsQuery, [scopeNames]);
        const allowedIds = allowedRowsRes.rows.map((row: any) => row.id);
        if (!allowedIds.includes(Number(comparison.region_id))) {
          return res.status(403).json({ error: '无权限访问该地区' });
        }
      } catch (e) {
        console.error('Error calculating scope IDs in comparison export:', e);
        return res.status(403).json({ error: '无权限访问该地区' });
      }
    }

    const resultsRes = await pool.query(`
      SELECT diff_json FROM comparison_results WHERE comparison_id = $1
    `, [comparisonId]);

    const leftActiveReport = await fetchActiveParsedReport(Number(comparison.left_report_id));
    const rightActiveReport = await fetchActiveParsedReport(Number(comparison.right_report_id));
    const notReadySides = collectNotReadySides(leftActiveReport, rightActiveReport);
    if (notReadySides.length > 0) {
      return res.status(409).json({
        error: '比对内容尚未就绪：报告未发布或解析内容为空',
        error_code: 'COMPARISON_CONTENT_NOT_READY',
        details: { not_ready_sides: notReadySides },
      });
    }

    const leftContent = leftActiveReport!.parsedJson;
    const rightContent = rightActiveReport!.parsedJson;

    const reportA = {
      meta: { id: comparison.left_report_id, year: comparison.year_a, unitName: comparison.region_name },
      data: leftContent
    };
    const reportB = {
      meta: { id: comparison.right_report_id, year: comparison.year_b, unitName: comparison.region_name },
      data: rightContent
    };

    const [olderReport, newerReport] = (comparison.year_a || 0) < (comparison.year_b || 0) ? [reportA, reportB] : [reportB, reportA];

    const sections: any[] = [];
    olderReport.data.sections.forEach((s: any) => sections.push({ title: s.title, oldSec: s }));
    newerReport.data.sections.forEach((s: any) => {
      const existing = sections.find(a => a.title === s.title);
      if (existing) existing.newSec = s;
      else sections.push({ title: s.title, newSec: s });
    });

    // Sort
    const numerals = ['一', '二', '三', '四', '五', '六', '七', '八'];
    sections.sort((a, b) => {
      const isTitleA = a.title === '标题' || a.title.includes('年度报告');
      const isTitleB = b.title === '标题' || b.title.includes('年度报告');
      if (isTitleA && !isTitleB) return -1;
      if (!isTitleA && isTitleB) return 1;
      const idxA = numerals.findIndex(n => a.title.includes(n));
      const idxB = numerals.findIndex(n => b.title.includes(n));
      return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
    });

    sections.forEach(sec => {
      if (sec.oldSec?.type === 'text' && sec.newSec?.type === 'text') {
        const diffs = calculateDiffs(sec.oldSec.content || '', sec.newSec.content || '');
        sec.diffHtml = renderDiffHtml(diffs, false);
      }
    });

    let summary: any = { textRepetition: 0, tableRepetition: 0, overallRepetition: 0, items: [] };
    if (resultsRes.rows.length > 0 && resultsRes.rows[0].diff_json) {
      try {
        const diffData = parseDbJson(resultsRes.rows[0].diff_json);
        if (diffData.summary) summary = diffData.summary;
        if (diffData.sections) {
          sections.forEach(sec => {
            const ds = diffData.sections.find((d: any) => d.title === sec.title);
            if (ds?.diffTable) sec.diffTable = ds.diffTable;
          });
        }
      } catch { }
    }

    const reportData: ComparisonReportData = {
      older: olderReport,
      newer: newerReport,
      summary,
      sections
    };

    const pdfPath = await pdfExportService.generateComparisonPdf({
      comparisonId,
      data: reportData,
      regionName: comparison.region_name || '未知地区',
      watermarkText: watermark_text,
      watermarkOpacity: watermark_opacity ? parseFloat(watermark_opacity) : 0.1,
      traceId: legacyTraceId,
    });

    const fileSize = require('fs').statSync(pdfPath).size;

    await pool.query(`
      INSERT INTO comparison_exports (comparison_id, format, file_path, file_size, watermark_text)
      VALUES ($1, 'pdf', $2, $3, $4)
    `, [comparisonId, pdfPath, fileSize, watermark_text || null]);

    res.download(pdfPath, `comparison_${comparisonId}_${comparison.year_a}_vs_${comparison.year_b}.pdf`);
  } catch (error: any) {
    console.error(`[ComparisonHistory][DeprecatedLegacyEjsPdfExport] trace=${legacyTraceId || 'unavailable'} error exporting PDF:`, error);
    res.status(500).json({ error: `导出失败: ${error.message}` });
  }
});

/**
 * GET /api/comparisons/:id/exports
 * Get export history for a comparison
 */
router.get('/:id/exports', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!comparisonId || Number.isNaN(comparisonId)) {
      return res.status(400).json({ error: '无效的比对ID' });
    }

    const comparisonRes = await pool.query('SELECT region_id FROM comparisons WHERE id = $1', [comparisonId]);
    const comparison = comparisonRes.rows[0];

    if (!comparison) {
      return res.status(404).json({ error: '比较不存在' });
    }

    // DATA SCOPE CHECK
    const user = req.user;
    if (user && user.dataScope && Array.isArray(user.dataScope.regions) && user.dataScope.regions.length > 0) {
      const scopeNames = user.dataScope.regions;
      const scopeIdsQuery = `
        WITH RECURSIVE allowed_ids AS (
            SELECT id FROM regions WHERE name = ANY($1::text[])
            UNION ALL
            SELECT r.id FROM regions r JOIN allowed_ids p ON r.parent_id = p.id
        )
        SELECT id FROM allowed_ids
      `;
      try {
        const allowedRowsRes = await pool.query(scopeIdsQuery, [scopeNames]);
        const allowedIds = allowedRowsRes.rows.map((row: any) => row.id);
        if (!allowedIds.includes(Number(comparison.region_id))) {
          return res.status(403).json({ error: '无权限访问该地区' });
        }
      } catch (e) {
        console.error('Error calculating scope IDs in comparison exports:', e);
        return res.status(403).json({ error: '无权限访问该地区' });
      }
    }

    const exportsRes = await pool.query(`
      SELECT id, format, file_size, watermark_text, created_at
      FROM comparison_exports
      WHERE comparison_id = $1
      ORDER BY created_at DESC
    `, [comparisonId]);

    res.json({ data: exportsRes.rows });
  } catch (error) {
    console.error('Error fetching exports:', error);
    res.status(500).json({ error: '获取导出记录失败' });
  }
});


/**
 * GET /api/comparisons/failed-jobs
 * Get list of failed comparison jobs
 */
router.get('/failed-jobs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    // Query with fallback: try comparison first, then report_id if comparison_id is missing
    const failedJobsRes = await pool.query(`
      SELECT 
        j.id as job_id,
        j.comparison_id,
        j.report_id,
        j.error_message, 
        j.created_at,
        j.finished_at,
        COALESCE(c.year_a, rep.year) as year_a,
        COALESCE(c.year_b, rep.year) as year_b,
        COALESCE(r1.name, r2.name, '未知地区') as region_name
      FROM jobs j
      LEFT JOIN comparisons c ON j.comparison_id = c.id
      LEFT JOIN regions r1 ON c.region_id = r1.id
      LEFT JOIN reports rep ON j.report_id = rep.id
      LEFT JOIN regions r2 ON rep.region_id = r2.id
      WHERE j.kind = 'compare' AND j.status = 'failed'
      ORDER BY j.finished_at DESC
    `);

    res.json(failedJobsRes.rows.map((row: any) => ({
      id: row.job_id,
      comparisonId: row.comparison_id,
      regionName: row.region_name || '未知地区',
      yearA: row.year_a || '?',
      yearB: row.year_b || '?',
      errorMessage: row.error_message,
      failedAt: row.finished_at
    })));
  } catch (error) {
    console.error('Error fetching failed jobs:', error);
    res.status(500).json({ error: '获取失败任务失败' });
  }
});

/**
 * POST /api/comparisons/retry-jobs
 * Retry failed comparison jobs
 */
router.post('/retry-jobs', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { jobIds, all } = req.body;

    let result;
    if (all) {
      result = await pool.query(`
        UPDATE jobs 
        SET status = 'queued', 
            error_message = NULL,
            started_at = NULL,
            finished_at = NULL,
            retry_count = 0
        WHERE kind = 'compare' AND status = 'failed'
      `);
    } else if (Array.isArray(jobIds) && jobIds.length > 0) {
      result = await pool.query(`
        UPDATE jobs 
        SET status = 'queued', 
            error_message = NULL,
            started_at = NULL,
            finished_at = NULL,
            retry_count = 0
        WHERE kind = 'compare' AND status = 'failed' AND id = ANY($1::int[])
      `, [jobIds]);
    } else {
      return res.status(400).json({ error: '请选择要重试的任务' });
    }

    res.json({ success: true, count: result.rowCount });
  } catch (error) {
    console.error('Error retrying jobs:', error);
    res.status(500).json({ error: '重试任务失败' });
  }
});

export default router;
