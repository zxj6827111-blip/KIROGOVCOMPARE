import express from 'express';
import pool from '../config/database-llm';
import { consistencyCheckService } from '../services/ConsistencyCheckService';

const router = express.Router();

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
        AND auto_status = 'FAIL'
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

/**
 * GET /reports/:id/checks - Get consistency checks for a report
 */
router.get('/reports/:id/checks', async (req, res) => {
  const reportId = req.params.id;
  if (!reportId) {
    res.status(400).json({ error: 'Missing report ID' });
    return;
  }

  try {
    // 1. Get active version of the report
    const reportRes = await pool.query(`
      SELECT rv.id as version_id, rv.parsed_json
      FROM reports r
      JOIN report_versions rv ON rv.id = r.active_version_id
      WHERE r.id = $1
      LIMIT 1
    `, [reportId]);

    if (reportRes.rows.length === 0) {
      res.json({
        latest_run: null,
        groups: []
      });
      return;
    }

    const { version_id } = reportRes.rows[0];

    // 2. Get latest run info
    const runRes = await pool.query(`
      SELECT * FROM report_consistency_runs 
      WHERE report_version_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [version_id]);

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
    `, [version_id]);
    const itemsRows = itemsRes.rows;

    const items = itemsRows.map((item: any) => {
      let evidence = item.evidence_json;
      if (typeof evidence === 'string') {
        try { evidence = JSON.parse(evidence); } catch (e) { }
      }
      return {
        ...item,
        evidence,
        // Ensure numeric values are numbers
        left_value: Number(item.left_value),
        right_value: Number(item.right_value),
        delta: Number(item.delta),
        tolerance: Number(item.tolerance)
      };
    });

    // 4. Group items
    const groupDefs: Record<string, string> = {
      'table2': '表二：主动公开',
      'table3': '表三：非本机关产生',
      'table4': '表四：行政复议诉讼',
      'text': '正文一致性校验',
      'visual': '视觉与结构审计',
      'structure': '结构完整性审计',
      'quality': '数据质量审计'
    };

    const orderedKeys = ['visual', 'structure', 'quality', 'text', 'table2', 'table3', 'table4'];

    const groupsMap: Record<string, any[]> = {};
    items.forEach((item: any) => {
      const k = item.group_key;
      if (!groupsMap[k]) groupsMap[k] = [];
      groupsMap[k].push(item);
    });

    const groups = orderedKeys.map(key => {
      if (groupsMap[key] || ['table3', 'table4', 'text'].includes(key)) {
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
router.post('/reports/:id/checks/run', async (req, res) => {
  const reportId = req.params.id;
  try {
    const reportRes = await pool.query(`
        SELECT rv.id as version_id, rv.parsed_json
        FROM reports r
        JOIN report_versions rv ON rv.id = r.active_version_id
        WHERE r.id = $1
        LIMIT 1
     `, [reportId]);

    if (reportRes.rows.length === 0) {
      res.status(404).json({ error: 'Report or active version not found' });
      return;
    }

    const { version_id, parsed_json } = reportRes.rows[0];
    let parsed = parsed_json;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch (e) { }
    }

    const result = await consistencyCheckService.runAndPersist(version_id, parsed);

    res.json({ success: true, runId: result.runId, count: result.items.length });

  } catch (err: any) {
    console.error('Error running checks:', err);
    res.status(500).json({ error: 'Failed to run checks: ' + err.message });
  }
});

/**
 * PATCH /reports/:id/checks/items/:itemId - Update check item status
 */
router.patch('/reports/:id/checks/items/:itemId', async (req, res) => {
  const { itemId } = req.params;
  const { human_status, human_comment } = req.body;

  if (!human_status) {
    res.status(400).json({ error: 'Missing human_status' });
    return;
  }

  try {
    await pool.query(`
         UPDATE report_consistency_items
         SET human_status = $1,
             human_comment = $2,
             updated_at = NOW()
         WHERE id = $3
       `, [human_status, human_comment || null, itemId]);

    try {
      const itemRowsRes = await pool.query('SELECT report_version_id FROM report_consistency_items WHERE id = $1 LIMIT 1', [itemId]);
      const reportVersionId = itemRowsRes.rows[0]?.report_version_id;
      if (reportVersionId) {
        const reportRowsRes = await pool.query('SELECT report_id FROM report_versions WHERE id = $1 LIMIT 1', [reportVersionId]);
        const reportId = reportRowsRes.rows[0]?.report_id;
        if (reportId) {
          await refreshComparisonStatusForReport(Number(reportId));
        }
      }
    } catch (refreshError) {
      console.warn('[Consistency] Failed to refresh comparison status:', refreshError);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error('Error updating check item:', err);
    res.status(500).json({ error: 'Failed to update item' });
  }
});

export default router;
