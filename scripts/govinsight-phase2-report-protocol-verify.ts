import pool from '../src/config/database-llm';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';
import {
  extractGovInsightStoredEnvelope,
  validateGovInsightReportPayload,
} from '../src/services/GovInsightReportProtocol';

function parseArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) ? value : fallback;
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function main(): Promise<void> {
  const regionId = parseArg('region', 721);
  const year = parseArg('year', 2024);

  const storedResult = await pool.query(
    `
    SELECT
      content_json,
      model_used,
      updated_at,
      protocol_version,
      payload_version,
      prompt_version,
      output_schema_version,
      materialize_status,
      source_job_id,
      source_report_version_id,
      report_payload_json
    FROM ai_decision_reports
    WHERE region_id = $1 AND year = $2
    LIMIT 1
    `,
    [regionId, year]
  );

  const storedRow = storedResult.rows[0] || null;
  const storedEnvelope = storedRow ? extractGovInsightStoredEnvelope(storedRow.content_json) : null;
  const storedPayload = storedRow?.report_payload_json || storedEnvelope?.reportPayload || null;

  let effectivePayload = storedPayload;
  let payloadSource: 'stored' | 'rebuilt' = storedPayload ? 'stored' : 'rebuilt';
  let storedPayloadErrors: string[] = [];

  if (effectivePayload) {
    const storedPayloadValidation = validateGovInsightReportPayload(effectivePayload);
    if (!storedPayloadValidation.valid) {
      storedPayloadErrors = storedPayloadValidation.errors;
      effectivePayload = null;
      payloadSource = 'rebuilt';
    }
  }

  if (!effectivePayload) {
    effectivePayload = await govInsightReportPayloadService.build(regionId, year);
  }

  const payloadValidation = validateGovInsightReportPayload(effectivePayload);
  if (!payloadValidation.valid) {
    throw new Error(`Invalid effective payload: ${payloadValidation.errors.slice(0, 8).join('; ')}`);
  }

  const promptText = govInsightReportPayloadService.buildPrompt(effectivePayload as any);

  console.log(
    JSON.stringify(
      {
        regionId,
        year,
        storedReportFound: Boolean(storedRow),
        storedMeta: storedRow
          ? {
              protocolVersion: storedRow.protocol_version || storedEnvelope?.protocolVersion || null,
              reportFormat: storedEnvelope?.reportFormat || null,
              payloadVersion: storedRow.payload_version || storedEnvelope?.payloadVersion || null,
              promptVersion: storedRow.prompt_version || storedEnvelope?.promptVersion || null,
              outputSchemaVersion:
                storedRow.output_schema_version || storedEnvelope?.outputSchemaVersion || null,
              materializeStatus: storedRow.materialize_status || storedEnvelope?.materializeStatus || null,
              sourceJobId: toNullableNumber(storedRow.source_job_id) ?? storedEnvelope?.sourceJobId ?? null,
              sourceReportVersionId:
                toNullableNumber(storedRow.source_report_version_id) ??
                storedEnvelope?.sourceReportVersionId ??
                null,
              modelUsed: storedRow.model_used || storedEnvelope?.modelUsed || null,
              updatedAt: storedRow.updated_at || null,
              storedPayloadErrors,
            }
          : null,
        effectivePayload: {
          source: payloadSource,
          version: (effectivePayload as any).version || null,
          materializeStatus: (effectivePayload as any).materializeStatus || null,
          promptLength: promptText.length,
          hasHierarchyAnalysis: Boolean((effectivePayload as any).hierarchyAnalysis),
          districtFocusCount: Array.isArray((effectivePayload as any).hierarchyAnalysis?.districtFocus)
            ? (effectivePayload as any).hierarchyAnalysis.districtFocus.length
            : 0,
          departmentFocusCount: Array.isArray((effectivePayload as any).hierarchyAnalysis?.departmentFocus)
            ? (effectivePayload as any).hierarchyAnalysis.departmentFocus.length
            : 0,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[govinsight-phase2-report-protocol-verify] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
