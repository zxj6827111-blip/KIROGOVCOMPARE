-- Migration 008: Async Jobs Schema
-- 1. Clean up unit_name (NULL → '')
-- 2. Extend jobs table with step tracking and retry fields
-- 3. Create notifications table for task center messaging

PRAGMA foreign_keys = OFF;

-- ============================================================
-- Part 1: Clean up unit_name data
-- ============================================================
UPDATE reports SET unit_name = '' WHERE unit_name IS NULL;
UPDATE reports SET unit_name = TRIM(unit_name);

-- Verify no duplicates (this should return 0 rows)
-- SELECT region_id, year, unit_name, COUNT(*) AS cnt
-- FROM reports GROUP BY region_id, year, unit_name HAVING cnt > 1;

-- ============================================================
-- Part 2: Rebuild reports table with NOT NULL unit_name
-- ============================================================
CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  unit_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(region_id, year, unit_name)
);

INSERT INTO reports_new (id, region_id, year, unit_name, created_at, updated_at)
SELECT id, region_id, year, COALESCE(unit_name, ''), created_at, updated_at FROM reports;

DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_reports_region_year_unit ON reports(region_id, year, unit_name);
CREATE INDEX IF NOT EXISTS idx_reports_region_year ON reports(region_id, year);

-- ============================================================
-- Part 3: Extend jobs table for async task tracking
-- ============================================================
ALTER TABLE jobs ADD COLUMN step_code TEXT DEFAULT 'QUEUED';
ALTER TABLE jobs ADD COLUMN step_name TEXT DEFAULT '等待处理';
ALTER TABLE jobs ADD COLUMN attempt INTEGER DEFAULT 1;
ALTER TABLE jobs ADD COLUMN provider TEXT;
ALTER TABLE jobs ADD COLUMN model TEXT;
ALTER TABLE jobs ADD COLUMN created_by INTEGER;

-- Unify retry semantics: max_retries=1 means "retry once", total 2 attempts
UPDATE jobs SET max_retries = 1 WHERE max_retries != 1;

-- Backfill attempt field: attempt = retry_count + 1
UPDATE jobs SET attempt = retry_count + 1;

-- ============================================================
-- Part 4: Create notifications table for message center
-- ============================================================
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'upload_complete',
  title TEXT NOT NULL,
  content_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT,
  related_job_id INTEGER REFERENCES jobs(id),
  related_version_id INTEGER REFERENCES report_versions(id),
  created_by INTEGER
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);

PRAGMA foreign_keys = ON;
