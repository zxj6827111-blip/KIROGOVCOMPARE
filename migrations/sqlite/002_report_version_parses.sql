-- Store LLM parse outputs separately per report version
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS report_version_parses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_version_id INTEGER NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  output_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
