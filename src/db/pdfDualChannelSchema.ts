/**
 * Schema ensure for the PDF dual-channel audit column.
 *
 * `parse_runs.dual_channel_json` holds Channel B's verdict for the same PDF: which cell
 * the two channels disagree on, how complete Channel B was, and what its own 勾稽 result
 * was. It is deliberately a separate column instead of riding inside `config_json`,
 * because `config_json` feeds the parse fingerprint — writing env-derived values there
 * would change fingerprinting and invalidate reuse for every existing run.
 *
 * Nullable and never read by the accepted-output path, so `PDF_DUAL_CHANNEL_MODE=off`
 * restores the previous behaviour without any schema change.
 */
import type { MigrationClient } from './migrationRunner';

export async function ensurePdfDualChannelSchema(client: MigrationClient): Promise<void> {
  await client.query(`
    ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS dual_channel_json JSONB;
  `);
}
