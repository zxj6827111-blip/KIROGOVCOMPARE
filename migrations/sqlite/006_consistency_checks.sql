-- Consistency checks tables for report version validation

-- Consistency check runs table
CREATE TABLE IF NOT EXISTS report_consistency_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_version_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'running', -- running, succeeded, failed
  engine_version TEXT NOT NULL DEFAULT 'v1',
  summary_json TEXT, -- JSON: { fail, uncertain, pending, confirmed, dismissed }
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME,
  FOREIGN KEY (report_version_id) REFERENCES report_versions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_consistency_runs_version 
  ON report_consistency_runs(report_version_id);

CREATE INDEX IF NOT EXISTS idx_consistency_runs_status 
  ON report_consistency_runs(status);

-- Consistency check items table
CREATE TABLE IF NOT EXISTS report_consistency_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  report_version_id INTEGER NOT NULL,
  group_key TEXT NOT NULL, -- 'table2', 'table3', 'table4', 'text'
  check_key TEXT NOT NULL, -- stable identifier like 't3_identity_balance', 't4_sum_total'
  title TEXT NOT NULL, -- human-readable title
  expr TEXT NOT NULL, -- formula string
  left_value REAL,
  right_value REAL,
  delta REAL,
  tolerance REAL NOT NULL DEFAULT 0,
  auto_status TEXT NOT NULL, -- PASS, FAIL, UNCERTAIN, NOT_ASSESSABLE
  evidence_json TEXT NOT NULL, -- JSON array of paths and values used
  fingerprint TEXT NOT NULL, -- stable fingerprint for upsert
  human_status TEXT NOT NULL DEFAULT 'pending', -- pending, confirmed, dismissed
  human_comment TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES report_consistency_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (report_version_id) REFERENCES report_versions(id) ON DELETE CASCADE,
  UNIQUE(report_version_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_consistency_items_run 
  ON report_consistency_items(run_id);

CREATE INDEX IF NOT EXISTS idx_consistency_items_version 
  ON report_consistency_items(report_version_id);

CREATE INDEX IF NOT EXISTS idx_consistency_items_group 
  ON report_consistency_items(group_key);

CREATE INDEX IF NOT EXISTS idx_consistency_items_auto_status 
  ON report_consistency_items(auto_status);

CREATE INDEX IF NOT EXISTS idx_consistency_items_human_status 
  ON report_consistency_items(human_status);
