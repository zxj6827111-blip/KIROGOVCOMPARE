-- Comparison support for LLM ingestion (SQLite)
PRAGMA foreign_keys = ON;

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
