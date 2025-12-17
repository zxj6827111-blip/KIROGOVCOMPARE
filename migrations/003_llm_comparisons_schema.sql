-- Comparison support for LLM ingestion (PostgreSQL)
CREATE TABLE IF NOT EXISTS comparisons (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES regions(id),
  year_a INTEGER NOT NULL,
  year_b INTEGER NOT NULL,
  left_report_id BIGINT NOT NULL REFERENCES reports(id),
  right_report_id BIGINT NOT NULL REFERENCES reports(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(region_id, year_a, year_b)
);

CREATE TABLE IF NOT EXISTS comparison_results (
  id BIGSERIAL PRIMARY KEY,
  comparison_id BIGINT NOT NULL UNIQUE REFERENCES comparisons(id) ON DELETE CASCADE,
  diff_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS comparison_id BIGINT REFERENCES comparisons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_comparison ON jobs(comparison_id);
