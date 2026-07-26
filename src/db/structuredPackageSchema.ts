/**
 * Shared schema ensure for structured package import columns/tables.
 * Single source of truth used by migrationRegistry 0002 and (optionally) docs.
 * Keep DDL here so migrations-llm and 0002 cannot drift.
 */
import type { MigrationClient } from './migrationRunner';

export async function ensureStructuredPackageSchema(client: MigrationClient): Promise<void> {
  await client.query(`
    ALTER TABLE report_versions
      ADD COLUMN IF NOT EXISTS ingestion_mode VARCHAR(32) NOT NULL DEFAULT 'ai_parse';

    ALTER TABLE report_versions
      ADD COLUMN IF NOT EXISTS package_sha256 VARCHAR(64);

    CREATE INDEX IF NOT EXISTS idx_report_versions_ingestion_mode
      ON report_versions(ingestion_mode);

    DROP INDEX IF EXISTS uq_report_versions_package_sha256;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_report_versions_package_report
      ON report_versions(report_id, package_sha256)
      WHERE package_sha256 IS NOT NULL;

    CREATE TABLE IF NOT EXISTS report_version_artifacts (
      id BIGSERIAL PRIMARY KEY,
      report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
      artifact_type VARCHAR(32) NOT NULL,
      original_filename VARCHAR(255) NOT NULL,
      stored_filename VARCHAR(255) NOT NULL,
      mime_type VARCHAR(128),
      size_bytes BIGINT,
      sha256 VARCHAR(64) NOT NULL,
      storage_path TEXT NOT NULL,
      schema_version VARCHAR(32),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT chk_report_version_artifacts_type
        CHECK (artifact_type IN ('source_package', 'source_pdf', 'source_markdown', 'source_json'))
    );

    CREATE INDEX IF NOT EXISTS idx_report_version_artifacts_version
      ON report_version_artifacts(report_version_id);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_report_version_artifacts_type
      ON report_version_artifacts(report_version_id, artifact_type);

    CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_version_structured_import_active
      ON jobs(version_id)
      WHERE kind = 'structured_import' AND status IN ('queued', 'running');

    CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_version_materialize_active
      ON jobs(version_id)
      WHERE kind = 'materialize' AND status IN ('queued', 'running');

    CREATE UNIQUE INDEX IF NOT EXISTS uq_jobs_version_checks_active
      ON jobs(version_id)
      WHERE kind = 'checks' AND status IN ('queued', 'running');

    CREATE INDEX IF NOT EXISTS idx_report_version_artifacts_sha256
      ON report_version_artifacts(sha256);
  `);
}

/**
 * Destructive inverse of ensureStructuredPackageSchema.
 *
 * WARNING: dropping `ingestion_mode` re-labels every structured_import version
 * as ai_parse (the column DEFAULT is irrelevant once the column is gone — the
 * remaining rows simply lose their mode). Dropping `package_sha256` removes
 * the scoped idempotency key. This is intended for an explicit, reviewed
 * hotfix only — the registered migration 0002 is intentionally irreversible
 * (reversible:false, no down handler) so the generic rollback runner acts as a
 * guard rail. See migrationRegistry.ts notes.
 */
export async function dropStructuredPackageSchema(client: MigrationClient): Promise<void> {
  await client.query(`
    DROP INDEX IF EXISTS uq_jobs_version_structured_import_active;
    DROP INDEX IF EXISTS uq_jobs_version_materialize_active;
    DROP INDEX IF EXISTS uq_jobs_version_checks_active;
    DROP INDEX IF EXISTS idx_report_version_artifacts_sha256;
    DROP TABLE IF EXISTS report_version_artifacts;
    DROP INDEX IF EXISTS uq_report_versions_package_report;
    DROP INDEX IF EXISTS uq_report_versions_package_sha256;
    DROP INDEX IF EXISTS idx_report_versions_ingestion_mode;
    ALTER TABLE report_versions DROP COLUMN IF EXISTS package_sha256;
    ALTER TABLE report_versions DROP COLUMN IF EXISTS ingestion_mode;
  `);
}
