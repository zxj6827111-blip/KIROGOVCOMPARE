import express from 'express';
import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';
import consistencyCheckService from '../services/ConsistencyCheckService';

const router = express.Router();

/**
 * GET /api/reports/:id/checks
 * 获取报告的一致性校验结果（分组返回）
 */
router.get('/:id/checks', async (req, res) => {
  try {
    ensureSqliteMigrations();

    const reportId = parseInt(req.params.id, 10);
    const includeDismissed = req.query.include_dismissed === '1';

    // 获取 report 和 active version
    const report = querySqlite(`
      SELECT id, region_id FROM reports WHERE id = ${sqlValue(reportId)} LIMIT 1;
    `)[0];

    if (!report) {
      return res.status(404).json({ error: 'report_not_found' });
    }

    const version = querySqlite(`
      SELECT id as version_id FROM report_versions
      WHERE report_id = ${sqlValue(reportId)} AND is_active = 1
      LIMIT 1;
    `)[0];

    if (!version) {
      return res.status(404).json({ error: 'no_active_version' });
    }

    const versionId = version.version_id;

    // 获取最新 run
    const latestRun = querySqlite(`
      SELECT id, status, engine_version, summary_json, created_at, finished_at
      FROM report_consistency_runs
      WHERE report_version_id = ${sqlValue(versionId)}
      ORDER BY id DESC
      LIMIT 1;
    `)[0];

    // 获取 items（默认过滤）
    let itemsFilter = `
      WHERE report_version_id = ${sqlValue(versionId)}
        AND auto_status IN ('FAIL', 'UNCERTAIN')
    `;
    if (!includeDismissed) {
      itemsFilter += ` AND human_status != 'dismissed'`;
    }

    const items = querySqlite(`
      SELECT * FROM report_consistency_items ${itemsFilter}
      ORDER BY group_key, check_key;
    `);

    // 按 group_key 分组
    const groupMap: any = {
      table2: { group_key: 'table2', group_name: '表二', items: [] },
      table3: { group_key: 'table3', group_name: '表三', items: [] },
      table4: { group_key: 'table4', group_name: '表四', items: [] },
      text: { group_key: 'text', group_name: '正文一致性', items: [] },
    };

    for (const item of items) {
      const groupKey = item.group_key || 'text';
      if (groupMap[groupKey]) {
        // 解析 evidence_json
        let evidence = null;
        try {
          evidence = JSON.parse(item.evidence_json || '{}');
        } catch (e) {
          evidence = {};
        }

        groupMap[groupKey].items.push({
          id: item.id,
          check_key: item.check_key,
          title: item.title,
          expr: item.expr,
          left_value: item.left_value,
          right_value: item.right_value,
          delta: item.delta,
          tolerance: item.tolerance,
          auto_status: item.auto_status,
          evidence: evidence,
          human_status: item.human_status,
          human_comment: item.human_comment,
          created_at: item.created_at,
          updated_at: item.updated_at,
        });
      }
    }

    const groups = Object.values(groupMap);

    // 解析 summary
    let summary = { fail: 0, uncertain: 0, pending: 0, confirmed: 0, dismissed: 0 };
    if (latestRun?.summary_json) {
      try {
        summary = JSON.parse(latestRun.summary_json);
      } catch (e) {
        // ignore
      }
    }

    res.json({
      report_id: reportId,
      version_id: versionId,
      latest_run: latestRun
        ? {
            run_id: latestRun.id,
            status: latestRun.status,
            engine_version: latestRun.engine_version,
            created_at: latestRun.created_at,
            finished_at: latestRun.finished_at,
            summary,
          }
        : null,
      groups,
    });
  } catch (error: any) {
    console.error('Error fetching checks:', error);
    res.status(500).json({ error: 'internal_server_error', message: error.message });
  }
});

/**
 * POST /api/reports/:id/checks/run
 * 手动触发一致性校验
 */
router.post('/:id/checks/run', async (req, res) => {
  try {
    ensureSqliteMigrations();

    const reportId = parseInt(req.params.id, 10);

    // 获取 active version
    const version = querySqlite(`
      SELECT id as version_id FROM report_versions
      WHERE report_id = ${sqlValue(reportId)} AND is_active = 1
      LIMIT 1;
    `)[0];

    if (!version) {
      return res.status(404).json({ error: 'no_active_version' });
    }

    const versionId = version.version_id;

    // 检查是否已存在 queued/running 的 checks job
    const existing = querySqlite(`
      SELECT id FROM jobs
      WHERE report_id = ${sqlValue(reportId)}
        AND version_id = ${sqlValue(versionId)}
        AND kind = 'checks'
        AND status IN ('queued', 'running')
      LIMIT 1;
    `);

    if (existing.length > 0) {
      return res.json({ message: 'checks_job_already_queued', job_id: existing[0].id });
    }

    // 创建 checks job
    const result = querySqlite(`
      INSERT INTO jobs (report_id, version_id, kind, status, created_at)
      VALUES (${sqlValue(reportId)}, ${sqlValue(versionId)}, 'checks', 'queued', datetime('now'))
      RETURNING id;
    `);

    const jobId = result[0].id;

    res.json({ message: 'checks_job_enqueued', job_id: jobId });
  } catch (error: any) {
    console.error('Error enqueueing checks job:', error);
    res.status(500).json({ error: 'internal_server_error', message: error.message });
  }
});

/**
 * PATCH /api/reports/:id/checks/items/:itemId
 * 更新人工审核状态
 */
router.patch('/:id/checks/items/:itemId', async (req, res) => {
  try {
    ensureSqliteMigrations();

    const reportId = parseInt(req.params.id, 10);
    const itemId = parseInt(req.params.itemId, 10);
    const { human_status, human_comment } = req.body;

    // 验证 human_status
    const validStatuses = ['pending', 'confirmed', 'dismissed'];
    if (human_status && !validStatuses.includes(human_status)) {
      return res.status(400).json({ error: 'invalid_human_status', valid: validStatuses });
    }

    // 获取 item（验证归属）
    const item = querySqlite(`
      SELECT id, report_version_id FROM report_consistency_items
      WHERE id = ${sqlValue(itemId)}
      LIMIT 1;
    `)[0];

    if (!item) {
      return res.status(404).json({ error: 'item_not_found' });
    }

    // 验证 item 属于该 report
    const version = querySqlite(`
      SELECT report_id FROM report_versions
      WHERE id = ${sqlValue(item.report_version_id)}
      LIMIT 1;
    `)[0];

    if (!version || version.report_id !== reportId) {
      return res.status(403).json({ error: 'item_not_belong_to_report' });
    }

    // 更新字段
    const updates: string[] = [];
    if (human_status) {
      updates.push(`human_status = ${sqlValue(human_status)}`);
    }
    if (human_comment !== undefined) {
      updates.push(`human_comment = ${sqlValue(human_comment || null)}`);
    }
    updates.push(`updated_at = datetime('now')`);

    if (updates.length === 1) {
      // 只有 updated_at，无实际更新
      return res.status(400).json({ error: 'no_fields_to_update' });
    }

    querySqlite(`
      UPDATE report_consistency_items
      SET ${updates.join(', ')}
      WHERE id = ${sqlValue(itemId)};
    `);

    // 返回更新后的 item
    const updated = querySqlite(`
      SELECT * FROM report_consistency_items WHERE id = ${sqlValue(itemId)} LIMIT 1;
    `)[0];

    res.json({
      message: 'item_updated',
      item: {
        id: updated.id,
        check_key: updated.check_key,
        title: updated.title,
        human_status: updated.human_status,
        human_comment: updated.human_comment,
        updated_at: updated.updated_at,
      },
    });
  } catch (error: any) {
    console.error('Error updating check item:', error);
    res.status(500).json({ error: 'internal_server_error', message: error.message });
  }
});

export default router;
