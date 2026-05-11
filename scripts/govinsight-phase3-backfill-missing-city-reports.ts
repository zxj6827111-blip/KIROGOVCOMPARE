import pool from '../src/config/database-llm';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';
import {
  buildStoredNarrativeEnvelope,
  GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
  GOVINSIGHT_PAYLOAD_VERSION,
  GOVINSIGHT_PROMPT_VERSION,
  synthesizeGovInsightNarrativeFromPayload,
} from '../src/services/GovInsightReportProtocol';

interface MissingCityRow {
  region_id: number;
  org_name: string;
  year: number;
  materialize_status: string;
  source_report_version_id: number | null;
}

function parseNumberArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function loadMissingRows(regionId?: number, year?: number, limit = 50): Promise<MissingCityRow[]> {
  const params: number[] = [];
  const filters = [`s.materialize_status = 'official'`, `s.unit_type = 'city'`];

  if (regionId) {
    params.push(regionId);
    filters.push(`s.region_id = $${params.length}`);
  }

  if (year) {
    params.push(year);
    filters.push(`s.year = $${params.length}`);
  }

  params.push(limit);

  const result = await pool.query<MissingCityRow>(
    `
    SELECT
      s.region_id,
      s.org_name,
      s.year,
      s.materialize_status,
      s.source_report_version_id
    FROM gov_open_annual_stats_v2 s
    WHERE ${filters.join(' AND ')}
      AND NOT EXISTS (
        SELECT 1
        FROM ai_decision_reports reports
        WHERE reports.region_id = s.region_id
          AND reports.year = s.year
      )
    ORDER BY s.year DESC, s.region_id ASC
    LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const regionId = parseNumberArg('region');
  const year = parseNumberArg('year');
  const limit = parseNumberArg('limit') ?? 50;

  const rows = await loadMissingRows(regionId, year, limit);

  let created = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const payload = await govInsightReportPayloadService.build(Number(row.region_id), Number(row.year));
      const narrative = synthesizeGovInsightNarrativeFromPayload(payload);

      if (!narrative) {
        skipped += 1;
        console.warn('[GovInsight Missing City Backfill] failed to synthesize narrative', {
          regionId: row.region_id,
          year: row.year,
          orgName: row.org_name,
        });
        continue;
      }

      const envelope = buildStoredNarrativeEnvelope({
        narrative,
        reportContent: narrative,
        reportPayload: payload,
        materializeStatus: payload.materializeStatus,
        sourceReportVersionId: payload.sourceReportVersionId,
        modelUsed: 'system/report_payload_v1_backfill',
        promptVersion: GOVINSIGHT_PROMPT_VERSION,
        payloadVersion: payload.version || GOVINSIGHT_PAYLOAD_VERSION,
        outputSchemaVersion: GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
      });

      console.log(
        JSON.stringify(
          {
            regionId: row.region_id,
            orgName: row.org_name,
            year: row.year,
            materializeStatus: payload.materializeStatus,
            sourceReportVersionId: payload.sourceReportVersionId ?? null,
            apply,
          },
          null,
          2
        )
      );

      if (!apply) {
        continue;
      }

      await pool.query(
        `
        INSERT INTO ai_decision_reports (
          region_id,
          org_name,
          year,
          content_json,
          model_used,
          protocol_version,
          payload_version,
          prompt_version,
          output_schema_version,
          materialize_status,
          source_report_version_id,
          report_payload_json,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, 'gov_insight_ai_report_v1', $6, $7, $8, $9, $10, $11, NOW(), NOW()
        )
        ON CONFLICT (region_id, year)
        DO UPDATE SET
          org_name = EXCLUDED.org_name,
          content_json = EXCLUDED.content_json,
          model_used = EXCLUDED.model_used,
          protocol_version = EXCLUDED.protocol_version,
          payload_version = EXCLUDED.payload_version,
          prompt_version = EXCLUDED.prompt_version,
          output_schema_version = EXCLUDED.output_schema_version,
          materialize_status = EXCLUDED.materialize_status,
          source_report_version_id = EXCLUDED.source_report_version_id,
          report_payload_json = EXCLUDED.report_payload_json,
          updated_at = NOW()
        `,
        [
          row.region_id,
          row.org_name,
          row.year,
          JSON.stringify(envelope),
          'system/report_payload_v1_backfill',
          payload.version || GOVINSIGHT_PAYLOAD_VERSION,
          GOVINSIGHT_PROMPT_VERSION,
          GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
          payload.materializeStatus,
          payload.sourceReportVersionId ?? row.source_report_version_id ?? null,
          JSON.stringify(payload),
        ]
      );

      created += 1;
    } catch (error) {
      skipped += 1;
      console.warn('[GovInsight Missing City Backfill] failed', {
        regionId: row.region_id,
        year: row.year,
        orgName: row.org_name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        regionId: regionId ?? null,
        year: year ?? null,
        limit,
        discovered: rows.length,
        created,
        skipped,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[GovInsight Missing City Backfill] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
