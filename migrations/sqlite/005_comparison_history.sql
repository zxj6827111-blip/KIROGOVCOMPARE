-- Comparison history schema
-- Migration 005: Add metadata to comparisons and export records

-- NOTE: SQLite doesn't support "ALTER TABLE ADD COLUMN IF NOT EXISTS"
-- These ALTER statements will fail if columns already exist - that's OK
-- The migration runner should catch and ignore duplicate column errors

-- Export records table
CREATE TABLE IF NOT EXISTS comparison_exports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comparison_id INTEGER NOT NULL,
  format VARCHAR(20) NOT NULL CHECK (format IN ('pdf', 'docx', 'json')),
  file_path TEXT NOT NULL,
  file_size INTEGER,
  watermark_text VARCHAR(255),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (comparison_id) REFERENCES comparisons(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comparison_exports_comparison 
ON comparison_exports(comparison_id);
