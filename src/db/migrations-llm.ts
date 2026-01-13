import fs from 'fs';
import path from 'path';
import pool, { dbType } from '../config/database-llm';
import { dbNowExpression } from '../config/db-llm';

const sqliteSchema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  province TEXT,
  parent_id INTEGER REFERENCES regions(id) ON DELETE CASCADE,
  level INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER,
  created_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
  updated_at TEXT NOT NULL DEFAULT (${dbNowExpression()})
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  unit_name TEXT NOT NULL DEFAULT '',
  active_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
  updated_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
  UNIQUE(region_id, year, unit_name)
);

CREATE INDEX IF NOT EXISTS idx_reports_region_year ON reports(region_id, year);

CREATE TABLE IF NOT EXISTS ingestion_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uuid TEXT NOT NULL UNIQUE,
  created_by INTEGER,
  created_at TEXT DEFAULT (${dbNowExpression()}),
  source TEXT DEFAULT 'upload',
  note TEXT,
  report_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  fail_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'processing',
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_batch_created ON ingestion_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_status ON ingestion_batches(status);

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
  parent_version_id INTEGER REFERENCES report_versions(id),
  version_type TEXT NOT NULL DEFAULT 'original_parse',
  change_reason TEXT,
  changed_fields_summary TEXT,
  state TEXT NOT NULL DEFAULT 'parsed',
  created_by INTEGER,
  ingestion_batch_id INTEGER REFERENCES ingestion_batches(id),
  created_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
  updated_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
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
  similarity INTEGER,
  check_status TEXT,
  created_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
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
  created_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
  started_at TEXT,
  finished_at TEXT,
  comparison_id INTEGER REFERENCES comparisons(id) ON DELETE SET NULL,
  export_title TEXT,
  file_name TEXT,
  file_path TEXT,
  file_size INTEGER,
  batch_id TEXT,
  created_by INTEGER,
  ingestion_batch_id INTEGER REFERENCES ingestion_batches(id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_report ON jobs(report_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_comparison ON jobs(comparison_id);

CREATE TABLE IF NOT EXISTS metric_dictionary (
  id SERIAL PRIMARY KEY,
  metric_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,
  description TEXT,
  unit TEXT DEFAULT '件',
  aggregatable BOOLEAN DEFAULT TRUE,
  formula_sql_or_expr TEXT,
  source_table TEXT NOT NULL CHECK (source_table IN ('facts', 'derived')),
  source_column TEXT,
  dims_supported TEXT,
  drilldown_source TEXT DEFAULT NULL CHECK (drilldown_source IS NULL OR drilldown_source = 'cells'),
  caveats TEXT,
  interpretation_template TEXT,
  effective_from DATE,
  deprecated_at TIMESTAMPTZ,
  superseded_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(metric_key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_metric_dict_active_unique
  ON metric_dictionary(metric_key)
  WHERE deprecated_at IS NULL;

CREATE TABLE IF NOT EXISTS cells (
  id SERIAL PRIMARY KEY,
  version_id BIGINT NOT NULL REFERENCES report_versions(id),
  table_id TEXT NOT NULL,
  row_key TEXT NOT NULL,
  col_key TEXT NOT NULL,
  cell_ref TEXT NOT NULL,
  value_raw TEXT,
  value_num NUMERIC,
  value_semantic TEXT NOT NULL DEFAULT 'TEXT' CHECK (value_semantic IN ('ZERO', 'EMPTY', 'NA', 'TEXT', 'NUMERIC')),
  normalized_value TEXT,
  page_number INTEGER,
  bbox_json TEXT,
  confidence REAL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(version_id, cell_ref)
);

CREATE INDEX IF NOT EXISTS idx_cells_version ON cells(version_id);
CREATE INDEX IF NOT EXISTS idx_cells_table ON cells(version_id, table_id);

CREATE TABLE IF NOT EXISTS fact_active_disclosure (
  id SERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id),
  version_id BIGINT NOT NULL REFERENCES report_versions(id),
  category TEXT NOT NULL,
  made_count INTEGER,
  repealed_count INTEGER,
  valid_count INTEGER,
  processed_count INTEGER,
  amount NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fact_active_disclosure_version ON fact_active_disclosure(version_id);

CREATE TABLE IF NOT EXISTS fact_application (
  id SERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id),
  version_id BIGINT NOT NULL REFERENCES report_versions(id),
  applicant_type TEXT NOT NULL,
  response_type TEXT NOT NULL,
  count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fact_application_version ON fact_application(version_id);

CREATE TABLE IF NOT EXISTS fact_legal_proceeding (
  id SERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id),
  version_id BIGINT NOT NULL REFERENCES report_versions(id),
  case_type TEXT NOT NULL,
  result_type TEXT NOT NULL,
  count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fact_legal_proceeding_version ON fact_legal_proceeding(version_id);

CREATE TABLE IF NOT EXISTS quality_issues (
  id SERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id),
  version_id BIGINT NOT NULL REFERENCES report_versions(id),
  rule_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  cell_ref TEXT,
  auto_status TEXT NOT NULL DEFAULT 'open',
  human_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_issues_version ON quality_issues(version_id);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
) VALUES
  ('active_disclosure_total', 1, '主动公开总数', '主动公开信息总量', '件', TRUE, 'facts', 'made_count', 'cells', '部分地区将规章与规范性文件合并'),
  ('active_disclosure_valid', 1, '现行有效件数', '现行有效规章与规范性文件', '件', TRUE, 'facts', 'valid_count', 'cells', NULL),
  ('application_received_total', 1, '依申请收到总数', '依申请新收合计', '件', TRUE, 'facts', 'count', 'cells', '注意区分本年新收与上年结转'),
  ('application_carried_over', 1, '依申请上年结转', '上年结转数量', '件', TRUE, 'facts', 'count', 'cells', NULL),
  ('application_granted', 1, '予以公开数量', '依申请办理结果-予以公开', '件', TRUE, 'facts', 'count', 'cells', NULL),
  ('application_partial_grant', 1, '部分公开数量', '依申请办理结果-部分公开', '件', TRUE, 'facts', 'count', 'cells', NULL),
  ('application_denied_total', 1, '不予公开数量', '依申请办理结果-不予公开合计', '件', TRUE, 'facts', 'count', 'cells', '含国家秘密/法律禁止等原因'),
  ('application_total_processed', 1, '依申请办理总数', '依申请办理结果总计', '件', TRUE, 'facts', 'count', 'cells', NULL),
  ('legal_review_total', 1, '行政复议总数', '行政复议案件总计', '件', TRUE, 'facts', 'count', 'cells', NULL),
  ('legal_litigation_total', 1, '行政诉讼总数', '行政诉讼案件总计', '件', TRUE, 'facts', 'count', 'cells', NULL)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS metric_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,
  description TEXT,
  unit TEXT DEFAULT '件',
  aggregatable INTEGER DEFAULT 1,
  formula_sql_or_expr TEXT,
  source_table TEXT NOT NULL CHECK (source_table IN ('facts', 'derived')),
  source_column TEXT,
  dims_supported TEXT,
  drilldown_source TEXT DEFAULT NULL CHECK (drilldown_source IS NULL OR drilldown_source = 'cells'),
  caveats TEXT,
  interpretation_template TEXT,
  effective_from TEXT,
  deprecated_at TEXT,
  superseded_by TEXT,
  created_at TEXT DEFAULT (${dbNowExpression()}),
  updated_at TEXT DEFAULT (${dbNowExpression()}),
  UNIQUE(metric_key, version)
);

CREATE TRIGGER IF NOT EXISTS trg_metric_dict_single_active
BEFORE INSERT ON metric_dictionary
FOR EACH ROW
WHEN NEW.deprecated_at IS NULL
BEGIN
  SELECT RAISE(ABORT, 'metric_key already has an active version')
  WHERE EXISTS (
    SELECT 1 FROM metric_dictionary
    WHERE metric_key = NEW.metric_key AND deprecated_at IS NULL
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_metric_dict_single_active_update
BEFORE UPDATE ON metric_dictionary
FOR EACH ROW
WHEN NEW.deprecated_at IS NULL AND OLD.deprecated_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'metric_key already has an active version')
  WHERE EXISTS (
    SELECT 1 FROM metric_dictionary
    WHERE metric_key = NEW.metric_key AND deprecated_at IS NULL AND id != NEW.id
  );
END;

CREATE TABLE IF NOT EXISTS cells (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES report_versions(id),
  table_id TEXT NOT NULL,
  row_key TEXT NOT NULL,
  col_key TEXT NOT NULL,
  cell_ref TEXT NOT NULL,
  value_raw TEXT,
  value_num REAL,
  value_semantic TEXT NOT NULL DEFAULT 'TEXT' CHECK (value_semantic IN ('ZERO', 'EMPTY', 'NA', 'TEXT', 'NUMERIC')),
  normalized_value TEXT,
  page_number INTEGER,
  bbox_json TEXT,
  confidence REAL,
  created_at TEXT DEFAULT (${dbNowExpression()}),
  UNIQUE(version_id, cell_ref)
);

CREATE INDEX IF NOT EXISTS idx_cells_version ON cells(version_id);
CREATE INDEX IF NOT EXISTS idx_cells_table ON cells(version_id, table_id);

CREATE TABLE IF NOT EXISTS fact_active_disclosure (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  version_id INTEGER NOT NULL REFERENCES report_versions(id),
  category TEXT NOT NULL,
  made_count INTEGER,
  repealed_count INTEGER,
  valid_count INTEGER,
  processed_count INTEGER,
  amount REAL,
  created_at TEXT DEFAULT (${dbNowExpression()})
);

CREATE INDEX IF NOT EXISTS idx_fact_active_disclosure_version ON fact_active_disclosure(version_id);

CREATE TABLE IF NOT EXISTS fact_application (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  version_id INTEGER NOT NULL REFERENCES report_versions(id),
  applicant_type TEXT NOT NULL,
  response_type TEXT NOT NULL,
  count INTEGER,
  created_at TEXT DEFAULT (${dbNowExpression()})
);

CREATE INDEX IF NOT EXISTS idx_fact_application_version ON fact_application(version_id);

CREATE TABLE IF NOT EXISTS fact_legal_proceeding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  version_id INTEGER NOT NULL REFERENCES report_versions(id),
  case_type TEXT NOT NULL,
  result_type TEXT NOT NULL,
  count INTEGER,
  created_at TEXT DEFAULT (${dbNowExpression()})
);

CREATE INDEX IF NOT EXISTS idx_fact_legal_proceeding_version ON fact_legal_proceeding(version_id);

CREATE TABLE IF NOT EXISTS quality_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  version_id INTEGER NOT NULL REFERENCES report_versions(id),
  rule_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  cell_ref TEXT,
  auto_status TEXT NOT NULL DEFAULT 'open',
  human_status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (${dbNowExpression()}),
  updated_at TEXT DEFAULT (${dbNowExpression()})
);

CREATE INDEX IF NOT EXISTS idx_quality_issues_version ON quality_issues(version_id);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
)
SELECT 'active_disclosure_total', 1, '主动公开总数', '主动公开信息总量', '件', 1, 'facts', 'made_count', 'cells', '部分地区将规章与规范性文件合并'
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'active_disclosure_total' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
)
SELECT 'active_disclosure_valid', 1, '现行有效件数', '现行有效规章与规范性文件', '件', 1, 'facts', 'valid_count', 'cells', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'active_disclosure_valid' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
)
SELECT 'application_received_total', 1, '依申请收到总数', '依申请新收合计', '件', 1, 'facts', 'count', 'cells', '注意区分本年新收与上年结转'
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'application_received_total' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
)
SELECT 'application_carried_over', 1, '依申请上年结转', '上年结转数量', '件', 1, 'facts', 'count', 'cells', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'application_carried_over' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
)
SELECT 'application_granted', 1, '予以公开数量', '依申请办理结果-予以公开', '件', 1, 'facts', 'count', 'cells', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'application_granted' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
)
SELECT 'application_partial_grant', 1, '部分公开数量', '依申请办理结果-部分公开', '件', 1, 'facts', 'count', 'cells', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'application_partial_grant' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
)
SELECT 'application_denied_total', 1, '不予公开数量', '依申请办理结果-不予公开合计', '件', 1, 'facts', 'count', 'cells', '含国家秘密/法律禁止等原因'
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'application_denied_total' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
)
SELECT 'application_total_processed', 1, '依申请办理总数', '依申请办理结果总计', '件', 1, 'facts', 'count', 'cells', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'application_total_processed' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
)
SELECT 'legal_review_total', 1, '行政复议总数', '行政复议案件总计', '件', 1, 'facts', 'count', 'cells', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'legal_review_total' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  drilldown_source,
  caveats
)
SELECT 'legal_litigation_total', 1, '行政诉讼总数', '行政诉讼案件总计', '件', 1, 'facts', 'count', 'cells', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'legal_litigation_total' AND deprecated_at IS NULL);

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
  created_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
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
  
  created_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
  updated_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
  
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
  created_at TEXT NOT NULL DEFAULT (${dbNowExpression()}),
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
