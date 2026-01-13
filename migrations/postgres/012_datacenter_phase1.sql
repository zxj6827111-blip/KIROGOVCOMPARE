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

ALTER TABLE reports ADD COLUMN IF NOT EXISTS active_version_id BIGINT REFERENCES report_versions(id);

ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS parent_version_id BIGINT REFERENCES report_versions(id);
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS version_type TEXT NOT NULL DEFAULT 'original_parse';
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS change_reason TEXT;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS changed_fields_summary TEXT;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT 'parsed';
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS created_by BIGINT;
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS ingestion_batch_id BIGINT REFERENCES ingestion_batches(id);
ALTER TABLE report_versions ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS ingestion_batch_id BIGINT REFERENCES ingestion_batches(id);

UPDATE reports r
SET active_version_id = rv.id
FROM (
  SELECT report_id, id,
         ROW_NUMBER() OVER (PARTITION BY report_id ORDER BY created_at DESC) AS rn
  FROM report_versions
  WHERE is_active = TRUE
) rv
WHERE r.active_version_id IS NULL AND rv.report_id = r.id AND rv.rn = 1;

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
