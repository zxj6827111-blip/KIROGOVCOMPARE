import express, { Request, Response } from 'express';
import { querySqlite, sqlValue, ensureSqliteMigrations } from '../config/sqlite';
import { authMiddleware, AuthRequest, optionalAuthMiddleware } from '../middleware/auth';
import pdfExportService from '../services/PdfExportService';
import path from 'path';
import fs from 'fs';
import { calculateDiffs, renderDiffHtml } from '../utils/diffRenderer';
import { calculateReportMetrics } from '../utils/reportAnalysis';
import { ComparisonReportData } from '../services/PdfExportService';

const router = express.Router();

/**
 * GET /api/comparisons/history
 * Get comparison history list with pagination
 */
router.get('/history', optionalAuthMiddleware, (req: AuthRequest, res: Response) => {
  try {
    ensureSqliteMigrations();

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const regionId = req.query.region_id;
    const regionName = req.query.region_name as string;
    const year = req.query.year;
    const offset = (page - 1) * pageSize;

    // Build conditions
    const conditions: string[] = [];
    if (regionId) {
      conditions.push(`c.region_id = ${sqlValue(Number(regionId))}`);
    }
    if (regionName) {
      // Filter by region name (partial match)
      // Note: Since we are using raw SQL helper, we need to be careful. 
      // sqlValue usually quotes strings. We can't easily do LIKE with sqlValue unless we manually construct.
      // Assuming sqlValue handles string escaping correctly:
      conditions.push(`r.name LIKE '%${String(regionName).replace(/'/g, "''")}%'`);
    }
    if (year) {
      const y = Number(year);
      if (!isNaN(y)) {
        conditions.push(`(c.year_a = ${y} OR c.year_b = ${y})`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = querySqlite(`
      SELECT COUNT(*) as total 
      FROM comparisons c 
      LEFT JOIN regions r ON c.region_id = r.id
      ${whereClause}
    `);
    const total = countResult?.[0]?.total || 0;

    // Get paginated results
    const comparisons = querySqlite(`
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
      LIMIT ${pageSize} OFFSET ${offset}
    `);

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
 * POST /api/comparisons/create
 * Create a new comparison record
 */
router.post('/create', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const { region_id, year_a, year_b, left_report_id, right_report_id } = req.body;

    console.log('Creating comparison:', { region_id, year_a, year_b, left_report_id, right_report_id });

    if (!region_id || !year_a || !year_b || !left_report_id || !right_report_id) {
      return res.status(400).json({ error: '缺少必要参数' });
    }

    ensureSqliteMigrations();

    // Check if comparison already exists
    const existing = querySqlite(`
      SELECT id FROM comparisons 
      WHERE region_id = ${sqlValue(region_id)} 
        AND year_a = ${sqlValue(year_a)} 
        AND year_b = ${sqlValue(year_b)}
    `);

    if (existing && existing.length > 0) {
      // Return existing comparison
      return res.json({
        success: true,
        message: '比对记录已存在',
        comparisonId: existing[0].id
      });
    }

    // Calculate Metrics
    let similarity = 0;
    let checkStatus: string | null = null;
    try {
      const leftRes = querySqlite(`SELECT parsed_json FROM report_versions WHERE report_id=${sqlValue(left_report_id)} AND is_active=1`);
      const rightRes = querySqlite(`SELECT parsed_json FROM report_versions WHERE report_id=${sqlValue(right_report_id)} AND is_active=1`);

      const leftJson = leftRes?.[0]?.parsed_json ? JSON.parse(leftRes[0].parsed_json) : { sections: [] };
      const rightJson = rightRes?.[0]?.parsed_json ? JSON.parse(rightRes[0].parsed_json) : { sections: [] };

      const metrics = calculateReportMetrics(leftJson, rightJson);
      similarity = metrics.similarity;
      checkStatus = metrics.checkStatus;
    } catch (e) {
      console.error('Error calculating metrics during creation:', e);
    }

    // Create comparison record
    querySqlite(`
      INSERT INTO comparisons (region_id, year_a, year_b, left_report_id, right_report_id, similarity, check_status, created_at)
      VALUES (${sqlValue(region_id)}, ${sqlValue(year_a)}, ${sqlValue(year_b)}, ${sqlValue(left_report_id)}, ${sqlValue(right_report_id)}, ${similarity}, ${checkStatus ? sqlValue(checkStatus) : 'NULL'}, datetime('now'))
    `);

    // Get the created comparison
    const created = querySqlite(`
      SELECT id FROM comparisons 
      WHERE region_id = ${sqlValue(region_id)} 
        AND left_report_id = ${sqlValue(left_report_id)} 
        AND right_report_id = ${sqlValue(right_report_id)}
      ORDER BY id DESC LIMIT 1
    `);

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
 * Get comparison result details with both reports' content
 */
router.get('/:id/result', optionalAuthMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!comparisonId || Number.isNaN(comparisonId)) {
      return res.status(400).json({ error: '无效的比对ID' });
    }

    ensureSqliteMigrations();

    // Get comparison info
    const comparisons = querySqlite(`
      SELECT c.*, r.name as region_name
      FROM comparisons c
      LEFT JOIN regions r ON c.region_id = r.id
      WHERE c.id = ${sqlValue(comparisonId)}
    `);

    if (!comparisons || comparisons.length === 0) {
      return res.status(404).json({ error: '比对记录不存在' });
    }

    const comparison = comparisons[0];

    // Get left report parsed content
    const leftVersions = querySqlite(`
      SELECT rv.parsed_json, rp.year
      FROM report_versions rv
      JOIN reports rp ON rv.report_id = rp.id
      WHERE rv.report_id = ${sqlValue(comparison.left_report_id)} AND rv.is_active = 1
    `);

    // Get right report parsed content
    const rightVersions = querySqlite(`
      SELECT rv.parsed_json, rp.year
      FROM report_versions rv
      JOIN reports rp ON rv.report_id = rp.id
      WHERE rv.report_id = ${sqlValue(comparison.right_report_id)} AND rv.is_active = 1
    `);

    // Get diff result if available
    const results = querySqlite(`
      SELECT cr.diff_json, cr.created_at
      FROM comparison_results cr
      WHERE cr.comparison_id = ${sqlValue(comparisonId)}
    `);

    // Parse JSON fields
    const parseJson = (val: any) => {
      if (!val) return null;
      if (typeof val === 'object') return val;
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    };

    const leftContent = leftVersions?.[0] ? parseJson(leftVersions[0].parsed_json) : null;
    const rightContent = rightVersions?.[0] ? parseJson(rightVersions[0].parsed_json) : null;
    const diffJson = results?.[0] ? parseJson(results[0].diff_json) : null;

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
router.delete('/:id', authMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!comparisonId || Number.isNaN(comparisonId)) {
      return res.status(400).json({ error: '无效的比对ID' });
    }

    ensureSqliteMigrations();

    // Check if exists
    const existing = querySqlite(`SELECT id FROM comparisons WHERE id = ${sqlValue(comparisonId)}`);
    if (!existing || existing.length === 0) {
      return res.status(404).json({ error: '比对记录不存在' });
    }

    // Delete (cascade will handle related records)
    querySqlite(`DELETE FROM comparisons WHERE id = ${sqlValue(comparisonId)}`);

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
router.post('/:id/export/pdf', optionalAuthMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!comparisonId || Number.isNaN(comparisonId)) {
      return res.status(400).json({ error: '无效的比对ID' });
    }

    const { watermark_text, watermark_opacity } = req.body;

    ensureSqliteMigrations();

    // Get comparison details
    const comparisons = querySqlite(`
      SELECT 
        c.id,
        c.region_id,
        c.year_a,
        c.year_b,
        r.name as region_name
      FROM comparisons c
      LEFT JOIN regions r ON c.region_id = r.id
      WHERE c.id = ${sqlValue(comparisonId)}
    `);

    if (!comparisons || comparisons.length === 0) {
      return res.status(404).json({ error: '比对记录不存在' });
    }

    const comparison = comparisons[0];

    // Get comparison result for summary
    const results = querySqlite(`
      SELECT diff_json FROM comparison_results WHERE comparison_id = ${sqlValue(comparisonId)}
    `);

    // Get left report content
    const leftVersions = querySqlite(`
      SELECT rv.parsed_json, rp.year
      FROM report_versions rv
      JOIN reports rp ON rv.report_id = rp.id
      WHERE rv.report_id = ${sqlValue(comparison.left_report_id)} AND rv.is_active = 1
    `);
    const leftContent = leftVersions?.[0]?.parsed_json ? JSON.parse(leftVersions[0].parsed_json) : { sections: [] };

    // Get right report content
    const rightVersions = querySqlite(`
      SELECT rv.parsed_json, rp.year
      FROM report_versions rv
      JOIN reports rp ON rv.report_id = rp.id
      WHERE rv.report_id = ${sqlValue(comparison.right_report_id)} AND rv.is_active = 1
    `);
    const rightContent = rightVersions?.[0]?.parsed_json ? JSON.parse(rightVersions[0].parsed_json) : { sections: [] };

    // Construct Report Objects
    const reportA = {
      meta: { id: comparison.left_report_id, year: comparison.year_a, unitName: comparison.region_name },
      data: leftContent
    };
    const reportB = {
      meta: { id: comparison.right_report_id, year: comparison.year_b, unitName: comparison.region_name },
      data: rightContent
    };

    const [olderReport, newerReport] = (comparison.year_a || 0) < (comparison.year_b || 0) ? [reportA, reportB] : [reportB, reportA];

    // Align Sections
    const sections: any[] = [];
    olderReport.data.sections.forEach((s: any) => sections.push({ title: s.title, oldSec: s }));
    newerReport.data.sections.forEach((s: any) => {
      const existing = sections.find(a => a.title === s.title);
      if (existing) existing.newSec = s;
      else sections.push({ title: s.title, newSec: s });
    });

    // Sort Sections
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

    // Calculate Diffs
    sections.forEach(sec => {
      if (sec.oldSec?.type === 'text' && sec.newSec?.type === 'text') {
        const diffs = calculateDiffs(sec.oldSec.content || '', sec.newSec.content || '');
        sec.diffHtml = renderDiffHtml(diffs, false);
      }
    });

    // Extract Summary and DiffTables from ComparisonResult
    let summary: any = { textRepetition: 0, tableRepetition: 0, overallRepetition: 0, items: [] };
    if (results && results.length > 0 && results[0].diff_json) {
      try {
        const diffData = JSON.parse(results[0].diff_json);
        if (diffData.summary) summary = diffData.summary;
        // Merge diff tables if available
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

    // Generate PDF
    const pdfPath = await pdfExportService.generateComparisonPdf({
      comparisonId,
      data: reportData,
      regionName: comparison.region_name || '未知地区',
      watermarkText: watermark_text,
      watermarkOpacity: watermark_opacity ? parseFloat(watermark_opacity) : 0.1,
    });

    // Record the export
    // const fileSize = pdfExportService.getFileSize(pdfPath); // Method removed
    const fileSize = require('fs').statSync(pdfPath).size;

    querySqlite(`
      INSERT INTO comparison_exports (comparison_id, format, file_path, file_size, watermark_text)
      VALUES (${sqlValue(comparisonId)}, 'pdf', ${sqlValue(pdfPath)}, ${sqlValue(fileSize)}, ${watermark_text ? sqlValue(watermark_text) : 'NULL'})
    `);

    // Send file (PDF generated via Puppeteer)
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
router.get('/:id/exports', optionalAuthMiddleware, (req: AuthRequest, res: Response) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!comparisonId || Number.isNaN(comparisonId)) {
      return res.status(400).json({ error: '无效的比对ID' });
    }

    ensureSqliteMigrations();

    const exports = querySqlite(`
      SELECT id, format, file_size, watermark_text, created_at
      FROM comparison_exports
      WHERE comparison_id = ${sqlValue(comparisonId)}
      ORDER BY created_at DESC
    `);

    res.json({ data: exports });
  } catch (error) {
    console.error('Error fetching exports:', error);
    res.status(500).json({ error: '获取导出记录失败' });
  }
});

export default router;
