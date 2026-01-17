-- Derived metrics tables for Data Center dashboard
CREATE TABLE IF NOT EXISTS derived_unit_year_metrics (
  report_id INTEGER PRIMARY KEY,
  region_id INTEGER,
  unit_name TEXT,
  year INTEGER NOT NULL,
  version_id INTEGER,
  active_version_id INTEGER,
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_derived_unit_year ON derived_unit_year_metrics(region_id, year);

CREATE TABLE IF NOT EXISTS derived_region_year_metrics (
  region_id INTEGER NOT NULL,
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
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (region_id, year)
);

CREATE INDEX IF NOT EXISTS idx_derived_region_year ON derived_region_year_metrics(region_id, year);

-- metric_dictionary entries for derived metrics
INSERT INTO metric_dictionary (
  metric_key,
  version,
  display_name,
  description,
  unit,
  aggregatable,
  source_table,
  source_column,
  caveats
)
SELECT 'quality_issue_count_total', 1, 'Quality issues total', 'Total number of quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_total', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'quality_issue_count_total' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key, version, display_name, description, unit, aggregatable, source_table, source_column, caveats
)
SELECT 'quality_issue_count_high', 1, 'Quality issues high', 'High severity quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_high', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'quality_issue_count_high' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key, version, display_name, description, unit, aggregatable, source_table, source_column, caveats
)
SELECT 'quality_issue_count_medium', 1, 'Quality issues medium', 'Medium severity quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_medium', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'quality_issue_count_medium' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key, version, display_name, description, unit, aggregatable, source_table, source_column, caveats
)
SELECT 'quality_issue_count_low', 1, 'Quality issues low', 'Low severity quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_low', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'quality_issue_count_low' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key, version, display_name, description, unit, aggregatable, source_table, source_column, caveats
)
SELECT 'application_total', 1, 'Applications received', 'Total new applications received (response_type=new_received)', 'count', TRUE, 'derived', 'application_total', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'application_total' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key, version, display_name, description, unit, aggregatable, source_table, source_column, caveats
)
SELECT 'legal_total', 1, 'Legal proceedings total', 'Total legal review + litigation cases (result_type=total)', 'count', TRUE, 'derived', 'legal_total', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'legal_total' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key, version, display_name, description, unit, aggregatable, source_table, source_column, caveats
)
SELECT 'materialize_succeeded', 1, 'Materialize succeeded', 'Materialize job succeeded (1) per unit/year', 'count', TRUE, 'derived', 'materialize_succeeded', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'materialize_succeeded' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key, version, display_name, description, unit, aggregatable, source_table, source_column, caveats
)
SELECT 'active_report_count', 1, 'Active report count', 'Reports with active_version per unit/year', 'count', TRUE, 'derived', 'active_report_count', NULL
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'active_report_count' AND deprecated_at IS NULL);

INSERT INTO metric_dictionary (
  metric_key, version, display_name, description, unit, aggregatable, source_table, source_column, caveats
)
SELECT 'derived_risk_score', 1, 'Derived risk score', 'Risk score = high*3 + medium*2 + low*1 + missing_fact_tables*1 + materialize_failed*2', 'score', TRUE, 'derived', 'derived_risk_score', 'missing_fact_tables counts any fact table with zero rows; materialize_failed applies when latest materialize job not in done/succeeded/success'
WHERE NOT EXISTS (SELECT 1 FROM metric_dictionary WHERE metric_key = 'derived_risk_score' AND deprecated_at IS NULL);
