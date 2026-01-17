import express from 'express';
import { dbQuery, dbType } from '../config/db-llm';
import { sqlValue } from '../config/sqlite';
import { authMiddleware } from '../middleware/auth';
import ReportFactoryService from '../services/report-factory/ReportFactoryService';
import DerivedMetricsService from '../services/DerivedMetricsService';

const router = express.Router();

router.use(authMiddleware);

const TABLE_MAP: Record<string, string> = {
  active_disclosure: 'fact_active_disclosure',
  application: 'fact_application',
  legal_proceeding: 'fact_legal_proceeding',
};

type EvidenceItem = {
  table: string;
  row: string;
  col: string;
  value_snippet: string;
  version_id: number;
  cell_ref: string;
};

function getTableName(tableName: string): string | null {
  return TABLE_MAP[tableName] ?? null;
}

function buildValueSnippet(value: any): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = String(value);
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

function buildEvidenceItem(table: string, row: string, col: string, value: any, versionId: number): EvidenceItem {
  const cellRef = `${table}:${row}:${col}`;
  return {
    table,
    row,
    col,
    value_snippet: buildValueSnippet(value),
    version_id: versionId,
    cell_ref: cellRef,
  };
}

function buildEvidenceForFact(tableKey: string, row: any, versionId: number): EvidenceItem[] {
  if (tableKey === 'active_disclosure') {
    const rowKey = String(row.category || '');
    if (!rowKey) {
      return [];
    }
    const mapping: Record<string, string> = {
      made_count: 'made',
      repealed_count: 'repealed',
      valid_count: 'valid',
      processed_count: 'processed',
      amount: 'amount',
    };
    return Object.entries(mapping).map(([field, colKey]) =>
      buildEvidenceItem(tableKey, rowKey, colKey, row[field], versionId)
    );
  }

  if (tableKey === 'application') {
    const rowKey = String(row.response_type || '');
    const colKey = String(row.applicant_type || '');
    if (!rowKey || !colKey) {
      return [];
    }
    return [buildEvidenceItem(tableKey, rowKey, colKey, row.count, versionId)];
  }

  if (tableKey === 'legal_proceeding') {
    const rowKey = String(row.case_type || '');
    const colKey = String(row.result_type || '');
    if (!rowKey || !colKey) {
      return [];
    }
    return [buildEvidenceItem(tableKey, rowKey, colKey, row.count, versionId)];
  }

  return [];
}

router.get('/v2/reports', async (req, res) => {
  try {
    const year = typeof req.query.year === 'string' ? req.query.year.trim() : '';
    const unitName = typeof req.query.unit_name === 'string' ? req.query.unit_name.trim() : '';
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';

    const conditions: string[] = [];
    if (year) {
      const yearNum = Number(year);
      if (!Number.isInteger(yearNum)) {
        return res.status(400).json({ error: 'Invalid year' });
      }
      conditions.push(`r.year = ${sqlValue(yearNum)}`);
    }

    if (unitName) {
      conditions.push(`r.unit_name LIKE ${sqlValue(`%${unitName}%`)}`);
    }

    const materializeStatusQuery = `(SELECT j.status FROM jobs j WHERE j.report_id = r.id AND j.kind = 'materialize' ORDER BY j.id DESC LIMIT 1)`;
    const materializeJobIdQuery = `(SELECT j.id FROM jobs j WHERE j.report_id = r.id AND j.kind = 'materialize' ORDER BY j.id DESC LIMIT 1)`;

    if (status) {
      if (status === 'none') {
        conditions.push(`${materializeJobIdQuery} IS NULL`);
      } else {
        conditions.push(`${materializeStatusQuery} = ${sqlValue(status)}`);
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = await dbQuery(`
      SELECT
        r.id AS report_id,
        r.region_id,
        reg.name AS region_name,
        r.unit_name,
        r.year,
        rv.id AS active_version_id,
        rv.created_at AS active_version_created_at,
        ${materializeJobIdQuery} AS materialize_job_id,
        ${materializeStatusQuery} AS materialize_status,
        (SELECT j.progress FROM jobs j WHERE j.report_id = r.id AND j.kind = 'materialize' ORDER BY j.id DESC LIMIT 1) AS materialize_progress,
        (SELECT j.finished_at FROM jobs j WHERE j.report_id = r.id AND j.kind = 'materialize' ORDER BY j.id DESC LIMIT 1) AS materialize_finished_at
      FROM reports r
      LEFT JOIN regions reg ON reg.id = r.region_id
      LEFT JOIN report_versions rv ON rv.id = r.active_version_id
      ${whereClause}
      ORDER BY r.id DESC
      LIMIT 200;
    `);

    return res.json({
      data: rows.map((row: any) => ({
        report_id: row.report_id,
        region_id: row.region_id,
        region_name: row.region_name,
        unit_name: row.unit_name,
        year: row.year,
        active_version: row.active_version_id
          ? {
            version_id: row.active_version_id,
            created_at: row.active_version_created_at,
          }
          : null,
        materialize_job: row.materialize_job_id
          ? {
            job_id: row.materialize_job_id,
            status: row.materialize_status,
            progress: row.materialize_progress,
            finished_at: row.materialize_finished_at,
          }
          : null,
      })),
    });
  } catch (error) {
    console.error('[DataCenter] Failed to list reports:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
      data: facts.map((row: any) => ({
        ...row,
        evidence: buildEvidenceForFact(req.params.tableName, row, report.active_version_id),
      })),
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
    const rowKey = typeof req.query.row_key === 'string' ? req.query.row_key : null;
    const colKey = typeof req.query.col_key === 'string' ? req.query.col_key : null;
    const limitParam = typeof req.query.limit === 'string' ? Number(req.query.limit) : 200;
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 1000) : 200;

    const report = (await dbQuery(
      `SELECT active_version_id FROM reports WHERE id = ${dbType === 'postgres' ? '$1' : '?'} LIMIT 1`,
      [reportId]
    ))[0];

    if (!report?.active_version_id) {
      return res.status(404).json({ error: 'Active version not found' });
    }

    const whereTable = tableId ? `AND table_id = ${sqlValue(tableId)}` : '';
    const whereRow = rowKey ? `AND row_key = ${sqlValue(rowKey)}` : '';
    const whereCol = colKey ? `AND col_key = ${sqlValue(colKey)}` : '';

    const cells = await dbQuery(`
      SELECT *
      FROM cells
      WHERE version_id = ${sqlValue(report.active_version_id)}
      ${whereTable}
      ${whereRow}
      ${whereCol}
      ORDER BY id ASC
      LIMIT ${sqlValue(limit)}
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

router.get('/v2/reports/:reportId/quality-issues', async (req, res) => {
  try {
    const reportId = Number(req.params.reportId);
    if (!reportId || Number.isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid reportId' });
    }

    const report = (await dbQuery(
      `SELECT active_version_id FROM reports WHERE id = ${dbType === 'postgres' ? '$1' : '?'} LIMIT 1`,
      [reportId]
    ))[0];

    if (!report?.active_version_id) {
      return res.status(404).json({ error: 'Active version not found' });
    }

    const issues = await dbQuery(`
      SELECT *
      FROM quality_issues
      WHERE report_id = ${sqlValue(reportId)}
        AND version_id = ${sqlValue(report.active_version_id)}
      ORDER BY created_at DESC, id DESC
    `);

    return res.json({
      data: issues,
      version_id: report.active_version_id,
    });
  } catch (error) {
    console.error('[DataCenter] Failed to fetch quality issues:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v2/reports/:reportId/quality-flags', async (req, res) => {
  try {
    const reportId = Number(req.params.reportId);
    if (!reportId || Number.isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid reportId' });
    }

    const report = (await dbQuery(
      `SELECT active_version_id FROM reports WHERE id = ${dbType === 'postgres' ? '$1' : '?'} LIMIT 1`,
      [reportId]
    ))[0];

    if (!report?.active_version_id) {
      return res.status(404).json({ error: 'Active version not found' });
    }

    const flags = await dbQuery(`
      SELECT severity, rule_code, COUNT(*) AS count
      FROM quality_issues
      WHERE report_id = ${sqlValue(reportId)}
        AND version_id = ${sqlValue(report.active_version_id)}
      GROUP BY severity, rule_code
      ORDER BY count DESC
    `);

    return res.json({
      data: flags,
      version_id: report.active_version_id,
    });
  } catch (error) {
    console.error('[DataCenter] Failed to fetch quality flags:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v2/reports/:reportId/report', async (req, res) => {
  try {
    const reportId = Number(req.params.reportId);
    if (!reportId || Number.isNaN(reportId)) {
      return res.status(400).json({ error: 'Invalid reportId' });
    }

    const formatParam = typeof req.query.format === 'string' ? req.query.format.trim().toLowerCase() : 'md';
    if (formatParam !== 'md' && formatParam !== 'html') {
      return res.status(400).json({ error: 'Invalid format' });
    }
    const format = formatParam as 'md' | 'html';

    const versionParam = typeof req.query.version === 'string' ? req.query.version.trim() : 'active';
    let versionId: number | undefined;
    if (versionParam && versionParam !== 'active') {
      const parsed = Number(versionParam);
      if (!parsed || Number.isNaN(parsed)) {
        return res.status(400).json({ error: 'Invalid version' });
      }
      versionId = parsed;
    }

    const includeEvidenceParam = typeof req.query.includeEvidence === 'string' ? req.query.includeEvidence.trim() : '';
    const includeEvidence = includeEvidenceParam ? includeEvidenceParam !== 'false' : true;

    const content = await ReportFactoryService.generate({
      reportId,
      versionId,
      format,
      includeEvidence,
    });

    res.status(200);
    if (format === 'html') {
      res.type('text/html');
    } else {
      res.type('text/markdown');
    }
    return res.send(content);
  } catch (error: any) {
    if (error?.statusCode === 400) {
      return res.status(400).json({ error: error.message || 'Bad request' });
    }
    if (error?.statusCode === 404) {
      return res.status(404).json({ error: error.message || 'Not found' });
    }
    console.error('[DataCenter] Failed to generate report:', error);
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

router.post('/v2/derived/run', async (req, res) => {
  try {
    const yearParam = typeof req.query.year === 'string' ? Number(req.query.year) : undefined;
    const regionParam = typeof req.query.region_id === 'string' ? Number(req.query.region_id) : undefined;

    if (yearParam !== undefined && (!Number.isFinite(yearParam) || !Number.isInteger(yearParam))) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    if (regionParam !== undefined && (!Number.isFinite(regionParam) || regionParam <= 0)) {
      return res.status(400).json({ error: 'Invalid region_id' });
    }

    const result = await DerivedMetricsService.run({
      year: yearParam,
      regionId: regionParam,
    });

    return res.json({ data: result });
  } catch (error) {
    console.error('[DataCenter] Failed to run derived aggregation:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v2/dashboard/kpis', async (req, res) => {
  try {
    const yearParam = typeof req.query.year === 'string' ? Number(req.query.year) : undefined;
    const regionParam = typeof req.query.region_id === 'string' ? Number(req.query.region_id) : undefined;

    if (yearParam !== undefined && (!Number.isFinite(yearParam) || !Number.isInteger(yearParam))) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    if (regionParam !== undefined && (!Number.isFinite(regionParam) || regionParam <= 0)) {
      return res.status(400).json({ error: 'Invalid region_id' });
    }

    const filters: string[] = [];
    if (yearParam !== undefined) {
      filters.push(`year = ${sqlValue(yearParam)}`);
    }
    if (regionParam !== undefined) {
      filters.push(`region_id = ${sqlValue(regionParam)}`);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const rows = await dbQuery(`
      SELECT
        SUM(report_count) as report_count,
        SUM(active_report_count) as active_report_count,
        SUM(materialize_succeeded) as materialize_succeeded,
        SUM(quality_issue_count_total) as quality_issue_count_total,
        AVG(derived_risk_avg) as derived_risk_avg
      FROM derived_region_year_metrics
      ${whereClause}
    `);

    const metrics = rows[0] || {};
    const reportCount = Number(metrics.report_count || 0);
    const activeReportCount = Number(metrics.active_report_count || 0);
    const materializeSucceeded = Number(metrics.materialize_succeeded || 0);
    const materializeSuccessRate = activeReportCount > 0 ? Number((materializeSucceeded / activeReportCount).toFixed(4)) : 0;

    return res.json({
      data: {
        report_count: reportCount,
        active_report_count: activeReportCount,
        materialize_success_rate: materializeSuccessRate,
        quality_issue_count_total: Number(metrics.quality_issue_count_total || 0),
        derived_risk_avg: Number(metrics.derived_risk_avg || 0),
      },
    });
  } catch (error) {
    console.error('[DataCenter] Failed to fetch dashboard KPIs:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v2/dashboard/trends', async (req, res) => {
  try {
    const regionParam = typeof req.query.region_id === 'string' ? Number(req.query.region_id) : undefined;
    const unitParam = typeof req.query.unit_id === 'string' ? Number(req.query.unit_id) : undefined;

    if (regionParam !== undefined && (!Number.isFinite(regionParam) || regionParam <= 0)) {
      return res.status(400).json({ error: 'Invalid region_id' });
    }
    if (unitParam !== undefined && (!Number.isFinite(unitParam) || unitParam <= 0)) {
      return res.status(400).json({ error: 'Invalid unit_id' });
    }

    if (unitParam !== undefined) {
      const rows = await dbQuery(`
        SELECT year, derived_risk_score, quality_issue_count_total, application_total, legal_total
        FROM derived_unit_year_metrics
        WHERE report_id = ${sqlValue(unitParam)}
        ORDER BY year ASC
      `);
      return res.json({ data: rows });
    }

    const filters: string[] = [];
    if (regionParam !== undefined) {
      filters.push(`region_id = ${sqlValue(regionParam)}`);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const rows = await dbQuery(`
      SELECT year, derived_risk_avg, quality_issue_count_total, application_total, legal_total
      FROM derived_region_year_metrics
      ${whereClause}
      ORDER BY year ASC
    `);
    return res.json({ data: rows });
  } catch (error) {
    console.error('[DataCenter] Failed to fetch dashboard trends:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v2/dashboard/rankings', async (req, res) => {
  try {
    const yearParam = typeof req.query.year === 'string' ? Number(req.query.year) : undefined;
    const regionParam = typeof req.query.region_id === 'string' ? Number(req.query.region_id) : undefined;
    const byParam = typeof req.query.by === 'string' ? req.query.by.trim() : 'risk';

    if (!['risk', 'issues', 'application'].includes(byParam)) {
      return res.status(400).json({ error: 'Invalid by' });
    }
    if (yearParam !== undefined && (!Number.isFinite(yearParam) || !Number.isInteger(yearParam))) {
      return res.status(400).json({ error: 'Invalid year' });
    }
    if (regionParam !== undefined && (!Number.isFinite(regionParam) || regionParam <= 0)) {
      return res.status(400).json({ error: 'Invalid region_id' });
    }

    const filters: string[] = [];
    if (yearParam !== undefined) {
      filters.push(`year = ${sqlValue(yearParam)}`);
    }
    if (regionParam !== undefined) {
      filters.push(`region_id = ${sqlValue(regionParam)}`);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const orderBy = (() => {
      if (byParam === 'issues') return 'quality_issue_count_total DESC';
      if (byParam === 'application') return 'application_total DESC';
      return 'derived_risk_score DESC';
    })();

    const rows = await dbQuery(`
      SELECT report_id, unit_name, region_id, year, derived_risk_score, quality_issue_count_total, application_total
      FROM derived_unit_year_metrics
      ${whereClause}
      ORDER BY ${orderBy}, report_id ASC
      LIMIT 10
    `);

    return res.json({ data: rows });
  } catch (error) {
    console.error('[DataCenter] Failed to fetch dashboard rankings:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
