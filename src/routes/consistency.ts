import express from 'express';
import { dbQuery, dbExecute, dbNowExpression, dbBool } from '../config/db-llm';
import { sqlValue } from '../config/sqlite';
import { consistencyCheckService } from '../services/ConsistencyCheckService';

const router = express.Router();

async function refreshComparisonStatusForReport(reportId: number): Promise<void> {
  const comparisons = await dbQuery(`
    SELECT id, year_a, year_b, left_report_id, right_report_id
    FROM comparisons
    WHERE left_report_id = ${sqlValue(reportId)} OR right_report_id = ${sqlValue(reportId)}
  `);

  if (!comparisons || comparisons.length === 0) {
    return;
  }

  const reportIds = Array.from(
    new Set(comparisons.flatMap((c: any) => [c.left_report_id, c.right_report_id]).filter(Boolean))
  );

  if (reportIds.length === 0) {
    return;
  }

  const versionRows = await dbQuery(`
    SELECT id, report_id
    FROM report_versions
    WHERE report_id IN (${reportIds.join(',')}) AND is_active = ${dbBool(true)}
    ORDER BY id DESC
  `);

  const versionMap = new Map<string, number>();
  for (const row of versionRows) {
    const rid = String(row.report_id);
    if (!versionMap.has(rid)) {
      versionMap.set(rid, Number(row.id));
    }
  }

  const versionIds = Array.from(versionMap.values());
  const countsMap = new Map<number, number>();

  if (versionIds.length > 0) {
    const countRows = await dbQuery(`
      SELECT report_version_id, COUNT(*) as cnt
      FROM report_consistency_items
      WHERE report_version_id IN (${versionIds.join(',')})
        AND auto_status = 'FAIL'
        AND human_status = 'pending'
      GROUP BY report_version_id
    `);

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

    await dbExecute(`
      UPDATE comparisons
      SET check_status = ${sqlValue(checkStatus)}
      WHERE id = ${sqlValue(comparison.id)}
    `);
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
    const reportRes = await dbQuery(`
      SELECT rv.id as version_id, rv.parsed_json
      FROM reports r
      JOIN report_versions rv ON r.id = rv.report_id
      WHERE r.id = ${sqlValue(reportId)} AND rv.is_active = ${dbBool(true)}
      ORDER BY rv.created_at DESC
      LIMIT 1
    `);

    if (reportRes.length === 0) {
      // No report or no active version
      res.json({
        latest_run: null,
        groups: [] 
      });
      return;
    }

    const { version_id } = reportRes[0];

    // 2. Get latest run info
    // Note: Service code uses 'report_consistency_runs', ensuring compatibility
    const runRes = await dbQuery(`
      SELECT * FROM report_consistency_runs 
      WHERE report_version_id = ${sqlValue(version_id)}
      ORDER BY created_at DESC
      LIMIT 1
    `);
    
    const latestRun = runRes[0] || null;
    let summary: any = { fail: 0, uncertain: 0, pass: 0, total: 0 };
    if (latestRun && latestRun.summary_json) {
       try {
         summary = typeof latestRun.summary_json === 'string' 
           ? JSON.parse(latestRun.summary_json) 
           : latestRun.summary_json;
       } catch (e) {}
    }

    // 3. Get items
    const itemsRes = await dbQuery(`
      SELECT * 
      FROM report_consistency_items 
      WHERE report_version_id = ${sqlValue(version_id)}
      ORDER BY id ASC
    `);

    // Parse specific JSON fields
    const items = itemsRes.map(item => {
      let evidence = item.evidence_json;
      if (typeof evidence === 'string') {
        try { evidence = JSON.parse(evidence); } catch (e) {}
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
      'table3': '表三：非本机关产生', // Note: This name might need adjustment based on actual content
      'table4': '表四：行政复议诉讼',
      'text': '正文一致性校验',
      'visual': '视觉与结构审计',
      'structure': '结构完整性审计',
      'quality': '数据质量审计'
    };

    // Use specific ordering
    const orderedKeys = ['visual', 'structure', 'quality', 'text', 'table2', 'table3', 'table4'];
    
    // Group items
    const groupsMap: Record<string, any[]>  = {};
    items.forEach(item => {
      const k = item.group_key;
      if (!groupsMap[k]) groupsMap[k] = [];
      groupsMap[k].push(item);
    });

    // Construct response
    const groups = orderedKeys.map(key => {
        // If we have items for this key, or if it's one of the core tables, ensure it appears
        if (groupsMap[key] || ['table3', 'table4', 'text'].includes(key)) {
             return {
                 group_key: key,
                 group_name: groupDefs[key] || key,
                 items: groupsMap[key] || []
             };
        }
        return null;
    }).filter(Boolean);

    // Merge any other keys found that weren't in orderedKeys
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
     // 1. Get active version
     const reportRes = await dbQuery(`
        SELECT rv.id as version_id, rv.parsed_json
        FROM reports r
        JOIN report_versions rv ON r.id = rv.report_id
        WHERE r.id = ${sqlValue(reportId)} AND rv.is_active = ${dbBool(true)}
        LIMIT 1
     `);
     
     if (reportRes.length === 0) {
       res.status(404).json({ error: 'Report or active version not found' });
       return;
     }

     const { version_id, parsed_json } = reportRes[0];
     let parsed = parsed_json;
     if (typeof parsed === 'string') {
        try { parsed = JSON.parse(parsed); } catch(e) {}
     }

     // 2. Run checks service
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
       await dbExecute(`
         UPDATE report_consistency_items
         SET human_status = ${sqlValue(human_status)},
             human_comment = ${sqlValue(human_comment || null)},
             updated_at = ${dbNowExpression()}
         WHERE id = ${sqlValue(itemId)}
       `);

       try {
         const itemRows = await dbQuery(`
           SELECT report_version_id
           FROM report_consistency_items
           WHERE id = ${sqlValue(itemId)}
           LIMIT 1
         `);
         const reportVersionId = itemRows?.[0]?.report_version_id;
         if (reportVersionId) {
           const reportRows = await dbQuery(`
             SELECT report_id
             FROM report_versions
             WHERE id = ${sqlValue(reportVersionId)}
             LIMIT 1
           `);
           const reportId = reportRows?.[0]?.report_id;
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
