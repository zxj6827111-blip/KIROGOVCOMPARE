/**
 * Schema ensure for department annual-report online filing.
 */
import type { MigrationClient } from './migrationRunner';

export async function ensureFilingSchema(client: MigrationClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS report_filings (
      id BIGSERIAL PRIMARY KEY,
      region_id BIGINT NOT NULL REFERENCES regions(id),
      year INTEGER NOT NULL,
      report_id BIGINT REFERENCES reports(id) ON DELETE SET NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'draft',
      form_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      draft_version_id BIGINT REFERENCES report_versions(id) ON DELETE SET NULL,
      effective_version_id BIGINT REFERENCES report_versions(id) ON DELETE SET NULL,
      previous_active_version_id BIGINT,
      last_check_run_id BIGINT,
      last_check_summary_json JSONB,
      created_by BIGINT,
      updated_by BIGINT,
      submitted_at TIMESTAMPTZ,
      effective_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_report_filings_status
        CHECK (status IN ('draft', 'submitted', 'checks_failed', 'effective')),
      CONSTRAINT uq_report_filings_region_year UNIQUE (region_id, year)
    );

    CREATE INDEX IF NOT EXISTS idx_report_filings_status
      ON report_filings(status);

    CREATE INDEX IF NOT EXISTS idx_report_filings_year
      ON report_filings(year);

    CREATE INDEX IF NOT EXISTS idx_report_filings_report
      ON report_filings(report_id);
  `);
}
