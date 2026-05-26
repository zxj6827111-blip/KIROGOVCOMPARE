import express from 'express';
import crypto from 'crypto';
import pool from '../config/database-llm';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { consistencyCheckService } from '../services/ConsistencyCheckService';
import { visionReviewService } from '../services/VisionReviewService';
import { ocrCorrectionService } from '../services/OcrCorrectionService';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import { classifyConsistencyIssueType } from '../utils/consistencyIssueType';
import { buildSectionTitleQualityItems } from '../utils/sectionTitleQuality';

const router = express.Router();

router.use(authMiddleware);

const generateRouteFingerprint = (groupKey: string, checkKey: string, expr: string): string =>
  crypto.createHash('sha256').update(`${groupKey}:${checkKey}:${expr}`).digest('hex').substring(0, 16);

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

async function checkReportAccess(
  reportId: number,
  user?: AuthRequest['user']
): Promise<{ ok: true; regionId: number } | { ok: false; status: number; error: string }> {
  if (!isPositiveInteger(reportId)) {
    return { ok: false, status: 400, error: 'Invalid report ID' };
  }

  const reportRes = await pool.query(
    `SELECT region_id
     FROM reports
     WHERE id = $1
     LIMIT 1`,
    [reportId]
  );
  const report = reportRes.rows[0];
  if (!report) {
    return { ok: false, status: 404, error: 'Report not found' };
  }

  const allowedRegionIds = await getAllowedRegionIdsAsync(user);
  if (allowedRegionIds && (allowedRegionIds.length === 0 || !allowedRegionIds.includes(Number(report.region_id)))) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  return { ok: true, regionId: Number(report.region_id) };
}

async function resolveReportVersionId(reportId: number, versionIdRaw?: unknown): Promise<number | null> {
  const explicitVersionId = typeof versionIdRaw === 'string' || typeof versionIdRaw === 'number'
    ? Number(versionIdRaw)
    : NaN;

  if (Number.isInteger(explicitVersionId) && explicitVersionId > 0) {
    const versionRes = await pool.query(
      `SELECT id
       FROM report_versions
       WHERE id = $1 AND report_id = $2
       LIMIT 1`,
      [explicitVersionId, reportId]
    );
    return versionRes.rows[0]?.id ? Number(versionRes.rows[0].id) : null;
  }

  const reportRes = await pool.query(`
      SELECT rv.id as version_id
      FROM reports r
      JOIN report_versions rv ON rv.id = r.active_version_id
      WHERE r.id = $1
      LIMIT 1
    `, [reportId]);

  return reportRes.rows[0]?.version_id ? Number(reportRes.rows[0].version_id) : null;
}

async function refreshComparisonStatusForReport(reportId: number): Promise<void> {
  const comparisonsRes = await pool.query(`
    SELECT id, year_a, year_b, left_report_id, right_report_id
    FROM comparisons
    WHERE left_report_id = $1 OR right_report_id = $1
  `, [reportId]);
  const comparisons = comparisonsRes.rows;

  if (!comparisons || comparisons.length === 0) {
    return;
  }

  const reportIds = Array.from(
    new Set(comparisons.flatMap((c: any) => [c.left_report_id, c.right_report_id]).filter(Boolean))
  );

  if (reportIds.length === 0) {
    return;
  }

  const versionRowsRes = await pool.query(`
    SELECT r.id as report_id, rv.id as version_id
    FROM reports r
    JOIN report_versions rv ON rv.id = r.active_version_id
    WHERE r.id = ANY($1::int[])
    ORDER BY rv.id DESC
  `, [reportIds]);
  const versionRows = versionRowsRes.rows;

  const versionMap = new Map<string, number>();
  for (const row of versionRows) {
    const rid = String(row.report_id);
    if (!versionMap.has(rid)) {
      versionMap.set(rid, Number(row.version_id));
    }
  }

  const versionIds = Array.from(versionMap.values());
  const countsMap = new Map<number, number>();

  if (versionIds.length > 0) {
    const countRowsRes = await pool.query(`
      SELECT report_version_id, COUNT(*) as cnt
      FROM report_consistency_items
      WHERE report_version_id = ANY($1::int[])
        AND auto_status IN ('FAIL', 'UNCERTAIN')
        AND human_status = 'pending'
      GROUP BY report_version_id
    `, [versionIds]);
    const countRows = countRowsRes.rows;

    for (const row of countRows) {
      countsMap.set(Number(row.report_version_id), Number(row.cnt));
    }
  }

  for (const comparison of comparisons) {
    const leftVid = versionMap.get(String(comparison.left_report_id));
    const rightVid = versionMap.get(String(comparison.right_report_id));
    const leftCount = leftVid ? (countsMap.get(leftVid) || 0) : 0;
    const rightCount = rightVid ? (countsMap.get(rightVid) || 0) : 0;

    const issueParts: string[] = [];
    if (leftCount > 0) {
      issueParts.push(`${comparison.year_a}年校验${leftCount}项`);
    }
    if (rightCount > 0) {
      issueParts.push(`${comparison.year_b}年校验${rightCount}项`);
    }

    const checkStatus = issueParts.length > 0 ? `异常(${issueParts.join('|')})` : '正常';

    await pool.query(`
      UPDATE comparisons
      SET check_status = $1
      WHERE id = $2
    `, [checkStatus, comparison.id]);
  }
}

async function refreshCachedStatsForVersion(reportVersionId: number): Promise<void> {
  const countsRes = await pool.query(`
    SELECT
      COUNT(*) FILTER (
        WHERE auto_status = 'FAIL'
          AND (human_status != 'dismissed' OR human_status IS NULL)
      ) AS total,
      COUNT(*) FILTER (
        WHERE auto_status = 'FAIL'
          AND group_key = 'visual'
          AND (human_status != 'dismissed' OR human_status IS NULL)
      ) AS visual,
      COUNT(*) FILTER (
        WHERE auto_status = 'FAIL'
          AND group_key = 'quality'
          AND (human_status != 'dismissed' OR human_status IS NULL)
      ) AS quality,
      COUNT(*) FILTER (
        WHERE auto_status = 'FAIL'
          AND group_key IN ('structure','table2','table3','table4','text','hierarchy')
          AND (human_status != 'dismissed' OR human_status IS NULL)
      ) AS structure
    FROM report_consistency_items
    WHERE report_version_id = $1
  `, [reportVersionId]);

  const row = countsRes.rows?.[0] || {};
  await pool.query(`
    UPDATE report_versions
    SET check_total = $2,
        check_visual = $3,
        check_structure = $4,
        check_quality = $5,
        checks_updated_at = NOW()
    WHERE id = $1
  `, [
    reportVersionId,
    Number(row.total || 0),
    Number(row.visual || 0),
    Number(row.structure || 0),
    Number(row.quality || 0),
  ]);
}

/**
 * GET /reports/:id/checks - Get consistency checks for a report
 */
router.get('/reports/:id/checks', async (req: AuthRequest, res) => {
  const reportId = Number(req.params.id);
  const access = await checkReportAccess(reportId, req.user);
  if (!access.ok) {
    res.status(access.status).json({ error: access.error });
    return;
  }

  try {
    const versionId = await resolveReportVersionId(reportId, req.query.version_id);
    if (!versionId) {
      res.json({
        latest_run: null,
        groups: []
      });
      return;
    }

    // 2. Get latest run info
    const runRes = await pool.query(`
      SELECT * FROM report_consistency_runs 
      WHERE report_version_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [versionId]);

    const latestRun = runRes.rows[0] || null;
    let summary: any = { fail: 0, uncertain: 0, pass: 0, total: 0 };
    if (latestRun && latestRun.summary_json) {
      try {
        summary = typeof latestRun.summary_json === 'string'
          ? JSON.parse(latestRun.summary_json)
          : latestRun.summary_json;
      } catch (e) { }
    }

    // 3. Get items
    const itemsRes = await pool.query(`
      SELECT * 
      FROM report_consistency_items 
      WHERE report_version_id = $1
      ORDER BY id ASC
    `, [versionId]);
    const itemsRows = itemsRes.rows;
    const versionRes = await pool.query(`
      SELECT parsed_json
      FROM report_versions
      WHERE id = $1
      LIMIT 1
    `, [versionId]);
    let parsedJson = versionRes.rows[0]?.parsed_json;
    if (typeof parsedJson === 'string') {
      try { parsedJson = JSON.parse(parsedJson); } catch { parsedJson = null; }
    }

    const items = itemsRows.map((item: any) => {
      let evidence = item.evidence_json;
      if (typeof evidence === 'string') {
        try { evidence = JSON.parse(evidence); } catch (e) { }
      }
      return {
        ...item,
        evidence,
        issueType: classifyConsistencyIssueType({
          ...item,
          evidence,
        }),
        // Ensure numeric values are numbers
        left_value: Number(item.left_value),
        right_value: Number(item.right_value),
        delta: Number(item.delta),
        tolerance: Number(item.tolerance)
      };
    });
    const existingFingerprints = new Set(items.map((item: any) => String(item.fingerprint || '')).filter(Boolean));
    const dynamicTitleItems = buildSectionTitleQualityItems(parsedJson?.sections || [], generateRouteFingerprint)
      .filter((item) => !existingFingerprints.has(item.fingerprint))
      .map((item) => ({
        id: null,
        run_id: latestRun?.id || null,
        report_version_id: versionId,
        group_key: item.groupKey,
        check_key: item.checkKey,
        fingerprint: item.fingerprint,
        title: item.title,
        expr: item.expr,
        left_value: item.leftValue,
        right_value: item.rightValue,
        delta: item.delta,
        tolerance: item.tolerance,
        auto_status: item.autoStatus,
        human_status: 'pending',
        evidence: item.evidenceJson,
        issueType: classifyConsistencyIssueType({
          group_key: item.groupKey,
          check_key: item.checkKey,
          title: item.title,
          expr: item.expr,
          evidence: item.evidenceJson,
        }),
      }));
    items.push(...dynamicTitleItems);

    // 4. Group items
    const groupDefs: Record<string, string> = {
      'table2': '表二：主动公开',
      'table3': '表三：非本机关产生',
      'table4': '表四：行政复议诉讼',
      'text': '正文一致性校验',
      'visual': '视觉与结构审计',
      'structure': '结构完整性审计',
      'quality': '数据质量审计',
      'hierarchy': '层级汇总一致性'
    };

    const orderedKeys = ['visual', 'structure', 'quality', 'text', 'hierarchy', 'table2', 'table3', 'table4'];

    const groupsMap: Record<string, any[]> = {};
    items.forEach((item: any) => {
      const k = item.group_key;
      if (!groupsMap[k]) groupsMap[k] = [];
      groupsMap[k].push(item);
    });

    const visibleEmptyGroups = ['table2', 'table3', 'table4', 'text', 'hierarchy'];
    const groups = orderedKeys.map(key => {
      if (groupsMap[key] || visibleEmptyGroups.includes(key)) {
        return {
          group_key: key,
          group_name: groupDefs[key] || key,
          items: groupsMap[key] || []
        };
      }
      return null;
    }).filter(Boolean);

    Object.keys(groupsMap).forEach(key => {
      if (!orderedKeys.includes(key)) {
        groups.push({
          group_key: key,
          group_name: groupDefs[key] || key,
          items: groupsMap[key]
        });
      }
    });

    res.json({
      data: {
        latest_run: latestRun ? {
          ...latestRun,
          summary
        } : null,
        groups
      }
    });

  } catch (err: any) {
    console.error('Error fetching checks:', err);
    res.status(500).json({ error: 'Failed to fetch checks: ' + err.message });
  }
});

/**
 * POST /reports/:id/checks/run - Run consistency checks
 */
router.post('/reports/:id/checks/run', async (req: AuthRequest, res) => {
  const reportId = Number(req.params.id);
  try {
    const access = await checkReportAccess(reportId, req.user);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const versionId = await resolveReportVersionId(reportId, req.body?.version_id ?? req.query.version_id);
    if (!versionId) {
      res.status(404).json({ error: 'Report or target version not found' });
      return;
    }

    const versionRes = await pool.query(
      `SELECT parsed_json
       FROM report_versions
       WHERE id = $1
       LIMIT 1`,
      [versionId]
    );
    const parsed_json = versionRes.rows[0]?.parsed_json;
    let parsed = parsed_json;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch (e) { }
    }

    const result = await consistencyCheckService.runAndPersist(versionId, parsed);
    let visualReviewQueued = 0;
    try {
      visualReviewQueued = await visionReviewService.enqueueForConsistencyItems(reportId, versionId, result.items);
    } catch (visionError) {
      console.warn('[Consistency] Failed to enqueue visual review:', visionError);
    }

    res.json({ success: true, version_id: versionId, runId: result.runId, count: result.items.length, visual_review_queued: visualReviewQueued });

  } catch (err: any) {
    console.error('Error running checks:', err);
    res.status(500).json({ error: 'Failed to run checks: ' + err.message });
  }
});

/**
 * GET /reports/:id/vision-review - Get table visual review results
 */
router.get('/reports/:id/vision-review', async (req: AuthRequest, res) => {
  const reportId = Number(req.params.id);
  try {
    const access = await checkReportAccess(reportId, req.user);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const versionId = await resolveReportVersionId(reportId, req.query.version_id);
    if (!versionId) {
      res.json({ data: { version_id: null, reviews: [] } });
      return;
    }

    const [reviews, corrections] = await Promise.all([
      visionReviewService.listReviews(reportId, versionId),
      visionReviewService.listCorrections(reportId, versionId),
    ]);
    res.json({ data: { version_id: versionId, reviews, corrections } });
  } catch (err: any) {
    console.error('Error fetching visual reviews:', err);
    res.status(500).json({ error: 'Failed to fetch visual reviews: ' + err.message });
  }
});

/**
 * POST /reports/:id/vision-review/run - Manually run visual review
 */
router.post('/reports/:id/vision-review/run', async (req: AuthRequest, res) => {
  const reportId = Number(req.params.id);
  try {
    const access = await checkReportAccess(reportId, req.user);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const versionId = await resolveReportVersionId(reportId, req.body?.version_id ?? req.query.version_id);
    if (!versionId) {
      res.status(404).json({ error: 'Report or target version not found' });
      return;
    }

    const tableIds = visionReviewService.normalizeTableIds(req.body?.table_ids ?? req.query.table_ids);
    const results = await visionReviewService.runNow(reportId, versionId, tableIds, true);
    res.json({ success: true, version_id: versionId, table_ids: tableIds, results });
  } catch (err: any) {
    console.error('Error running visual review:', err);
    res.status(500).json({ error: 'Failed to run visual review: ' + err.message });
  }
});

/**
 * POST /reports/:id/vision-review/corrections/resolve - Confirm or reject pending OCR corrections
 */
router.post('/reports/:id/vision-review/corrections/resolve', async (req: AuthRequest, res) => {
  const reportId = Number(req.params.id);
  try {
    const access = await checkReportAccess(reportId, req.user);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const versionId = await resolveReportVersionId(reportId, req.body?.version_id ?? req.query.version_id);
    if (!versionId) {
      res.status(404).json({ error: 'Report or target version not found' });
      return;
    }

    const action = String(req.body?.action || '').trim().toLowerCase();
    if (action !== 'confirm' && action !== 'reject') {
      res.status(400).json({ error: 'action must be confirm or reject' });
      return;
    }

    const rawIds = Array.isArray(req.body?.correction_ids)
      ? req.body.correction_ids
      : req.body?.correction_id
        ? [req.body.correction_id]
        : [];
    const correctionIds = rawIds
      .map((item: unknown) => Number(item))
      .filter((item: number) => Number.isInteger(item) && item > 0);
    if (!correctionIds.length) {
      res.status(400).json({ error: 'correction_ids is required' });
      return;
    }

    const result = await ocrCorrectionService.resolveCorrections(
      reportId,
      versionId,
      correctionIds,
      action,
      req.user?.id ?? null
    );
    res.json({ success: true, version_id: versionId, action, ...result });
  } catch (err: any) {
    console.error('Error resolving OCR corrections:', err);
    res.status(500).json({ error: 'Failed to resolve OCR corrections: ' + err.message });
  }
});

/**
 * POST /reports/:id/checks/items/bulk-status - Batch update check item status.
 * Used by "one-click confirm" to avoid hundreds of single PATCH requests hitting
 * the global API rate limiter and refreshing cached stats repeatedly.
 */
router.post('/reports/:id/checks/items/bulk-status', async (req: AuthRequest, res) => {
  const reportId = Number(req.params.id);
  const { version_id, item_ids, human_status, human_comment } = req.body || {};

  if (!human_status) {
    res.status(400).json({ error: 'Missing human_status' });
    return;
  }

  const ALLOWED_HUMAN_STATUSES = new Set(['pending', 'confirmed', 'dismissed']);
  const normalizedHumanStatus = String(human_status).toLowerCase();
  if (!ALLOWED_HUMAN_STATUSES.has(normalizedHumanStatus)) {
    res.status(400).json({ error: 'Invalid human_status. Allowed: pending, confirmed, dismissed' });
    return;
  }

  if (!Array.isArray(item_ids)) {
    res.status(400).json({ error: 'Missing item_ids' });
    return;
  }

  const itemIds = Array.from(
    new Set(
      item_ids
        .map((value: unknown) => Number(value))
        .filter((value: number) => isPositiveInteger(value))
    )
  );

  if (itemIds.length === 0) {
    res.status(400).json({ error: 'No valid item_ids' });
    return;
  }

  if (itemIds.length > 2000) {
    res.status(400).json({ error: 'Too many item_ids. Max: 2000' });
    return;
  }

  try {
    const access = await checkReportAccess(reportId, req.user);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const versionId = await resolveReportVersionId(reportId, version_id);
    if (!versionId) {
      res.status(404).json({ error: 'Report version not found' });
      return;
    }

    const updateRes = await pool.query(
      `UPDATE report_consistency_items rci
       SET human_status = $1,
           human_comment = $2,
           updated_at = NOW()
       WHERE rci.report_version_id = $3
         AND rci.id = ANY($4::bigint[])
       RETURNING rci.id`,
      [normalizedHumanStatus, human_comment || null, versionId, itemIds]
    );

    try {
      await refreshCachedStatsForVersion(Number(versionId));
      await refreshComparisonStatusForReport(reportId);
    } catch (refreshError) {
      console.warn('[Consistency] Failed to refresh cached stats or comparison status after bulk update:', refreshError);
    }

    res.json({
      success: true,
      report_id: reportId,
      version_id: versionId,
      requested_count: itemIds.length,
      updated_count: updateRes.rowCount || 0,
      missing_count: Math.max(itemIds.length - (updateRes.rowCount || 0), 0),
      updated_item_ids: updateRes.rows.map((row: any) => Number(row.id)),
    });
  } catch (err: any) {
    console.error('Error bulk updating check items:', err);
    res.status(500).json({ error: 'Failed to bulk update items' });
  }
});

/**
 * PATCH /reports/:id/checks/items/:itemId - Update check item status
 */
router.patch('/reports/:id/checks/items/:itemId', async (req: AuthRequest, res) => {
  const reportId = Number(req.params.id);
  const itemId = Number(req.params.itemId);
  const { human_status, human_comment } = req.body;

  if (!human_status) {
    res.status(400).json({ error: 'Missing human_status' });
    return;
  }

  const ALLOWED_HUMAN_STATUSES = new Set(['pending', 'confirmed', 'dismissed']);
  if (!ALLOWED_HUMAN_STATUSES.has(String(human_status).toLowerCase())) {
    res.status(400).json({ error: 'Invalid human_status. Allowed: pending, confirmed, dismissed' });
    return;
  }

  try {
    if (!isPositiveInteger(reportId) || !isPositiveInteger(itemId)) {
      res.status(400).json({ error: 'Invalid report or item ID' });
      return;
    }

    const itemRes = await pool.query(
      `SELECT r.region_id, rci.report_version_id
       FROM report_consistency_items rci
       JOIN report_versions rv ON rv.id = rci.report_version_id
       JOIN reports r ON r.id = rv.report_id
       WHERE rci.id = $1
         AND r.id = $2
       LIMIT 1`,
      [itemId, reportId]
    );
    const itemRow = itemRes.rows[0];
    if (!itemRow) {
      res.status(404).json({ error: 'Check item not found' });
      return;
    }

    const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
    if (allowedRegionIds && (allowedRegionIds.length === 0 || !allowedRegionIds.includes(Number(itemRow.region_id)))) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    await pool.query(`
         UPDATE report_consistency_items
         SET human_status = $1,
             human_comment = $2,
             updated_at = NOW()
         WHERE id = $3
       `, [human_status, human_comment || null, itemId]);

    try {
      const reportVersionId = itemRow.report_version_id;
      if (reportVersionId) {
        await refreshCachedStatsForVersion(Number(reportVersionId));
        const reportRowsRes = await pool.query('SELECT report_id FROM report_versions WHERE id = $1 LIMIT 1', [reportVersionId]);
        const reportId = reportRowsRes.rows[0]?.report_id;
        if (reportId) {
          await refreshComparisonStatusForReport(Number(reportId));
        }
      }
    } catch (refreshError) {
      console.warn('[Consistency] Failed to refresh cached stats or comparison status:', refreshError);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Error updating check item:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

export default router;
