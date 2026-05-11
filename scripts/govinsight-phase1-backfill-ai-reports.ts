import pool from '../src/config/database-llm';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';
import {
  buildStoredNarrativeEnvelope,
  GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
  GOVINSIGHT_PAYLOAD_VERSION,
  GOVINSIGHT_PROMPT_VERSION,
  reconcileGovInsightNarrativeWithPayload,
} from '../src/services/GovInsightReportProtocol';

interface AiDecisionReportRow {
  id: number;
  region_id: number;
  org_name: string;
  year: number;
  content_json: unknown;
  model_used: string | null;
  protocol_version: string | null;
  payload_version: string | null;
  prompt_version: string | null;
  output_schema_version: string | null;
  materialize_status: string | null;
  source_report_version_id: number | null;
  report_payload_json: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStoredEnvelope(value: unknown): boolean {
  return isRecord(value) && typeof value._reportFormat === 'string';
}

function isNormalizedFormalReport(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return (
    !!value.metadata &&
    Array.isArray(value.overallJudgments) &&
    Array.isArray(value.riskItems) &&
    Array.isArray(value.confirmedFacts) &&
    Array.isArray(value.prudentAnalyses) &&
    Array.isArray(value.unansweredQuestions) &&
    Array.isArray(value.rectificationTasks) &&
    Array.isArray(value.scorecards)
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const result = await pool.query<AiDecisionReportRow>(
    `
    SELECT
      id,
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
      report_payload_json
    FROM ai_decision_reports
    ORDER BY id ASC
    `
  );

  let scanned = 0;
  let alreadyEnvelope = 0;
  let candidates = 0;
  let updated = 0;
  let payloadBuilt = 0;

  for (const row of result.rows) {
    scanned += 1;
    if (isStoredEnvelope(row.content_json)) {
      alreadyEnvelope += 1;
      continue;
    }

    if (!isRecord(row.content_json)) {
      continue;
    }

    candidates += 1;

    let reportPayload: Record<string, unknown> | null =
      isRecord(row.report_payload_json) ? row.report_payload_json : null;
    let materializeStatus = row.materialize_status || null;
    let sourceReportVersionId = row.source_report_version_id ?? null;

    if (!reportPayload) {
      try {
        const payload = await govInsightReportPayloadService.build(Number(row.region_id), Number(row.year));
        reportPayload = payload as unknown as Record<string, unknown>;
        materializeStatus = payload.materializeStatus;
        sourceReportVersionId = payload.sourceReportVersionId ?? sourceReportVersionId;
        payloadBuilt += 1;
      } catch (error) {
        console.warn('[GovInsight AI Report Backfill] payload build failed, continuing without payload', {
          id: row.id,
          regionId: row.region_id,
          year: row.year,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const rawNarrative = isRecord(row.content_json) ? row.content_json : null;
    const normalizedNarrative =
      reconcileGovInsightNarrativeWithPayload(rawNarrative, reportPayload) ||
      (isNormalizedFormalReport(row.content_json) ? row.content_json : rawNarrative);

    const envelope = buildStoredNarrativeEnvelope({
      reportContent: normalizedNarrative,
      narrative: normalizedNarrative,
      reportPayload,
      materializeStatus,
      sourceReportVersionId,
      modelUsed: row.model_used || null,
      promptVersion: row.prompt_version || GOVINSIGHT_PROMPT_VERSION,
      payloadVersion: reportPayload ? GOVINSIGHT_PAYLOAD_VERSION : row.payload_version || null,
      outputSchemaVersion: row.output_schema_version || GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
    });

    console.log(
      JSON.stringify(
        {
          id: row.id,
          regionId: row.region_id,
          orgName: row.org_name,
          year: row.year,
          mode: isNormalizedFormalReport(row.content_json) ? 'reportContent' : 'narrative',
          materializeStatus: materializeStatus || null,
          hasPayload: Boolean(reportPayload),
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
      UPDATE ai_decision_reports
      SET
        content_json = $2,
        protocol_version = 'gov_insight_ai_report_v1',
        payload_version = $3,
        prompt_version = $4,
        output_schema_version = $5,
        materialize_status = $6,
        source_report_version_id = $7,
        report_payload_json = $8,
        updated_at = NOW()
      WHERE id = $1
      `,
      [
        row.id,
        JSON.stringify(envelope),
        reportPayload ? GOVINSIGHT_PAYLOAD_VERSION : row.payload_version,
        row.prompt_version || GOVINSIGHT_PROMPT_VERSION,
        row.output_schema_version || GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
        materializeStatus,
        sourceReportVersionId,
        reportPayload ? JSON.stringify(reportPayload) : row.report_payload_json,
      ]
    );

    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        apply,
        scanned,
        alreadyEnvelope,
        candidates,
        updated,
        payloadBuilt,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[GovInsight AI Report Backfill] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
