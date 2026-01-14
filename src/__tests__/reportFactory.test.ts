/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const dbPath = path.join(process.cwd(), 'artifacts', 'report-factory.db');

process.env.NODE_ENV = 'test';
process.env.DATABASE_TYPE = 'sqlite';
process.env.JWT_SECRET = 'report-factory-test-secret-should-be-32-bytes-minimum';
process.env.SQLITE_DB_PATH = dbPath;
process.env.RATE_LIMIT_STORE = 'memory';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX = '1000';

const { createLlmApp } = require('../app-llm');
const { runLLMMigrations } = require('../db/migrations-llm');
const { querySqlite } = require('../config/sqlite');

describe('Report factory API', () => {
  const app = createLlmApp();

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
      INSERT OR IGNORE INTO fact_active_disclosure (
        id, report_id, version_id, category, made_count, repealed_count, valid_count, processed_count, amount
      )
      VALUES (1, 100, 200, 'regulations', 5, 0, 4, 0, NULL);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO fact_application (id, report_id, version_id, applicant_type, response_type, count)
      VALUES
        (1, 100, 200, 'total', 'new_received', 12),
        (2, 100, 200, 'total', 'carried_over', 3),
        (3, 100, 200, 'total', 'granted', 6),
        (4, 100, 200, 'total', 'partial_grant', 1),
        (5, 100, 200, 'total', 'denied_state_secret', 2),
        (6, 100, 200, 'total', 'total_processed', 9);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO fact_legal_proceeding (id, report_id, version_id, case_type, result_type, count)
      VALUES
        (1, 100, 200, 'review', 'total', 2),
        (2, 100, 200, 'litigation_direct', 'total', 1);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO cells (
        id, version_id, table_id, row_key, col_key, cell_ref, value_raw, value_num, value_semantic, normalized_value
      )
      VALUES (
        1,
        200,
        'active_disclosure',
        'regulations',
        'made',
        'active_disclosure:regulations:made',
        '5',
        5,
        'NUMERIC',
        '5'
      );
    `);

    querySqlite(`
      INSERT OR IGNORE INTO quality_issues (
        id, report_id, version_id, rule_code, severity, description, cell_ref, auto_status, human_status, created_at, updated_at
      )
      VALUES (
        1,
        100,
        200,
        'missing_data',
        'high',
        '示例问题：缺失数据',
        'active_disclosure:regulations:made',
        'open',
        'pending',
        datetime('now'),
        datetime('now')
      );
    `);
  });

  it('returns 404 when report does not exist', async () => {
    const res = await request(app).get('/api/v2/reports/999/report');
    expect(res.status).toBe(404);
  });

  it('returns markdown report with evidence', async () => {
    const res = await request(app).get('/api/v2/reports/100/report?format=md&includeEvidence=true');
    expect(res.status).toBe(200);
    expect(res.text).toContain('## 1. 摘要');
    expect(res.text).toContain('## 2. 核心指标概览');
    expect(res.text).toContain('## 3. 问题清单');
    expect(res.text).toContain('reportId=100 [evidence] table=active_disclosure row=regulations col=made value="5" (versionId=200)');
  });

  it('omits evidence appendix when includeEvidence=false', async () => {
    const res = await request(app).get('/api/v2/reports/100/report?format=md&includeEvidence=false');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('## 4. 证据附件');
  });
});
