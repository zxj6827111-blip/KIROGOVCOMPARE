import express from 'express';
import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';

const router = express.Router();

interface ParsedVersion {
  version_id: number;
  parsed_json: any;
}

function parseJsonSafe(value: any): any {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'object') {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch (error) {
    return value;
  }
}

function isParsedReady(version: ParsedVersion | undefined): boolean {
  if (!version) return false;
  if (version.parsed_json === null || version.parsed_json === undefined) return false;
  const parsed = parseJsonSafe(version.parsed_json);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return Object.keys(parsed).length > 0;
  }
  return true;
}

function buildLatestJob(comparisonId: number): any {
  const job = querySqlite(`
    SELECT id, status, progress, error_code, error_message
    FROM jobs
    WHERE comparison_id = ${sqlValue(comparisonId)}
    ORDER BY id DESC
    LIMIT 1;
  `)[0];

  if (!job) {
    return null;
  }

  return {
    job_id: job.id,
    status: job.status,
    progress: job.progress,
    error_code: job.error_code,
    error_message: job.error_message,
  };
}

function fetchParsedVersion(reportId: number): ParsedVersion | undefined {
  const version = querySqlite(`
    SELECT id as version_id, parsed_json
    FROM report_versions
    WHERE report_id = ${sqlValue(reportId)} AND is_active = 1
    LIMIT 1;
  `)[0];

  if (!version) {
    return undefined;
  }

  return {
    version_id: version.version_id,
    parsed_json: parseJsonSafe(version.parsed_json),
  };
}

router.post('/comparisons', (req, res) => {
  try {
    const { region_id, year_a, year_b, left_report_id, right_report_id } = req.body;

    if (!region_id && (!left_report_id || !right_report_id)) {
      return res.status(400).json({ error: 'region_id/year_a/year_b 或 report_id 组合不能为空' });
    }

    let regionId = region_id ? Number(region_id) : undefined;
    let yearA = year_a !== undefined ? Number(year_a) : undefined;
    let yearB = year_b !== undefined ? Number(year_b) : undefined;
    let leftReportId = left_report_id !== undefined ? Number(left_report_id) : undefined;
    let rightReportId = right_report_id !== undefined ? Number(right_report_id) : undefined;

    if (regionId !== undefined && (!Number.isInteger(regionId) || regionId < 1)) {
      return res.status(400).json({ error: 'region_id 无效' });
    }

    const validateYear = (year: number | undefined): boolean => year !== undefined && Number.isInteger(year);
    if (yearA !== undefined && !validateYear(yearA)) {
      return res.status(400).json({ error: 'year_a 无效' });
    }
    if (yearB !== undefined && !validateYear(yearB)) {
      return res.status(400).json({ error: 'year_b 无效' });
    }

    if (leftReportId !== undefined && (!Number.isInteger(leftReportId) || leftReportId < 1)) {
      return res.status(400).json({ error: 'left_report_id 无效' });
    }
    if (rightReportId !== undefined && (!Number.isInteger(rightReportId) || rightReportId < 1)) {
      return res.status(400).json({ error: 'right_report_id 无效' });
    }

    ensureSqliteMigrations();

    if (regionId && yearA !== undefined && yearB !== undefined) {
      if (yearA > yearB) {
        [yearA, yearB] = [yearB, yearA];
      }
      const leftReport = querySqlite(
        `SELECT id, region_id, year FROM reports WHERE region_id = ${sqlValue(regionId)} AND year = ${sqlValue(yearA)} LIMIT 1;`
      )[0];
      const rightReport = querySqlite(
        `SELECT id, region_id, year FROM reports WHERE region_id = ${sqlValue(regionId)} AND year = ${sqlValue(yearB)} LIMIT 1;`
      )[0];

      if (!leftReport || !rightReport) {
        return res.status(404).json({ error: '报告不存在' });
      }

      leftReportId = leftReport.id;
      rightReportId = rightReport.id;
    }

    if (leftReportId === undefined || rightReportId === undefined) {
      return res.status(400).json({ error: '报告信息不足，无法创建比对' });
    }

    const leftReport = querySqlite(`SELECT id, region_id, year FROM reports WHERE id = ${sqlValue(leftReportId)} LIMIT 1;`)[0];
    const rightReport = querySqlite(`SELECT id, region_id, year FROM reports WHERE id = ${sqlValue(rightReportId)} LIMIT 1;`)[0];

    if (!leftReport || !rightReport) {
      return res.status(404).json({ error: '报告不存在' });
    }

    if (leftReport.region_id !== rightReport.region_id) {
      return res.status(400).json({ error: '必须比较同一地区的报告' });
    }

    regionId = leftReport.region_id;
    yearA = Math.min(leftReport.year, rightReport.year);
    yearB = Math.max(leftReport.year, rightReport.year);

    if (leftReport.year > rightReport.year) {
      [leftReportId, rightReportId] = [rightReportId, leftReportId];
    }

    const leftVersion = fetchParsedVersion(leftReportId);
    const rightVersion = fetchParsedVersion(rightReportId);

    if (!isParsedReady(leftVersion) || !isParsedReady(rightVersion)) {
      return res.status(409).json({ error: '解析未完成', error_code: 'PARSE_NOT_READY' });
    }

    const existingComparison = querySqlite(`
      SELECT id FROM comparisons WHERE region_id = ${sqlValue(regionId)} AND year_a = ${sqlValue(yearA)} AND year_b = ${sqlValue(yearB)} LIMIT 1;
    `)[0];

    const comparison = querySqlite(`
      INSERT INTO comparisons (region_id, year_a, year_b, left_report_id, right_report_id)
      VALUES (${sqlValue(regionId)}, ${sqlValue(yearA)}, ${sqlValue(yearB)}, ${sqlValue(leftReportId)}, ${sqlValue(rightReportId)})
      ON CONFLICT(region_id, year_a, year_b) DO UPDATE SET
        left_report_id = excluded.left_report_id,
        right_report_id = excluded.right_report_id
      RETURNING id;
    `)[0];

    if (!comparison?.id) {
      return res.status(500).json({ error: 'comparison 创建失败' });
    }

    const existingJob = querySqlite(`
      SELECT id FROM jobs
      WHERE comparison_id = ${sqlValue(comparison.id)} AND status IN ('queued', 'running')
      ORDER BY id DESC
      LIMIT 1;
    `)[0];

    let jobId: number;
    if (existingJob?.id) {
      jobId = existingJob.id;
    } else {
      const newJob = querySqlite(`
        INSERT INTO jobs (report_id, kind, status, progress, comparison_id)
        VALUES (${sqlValue(leftReportId)}, 'compare', 'queued', 0, ${sqlValue(comparison.id)})
        RETURNING id;
      `)[0];
      jobId = newJob.id;
    }

    return res.status(existingComparison ? 200 : 201).json({
      comparison_id: comparison.id,
      job_id: jobId,
    });
  } catch (error) {
    console.error('Error creating comparison:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/comparisons', (req, res) => {
  try {
    const { region_id, year_a, year_b } = req.query;

    ensureSqliteMigrations();

    const conditions: string[] = [];
    if (region_id !== undefined) {
      const regionIdNum = Number(region_id);
      if (!Number.isInteger(regionIdNum) || regionIdNum < 1) {
        return res.status(400).json({ error: 'region_id 无效' });
      }
      conditions.push(`region_id = ${sqlValue(regionIdNum)}`);
    }
    if (year_a !== undefined) {
      const yearANum = Number(year_a);
      if (!Number.isInteger(yearANum)) {
        return res.status(400).json({ error: 'year_a 无效' });
      }
      conditions.push(`year_a = ${sqlValue(yearANum)}`);
    }
    if (year_b !== undefined) {
      const yearBNum = Number(year_b);
      if (!Number.isInteger(yearBNum)) {
        return res.status(400).json({ error: 'year_b 无效' });
      }
      conditions.push(`year_b = ${sqlValue(yearBNum)}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = querySqlite(`
      SELECT
        c.id,
        c.region_id,
        c.year_a,
        c.year_b,
        c.left_report_id,
        c.right_report_id
      FROM comparisons c
      ${whereClause}
      ORDER BY c.id DESC;
    `);

    return res.json({
      data: rows.map((row: any) => ({
        id: row.id,
        region_id: row.region_id,
        year_a: row.year_a,
        year_b: row.year_b,
        left_report_id: row.left_report_id,
        right_report_id: row.right_report_id,
        latest_job: buildLatestJob(row.id),
      })),
    });
  } catch (error) {
    console.error('Error listing comparisons:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/comparisons/:id', (req, res) => {
  try {
    const comparisonId = Number(req.params.id);
    if (!Number.isInteger(comparisonId) || comparisonId < 1) {
      return res.status(400).json({ error: 'comparison_id 无效' });
    }

    ensureSqliteMigrations();

    const comparison = querySqlite(`
      SELECT id, region_id, year_a, year_b, left_report_id, right_report_id
      FROM comparisons
      WHERE id = ${sqlValue(comparisonId)}
      LIMIT 1;
    `)[0];

    if (!comparison) {
      return res.status(404).json({ error: 'comparison 不存在' });
    }

    const resultRow = querySqlite(`
      SELECT diff_json FROM comparison_results WHERE comparison_id = ${sqlValue(comparisonId)} LIMIT 1;
    `)[0];

    let diffJson: any = null;
    if (resultRow?.diff_json !== undefined) {
      diffJson = parseJsonSafe(resultRow.diff_json);
    }

    return res.json({
      id: comparison.id,
      region_id: comparison.region_id,
      year_a: comparison.year_a,
      year_b: comparison.year_b,
      left_report_id: comparison.left_report_id,
      right_report_id: comparison.right_report_id,
      latest_job: buildLatestJob(comparison.id),
      diff_json: diffJson,
    });
  } catch (error) {
    console.error('Error fetching comparison detail:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
