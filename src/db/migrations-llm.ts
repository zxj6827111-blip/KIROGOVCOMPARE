import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import pool, { dbType } from '../config/database-llm';
import { dbNowExpression } from '../config/db-llm';
import { querySqlite, sqlValue } from '../config/sqlite';

// ============================================================================
// FORBIDDEN KEYWORDS FOR SQLITE
// These PostgreSQL-specific keywords must NEVER appear in SQLite migrations.
// This list mirrors scripts/scan_sqlite_migrations.js for runtime validation.
// ============================================================================
const FORBIDDEN_KEYWORDS_PATH = path.join(__dirname, '..', '..', 'migrations', 'sqlite_forbidden_keywords.json');

type ForbiddenKeywordEntry = { label: string; pattern: string; flags?: string };

function loadForbiddenKeywords(): Array<{ label: string; pattern: RegExp }> {
  if (!fs.existsSync(FORBIDDEN_KEYWORDS_PATH)) {
    throw new Error('[SQLite Migration Error] Forbidden keywords file not found: ' + FORBIDDEN_KEYWORDS_PATH);
  }
  const raw = fs.readFileSync(FORBIDDEN_KEYWORDS_PATH, 'utf8');
  const parsed = JSON.parse(raw) as { keywords?: ForbiddenKeywordEntry[] };
  if (!parsed.keywords || !Array.isArray(parsed.keywords)) {
    throw new Error('[SQLite Migration Error] Invalid forbidden keywords format: ' + FORBIDDEN_KEYWORDS_PATH);
  }
  return parsed.keywords.map((entry) => ({
    label: entry.label,
    pattern: new RegExp(entry.pattern, entry.flags || ''),
  }));
}

const FORBIDDEN_SQLITE_KEYWORDS = loadForbiddenKeywords();

/**
 * Strip SQL comments to avoid false positives in keyword detection.
 */
function stripSqlComments(sql: string): string {
  // Remove single-line comments
  let cleaned = sql.replace(/--.*$/gm, '');
  // Remove multi-line comments (preserve line count for error messages)
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ''));
  return cleaned;
}

/**
 * Validate that SQL does not contain PostgreSQL-specific keywords.
 * Throws an error if any forbidden keyword is found.
 */
function validateNoForbiddenKeywords(sql: string, source: string): void {
  const stripped = stripSqlComments(sql);
  const lines = stripped.split('\n');

  const violations: { line: number; keyword: string }[] = [];

  lines.forEach((line, index) => {
    FORBIDDEN_SQLITE_KEYWORDS.forEach(({ label, pattern }) => {
      if (pattern.test(line)) {
        violations.push({ line: index + 1, keyword: label });
      }
    });
  });

  if (violations.length > 0) {
    const details = violations.map(v => '  Line ' + v.line + ': ' + v.keyword).join('\n');
    throw new Error(
      '[SQLite Migration Error] Forbidden PostgreSQL keywords detected in ' + source + ':\n' + details + '\n' +
      'Fix: Use SQLite-compatible syntax (e.g., TEXT instead of TIMESTAMPTZ, datetime(\'now\') instead of NOW())'
    );
  }
}

const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations';

function ensureSchemaMigrationsTable(): void {
  querySqlite(
    `CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum TEXT NULL
    );`
  );
}

function getAppliedMigration(filename: string): { filename?: string; checksum?: string } | undefined {
  const rows = querySqlite(
    `SELECT filename, checksum FROM ${SCHEMA_MIGRATIONS_TABLE} WHERE filename = ${sqlValue(filename)} LIMIT 1;`
  ) as Array<{ filename?: string; checksum?: string }>;
  return rows[0];
}

function getAppliedMigrationCount(): number {
  const rows = querySqlite(`SELECT COUNT(*) as cnt FROM ${SCHEMA_MIGRATIONS_TABLE};`) as Array<{ cnt?: number }>;
  return Number(rows[0]?.cnt || 0);
}

function hasReportsTable(): boolean {
  const rows = querySqlite(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'reports' LIMIT 1;`
  ) as Array<{ name?: string }>;
  return rows.length > 0;
}

function recordMigration(filename: string, checksum: string): void {
  querySqlite(
    `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (filename, checksum) VALUES (${sqlValue(filename)}, ${sqlValue(checksum)});`
  );
}

// ============================================================================
// POSTGRESQL SCHEMA (kept as-is for postgres mode)
// ============================================================================
const postgresSchema = `
CREATE TABLE IF NOT EXISTS regions (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  province VARCHAR(255),
  parent_id BIGINT REFERENCES regions(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  unit_name VARCHAR(255) NOT NULL DEFAULT '',
  active_version_id BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(region_id, year, unit_name)
);

CREATE INDEX IF NOT EXISTS idx_reports_region_year ON reports(region_id, year);

CREATE TABLE IF NOT EXISTS ingestion_batches (
  id BIGSERIAL PRIMARY KEY,
  batch_uuid UUID NOT NULL UNIQUE,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'upload',
  note TEXT,
  report_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'processing',
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_batch_created ON ingestion_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_status ON ingestion_batches(status);

CREATE TABLE IF NOT EXISTS report_versions (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  file_size BIGINT,
  storage_path TEXT NOT NULL,
  text_path TEXT,
  raw_text TEXT,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt_version VARCHAR(50) NOT NULL,
  parsed_json JSONB NOT NULL,
  schema_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  parent_version_id BIGINT REFERENCES report_versions(id),
  version_type TEXT NOT NULL DEFAULT 'original_parse',
  change_reason TEXT,
  changed_fields_summary TEXT,
  state TEXT NOT NULL DEFAULT 'parsed',
  created_by BIGINT,
  ingestion_batch_id BIGINT REFERENCES ingestion_batches(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_report_versions_report_file
ON report_versions(report_id, file_hash);

CREATE INDEX IF NOT EXISTS idx_report_versions_report_active
ON report_versions(report_id, is_active);

CREATE TABLE IF NOT EXISTS comparisons (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES regions(id),
  year_a INTEGER NOT NULL,
  year_b INTEGER NOT NULL,
  left_report_id BIGINT NOT NULL REFERENCES reports(id),
  right_report_id BIGINT NOT NULL REFERENCES reports(id),
  similarity INTEGER,
  check_status VARCHAR(50),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(region_id, year_a, year_b)
);

CREATE TABLE IF NOT EXISTS comparison_results (
  id BIGSERIAL PRIMARY KEY,
  comparison_id BIGINT NOT NULL UNIQUE REFERENCES comparisons(id) ON DELETE CASCADE,
  diff_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version_id BIGINT REFERENCES report_versions(id) ON DELETE SET NULL,
  kind VARCHAR(30) NOT NULL DEFAULT 'parse',
  status VARCHAR(30) NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  step_code VARCHAR(50) DEFAULT 'QUEUED',
  step_name VARCHAR(255) DEFAULT '等待处理',
  attempt INTEGER DEFAULT 1,
  provider VARCHAR(50),
  model VARCHAR(100),
  error_code VARCHAR(50),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  comparison_id BIGINT REFERENCES comparisons(id) ON DELETE SET NULL,
  export_title TEXT,
  file_name TEXT,
  file_path TEXT,
  file_size BIGINT,
  batch_id TEXT,
  created_by BIGINT,
  ingestion_batch_id BIGINT REFERENCES ingestion_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_report ON jobs(report_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_comparison ON jobs(comparison_id);

CREATE TABLE IF NOT EXISTS report_version_parses (
  id BIGSERIAL PRIMARY KEY,
  report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  output_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Consistency check runs table
CREATE TABLE IF NOT EXISTS report_consistency_runs (
  id BIGSERIAL PRIMARY KEY,
  report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  status VARCHAR(30) NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed')),
  engine_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  summary_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_consistency_runs_version 
  ON report_consistency_runs(report_version_id);

CREATE INDEX IF NOT EXISTS idx_consistency_runs_status 
  ON report_consistency_runs(status);

-- Consistency check items table
CREATE TABLE IF NOT EXISTS report_consistency_items (
  id BIGSERIAL PRIMARY KEY,
  run_id BIGINT NOT NULL REFERENCES report_consistency_runs(id) ON DELETE CASCADE,
  report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  
  group_key VARCHAR(30) NOT NULL CHECK(group_key IN ('table2', 'table3', 'table4', 'text', 'visual', 'structure', 'quality')),
  check_key VARCHAR(100) NOT NULL,
  fingerprint VARCHAR(32) NOT NULL,
  
  title TEXT NOT NULL,
  expr TEXT NOT NULL,
  
  left_value DOUBLE PRECISION,
  right_value DOUBLE PRECISION,
  delta DOUBLE PRECISION,
  tolerance DOUBLE PRECISION NOT NULL DEFAULT 0,
  auto_status VARCHAR(30) NOT NULL CHECK(auto_status IN ('PASS', 'FAIL', 'UNCERTAIN', 'NOT_ASSESSABLE')),
  
  evidence_json JSONB NOT NULL,
  
  human_status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK(human_status IN ('pending', 'confirmed', 'dismissed')),
  human_comment TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE(report_version_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_consistency_items_run 
  ON report_consistency_items(run_id);

CREATE INDEX IF NOT EXISTS idx_consistency_items_version 
  ON report_consistency_items(report_version_id);

CREATE INDEX IF NOT EXISTS idx_consistency_items_group 
  ON report_consistency_items(group_key);

CREATE INDEX IF NOT EXISTS idx_consistency_items_status 
  ON report_consistency_items(auto_status, human_status);

CREATE INDEX IF NOT EXISTS idx_consistency_items_fingerprint 
  ON report_consistency_items(fingerprint);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL DEFAULT 'upload_complete',
  title VARCHAR(255) NOT NULL,
  content_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  related_job_id BIGINT REFERENCES jobs(id),
  related_version_id BIGINT REFERENCES report_versions(id),
  created_by BIGINT
);


CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
  id BIGSERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(100),
  permissions TEXT DEFAULT '{}',
  data_scope TEXT DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS raw_text TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS active_version_id BIGINT REFERENCES report_versions(id);
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS parent_version_id BIGINT REFERENCES report_versions(id);
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS version_type TEXT NOT NULL DEFAULT 'original_parse';
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS change_reason TEXT;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS changed_fields_summary TEXT;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'parsed';
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS ingestion_batch_id BIGINT REFERENCES ingestion_batches(id);
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS export_title TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS batch_id TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ingestion_batch_id BIGINT REFERENCES ingestion_batches(id);

ALTER TABLE report_consistency_items DROP CONSTRAINT IF EXISTS report_consistency_items_group_key_check;
ALTER TABLE report_consistency_items
  ADD CONSTRAINT report_consistency_items_group_key_check
  CHECK (group_key IN ('table2', 'table3', 'table4', 'text', 'visual', 'structure', 'quality'));

ALTER TABLE regions ADD COLUMN IF NOT EXISTS sort_order INTEGER;
ALTER TABLE comparisons ADD COLUMN IF NOT EXISTS similarity INTEGER;
ALTER TABLE comparisons ADD COLUMN IF NOT EXISTS check_status VARCHAR(50);
`;

// ============================================================================
// MIGRATION RUNNER
// ============================================================================

/**
 * Run SQLite migrations by reading .sql files from migrations/sqlite/ directory.
 * This ensures the executed SQL matches the static scan in scan_sqlite_migrations.js.
 */
async function runSqliteMigrationsFromFiles(): Promise<void> {
  // Path relative to compiled dist/db/migrations-llm.js -> ../../migrations/sqlite
  const migrationsDir = path.join(__dirname, '..', '..', 'migrations', 'sqlite');

  if (!fs.existsSync(migrationsDir)) {
    throw new Error('[SQLite Migration Error] migrations/sqlite directory not found: ' + migrationsDir);
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Sorted order: 001_, 002_, etc.

  console.log('[SQLite Migrations] Found ' + files.length + ' migration files in ' + migrationsDir);

  ensureSchemaMigrationsTable();

  const appliedCount = getAppliedMigrationCount();
  if (appliedCount === 0 && hasReportsTable()) {
    console.log('[SQLite Migrations] schema_migrations empty but reports table exists; seeding records only.');
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      recordMigration(file, checksum);
    }
    console.log('[SQLite Migrations] schema_migrations seeded for existing database.');
    return;
  }

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    const checksum = crypto.createHash('sha256').update(sql).digest('hex');

    const applied = getAppliedMigration(file);
    if (applied) {
      if (applied.checksum && applied.checksum !== checksum) {
        throw new Error(
          '[SQLite Migration Error] Migration file changed after apply: ' + file + '\n' +
          'Expected checksum: ' + applied.checksum + '\n' +
          'Actual checksum: ' + checksum + '\n' +
          'Fix: revert the file or create a new migration.'
        );
      }
      console.log('[SQLite Migrations] Skipping already applied: ' + file);
      continue;
    }

    // Runtime validation: reject PG keywords
    validateNoForbiddenKeywords(sql, file);

    // Execute the entire file using querySqlite (handles multi-statement SQL correctly)
    try {
      querySqlite(sql);
      recordMigration(file, checksum);
      console.log('[SQLite Migrations] Applied: ' + file);
    } catch (err: any) {
      const errMsg = (err.message || '') + (err.stderr || '');
      throw new Error('[SQLite Migration Error] Failed in ' + file + ': ' + errMsg);
    }
  }
}

export async function runLLMMigrations(): Promise<void> {
  try {
    if (dbType === 'sqlite') {
      // SQLite: MUST use file-based migrations from migrations/sqlite/*.sql
      // This ensures runtime matches static scan (scan_sqlite_migrations.js)
      console.log('[SQLite Migrations] Running file-based migrations...');
      await runSqliteMigrationsFromFiles();
      console.log('✓ SQLite LLM migrations completed (file-based)');
    } else {
      // PostgreSQL 迁移 (embedded schema is fine for PG)
      const statements = postgresSchema.split(';').filter(s => s.trim());
      for (const statement of statements) {
        if (statement.trim()) {
          await pool.query(statement);
        }
      }
      console.log('✓ PostgreSQL LLM migrations completed');
    }
  } catch (error) {
    console.error('LLM migrations failed:', error);
    throw error;
  }
}
