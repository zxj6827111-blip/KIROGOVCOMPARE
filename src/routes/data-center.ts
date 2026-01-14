import express from 'express';
import { dbQuery, dbType } from '../config/db-llm';
import { sqlValue } from '../config/sqlite';
import { authMiddleware } from '../middleware/auth';

const router = express.Router();

router.use(authMiddleware);

const TABLE_MAP: Record<string, string> = {
  active_disclosure: 'fact_active_disclosure',
  application: 'fact_application',
  legal_proceeding: 'fact_legal_proceeding',
};

function getTableName(tableName: string): string | null {
  return TABLE_MAP[tableName] ?? null;
}

router.get('/v2/batches', async (_req, res) => {
  try {
    const batches = await dbQuery(`
      SELECT id, batch_uuid, created_by, created_at, source, note,
             report_count, success_count, fail_count, status, completed_at
      FROM ingestion_batches
      ORDER BY created_at DESC
      LIMIT 50;
    `);

    res.json({ data: batches });
  } catch (error) {
    console.error('[DataCenter] Failed to list batches:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v2/batches/:batchUuid', async (req, res) => {
  try {
    const batchUuid = req.params.batchUuid;
    const batch = (await dbQuery(
      `SELECT id, batch_uuid, created_by, created_at, source, note,
              report_count, success_count, fail_count, status, completed_at
       FROM ingestion_batches
       WHERE batch_uuid = ${dbType === 'postgres' ? '$1' : '?'}
       LIMIT 1`,
      [batchUuid]
    ))[0];

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const versions = await dbQuery(`
      SELECT rv.id as version_id, rv.report_id, rv.state, rv.created_at
      FROM report_versions rv
      WHERE rv.ingestion_batch_id = ${sqlValue(batch.id)}
      ORDER BY rv.created_at DESC
    `);

    const jobs = await dbQuery(`
      SELECT id, report_id, version_id, kind, status, progress, created_at, finished_at
      FROM jobs
      WHERE ingestion_batch_id = ${sqlValue(batch.id)}
      ORDER BY created_at DESC
    `);

    return res.json({
      data: {
        batch,
        versions,
        jobs,
      }
    });
  } catch (error) {
    console.error('[DataCenter] Failed to fetch batch detail:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/v2/batches/:batchUuid/retry', async (req, res) => {
  try {
    const batchUuid = req.params.batchUuid;
    const batch = (await dbQuery(
      `SELECT id FROM ingestion_batches WHERE batch_uuid = ${dbType === 'postgres' ? '$1' : '?'} LIMIT 1`,
      [batchUuid]
    ))[0];

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const failedJobs = await dbQuery(`
      SELECT id, report_id, version_id, kind, provider, model
      FROM jobs
      WHERE ingestion_batch_id = ${sqlValue(batch.id)}
        AND status IN ('failed', 'cancelled')
        AND kind != 'pdf_export'
      ORDER BY created_at DESC
    `);

    if (failedJobs.length === 0) {
      return res.json({ retried: 0, message: 'No failed jobs to retry' });
    }

    let retried = 0;
    for (const job of failedJobs) {
      await dbQuery(`
        INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, ingestion_batch_id)
        VALUES (${sqlValue(job.report_id)}, ${sqlValue(job.version_id)}, ${sqlValue(job.kind)}, 'queued', 0, ${sqlValue(job.provider)}, ${sqlValue(job.model)}, ${sqlValue(batch.id)})
      `);
      retried += 1;
    }

    return res.json({ retried });
  } catch (error) {
    console.error('[DataCenter] Failed to retry batch:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v2/reports/:reportId/facts/:tableName', async (req, res) => {
  try {
    const reportId = Number(req.params.reportId);
    if (!reportId || Number.isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid reportId' });
    }

    const tableName = getTableName(req.params.tableName);
    if (!tableName) {
      return res.status(400).json({ error: 'Invalid tableName' });
    }

    const report = (await dbQuery(
      `SELECT active_version_id FROM reports WHERE id = ${dbType === 'postgres' ? '$1' : '?'} LIMIT 1`,
      [reportId]
    ))[0];

    if (!report?.active_version_id) {
      return res.status(404).json({ error: 'Active version not found' });
    }

    const facts = await dbQuery(`
      SELECT *
      FROM ${tableName}
      WHERE report_id = ${sqlValue(reportId)}
        AND version_id = ${sqlValue(report.active_version_id)}
      ORDER BY id ASC
    `);

    return res.json({
      data: facts,
      version_id: report.active_version_id,
      table: req.params.tableName,
    });
  } catch (error) {
    console.error('[DataCenter] Failed to fetch facts:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v2/reports/:reportId/cells', async (req, res) => {
  try {
    const reportId = Number(req.params.reportId);
    if (!reportId || Number.isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid reportId' });
    }

    const tableId = typeof req.query.table_id === 'string' ? req.query.table_id : null;

    const report = (await dbQuery(
      `SELECT active_version_id FROM reports WHERE id = ${dbType === 'postgres' ? '$1' : '?'} LIMIT 1`,
      [reportId]
    ))[0];

    if (!report?.active_version_id) {
      return res.status(404).json({ error: 'Active version not found' });
    }

    const whereTable = tableId ? `AND table_id = ${sqlValue(tableId)}` : '';

    const cells = await dbQuery(`
      SELECT *
      FROM cells
      WHERE version_id = ${sqlValue(report.active_version_id)}
      ${whereTable}
      ORDER BY id ASC
    `);

    return res.json({
      data: cells,
      version_id: report.active_version_id,
    });
  } catch (error) {
    console.error('[DataCenter] Failed to fetch cells:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v2/metrics', async (_req, res) => {
  try {
    const metrics = await dbQuery(`
      SELECT id, metric_key, version, display_name, description, unit,
             aggregatable, source_table, source_column, drilldown_source,
             caveats, interpretation_template, effective_from, deprecated_at
      FROM metric_dictionary
      WHERE deprecated_at IS NULL
      ORDER BY metric_key ASC
    `);

    return res.json({ data: metrics });
  } catch (error) {
    console.error('[DataCenter] Failed to fetch metrics:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
