/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const dbPath = path.join(process.cwd(), 'artifacts', 'derived-metrics.db');

process.env.NODE_ENV = 'test';
process.env.DATABASE_TYPE = 'sqlite';
process.env.JWT_SECRET = 'derived-metrics-test-secret-should-be-32-bytes-minimum';
process.env.SQLITE_DB_PATH = dbPath;
process.env.RATE_LIMIT_STORE = 'memory';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX = '1000';

const { createLlmApp } = require('../app-llm');
const { runLLMMigrations } = require('../db/migrations-llm');
const { querySqlite } = require('../config/sqlite');

const app = createLlmApp();

describe('Derived metrics aggregation + dashboard APIs', () => {
  beforeAll(async () => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    await runLLMMigrations();

    querySqlite(`
      INSERT OR IGNORE INTO reports (id, region_id, year, unit_name, active_version_id)
      VALUES (100, 1, 2023, 'UnitReport', 200);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO report_versions (
        id, report_id, file_name, file_hash, file_size, storage_path,
        provider, model, prompt_version, parsed_json, schema_version, is_active, version_type, state
      )
      VALUES (200, 100, 'report.pdf', 'hash', 123, 'storage/report.pdf', 'manual', 'n/a', 'v1', '{}', 'v1', 1, 'original_parse', 'parsed');
    `);

    querySqlite(`
      INSERT OR IGNORE INTO jobs (id, report_id, version_id, kind, status, progress, created_by)
      VALUES (300, 100, 200, 'materialize', 'done', 100, 1);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO fact_application (id, report_id, version_id, applicant_type, response_type, count)
      VALUES (1, 100, 200, 'total', 'new_received', 12);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO fact_legal_proceeding (id, report_id, version_id, case_type, result_type, count)
      VALUES (1, 100, 200, 'review', 'total', 2);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO quality_issues (
        id, report_id, version_id, rule_code, severity, description, cell_ref, auto_status, human_status, created_at, updated_at
      )
      VALUES (1, 100, 200, 'active_missing', 'high', '主动公开缺失', NULL, 'open', 'pending', datetime('now'), datetime('now'));
    `);
  });

  it('runs derived aggregation and is idempotent', async () => {
    const runRes = await request(app).post('/api/v2/derived/run?year=2023');
    expect(runRes.status).toBe(200);
    const first = runRes.body?.data?.unitUpserts || 0;

    const secondRun = await request(app).post('/api/v2/derived/run?year=2023');
    expect(secondRun.status).toBe(200);
    expect(secondRun.body?.data?.unitUpserts).toBe(first);

    const rows = querySqlite('SELECT COUNT(*) as cnt FROM derived_unit_year_metrics;');
    expect(Number(rows[0].cnt)).toBeGreaterThan(0);
  });

  it('returns dashboard kpis', async () => {
    const res = await request(app).get('/api/v2/dashboard/kpis?year=2023');
    expect(res.status).toBe(200);
    expect(res.body?.data?.report_count).toBeDefined();
    expect(res.body?.data?.materialize_success_rate).toBeDefined();
  });

  it('returns rankings in stable order', async () => {
    const res = await request(app).get('/api/v2/dashboard/rankings?year=2023&by=risk');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body?.data)).toBe(true);
  });
});
