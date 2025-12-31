-- Migration: Support multiple units per region/year
-- Changes the UNIQUE constraint from (region_id, year) to (region_id, year, unit_name)

PRAGMA foreign_keys = OFF;

-- Step 1: Create new table with corrected schema
CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  unit_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(region_id, year, unit_name)
);

-- Step 2: Copy existing data from old table
INSERT INTO reports_new (id, region_id, year, unit_name, created_at, updated_at)
SELECT id, region_id, year, unit_name, created_at, updated_at FROM reports;

-- Step 3: Drop old table
DROP TABLE reports;

-- Step 4: Rename new table to reports
ALTER TABLE reports_new RENAME TO reports;

-- Step 5: Recreate index
CREATE INDEX IF NOT EXISTS idx_reports_region_year ON reports(region_id, year);

PRAGMA foreign_keys = ON;
