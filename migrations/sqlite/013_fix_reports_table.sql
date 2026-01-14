PRAGMA foreign_keys = OFF;

-- Restore reports table if a previous migration left reports_new behind.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  unit_name TEXT NOT NULL DEFAULT '',
  active_version_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(region_id, year, unit_name)
);

-- Create a placeholder reports_new for safe copy if it is missing.
CREATE TABLE IF NOT EXISTS reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  unit_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(region_id, year, unit_name)
);

INSERT OR IGNORE INTO reports (id, region_id, year, unit_name, created_at, updated_at)
SELECT id, region_id, year, unit_name, created_at, updated_at FROM reports_new;

DROP TABLE IF EXISTS reports_new;

CREATE INDEX IF NOT EXISTS idx_reports_region_year_unit ON reports(region_id, year, unit_name);
CREATE INDEX IF NOT EXISTS idx_reports_region_year ON reports(region_id, year);

PRAGMA foreign_keys = ON;
