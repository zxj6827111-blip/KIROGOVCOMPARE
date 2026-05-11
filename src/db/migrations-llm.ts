import pool from '../config/database-llm';

// ============================================================================
// POSTGRESQL SCHEMA
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_region_year ON reports(region_id, year);

CREATE TABLE IF NOT EXISTS users (
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
  completed_at TIMESTAMPTZ,
  stats_refreshed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_batch_created ON ingestion_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_batch_status ON ingestion_batches(status);
ALTER TABLE ingestion_batches ADD COLUMN IF NOT EXISTS stats_refreshed_at TIMESTAMPTZ;

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
  review_status VARCHAR(30) NOT NULL DEFAULT 'published',
  approved_at TIMESTAMPTZ,
  approved_by BIGINT,
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(region_id, year_a, year_b)
);

ALTER TABLE comparisons
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

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

CREATE TABLE IF NOT EXISTS parse_runs (
  id BIGSERIAL PRIMARY KEY,
  report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL,
  fingerprint VARCHAR(64) NOT NULL,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt_version VARCHAR(50) NOT NULL,
  parser_version VARCHAR(50) NOT NULL,
  source_extractor_version VARCHAR(50) NOT NULL,
  schema_version VARCHAR(50) NOT NULL,
  stabilize_mode VARCHAR(20) NOT NULL,
  rule_gate_enabled BOOLEAN NOT NULL,
  source_gate_strategy VARCHAR(20) NOT NULL DEFAULT 'standard',
  source_gate_uncertain_threshold INTEGER NOT NULL DEFAULT 10,
  source_gate_high_confidence_blocking BOOLEAN NOT NULL DEFAULT TRUE,
  source_gate_warning_threshold INTEGER NOT NULL DEFAULT 5,
  config_json JSONB NOT NULL,
  status VARCHAR(30) NOT NULL CHECK (status IN (
    'created',
    'running',
    'accepted',
    'superseded',
    'failed',
    'gate_failed',
    'finalize_failed'
  )),
  intended_final_status VARCHAR(30) CHECK (
    intended_final_status IS NULL
    OR intended_final_status IN ('accepted', 'failed', 'gate_failed')
  ),
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  superseded_by BIGINT REFERENCES parse_runs(id) ON DELETE SET NULL,
  superseded_at TIMESTAMPTZ,
  restored_from BIGINT REFERENCES parse_runs(id) ON DELETE SET NULL,
  restored_at TIMESTAMPTZ,
  draft_output_json JSONB,
  draft_repairs_json JSONB,
  draft_gate_result_json JSONB,
  draft_consensus_result_json JSONB,
  draft_source_snapshots_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  output_json JSONB,
  repairs_json JSONB,
  gate_result_json JSONB,
  consensus_result_json JSONB,
  error_code VARCHAR(50),
  error_message TEXT,
  retry_of BIGINT REFERENCES parse_runs(id) ON DELETE SET NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT chk_parse_runs_current_must_be_accepted
    CHECK (is_current = FALSE OR (status = 'accepted' AND output_json IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_parse_runs_version_current
  ON parse_runs(report_version_id)
  WHERE is_current = TRUE;

CREATE INDEX IF NOT EXISTS idx_parse_runs_version_fingerprint
  ON parse_runs(report_version_id, fingerprint);
CREATE INDEX IF NOT EXISTS idx_parse_runs_superseded_by
  ON parse_runs(superseded_by) WHERE superseded_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parse_runs_restored_from
  ON parse_runs(restored_from) WHERE restored_from IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parse_runs_created ON parse_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parse_runs_status ON parse_runs(status);
CREATE INDEX IF NOT EXISTS idx_parse_runs_job ON parse_runs(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parse_runs_version ON parse_runs(report_version_id);
CREATE INDEX IF NOT EXISTS idx_parse_runs_is_current ON parse_runs(is_current) WHERE is_current = TRUE;

CREATE TABLE IF NOT EXISTS source_snapshots (
  id BIGSERIAL PRIMARY KEY,
  parse_run_id BIGINT REFERENCES parse_runs(id) ON DELETE CASCADE,
  report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  source_type VARCHAR(30) NOT NULL,
  source_path TEXT,
  page_number INTEGER,
  table_index INTEGER,
  table_id VARCHAR(50),
  row_index INTEGER,
  col_index INTEGER,
  row_span INTEGER NOT NULL DEFAULT 1,
  col_span INTEGER NOT NULL DEFAULT 1,
  row_header TEXT,
  col_header TEXT,
  cell_text TEXT,
  normalized_text TEXT,
  bbox_json JSONB,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_snapshots_parse_run
  ON source_snapshots(parse_run_id) WHERE parse_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_source_snapshots_version
  ON source_snapshots(report_version_id);
CREATE INDEX IF NOT EXISTS idx_source_snapshots_table
  ON source_snapshots(report_version_id, table_id, row_index, col_index);

CREATE TABLE IF NOT EXISTS source_gate_results (
  id BIGSERIAL PRIMARY KEY,
  parse_run_id BIGINT NOT NULL REFERENCES parse_runs(id) ON DELETE CASCADE,
  report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  gate_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  strategy VARCHAR(20) NOT NULL DEFAULT 'standard',
  status VARCHAR(30) NOT NULL CHECK (status IN ('passed', 'warning', 'blocked', 'not_assessable')),
  uncertain_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  blocker_count INTEGER NOT NULL DEFAULT 0,
  result_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_source_gate_results_parse_run
  ON source_gate_results(parse_run_id);
CREATE INDEX IF NOT EXISTS idx_source_gate_results_version
  ON source_gate_results(report_version_id);
CREATE INDEX IF NOT EXISTS idx_source_gate_results_status
  ON source_gate_results(status);

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
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS review_status VARCHAR(30) NOT NULL DEFAULT 'published';
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS approved_by BIGINT REFERENCES admin_users(id);
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS ingestion_batch_id BIGINT REFERENCES ingestion_batches(id);
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS check_total INTEGER;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS check_visual INTEGER;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS check_structure INTEGER;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS check_quality INTEGER;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS checks_updated_at TIMESTAMPTZ;
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

-- ---------------------------------------------------------------------------
-- Consistency triggers: keep active_version_id and is_active aligned
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION enforce_active_version_belongs()
RETURNS trigger AS $$
BEGIN
  IF NEW.active_version_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM report_versions rv
      WHERE rv.id = NEW.active_version_id
        AND rv.report_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'active_version_id % does not belong to report %', NEW.active_version_id, NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reports_active_version_check ON reports;
CREATE TRIGGER trg_reports_active_version_check
BEFORE UPDATE OF active_version_id ON reports
FOR EACH ROW
EXECUTE FUNCTION enforce_active_version_belongs();

CREATE OR REPLACE FUNCTION sync_report_versions_active()
RETURNS trigger AS $$
BEGIN
  -- Avoid transient unique-index conflicts on uq_report_versions_active by
  -- clearing active flags first, then enabling the target version.
  UPDATE report_versions
  SET is_active = false
  WHERE report_id = NEW.id;

  IF NEW.active_version_id IS NOT NULL THEN
    UPDATE report_versions
    SET is_active = true
    WHERE id = NEW.active_version_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_reports_sync_active ON reports;
CREATE TRIGGER trg_reports_sync_active
AFTER UPDATE OF active_version_id ON reports
FOR EACH ROW
EXECUTE FUNCTION sync_report_versions_active();

-- Data Center Phase 1 tables (Postgres)
CREATE TABLE IF NOT EXISTS metric_dictionary (
  id BIGSERIAL PRIMARY KEY,
  metric_key VARCHAR(255) NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  unit VARCHAR(50),
  aggregatable BOOLEAN DEFAULT TRUE,
  formula_sql_or_expr TEXT,
  source_table VARCHAR(32) NOT NULL CHECK (source_table IN ('facts', 'derived')),
  source_column VARCHAR(255),
  dims_supported TEXT,
  drilldown_source VARCHAR(32) DEFAULT NULL CHECK (drilldown_source IS NULL OR drilldown_source = 'cells'),
  caveats TEXT,
  interpretation_template TEXT,
  effective_from TIMESTAMPTZ,
  deprecated_at TIMESTAMPTZ,
  superseded_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(metric_key, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_metric_dict_active_unique
  ON metric_dictionary(metric_key)
  WHERE deprecated_at IS NULL;

CREATE TABLE IF NOT EXISTS cells (
  id BIGSERIAL PRIMARY KEY,
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
  id BIGSERIAL PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_fact_active_disclosure_report_version ON fact_active_disclosure(report_id, version_id);
CREATE INDEX IF NOT EXISTS idx_fact_active_disclosure_version ON fact_active_disclosure(version_id);

CREATE TABLE IF NOT EXISTS fact_application (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id),
  version_id BIGINT NOT NULL REFERENCES report_versions(id),
  applicant_type TEXT NOT NULL,
  response_type TEXT NOT NULL,
  count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fact_application_report_version ON fact_application(report_id, version_id);
CREATE INDEX IF NOT EXISTS idx_fact_application_version ON fact_application(version_id);

CREATE TABLE IF NOT EXISTS fact_legal_proceeding (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id),
  version_id BIGINT NOT NULL REFERENCES report_versions(id),
  case_type TEXT NOT NULL,
  result_type TEXT NOT NULL,
  count INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fact_legal_proceeding_report_version ON fact_legal_proceeding(report_id, version_id);
CREATE INDEX IF NOT EXISTS idx_fact_legal_proceeding_version ON fact_legal_proceeding(version_id);

CREATE TABLE IF NOT EXISTS quality_issues (
  id BIGSERIAL PRIMARY KEY,
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

CREATE TABLE IF NOT EXISTS derived_unit_year_metrics (
  report_id BIGINT PRIMARY KEY REFERENCES reports(id),
  region_id BIGINT,
  unit_name TEXT,
  year INTEGER NOT NULL,
  version_id BIGINT,
  active_version_id BIGINT,
  report_count INTEGER NOT NULL DEFAULT 0,
  active_report_count INTEGER NOT NULL DEFAULT 0,
  materialize_succeeded INTEGER NOT NULL DEFAULT 0,
  quality_issue_count_total INTEGER NOT NULL DEFAULT 0,
  quality_issue_count_high INTEGER NOT NULL DEFAULT 0,
  quality_issue_count_medium INTEGER NOT NULL DEFAULT 0,
  quality_issue_count_low INTEGER NOT NULL DEFAULT 0,
  application_total INTEGER NOT NULL DEFAULT 0,
  legal_total INTEGER NOT NULL DEFAULT 0,
  derived_risk_score INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_derived_unit_year ON derived_unit_year_metrics(region_id, year);

CREATE TABLE IF NOT EXISTS derived_region_year_metrics (
  region_id BIGINT NOT NULL,
  year INTEGER NOT NULL,
  report_count INTEGER NOT NULL DEFAULT 0,
  active_report_count INTEGER NOT NULL DEFAULT 0,
  materialize_succeeded INTEGER NOT NULL DEFAULT 0,
  quality_issue_count_total INTEGER NOT NULL DEFAULT 0,
  quality_issue_count_high INTEGER NOT NULL DEFAULT 0,
  quality_issue_count_medium INTEGER NOT NULL DEFAULT 0,
  quality_issue_count_low INTEGER NOT NULL DEFAULT 0,
  application_total INTEGER NOT NULL DEFAULT 0,
  legal_total INTEGER NOT NULL DEFAULT 0,
  derived_risk_avg REAL NOT NULL DEFAULT 0,
  derived_risk_max INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (region_id, year)
);

CREATE INDEX IF NOT EXISTS idx_derived_region_year ON derived_region_year_metrics(region_id, year);

CREATE TABLE IF NOT EXISTS ai_decision_reports (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT, 
  org_name VARCHAR(255),
  year INTEGER NOT NULL,
  content_json JSONB NOT NULL,
  model_used VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(region_id, year)
);

CREATE INDEX IF NOT EXISTS idx_ai_reports_region_year ON ai_decision_reports(region_id, year);

CREATE TABLE IF NOT EXISTS gov_insight_report_jobs (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL,
  org_id VARCHAR(100) NOT NULL,
  org_name VARCHAR(255) NOT NULL,
  year INTEGER NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  step_code VARCHAR(50) NOT NULL DEFAULT 'QUEUED',
  step_name VARCHAR(255) NOT NULL DEFAULT '等待处理',
  model VARCHAR(100) NOT NULL,
  prompt_text TEXT NOT NULL,
  system_instruction TEXT,
  request_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(50),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 1,
  created_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_gov_insight_report_jobs_region_year
  ON gov_insight_report_jobs(region_id, year, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_insight_report_jobs_status
  ON gov_insight_report_jobs(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gov_insight_report_jobs_active
  ON gov_insight_report_jobs(region_id, year)
  WHERE status IN ('queued', 'running');

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
  ('active_disclosure_total', 1, 'Active disclosure total', 'Total active disclosure items', 'count', TRUE, 'facts', 'made_count', 'cells', NULL),
  ('active_disclosure_valid', 1, 'Active disclosure valid', 'Valid active disclosure items', 'count', TRUE, 'facts', 'valid_count', 'cells', NULL),
  ('application_received_total', 1, 'Applications received', 'Total new applications received', 'count', TRUE, 'facts', 'count', 'cells', NULL),
  ('application_carried_over', 1, 'Applications carried over', 'Applications carried over from prior year', 'count', TRUE, 'facts', 'count', 'cells', NULL),
  ('application_granted', 1, 'Applications granted', 'Applications granted', 'count', TRUE, 'facts', 'count', 'cells', NULL),
  ('application_partial_grant', 1, 'Applications partially granted', 'Applications partially granted', 'count', TRUE, 'facts', 'count', 'cells', NULL),
  ('application_denied_total', 1, 'Applications denied', 'Applications denied total', 'count', TRUE, 'facts', 'count', 'cells', NULL),
  ('application_total_processed', 1, 'Applications processed', 'Total applications processed', 'count', TRUE, 'facts', 'count', 'cells', NULL),
  ('legal_review_total', 1, 'Legal review total', 'Total legal review cases', 'count', TRUE, 'facts', 'count', 'cells', NULL),
  ('legal_litigation_total', 1, 'Legal litigation total', 'Total legal litigation cases', 'count', TRUE, 'facts', 'count', 'cells', NULL),
  ('quality_issue_count_total', 1, 'Quality issues total', 'Total number of quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_total', NULL, NULL),
  ('quality_issue_count_high', 1, 'Quality issues high', 'High severity quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_high', NULL, NULL),
  ('quality_issue_count_medium', 1, 'Quality issues medium', 'Medium severity quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_medium', NULL, NULL),
  ('quality_issue_count_low', 1, 'Quality issues low', 'Low severity quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_low', NULL, NULL),
  ('application_total', 1, 'Applications received', 'Total new applications received (response_type=new_received)', 'count', TRUE, 'derived', 'application_total', NULL, NULL),
  ('legal_total', 1, 'Legal proceedings total', 'Total legal review + litigation cases (result_type=total)', 'count', TRUE, 'derived', 'legal_total', NULL, NULL),
  ('materialize_succeeded', 1, 'Materialize succeeded', 'Materialize job succeeded (1) per unit/year', 'count', TRUE, 'derived', 'materialize_succeeded', NULL, NULL),
  ('active_report_count', 1, 'Active report count', 'Reports with active_version per unit/year', 'count', TRUE, 'derived', 'active_report_count', NULL, NULL),
  ('derived_risk_score', 1, 'Derived risk score', 'Risk score = high*3 + medium*2 + low*1 + missing_fact_tables*1 + materialize_failed*2', 'score', TRUE, 'derived', 'derived_risk_score', NULL, 'missing_fact_tables counts any fact table with zero rows, materialize_failed applies when latest materialize job not in done/succeeded/success')
ON CONFLICT DO NOTHING;

-- GovInsight MATERIALIZED VIEW: gov_open_annual_stats
-- 政务公开智慧治理大屏数据聚合视图
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='gov_open_annual_stats' AND relkind='m')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='action_force')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='fees_amount')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='outcome_not_open_state_secret')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='outcome_not_open_law_forbidden')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='outcome_not_open_enforcement')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='outcome_complaint')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='outcome_publication')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='outcome_massive')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='outcome_confirm')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='outcome_overdue_correction')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='outcome_overdue_fee')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='gov_open_annual_stats' AND column_name='outcome_other_reasons') THEN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname='gov_open_annual_stats' AND relkind='m') THEN
      DROP MATERIALIZED VIEW gov_open_annual_stats;
    ELSIF EXISTS (SELECT 1 FROM pg_class WHERE relname='gov_open_annual_stats' AND relkind='v') THEN
      DROP VIEW gov_open_annual_stats;
    END IF;
    CREATE MATERIALIZED VIEW gov_open_annual_stats AS
 WITH RECURSIVE base AS (
         SELECT r.id AS report_id,
            reg.id AS region_id,
            reg.name AS org_name,
            reg.level,
            reg.parent_id,
            parent_1.level AS parent_level,
            r.year,
            r.active_version_id AS version_id
           FROM ((regions reg
             LEFT JOIN regions parent_1 ON ((parent_1.id = reg.parent_id)))
             LEFT JOIN reports r ON (((r.region_id = reg.id) AND (r.active_version_id IS NOT NULL))))
        ), active_disclosure_pivot AS (
         SELECT fad.report_id,
            fad.version_id,
            sum(
                CASE
                    WHEN (fad.category = 'regulations') THEN fad.made_count
                    ELSE 0
                END) AS reg_published,
            sum(
                CASE
                    WHEN (fad.category = 'regulations') THEN fad.valid_count
                    ELSE 0
                END) AS reg_active,
            sum(
                CASE
                    WHEN (fad.category = 'regulations') THEN fad.repealed_count
                    ELSE 0
                END) AS reg_abolished,
            sum(
                CASE
                    WHEN (fad.category = 'normative_documents') THEN fad.made_count
                    ELSE 0
                END) AS doc_published,
            sum(
                CASE
                    WHEN (fad.category = 'normative_documents') THEN fad.valid_count
                    ELSE 0
                END) AS doc_active,
            sum(
                CASE
                    WHEN (fad.category = 'normative_documents') THEN fad.repealed_count
                    ELSE 0
                END) AS doc_abolished,
            sum(
                CASE
                    WHEN (fad.category = 'licensing') THEN COALESCE(fad.processed_count, 0)
                    ELSE 0
                END) AS action_licensing,
            sum(
                CASE
                    WHEN (fad.category = 'punishment') THEN COALESCE(fad.processed_count, 0)
                    ELSE 0
                END) AS action_punishment,
            sum(
                CASE
                    WHEN (fad.category = 'coercion') THEN COALESCE(fad.processed_count, 0)
                    ELSE 0
                END) AS action_force,
            sum(
                CASE
                    WHEN (fad.category = 'fees') THEN COALESCE(fad.amount, 0)
                    ELSE 0
                END) AS fees_amount
           FROM fact_active_disclosure fad
          GROUP BY fad.report_id, fad.version_id
        ), application_pivot AS (
         SELECT fa.report_id,
            fa.version_id,
            sum(CASE WHEN fa.response_type = 'new_received' THEN fa.count ELSE 0 END) AS app_new,
            sum(CASE WHEN fa.response_type = 'carried_over' THEN fa.count ELSE 0 END) AS app_carried_over,
            sum(CASE WHEN fa.applicant_type = 'natural_person' AND fa.response_type = 'new_received' THEN fa.count ELSE 0 END) AS source_natural,
            sum(CASE WHEN fa.response_type IN ('granted', 'public') THEN fa.count ELSE 0 END) AS outcome_public,
            sum(CASE WHEN fa.response_type IN ('partial_grant', 'partial') THEN fa.count ELSE 0 END) AS outcome_partial,
            sum(CASE WHEN fa.response_type IN ('unable_to_provide', 'unable', 'unable_no_info', 'unable_need_creation', 'unable_unclear') THEN fa.count ELSE 0 END) AS outcome_unable,
            sum(CASE WHEN fa.response_type = 'unable_no_info' THEN fa.count ELSE 0 END) AS outcome_unable_no_info,
            sum(CASE WHEN fa.response_type = 'unable_need_creation' THEN fa.count ELSE 0 END) AS outcome_unable_need_creation,
            sum(CASE WHEN fa.response_type = 'unable_unclear' THEN fa.count ELSE 0 END) AS outcome_unable_unclear,
            sum(CASE WHEN fa.response_type IN ('denied', 'not_open', 'denied_law_forbidden', 'denied_state_secret', 'not_open_danger', 'denied_safety_stability', 'not_open_process', 'denied_process_info', 'not_open_internal', 'denied_internal_affairs', 'not_open_third_party', 'denied_third_party_rights', 'denied_enforcement_case', 'not_open_admin_query', 'denied_admin_query') THEN fa.count ELSE 0 END) AS outcome_not_open,
            sum(CASE WHEN fa.response_type = 'denied_state_secret' THEN fa.count ELSE 0 END) AS outcome_not_open_state_secret,
            sum(CASE WHEN fa.response_type = 'denied_law_forbidden' THEN fa.count ELSE 0 END) AS outcome_not_open_law_forbidden,
            sum(CASE WHEN fa.response_type IN ('not_open_danger', 'denied_safety_stability') THEN fa.count ELSE 0 END) AS outcome_not_open_danger,
            sum(CASE WHEN fa.response_type IN ('not_open_process', 'denied_process_info') THEN fa.count ELSE 0 END) AS outcome_not_open_process,
            sum(CASE WHEN fa.response_type IN ('not_open_internal', 'denied_internal_affairs') THEN fa.count ELSE 0 END) AS outcome_not_open_internal,
            sum(CASE WHEN fa.response_type IN ('not_open_third_party', 'denied_third_party_rights') THEN fa.count ELSE 0 END) AS outcome_not_open_third_party,
            sum(CASE WHEN fa.response_type = 'denied_enforcement_case' THEN fa.count ELSE 0 END) AS outcome_not_open_enforcement,
            sum(CASE WHEN fa.response_type IN ('not_open_admin_query', 'denied_admin_query') THEN fa.count ELSE 0 END) AS outcome_not_open_admin_query,
            sum(CASE WHEN fa.response_type IN ('ignored', 'not_processed_complaint', 'not_processed_confirm_info', 'ignore_repeat', 'not_processed_repeat', 'not_processed_publication', 'not_processed_massive_requests') THEN fa.count ELSE 0 END) AS outcome_ignore,
            sum(CASE WHEN fa.response_type = 'not_processed_complaint' THEN fa.count ELSE 0 END) AS outcome_complaint,
            sum(CASE WHEN fa.response_type IN ('ignore_repeat', 'not_processed_repeat') THEN fa.count ELSE 0 END) AS outcome_ignore_repeat,
            sum(CASE WHEN fa.response_type = 'not_processed_publication' THEN fa.count ELSE 0 END) AS outcome_publication,
            sum(CASE WHEN fa.response_type = 'not_processed_massive_requests' THEN fa.count ELSE 0 END) AS outcome_massive,
            sum(CASE WHEN fa.response_type = 'not_processed_confirm_info' THEN fa.count ELSE 0 END) AS outcome_confirm,
            sum(CASE WHEN fa.response_type IN ('other', 'outcome_other', 'other_other_reasons', 'other_overdue_correction', 'other_overdue_fee') THEN fa.count ELSE 0 END) AS outcome_other,
            sum(CASE WHEN fa.response_type = 'other_overdue_correction' THEN fa.count ELSE 0 END) AS outcome_overdue_correction,
            sum(CASE WHEN fa.response_type = 'other_overdue_fee' THEN fa.count ELSE 0 END) AS outcome_overdue_fee,
            sum(CASE WHEN fa.response_type IN ('outcome_other', 'other_other_reasons') THEN fa.count ELSE 0 END) AS outcome_other_reasons,
            sum(CASE WHEN fa.response_type = 'carried_forward' THEN fa.count ELSE 0 END) AS app_carried_forward
           FROM fact_application fa
          WHERE fa.applicant_type <> 'total'
          GROUP BY fa.report_id, fa.version_id
        ), legal_pivot AS (
         SELECT flp.report_id,
            flp.version_id,
            sum(CASE WHEN (flp.case_type = 'review' AND flp.result_type = 'total') THEN flp.count ELSE 0 END) AS rev_total,
            sum(CASE WHEN (flp.case_type = 'review' AND flp.result_type = 'correct') THEN flp.count ELSE 0 END) AS rev_corrected,
            sum(CASE WHEN (flp.case_type IN ('litigation_direct', 'litigation_post_review') AND flp.result_type = 'total') THEN flp.count ELSE 0 END) AS lit_total,
            sum(CASE WHEN (flp.case_type IN ('litigation_direct', 'litigation_post_review') AND flp.result_type = 'correct') THEN flp.count ELSE 0 END) AS lit_corrected
           FROM fact_legal_proceeding flp
          GROUP BY flp.report_id, flp.version_id
        )
 SELECT concat('report_', b.report_id) AS id,
    b.year,
        CASE
            WHEN (b.level <= 2) THEN concat('city_', b.region_id)
            ELSE concat('district_', b.region_id)
        END AS org_id,
    b.org_name,
        CASE
            WHEN (b.level <= 2) THEN 'city'
            ELSE 'district'
        END AS org_type,
        CASE
            WHEN (b.parent_id IS NULL) THEN NULL
            WHEN (parent.level <= 2) THEN concat('city_', b.parent_id)
            ELSE concat('district_', b.parent_id)
        END AS parent_id,
    COALESCE(ad.reg_published, (0)) AS reg_published,
    COALESCE(ad.reg_active, (0)) AS reg_active,
    COALESCE(ad.reg_abolished, (0)) AS reg_abolished,
    COALESCE(ad.doc_published, (0)) AS doc_published,
    COALESCE(ad.doc_active, (0)) AS doc_active,
    COALESCE(ad.doc_abolished, (0)) AS doc_abolished,
    COALESCE(ad.action_licensing, (0)) AS action_licensing,
    COALESCE(ad.action_punishment, (0)) AS action_punishment,
    COALESCE(ad.action_force, (0)) AS action_force,
    COALESCE(ad.fees_amount, (0)) AS fees_amount,
    COALESCE(ap.app_new, (0)) AS app_new,
    COALESCE(ap.app_carried_over, (0)) AS app_carried_over,
    COALESCE(ap.source_natural, (0)) AS source_natural,
    COALESCE(ap.outcome_public, (0)) AS outcome_public,
    COALESCE(ap.outcome_partial, (0)) AS outcome_partial,
    COALESCE(ap.outcome_unable, (0)) AS outcome_unable,
    COALESCE(ap.outcome_unable_no_info, (0)) AS outcome_unable_no_info,
    COALESCE(ap.outcome_unable_need_creation, (0)) AS outcome_unable_need_creation,
    COALESCE(ap.outcome_unable_unclear, (0)) AS outcome_unable_unclear,
    COALESCE(ap.outcome_not_open, (0)) AS outcome_not_open,
    COALESCE(ap.outcome_not_open_state_secret, (0)) AS outcome_not_open_state_secret,
    COALESCE(ap.outcome_not_open_law_forbidden, (0)) AS outcome_not_open_law_forbidden,
    COALESCE(ap.outcome_not_open_danger, (0)) AS outcome_not_open_danger,
    COALESCE(ap.outcome_not_open_process, (0)) AS outcome_not_open_process,
    COALESCE(ap.outcome_not_open_internal, (0)) AS outcome_not_open_internal,
    COALESCE(ap.outcome_not_open_third_party, (0)) AS outcome_not_open_third_party,
    COALESCE(ap.outcome_not_open_enforcement, (0)) AS outcome_not_open_enforcement,
    COALESCE(ap.outcome_not_open_admin_query, (0)) AS outcome_not_open_admin_query,
    COALESCE(ap.outcome_ignore, (0)) AS outcome_ignore,
    COALESCE(ap.outcome_complaint, (0)) AS outcome_complaint,
    COALESCE(ap.outcome_ignore_repeat, (0)) AS outcome_ignore_repeat,
    COALESCE(ap.outcome_publication, (0)) AS outcome_publication,
    COALESCE(ap.outcome_massive, (0)) AS outcome_massive,
    COALESCE(ap.outcome_confirm, (0)) AS outcome_confirm,
    COALESCE(ap.outcome_other, (0)) AS outcome_other,
    COALESCE(ap.outcome_overdue_correction, (0)) AS outcome_overdue_correction,
    COALESCE(ap.outcome_overdue_fee, (0)) AS outcome_overdue_fee,
    COALESCE(ap.outcome_other_reasons, (0)) AS outcome_other_reasons,
    COALESCE(ap.app_carried_forward, (0)) AS app_carried_forward,
    COALESCE(lp.rev_total, (0)) AS rev_total,
    COALESCE(lp.rev_corrected, (0)) AS rev_corrected,
    COALESCE(lp.lit_total, (0)) AS lit_total,
    COALESCE(lp.lit_corrected, (0)) AS lit_corrected
   FROM ((((base b
     LEFT JOIN regions parent ON ((parent.id = b.parent_id)))
     LEFT JOIN active_disclosure_pivot ad ON (((ad.report_id = b.report_id) AND (ad.version_id = b.version_id))))
     LEFT JOIN application_pivot ap ON (((ap.report_id = b.report_id) AND (ap.version_id = b.version_id))))
     LEFT JOIN legal_pivot lp ON (((lp.report_id = b.report_id) AND (lp.version_id = b.version_id))));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_gov_open_annual_stats_year
  ON gov_open_annual_stats(year);
CREATE INDEX IF NOT EXISTS idx_gov_open_annual_stats_year_org_name
  ON gov_open_annual_stats(year, org_name);
CREATE INDEX IF NOT EXISTS idx_gov_open_annual_stats_org_id
  ON gov_open_annual_stats(org_id);
CREATE INDEX IF NOT EXISTS idx_gov_open_annual_stats_parent_id
  ON gov_open_annual_stats(parent_id);
`;

export async function runLLMMigrations(): Promise<void> {
  // Use Postgres pool
  try {
    await pool.query(postgresSchema);
    console.log('[Postgres Migrations] Schema ensured.');

    // ------------------------------------------------------------------------
    // Report uniqueness hardening: one report per (region_id, year)
    // ------------------------------------------------------------------------
    try {
      await pool.query(`ALTER TABLE reports DROP CONSTRAINT IF EXISTS reports_region_id_year_unit_name_key;`);
    } catch (dropError: any) {
      console.error('[Migrations] Failed to drop legacy reports unique constraint:', dropError?.message || dropError);
    }

    try {
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_reports_region_year
        ON reports(region_id, year);
      `);
    } catch (uniqueIndexError: any) {
      console.error(
        '[Migrations] Failed to create uq_reports_region_year index. Resolve duplicate reports and rerun fix:merge-duplicates.',
        uniqueIndexError?.message || uniqueIndexError
      );
    }

    // ============================================================================
    // DATA INTEGRITY REPAIR
    // ============================================================================

    // 1. Fix missing/invalid active_version_id.
    // Prefer versions that already have fact rows; then parsed_json-rich versions;
    // finally fall back to latest version so active_version_id is not unnecessarily nulled out.
    const repairRes = await pool.query(`
      UPDATE reports r
      SET active_version_id = (
        SELECT rv.id
        FROM report_versions rv
        WHERE rv.report_id = r.id
        ORDER BY
          CASE
            WHEN (
              EXISTS (SELECT 1 FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = rv.id)
              OR EXISTS (SELECT 1 FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = rv.id)
              OR EXISTS (SELECT 1 FROM fact_legal_proceeding flp WHERE flp.report_id = r.id AND flp.version_id = rv.id)
            ) THEN 0
            WHEN rv.parsed_json IS NOT NULL AND length(rv.parsed_json::text) > 100 THEN 1
            WHEN rv.parsed_json IS NOT NULL AND rv.parsed_json::text NOT IN ('{}', 'null', '\"\"') THEN 2
            ELSE 3
          END ASC,
          rv.created_at DESC,
          rv.id DESC
        LIMIT 1
      )
      WHERE 
        EXISTS (
          SELECT 1
          FROM report_versions rv2
          WHERE rv2.report_id = r.id
        )
        AND (
          r.active_version_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM report_versions cur
            WHERE cur.id = r.active_version_id
              AND cur.report_id = r.id
          )
          OR
          EXISTS (
          SELECT 1 FROM report_versions cur 
          WHERE cur.id = r.active_version_id 
            AND cur.report_id = r.id
            AND (cur.parsed_json IS NULL OR cur.parsed_json::text IN ('{}', 'null', '\"\"'))
        )
          OR EXISTS (
            SELECT 1
            FROM report_versions cur
            WHERE cur.id = r.active_version_id
              AND cur.report_id = r.id
              AND NOT (
                EXISTS (SELECT 1 FROM fact_active_disclosure fad WHERE fad.report_id = r.id AND fad.version_id = cur.id)
                OR EXISTS (SELECT 1 FROM fact_application fa WHERE fa.report_id = r.id AND fa.version_id = cur.id)
                OR EXISTS (SELECT 1 FROM fact_legal_proceeding flp WHERE flp.report_id = r.id AND flp.version_id = cur.id)
              )
              AND EXISTS (
                SELECT 1
                FROM report_versions rvx
                WHERE rvx.report_id = r.id
                  AND (
                    EXISTS (SELECT 1 FROM fact_active_disclosure fadx WHERE fadx.report_id = r.id AND fadx.version_id = rvx.id)
                    OR EXISTS (SELECT 1 FROM fact_application fax WHERE fax.report_id = r.id AND fax.version_id = rvx.id)
                    OR EXISTS (SELECT 1 FROM fact_legal_proceeding flpx WHERE flpx.report_id = r.id AND flpx.version_id = rvx.id)
                  )
              )
          )
      );
    `);

    if ((repairRes.rowCount ?? 0) > 0) {
      console.log(`[Migrations] Fixed data integrity for ${repairRes.rowCount} reports (active version aligned)`);
    }

    // ------------------------------------------------------------------------
    // Parsing lifecycle foundation (v5.2): idempotent hardening for existing DBs.
    // ------------------------------------------------------------------------
    await pool.query(`
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS report_version_id BIGINT;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS job_id BIGINT;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS fingerprint VARCHAR(64);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS provider VARCHAR(50);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS model VARCHAR(100);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS prompt_version VARCHAR(50);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS parser_version VARCHAR(50);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS source_extractor_version VARCHAR(50);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS schema_version VARCHAR(50);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS stabilize_mode VARCHAR(20);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS rule_gate_enabled BOOLEAN;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS source_gate_strategy VARCHAR(20) DEFAULT 'standard';
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS source_gate_uncertain_threshold INTEGER DEFAULT 10;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS source_gate_high_confidence_blocking BOOLEAN DEFAULT TRUE;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS source_gate_warning_threshold INTEGER DEFAULT 5;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS config_json JSONB;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS status VARCHAR(30);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS intended_final_status VARCHAR(30);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT FALSE;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS superseded_by BIGINT;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS restored_from BIGINT;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS draft_output_json JSONB;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS draft_repairs_json JSONB;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS draft_gate_result_json JSONB;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS draft_consensus_result_json JSONB;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS draft_source_snapshots_json JSONB;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS output_json JSONB;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS repairs_json JSONB;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS gate_result_json JSONB;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS consensus_result_json JSONB;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS error_code VARCHAR(50);
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS error_message TEXT;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS retry_of BIGINT;
      ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS attempt INTEGER DEFAULT 1;

      UPDATE parse_runs
      SET source_gate_strategy = COALESCE(source_gate_strategy, 'standard'),
          source_gate_uncertain_threshold = COALESCE(source_gate_uncertain_threshold, 10),
          source_gate_high_confidence_blocking = COALESCE(source_gate_high_confidence_blocking, TRUE),
          source_gate_warning_threshold = COALESCE(source_gate_warning_threshold, 5),
          is_current = COALESCE(is_current, FALSE),
          created_at = COALESCE(created_at, NOW()),
          attempt = COALESCE(attempt, 1);

      UPDATE parse_runs
      SET intended_final_status = status
      WHERE intended_final_status IS NULL
        AND status IN ('accepted', 'failed', 'gate_failed');
    `);

    await pool.query(`
      DO $$
      BEGIN
        ALTER TABLE parse_runs
          ADD CONSTRAINT fk_parse_runs_report_version
          FOREIGN KEY (report_version_id) REFERENCES report_versions(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$
      BEGIN
        ALTER TABLE parse_runs
          ADD CONSTRAINT fk_parse_runs_job
          FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$
      BEGIN
        ALTER TABLE parse_runs
          ADD CONSTRAINT fk_parse_runs_superseded_by
          FOREIGN KEY (superseded_by) REFERENCES parse_runs(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$
      BEGIN
        ALTER TABLE parse_runs
          ADD CONSTRAINT fk_parse_runs_restored_from
          FOREIGN KEY (restored_from) REFERENCES parse_runs(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      DO $$
      BEGIN
        ALTER TABLE parse_runs
          ADD CONSTRAINT fk_parse_runs_retry_of
          FOREIGN KEY (retry_of) REFERENCES parse_runs(id) ON DELETE SET NULL;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;

      ALTER TABLE parse_runs DROP CONSTRAINT IF EXISTS parse_runs_status_check;
      ALTER TABLE parse_runs ADD CONSTRAINT parse_runs_status_check
        CHECK (status IN ('created', 'running', 'accepted', 'superseded', 'failed', 'gate_failed', 'finalize_failed'));

      ALTER TABLE parse_runs DROP CONSTRAINT IF EXISTS parse_runs_intended_final_status_check;
      ALTER TABLE parse_runs ADD CONSTRAINT parse_runs_intended_final_status_check
        CHECK (intended_final_status IS NULL OR intended_final_status IN ('accepted', 'failed', 'gate_failed'));

      ALTER TABLE parse_runs DROP CONSTRAINT IF EXISTS chk_parse_runs_current_must_be_accepted;
      ALTER TABLE parse_runs ADD CONSTRAINT chk_parse_runs_current_must_be_accepted
        CHECK (is_current = FALSE OR (status = 'accepted' AND output_json IS NOT NULL));

      DROP INDEX IF EXISTS uq_parse_runs_version_fingerprint_accepted;
      DROP INDEX IF EXISTS uq_parse_runs_version_fingerprint_history;

      CREATE UNIQUE INDEX IF NOT EXISTS uq_parse_runs_version_current
        ON parse_runs(report_version_id) WHERE is_current = TRUE;
      CREATE INDEX IF NOT EXISTS idx_parse_runs_version_fingerprint
        ON parse_runs(report_version_id, fingerprint);
      CREATE INDEX IF NOT EXISTS idx_parse_runs_superseded_by
        ON parse_runs(superseded_by) WHERE superseded_by IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_parse_runs_restored_from
        ON parse_runs(restored_from) WHERE restored_from IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_parse_runs_created ON parse_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_parse_runs_status ON parse_runs(status);
      CREATE INDEX IF NOT EXISTS idx_parse_runs_job ON parse_runs(job_id) WHERE job_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_parse_runs_version ON parse_runs(report_version_id);
      CREATE INDEX IF NOT EXISTS idx_parse_runs_is_current ON parse_runs(is_current) WHERE is_current = TRUE;
    `);

    // 2. Sync is_active to match reports.active_version_id (best-effort)
    await pool.query(`
      UPDATE report_versions rv
      SET is_active = (rv.id = r.active_version_id)
      FROM reports r
      WHERE rv.report_id = r.id
        AND r.active_version_id IS NOT NULL;
    `);

    await pool.query(`
      UPDATE report_versions rv
      SET is_active = false
      WHERE rv.report_id IN (SELECT id FROM reports WHERE active_version_id IS NULL);
    `);

    // 2.5. Normalize review workflow status so only the current published version
    // is treated as formal production data; older versions remain historical.
    await pool.query(`
      UPDATE report_versions rv
      SET review_status = CASE
            WHEN EXISTS (
              SELECT 1
              FROM reports r
              WHERE r.active_version_id = rv.id
            ) OR rv.is_active = true THEN 'published'
            ELSE 'history'
          END,
          approved_at = CASE
            WHEN EXISTS (
              SELECT 1
              FROM reports r
              WHERE r.active_version_id = rv.id
            ) OR rv.is_active = true
              THEN COALESCE(rv.approved_at, rv.updated_at, rv.created_at, NOW())
            ELSE rv.approved_at
          END
      WHERE rv.review_status IS NULL
         OR rv.review_status NOT IN ('pending_review', 'published', 'history');
    `);

    // 3. Create unique active version index (after normalization)
    try {
      await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_report_versions_active
        ON report_versions(report_id)
        WHERE is_active = true;
      `);
    } catch (indexError: any) {
      console.error('[Migrations] Failed to create uq_report_versions_active index:', indexError?.message || indexError);
    }

    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_report_versions_review_status
        ON report_versions(report_id, review_status, created_at DESC);
      `);
    } catch (indexError: any) {
      console.error('[Migrations] Failed to create idx_report_versions_review_status:', indexError?.message || indexError);
    }

  } catch (error: any) {
    console.error('Failed to run Postgres schema migrations:', error);
    throw error;
  }
}
