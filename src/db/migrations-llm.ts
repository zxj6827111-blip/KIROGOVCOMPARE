import fs from 'fs';
import path from 'path';
import pool, { dbType } from '../config/database-llm';

const sqliteSchema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  province TEXT,
  parent_id INTEGER REFERENCES regions(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  unit_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(region_id, year, unit_name)
);

CREATE INDEX IF NOT EXISTS idx_reports_region_year ON reports(region_id, year);

CREATE TABLE IF NOT EXISTS report_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size INTEGER,
  storage_path TEXT NOT NULL,
  text_path TEXT,
  raw_text TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  parsed_json TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(report_id, file_hash)
);

CREATE INDEX IF NOT EXISTS idx_report_versions_report_active
ON report_versions(report_id, is_active);

CREATE TABLE IF NOT EXISTS comparisons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  year_a INTEGER NOT NULL,
  year_b INTEGER NOT NULL,
  left_report_id INTEGER NOT NULL REFERENCES reports(id),
  right_report_id INTEGER NOT NULL REFERENCES reports(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(region_id, year_a, year_b)
);

CREATE TABLE IF NOT EXISTS comparison_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comparison_id INTEGER NOT NULL UNIQUE REFERENCES comparisons(id) ON DELETE CASCADE,
  diff_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version_id INTEGER REFERENCES report_versions(id),
  kind TEXT NOT NULL DEFAULT 'parse',
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  step_code TEXT DEFAULT 'QUEUED',
  step_name TEXT DEFAULT '等待处理',
  attempt INTEGER DEFAULT 1,
  provider TEXT,
  model TEXT,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT,
  comparison_id INTEGER REFERENCES comparisons(id) ON DELETE SET NULL,
  export_title TEXT,
  file_name TEXT,
  file_path TEXT,
  file_size INTEGER,
  batch_id TEXT,
  created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_jobs_report ON jobs(report_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_comparison ON jobs(comparison_id);

CREATE TABLE IF NOT EXISTS report_version_parses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_version_id INTEGER NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  output_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Consistency check runs table
CREATE TABLE IF NOT EXISTS report_consistency_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_version_id INTEGER NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('queued', 'running', 'succeeded', 'failed')),
  engine_version TEXT NOT NULL DEFAULT 'v1',
  summary_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_consistency_runs_version 
  ON report_consistency_runs(report_version_id);

CREATE INDEX IF NOT EXISTS idx_consistency_runs_status 
  ON report_consistency_runs(status);

-- Consistency check items table
CREATE TABLE IF NOT EXISTS report_consistency_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES report_consistency_runs(id) ON DELETE CASCADE,
  report_version_id INTEGER NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  
  group_key TEXT NOT NULL CHECK(group_key IN ('table2', 'table3', 'table4', 'text', 'visual', 'structure', 'quality')),
  check_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  
  title TEXT NOT NULL,
  expr TEXT NOT NULL,
  
  left_value REAL,
  right_value REAL,
  delta REAL,
  tolerance REAL NOT NULL DEFAULT 0,
  auto_status TEXT NOT NULL CHECK(auto_status IN ('PASS', 'FAIL', 'UNCERTAIN', 'NOT_ASSESSABLE')),
  
  evidence_json TEXT NOT NULL,
  
  human_status TEXT NOT NULL DEFAULT 'pending' CHECK(human_status IN ('pending', 'confirmed', 'dismissed')),
  human_comment TEXT,
  
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  
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
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'upload_complete',
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  related_job_id INTEGER REFERENCES jobs(id),
  related_version_id INTEGER REFERENCES report_versions(id),
  created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
`;

const postgresSchema = `
CREATE TABLE IF NOT EXISTS regions (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  province VARCHAR(255),
  parent_id BIGINT REFERENCES regions(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  unit_name VARCHAR(255) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(region_id, year, unit_name)
);

CREATE INDEX IF NOT EXISTS idx_reports_region_year ON reports(region_id, year);

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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  created_by BIGINT
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
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS export_title TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS file_name TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS batch_id TEXT;

ALTER TABLE report_consistency_items DROP CONSTRAINT IF EXISTS report_consistency_items_group_key_check;
ALTER TABLE report_consistency_items
  ADD CONSTRAINT report_consistency_items_group_key_check
  CHECK (group_key IN ('table2', 'table3', 'table4', 'text', 'visual', 'structure', 'quality'));
`;

export async function runLLMMigrations(): Promise<void> {
  try {
    if (dbType === 'sqlite') {
      // SQLite 迁移
      const statements = sqliteSchema.split(';').filter(s => s.trim());
      for (const statement of statements) {
        if (statement.trim()) {
          await new Promise((resolve, reject) => {
            pool.run(statement, (err: any) => {
              if (err) reject(err);
              else resolve(null);
            });
          });
        }
      }
      console.log('✓ SQLite LLM migrations completed');
    } else {
      // PostgreSQL 迁移
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
