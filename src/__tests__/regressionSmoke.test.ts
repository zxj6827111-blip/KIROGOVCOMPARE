/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const request = require('supertest');

const dbPath = path.join(process.cwd(), 'artifacts', 'regression-smoke.db');

process.env.NODE_ENV = 'development';
process.env.DATABASE_TYPE = 'sqlite';
process.env.JWT_SECRET = 'regression-test-secret-should-be-32-bytes-minimum';
process.env.SQLITE_DB_PATH = dbPath;
process.env.RATE_LIMIT_STORE = 'memory';
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX = '1000';

const { createApp } = require('../app');
const { createLlmApp } = require('../app-llm');
const { ensureSqliteMigrations, querySqlite, sqlValue } = require('../config/sqlite');
const { hashPassword } = require('../middleware/auth');

describe('Regression smoke (login/tasks/notifications/export)', () => {
  const app = createApp();
  const llmApp = createLlmApp();
  const adminPassword = 'RegressionPass123!';
  let token = '';

  beforeAll(() => {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }

    ensureSqliteMigrations();

    const permissions = JSON.stringify({
      upload_reports: true,
      view_reports: true,
      manage_users: true,
      manage_jobs: true,
      manage_regions: true
    });
    const dataScope = JSON.stringify({ regions: ['TestRegion'] });
    const passwordHash = hashPassword(adminPassword);

    querySqlite(`
      INSERT OR REPLACE INTO admin_users (id, username, password_hash, display_name, permissions, data_scope, created_at, updated_at)
      VALUES (1, 'admin', ${sqlValue(passwordHash)}, 'Admin', ${sqlValue(permissions)}, ${sqlValue(dataScope)}, datetime('now'), datetime('now'));
    `);

    querySqlite(`
      INSERT OR IGNORE INTO regions (id, code, name, level)
      VALUES (1, 'R1', 'TestRegion', 1);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO reports (id, region_id, year, unit_name)
      VALUES
        (1, 1, 2022, 'UnitA'),
        (2, 1, 2023, 'UnitA');
    `);

    querySqlite(`
      INSERT OR IGNORE INTO report_versions (
        id, report_id, file_name, file_hash, file_size, storage_path,
        provider, model, prompt_version, parsed_json, schema_version, is_active, version_type, state
      )
      VALUES
        (1, 1, 'report-2022.pdf', 'hash-2022', 123, 'storage/report-2022.pdf', 'manual', 'n/a', 'v1', '{}', 'v1', 1, 'original_parse', 'parsed'),
        (2, 2, 'report-2023.pdf', 'hash-2023', 123, 'storage/report-2023.pdf', 'manual', 'n/a', 'v1', '{}', 'v1', 1, 'original_parse', 'parsed');
    `);

    querySqlite(`
      UPDATE reports
      SET active_version_id = CASE id WHEN 1 THEN 1 WHEN 2 THEN 2 END
      WHERE id IN (1, 2);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO jobs (id, report_id, version_id, kind, status, progress, created_by)
      VALUES (1, 1, 1, 'parse', 'done', 100, 1);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO comparisons (id, region_id, year_a, year_b, left_report_id, right_report_id)
      VALUES (1, 1, 2022, 2023, 1, 2);
    `);

    querySqlite(`
      INSERT OR IGNORE INTO notifications (id, type, title, content_json, related_job_id, related_version_id, created_by)
      VALUES (1, 'upload_complete', 'Smoke notification', '{"message":"ok"}', 1, 1, 1);
    `);
  });

  it('login', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: adminPassword });

    expect(res.status).toBe(200);
    expect(res.body?.token).toBeTruthy();
    token = res.body.token;
  });

  it('tasks (jobs list + detail)', async () => {
    const listRes = await request(llmApp)
      .get('/api/jobs')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.jobs)).toBe(true);
    expect(listRes.body.jobs.length).toBeGreaterThan(0);

    const detailRes = await request(llmApp)
      .get('/api/jobs/1')
      .set('Authorization', `Bearer ${token}`);

    expect(detailRes.status).toBe(200);
    expect(detailRes.body?.version_id).toBe(1);
  });

  it('notifications list + mark read', async () => {
    const listRes = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body.notifications)).toBe(true);
    expect(listRes.body.notifications.length).toBeGreaterThan(0);

    const first = listRes.body.notifications[0];
    const readRes = await request(app)
      .post(`/api/notifications/${first.id}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(readRes.status).toBe(200);
  });

  it('export (pdf job creation)', async () => {
    const res = await request(llmApp)
      .post('/api/pdf-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ comparison_id: 1 });

    expect(res.status).toBe(201);
    expect(res.body?.job_id).toBeTruthy();
  });
});
