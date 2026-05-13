CREATE TABLE IF NOT EXISTS ocr_corrections (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  review_id BIGINT NOT NULL REFERENCES table_visual_reviews(id) ON DELETE CASCADE,
  table_id VARCHAR(20) NOT NULL CHECK (table_id IN ('table_2', 'table_3', 'table_4')),
  field_path TEXT NOT NULL,
  parsed_value JSONB,
  ocr_value JSONB,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  applied_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by BIGINT REFERENCES admin_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ocr_corrections_version
  ON ocr_corrections(report_version_id);
CREATE INDEX IF NOT EXISTS idx_ocr_corrections_review
  ON ocr_corrections(review_id);
CREATE INDEX IF NOT EXISTS idx_ocr_corrections_status
  ON ocr_corrections(status);
ALTER TABLE ocr_corrections
  DROP CONSTRAINT IF EXISTS ocr_corrections_report_version_id_field_path_status_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ocr_corrections_pending
  ON ocr_corrections(report_version_id, field_path)
  WHERE status = 'pending';
