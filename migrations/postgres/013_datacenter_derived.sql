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
) VALUES
  ('quality_issue_count_total', 1, 'Quality issues total', 'Total number of quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_total', NULL),
  ('quality_issue_count_high', 1, 'Quality issues high', 'High severity quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_high', NULL),
  ('quality_issue_count_medium', 1, 'Quality issues medium', 'Medium severity quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_medium', NULL),
  ('quality_issue_count_low', 1, 'Quality issues low', 'Low severity quality issues per unit/year', 'count', TRUE, 'derived', 'quality_issue_count_low', NULL),
  ('application_total', 1, 'Applications received', 'Total new applications received (response_type=new_received)', 'count', TRUE, 'derived', 'application_total', NULL),
  ('legal_total', 1, 'Legal proceedings total', 'Total legal review + litigation cases (result_type=total)', 'count', TRUE, 'derived', 'legal_total', NULL),
  ('materialize_succeeded', 1, 'Materialize succeeded', 'Materialize job succeeded (1) per unit/year', 'count', TRUE, 'derived', 'materialize_succeeded', NULL),
  ('active_report_count', 1, 'Active report count', 'Reports with active_version per unit/year', 'count', TRUE, 'derived', 'active_report_count', NULL),
  ('derived_risk_score', 1, 'Derived risk score', 'Risk score = high*3 + medium*2 + low*1 + missing_fact_tables*1 + materialize_failed*2', 'score', TRUE, 'derived', 'derived_risk_score', 'missing_fact_tables counts any fact table with zero rows; materialize_failed applies when latest materialize job not in done/succeeded/success')
ON CONFLICT DO NOTHING;
