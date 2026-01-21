import express, { Request, Response } from 'express';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import pdfExportService from '../services/PdfExportService';
import { calculateReportMetrics } from '../utils/reportAnalysis';
import { ComparisonReportData } from '../services/PdfExportService';
import { calculateDiffs, renderDiffHtml } from '../utils/diffRenderer';

const router = express.Router();

function parseDbJson(value: any): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

    // Check if comparison already exists
    const existingRes = await pool.query(`
      SELECT id FROM comparisons 
      WHERE region_id = $1 
        AND year_a = $2 
        AND year_b = $3
    `, [region_id, year_a, year_b]);
    const existing = existingRes.rows;

    if (existing && existing.length > 0) {
      return res.json({
        success: true,
        message: '比较已存在',
        comparisonId: existing[0].id
      });
    }

    // Calculate Metrics
    let similarity = 0;
    let checkStatus: string | null = null;
    try {
      const leftRes = await pool.query(`
        SELECT rv.parsed_json
        FROM reports r
        JOIN report_versions rv ON rv.id = r.active_version_id
        WHERE r.id = $1
      `, [left_report_id]);
      const rightRes = await pool.query(`
        SELECT rv.parsed_json
        FROM reports r
        JOIN report_versions rv ON rv.id = r.active_version_id
        WHERE r.id = $1
      `, [right_report_id]);

      const leftJson = parseDbJson(leftRes.rows[0]?.parsed_json) || { sections: [] };
      const rightJson = parseDbJson(rightRes.rows[0]?.parsed_json) || { sections: [] };

      const metrics = calculateReportMetrics(leftJson, rightJson);
      similarity = metrics.similarity;
      checkStatus = metrics.checkStatus;

      // Additionally, check for individual report consistency issues
      const leftVersionRes = await pool.query(`SELECT active_version_id as id FROM reports WHERE id=$1`, [left_report_id]);
      const rightVersionRes = await pool.query(`SELECT active_version_id as id FROM reports WHERE id=$1`, [right_report_id]);

      const leftVersionId = leftVersionRes.rows[0]?.id;
      const rightVersionId = rightVersionRes.rows[0]?.id;

      const leftIssuesRes = leftVersionId ? await pool.query(`
        SELECT COUNT(*) as cnt FROM report_consistency_items 
        WHERE report_version_id=$1 
        AND auto_status='FAIL' 
        AND human_status='pending'
      `, [leftVersionId]) : { rows: [{ cnt: 0 }] };
      const leftIssues = parseInt(leftIssuesRes.rows[0].cnt) || 0;

      const rightIssuesRes = rightVersionId ? await pool.query(`
        SELECT COUNT(*) as cnt FROM report_consistency_items 
        WHERE report_version_id=$1 
        AND auto_status='FAIL' 
        AND human_status='pending'
      `, [rightVersionId]) : { rows: [{ cnt: 0 }] };
      const rightIssues = parseInt(rightIssuesRes.rows[0].cnt) || 0;

      // Combine cross-year and intra-report checks
      if (leftIssues > 0 || rightIssues > 0) {
        const issueDesc = [];
        if (checkStatus && checkStatus.startsWith('异常')) {
          issueDesc.push(checkStatus.replace('异常(', '').replace(')', ''));
        }
        if (leftIssues > 0) issueDesc.push(`${year_a}年校验${leftIssues}项`);
        if (rightIssues > 0) issueDesc.push(`${year_b}年校验${rightIssues}项`);
        checkStatus = `异常(${issueDesc.join('|')})`;
      } else if (!checkStatus) {
        // No cross-year issues and no intra issues found
        checkStatus = '正常';
      }
    } catch (e) {
      console.error('Error calculating metrics during creation:', e);
    }

    // Create comparison record
    await pool.query(`
      INSERT INTO comparisons (region_id, year_a, year_b, left_report_id, right_report_id, similarity, check_status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [region_id, year_a, year_b, left_report_id, right_report_id, similarity, checkStatus || null]);

    const createdRes = await pool.query(`
      SELECT id FROM comparisons 
      WHERE region_id = $1 
        AND left_report_id = $2 
        AND right_report_id = $3
      ORDER BY id DESC LIMIT 1
    `, [region_id, left_report_id, right_report_id]);
    const created = createdRes.rows;

    if (!created || created.length === 0) {
      return res.status(500).json({ error: '创建失败' });
    }

    res.json({
      success: true,
      message: '比对记录创建成功',
      comparisonId: created[0].id
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

    // Get content
    const leftVersionsRes = await pool.query(`
      SELECT rv.parsed_json, rp.year
      FROM reports rp
      JOIN report_versions rv ON rv.id = rp.active_version_id
      WHERE rp.id = $1
    `, [comparison.left_report_id]);
    const rightVersionsRes = await pool.query(`
      SELECT rv.parsed_json, rp.year
      FROM reports rp
      JOIN report_versions rv ON rv.id = rp.active_version_id
      WHERE rp.id = $1
    `, [comparison.right_report_id]);

    const resultsRes = await pool.query(`
      SELECT cr.diff_json, cr.created_at
      FROM comparison_results cr
      WHERE cr.comparison_id = $1
    `, [comparisonId]);

    const leftContent = parseDbJson(leftVersionsRes.rows[0]?.parsed_json);
    const rightContent = parseDbJson(rightVersionsRes.rows[0]?.parsed_json);
    const diffJson = parseDbJson(resultsRes.rows[0]?.diff_json);

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
 * Export comparison to PDF with optional watermark
 */
router.post('/:id/export/pdf', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!comparisonId || Number.isNaN(comparisonId)) {
      return res.status(400).json({ error: '无效的比对ID' });
    }

    const { watermark_text, watermark_opacity } = req.body;

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

    const leftVersionsRes = await pool.query(`
      SELECT rv.parsed_json, rp.year
      FROM reports rp
      JOIN report_versions rv ON rv.id = rp.active_version_id
      WHERE rp.id = $1
    `, [comparison.left_report_id]);
    const rightVersionsRes = await pool.query(`
      SELECT rv.parsed_json, rp.year
      FROM reports rp
      JOIN report_versions rv ON rv.id = rp.active_version_id
      WHERE rp.id = $1
    `, [comparison.right_report_id]);

    const leftContent = parseDbJson(leftVersionsRes.rows[0]?.parsed_json) || { sections: [] };
    const rightContent = parseDbJson(rightVersionsRes.rows[0]?.parsed_json) || { sections: [] };

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
    });

    const fileSize = require('fs').statSync(pdfPath).size;

    await pool.query(`
      INSERT INTO comparison_exports (comparison_id, format, file_path, file_size, watermark_text)
      VALUES ($1, 'pdf', $2, $3, $4)
    `, [comparisonId, pdfPath, fileSize, watermark_text || null]);

    res.download(pdfPath, `comparison_${comparisonId}_${comparison.year_a}_vs_${comparison.year_b}.pdf`);
  } catch (error: any) {
    console.error('Error exporting PDF:', error);
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

export default router;
