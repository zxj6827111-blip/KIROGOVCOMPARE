CREATE TABLE IF NOT EXISTS table_visual_reviews (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  table_id VARCHAR(20) NOT NULL CHECK (table_id IN ('table_2', 'table_3', 'table_4')),
  trigger_reason TEXT,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  api_mode VARCHAR(30),
  review_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  status VARCHAR(40) NOT NULL CHECK (
    status IN ('queued', 'running', 'completed', 'source_unavailable', 'channel_unavailable', 'failed')
  ),
  conclusion VARCHAR(40) CHECK (
    conclusion IS NULL OR conclusion IN (
      'source_table_anomaly',
      'parse_mapping_anomaly',
      'source_table_matches_parse',
      'inconclusive'
    )
  ),
  screenshot_path TEXT,
  screenshot_meta_json JSONB,
  ocr_json JSONB,
  comparison_json JSONB,
  error_code VARCHAR(80),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  UNIQUE(report_version_id, table_id, file_hash, provider, model)
);

CREATE INDEX IF NOT EXISTS idx_table_visual_reviews_version
  ON table_visual_reviews(report_version_id);
CREATE INDEX IF NOT EXISTS idx_table_visual_reviews_report
  ON table_visual_reviews(report_id);
CREATE INDEX IF NOT EXISTS idx_table_visual_reviews_status
  ON table_visual_reviews(status);
CREATE INDEX IF NOT EXISTS idx_table_visual_reviews_table
  ON table_visual_reviews(report_version_id, table_id);
