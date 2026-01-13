PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS ingestion_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_uuid TEXT NOT NULL UNIQUE,
  created_by INTEGER,
  created_at TEXT DEFAULT (datetime('now')),
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

ALTER TABLE reports ADD COLUMN active_version_id INTEGER;

ALTER TABLE report_versions ADD COLUMN parent_version_id INTEGER;
ALTER TABLE report_versions ADD COLUMN version_type TEXT NOT NULL DEFAULT 'original_parse';
ALTER TABLE report_versions ADD COLUMN change_reason TEXT;
ALTER TABLE report_versions ADD COLUMN changed_fields_summary TEXT;
ALTER TABLE report_versions ADD COLUMN state TEXT NOT NULL DEFAULT 'parsed';
ALTER TABLE report_versions ADD COLUMN created_by INTEGER;
ALTER TABLE report_versions ADD COLUMN ingestion_batch_id INTEGER;
ALTER TABLE report_versions ADD COLUMN updated_at TEXT DEFAULT (datetime('now'));

ALTER TABLE jobs ADD COLUMN ingestion_batch_id INTEGER;

UPDATE reports
SET active_version_id = (
  SELECT id
  FROM report_versions rv
  WHERE rv.report_id = reports.id AND rv.is_active = 1
  ORDER BY rv.created_at DESC
  LIMIT 1
)
WHERE active_version_id IS NULL;

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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
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
  created_at TEXT DEFAULT (datetime('now')),
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
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fact_active_disclosure_version ON fact_active_disclosure(version_id);

CREATE TABLE IF NOT EXISTS fact_application (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  version_id INTEGER NOT NULL REFERENCES report_versions(id),
  applicant_type TEXT NOT NULL,
  response_type TEXT NOT NULL,
  count INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fact_application_version ON fact_application(version_id);

CREATE TABLE IF NOT EXISTS fact_legal_proceeding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id),
  version_id INTEGER NOT NULL REFERENCES report_versions(id),
  case_type TEXT NOT NULL,
  result_type TEXT NOT NULL,
  count INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
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
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
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
