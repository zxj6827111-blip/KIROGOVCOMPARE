PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS metric_dictionary;

CREATE TABLE metric_dictionary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  metric_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  display_name TEXT NOT NULL,
  description TEXT,
  unit TEXT,
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

CREATE TRIGGER trg_metric_dict_single_active
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

CREATE TRIGGER trg_metric_dict_single_active_update
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

INSERT INTO metric_dictionary
  (metric_key, version, display_name, description, unit, aggregatable, source_table, source_column, drilldown_source, caveats)
VALUES
  ('active_disclosure_total', 1, 'Active disclosure total', 'Total active disclosure items', 'count', 1, 'facts', 'made_count', 'cells', NULL),
  ('active_disclosure_valid', 1, 'Active disclosure valid', 'Valid active disclosure items', 'count', 1, 'facts', 'valid_count', 'cells', NULL),
  ('application_received_total', 1, 'Applications received', 'Total new applications received', 'count', 1, 'facts', 'count', 'cells', NULL),
  ('application_carried_over', 1, 'Applications carried over', 'Applications carried over from prior year', 'count', 1, 'facts', 'count', 'cells', NULL),
  ('application_granted', 1, 'Applications granted', 'Applications granted', 'count', 1, 'facts', 'count', 'cells', NULL),
  ('application_partial_grant', 1, 'Applications partially granted', 'Applications partially granted', 'count', 1, 'facts', 'count', 'cells', NULL),
  ('application_denied_total', 1, 'Applications denied', 'Applications denied total', 'count', 1, 'facts', 'count', 'cells', NULL),
  ('application_total_processed', 1, 'Applications processed', 'Total applications processed', 'count', 1, 'facts', 'count', 'cells', NULL),
  ('legal_review_total', 1, 'Legal review total', 'Total legal review cases', 'count', 1, 'facts', 'count', 'cells', NULL),
  ('legal_litigation_total', 1, 'Legal litigation total', 'Total legal litigation cases', 'count', 1, 'facts', 'count', 'cells', NULL);

PRAGMA foreign_keys = ON;
