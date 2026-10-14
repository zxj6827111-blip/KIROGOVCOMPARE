/**
 * Schema ensure for the parse quality marker.
 *
 * `parse_quality_level` says how an accepted result was produced, which is what an
 * operator needs when dual-channel output starts competing with LLM output:
 *   dual   - accepted straight from the deterministic dual-channel candidate (no LLM)
 *   ai     - accepted through the existing pdfjs -> LLM path
 *   manual - accepted after a human correction / structured import
 *   failed - attempt produced nothing usable
 *
 * NULL is deliberately allowed and is what every pre-existing row keeps: backfilling
 * history from `provider`/`model` would be a guess about data that has already been
 * published, so it is not done here.
 */
import type { MigrationClient } from './migrationRunner';

export async function ensureParseQualitySchema(client: MigrationClient): Promise<void> {
  await client.query(`
    ALTER TABLE parse_runs
      ADD COLUMN IF NOT EXISTS parse_quality_level TEXT
      CONSTRAINT parse_runs_parse_quality_level_check
      CHECK (parse_quality_level IN ('ai', 'dual', 'manual', 'failed'));

    CREATE INDEX IF NOT EXISTS idx_parse_runs_quality_level
      ON parse_runs(parse_quality_level)
      WHERE parse_quality_level IS NOT NULL;
  `);
}
