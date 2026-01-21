import express from 'express';
import pool from '../config/database-llm';
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
    const params: any[] = [];
    let paramIndex = 1;

    if (year) {
      const yearNum = Number(year);
      if (!Number.isInteger(yearNum)) {
        return res.status(400).json({ error: 'Invalid year' });
      }
      conditions.push(`r.year = $${paramIndex++}`);
      params.push(yearNum);
    }

    if (unitName) {
      conditions.push(`r.unit_name LIKE $${paramIndex++}`);
      params.push(`%${unitName}%`);
    }

    // Subqueries for status and job ID
    // We can't easily param these inside the select list if they are complex text substitution, but here they are static SQL logic.
    const materializeStatusQuery = `(SELECT j.status FROM jobs j WHERE j.report_id = r.id AND j.kind = 'materialize' ORDER BY j.id DESC LIMIT 1)`;
    const materializeJobIdQuery = `(SELECT j.id FROM jobs j WHERE j.report_id = r.id AND j.kind = 'materialize' ORDER BY j.id DESC LIMIT 1)`;

    if (status) {
      if (status === 'none') {
        conditions.push(`${materializeJobIdQuery} IS NULL`);
      } else {
        conditions.push(`${materializeStatusQuery} = $${paramIndex++}`);
        params.push(status);
      }
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(`
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
    `, params);

    return res.json({
      data: result.rows.map((row: any) => ({
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
    const result = await pool.query(`
      SELECT id, batch_uuid, created_by, created_at, source, note,
             report_count, success_count, fail_count, status, completed_at
      FROM ingestion_batches
      ORDER BY created_at DESC
      LIMIT 50;
    `);

    res.json({ data: result.rows });
  } catch (error) {
    console.error('[DataCenter] Failed to list batches:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/v2/batches/:batchUuid', async (req, res) => {
  try {
    const batchUuid = req.params.batchUuid;
    const batchRes = await pool.query(
      `SELECT id, batch_uuid, created_by, created_at, source, note,
              report_count, success_count, fail_count, status, completed_at
       FROM ingestion_batches
       WHERE batch_uuid = $1
       LIMIT 1`,
      [batchUuid]
    );
    const batch = batchRes.rows[0];

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const versionsRes = await pool.query(`
      SELECT rv.id as version_id, rv.report_id, rv.state, rv.created_at
      FROM report_versions rv
      WHERE rv.ingestion_batch_id = $1
      ORDER BY rv.created_at DESC
    `, [batch.id]);

    const jobsRes = await pool.query(`
      SELECT id, report_id, version_id, kind, status, progress, created_at, finished_at
      FROM jobs
      WHERE ingestion_batch_id = $1
      ORDER BY created_at DESC
    `, [batch.id]);

    return res.json({
      data: {
        batch,
        versions: versionsRes.rows,
        jobs: jobsRes.rows,
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
    const batchRes = await pool.query(
      `SELECT id FROM ingestion_batches WHERE batch_uuid = $1 LIMIT 1`,
      [batchUuid]
    );
    const batch = batchRes.rows[0];

    if (!batch) {
      return res.status(404).json({ error: 'Batch not found' });
    }

    const failedJobsRes = await pool.query(`
      SELECT id, report_id, version_id, kind, provider, model
      FROM jobs
      WHERE ingestion_batch_id = $1
        AND status IN ('failed', 'cancelled')
        AND kind != 'pdf_export'
      ORDER BY created_at DESC
    `, [batch.id]);
    const failedJobs = failedJobsRes.rows;

    if (failedJobs.length === 0) {
      return res.json({ retried: 0, message: 'No failed jobs to retry' });
    }

    let retried = 0;
    // We could optimize this, but loop is fine for typically small number of retries
    for (const job of failedJobs) {
      await pool.query(`
        INSERT INTO jobs (report_id, version_id, kind, status, progress, provider, model, ingestion_batch_id)
        VALUES ($1, $2, $3, 'queued', 0, $4, $5, $6)
      `, [job.report_id, job.version_id, job.kind, job.provider, job.model, batch.id]);
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

    const reportRes = await pool.query(
      `SELECT active_version_id FROM reports WHERE id = $1 LIMIT 1`,
      [reportId]
    );
    const report = reportRes.rows[0];

    if (!report?.active_version_id) {
      return res.status(404).json({ error: 'Active version not found' });
    }

    // tableName is safe because of getTableName whitelist check
    const factsRes = await pool.query(`
      SELECT *
      FROM ${tableName}
      WHERE report_id = $1
        AND version_id = $2
      ORDER BY id ASC
    `, [reportId, report.active_version_id]);

    return res.json({
      data: factsRes.rows.map((row: any) => ({
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

    const reportRes = await pool.query(
      `SELECT active_version_id FROM reports WHERE id = $1 LIMIT 1`,
      [reportId]
    );
    const report = reportRes.rows[0];

    if (!report?.active_version_id) {
      return res.status(404).json({ error: 'Active version not found' });
    }

    const conditions: string[] = [`version_id = $1`];
    const params: any[] = [report.active_version_id];
    let paramIndex = 2; // $1 is used

    if (tableId) {
      conditions.push(`table_id = $${paramIndex++}`);
      params.push(tableId);
    }
    if (rowKey) {
      conditions.push(`row_key = $${paramIndex++}`);
      params.push(rowKey);
    }
    if (colKey) {
      conditions.push(`col_key = $${paramIndex++}`);
      params.push(colKey);
    }

    params.push(limit); // Last param is limit

    const cellsRes = await pool.query(`
      SELECT *
      FROM cells
      WHERE ${conditions.join(' AND ')}
      ORDER BY id ASC
      LIMIT $${paramIndex}
    `, params);

    return res.json({
      data: cellsRes.rows,
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

    const reportRes = await pool.query(
      `SELECT active_version_id FROM reports WHERE id = $1 LIMIT 1`,
      [reportId]
    );
    const report = reportRes.rows[0];

    if (!report?.active_version_id) {
      return res.status(404).json({ error: 'Active version not found' });
    }

    const issuesRes = await pool.query(`
      SELECT *
      FROM quality_issues
      WHERE report_id = $1
        AND version_id = $2
      ORDER BY created_at DESC, id DESC
    `, [reportId, report.active_version_id]);

    return res.json({
      data: issuesRes.rows,
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

    const reportRes = await pool.query(
      `SELECT active_version_id FROM reports WHERE id = $1 LIMIT 1`,
      [reportId]
    );
    const report = reportRes.rows[0];

    if (!report?.active_version_id) {
      return res.status(404).json({ error: 'Active version not found' });
    }

    const flagsRes = await pool.query(`
      SELECT severity, rule_code, COUNT(*) AS count
      FROM quality_issues
      WHERE report_id = $1
        AND version_id = $2
      GROUP BY severity, rule_code
      ORDER BY count DESC
    `, [reportId, report.active_version_id]);

    return res.json({
      data: flagsRes.rows,
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
    const metricsRes = await pool.query(`
      SELECT id, metric_key, version, display_name, description, unit,
             aggregatable, source_table, source_column, drilldown_source,
             caveats, interpretation_template, effective_from, deprecated_at
      FROM metric_dictionary
      WHERE deprecated_at IS NULL
      ORDER BY metric_key ASC
    `);

    return res.json({ data: metricsRes.rows });
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
    const params: any[] = [];
    let paramIndex = 1;

    if (yearParam !== undefined) {
      filters.push(`year = $${paramIndex++}`);
      params.push(yearParam);
    }
    if (regionParam !== undefined) {
      filters.push(`region_id = $${paramIndex++}`);
      params.push(regionParam);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const rowsRes = await pool.query(`
      SELECT
        SUM(report_count) as report_count,
        SUM(active_report_count) as active_report_count,
        SUM(materialize_succeeded) as materialize_succeeded,
        SUM(quality_issue_count_total) as quality_issue_count_total,
        AVG(derived_risk_avg) as derived_risk_avg
      FROM derived_region_year_metrics
      ${whereClause}
    `, params);

    const metrics = rowsRes.rows[0] || {};
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
      const rowsRes = await pool.query(`
        SELECT year, derived_risk_score, quality_issue_count_total, application_total, legal_total
        FROM derived_unit_year_metrics
        WHERE report_id = $1
        ORDER BY year ASC
      `, [unitParam]);
      return res.json({ data: rowsRes.rows });
    }

    const filters: string[] = [];
    const params: any[] = [];
    if (regionParam !== undefined) {
      filters.push(`region_id = $1`);
      params.push(regionParam);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const rowsRes = await pool.query(`
      SELECT year, derived_risk_avg, quality_issue_count_total, application_total, legal_total
      FROM derived_region_year_metrics
      ${whereClause}
      ORDER BY year ASC
    `, params);
    return res.json({ data: rowsRes.rows });
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
    const params: any[] = [];
    let paramIndex = 1;

    if (yearParam !== undefined) {
      filters.push(`year = $${paramIndex++}`);
      params.push(yearParam);
    }
    if (regionParam !== undefined) {
      filters.push(`region_id = $${paramIndex++}`);
      params.push(regionParam);
    }
    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    let orderBy = 'derived_risk_score DESC';
    if (byParam === 'issues') orderBy = 'quality_issue_count_total DESC';
    if (byParam === 'application') orderBy = 'application_total DESC';

    const rowsRes = await pool.query(`
      SELECT report_id, unit_name, region_id, year, derived_risk_score, quality_issue_count_total, application_total
      FROM derived_unit_year_metrics
      ${whereClause}
      ORDER BY ${orderBy}, report_id ASC
      LIMIT 10
    `, params);

    return res.json({ data: rowsRes.rows });
  } catch (error) {
    console.error('[DataCenter] Failed to fetch dashboard rankings:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
