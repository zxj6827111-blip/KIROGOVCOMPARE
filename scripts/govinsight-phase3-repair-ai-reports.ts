import pool from '../src/config/database-llm';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';
import {
  buildStoredNarrativeEnvelope,
  coerceLegacyGovInsightNarrative,
  extractGovInsightStoredEnvelope,
  GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
  GOVINSIGHT_PAYLOAD_VERSION,
  GOVINSIGHT_PROMPT_VERSION,
  reconcileGovInsightNarrativeWithPayload,
  validateGovInsightNarrative,
  validateGovInsightReportPayload,
  validateGovInsightStoredEnvelope,
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
  source_job_id: number | null;
  source_report_version_id: number | null;
  report_payload_json: unknown;
}

interface RepairDecision {
  rowId: number;
  regionId: number;
  orgName: string;
  year: number;
  issues: string[];
  payloadSource: 'stored' | 'rebuilt' | 'missing';
  envelopeMode: 'preserved' | 'rebuilt' | 'unsupported';
  sourceJobId: number | null;
  sourceReportVersionId: number | null;
  materializeStatus: string | null;
  nextContentJson?: string;
  nextReportPayloadJson?: string | null;
  nextProtocolVersion?: string;
  nextPayloadVersion?: string | null;
  nextPromptVersion?: string | null;
  nextOutputSchemaVersion?: string | null;
  skipReason?: string;
}

function parseNumberArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toNullableNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sortJsonDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonDeep(item));
  }
  if (isRecord(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortJsonDeep(value[key]);
        return acc;
      }, {});
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonDeep(value));
}

function chooseNarrativeCandidate(
  row: AiDecisionReportRow,
  effectivePayload: Record<string, unknown> | null
): {
  reportContent: Record<string, unknown> | null;
  narrative: Record<string, unknown> | null;
  mode: RepairDecision['envelopeMode'];
  issues: string[];
} {
  const extracted = extractGovInsightStoredEnvelope(row.content_json);
  if (extracted) {
    const reportContentValidation = extracted.reportContent
      ? validateGovInsightNarrative(extracted.reportContent)
      : { valid: false, errors: ['missing_report_content'] };
    const narrativeValidation = extracted.narrative
      ? validateGovInsightNarrative(extracted.narrative)
      : { valid: false, errors: ['missing_narrative'] };

    if (reportContentValidation.valid && narrativeValidation.valid) {
      return {
        reportContent: extracted.reportContent,
        narrative: extracted.narrative,
        mode: 'preserved',
        issues: [],
      };
    }

    if (reportContentValidation.valid) {
      return {
        reportContent: extracted.reportContent,
        narrative: extracted.reportContent,
        mode: 'rebuilt',
        issues: ['invalid_or_missing_narrative_in_envelope'],
      };
    }

    if (narrativeValidation.valid) {
      return {
        reportContent: extracted.narrative,
        narrative: extracted.narrative,
        mode: 'rebuilt',
        issues: ['invalid_or_missing_report_content_in_envelope'],
      };
    }

    const coerced = coerceLegacyGovInsightNarrative(
      extracted.reportContent || extracted.narrative || row.content_json,
      effectivePayload
    );
    if (coerced) {
      return {
        reportContent: coerced,
        narrative: coerced,
        mode: 'rebuilt',
        issues: ['legacy_envelope_narrative_coerced_to_formal_report'],
      };
    }

    return {
      reportContent: null,
      narrative: null,
      mode: 'unsupported',
      issues: ['invalid_stored_envelope_narrative'],
    };
  }

  if (!isRecord(row.content_json)) {
    return {
      reportContent: null,
      narrative: null,
      mode: 'unsupported',
      issues: ['content_json_not_object'],
    };
  }

  const rawValidation = validateGovInsightNarrative(row.content_json);
  if (!rawValidation.valid) {
    const coerced = coerceLegacyGovInsightNarrative(row.content_json, effectivePayload);
    if (coerced) {
      return {
        reportContent: coerced,
        narrative: coerced,
        mode: 'rebuilt',
        issues: ['legacy_content_coerced_to_formal_report'],
      };
    }

    return {
      reportContent: null,
      narrative: null,
      mode: 'unsupported',
      issues: ['legacy_content_not_convertible_to_formal_narrative'],
    };
  }

  return {
    reportContent: row.content_json,
    narrative: row.content_json,
    mode: 'rebuilt',
    issues: ['legacy_content_without_envelope'],
  };
}

async function resolveSourceJobId(
  row: AiDecisionReportRow,
  cache: Map<string, number | null>
): Promise<number | null> {
  const current = toNullableNumber(row.source_job_id);
  if (current !== null) {
    return current;
  }

  const key = `${row.region_id}:${row.year}`;
  if (cache.has(key)) {
    return cache.get(key) ?? null;
  }

  const result = await pool.query<{ id: number }>(
    `
    SELECT id
    FROM gov_insight_report_jobs
    WHERE region_id = $1
      AND year = $2
      AND status = 'succeeded'
    ORDER BY finished_at DESC NULLS LAST, created_at DESC
    LIMIT 1
    `,
    [row.region_id, row.year]
  );

  const value = result.rows[0] ? Number(result.rows[0].id) : null;
  cache.set(key, value);
  return value;
}

async function decideRepair(
  row: AiDecisionReportRow,
  sourceJobCache: Map<string, number | null>
): Promise<RepairDecision> {
  const issues: string[] = [];
  const extracted = extractGovInsightStoredEnvelope(row.content_json);
  const storedPayload = isRecord(row.report_payload_json)
    ? row.report_payload_json
    : extracted?.reportPayload && isRecord(extracted.reportPayload)
      ? extracted.reportPayload
      : null;

  let effectivePayload = storedPayload;
  let payloadSource: RepairDecision['payloadSource'] = storedPayload ? 'stored' : 'rebuilt';

  if (effectivePayload) {
    const storedPayloadValidation = validateGovInsightReportPayload(effectivePayload);
    if (!storedPayloadValidation.valid) {
      issues.push(...storedPayloadValidation.errors.map((item) => `invalid_stored_payload:${item}`));
      effectivePayload = null;
      payloadSource = 'rebuilt';
    }
  } else {
    issues.push('missing_stored_payload');
  }

  if (!effectivePayload) {
    try {
      const rebuiltPayload = await govInsightReportPayloadService.build(Number(row.region_id), Number(row.year));
      const rebuiltValidation = validateGovInsightReportPayload(rebuiltPayload);
      if (!rebuiltValidation.valid) {
        return {
          rowId: row.id,
          regionId: Number(row.region_id),
          orgName: row.org_name,
          year: Number(row.year),
          issues: [...issues, ...rebuiltValidation.errors.map((item) => `invalid_rebuilt_payload:${item}`)],
          payloadSource: 'missing',
          envelopeMode: 'unsupported',
          sourceJobId: toNullableNumber(row.source_job_id),
          sourceReportVersionId: toNullableNumber(row.source_report_version_id),
          materializeStatus: row.materialize_status || null,
          skipReason: 'rebuilt_payload_invalid',
        };
      }
      effectivePayload = rebuiltPayload as unknown as Record<string, unknown>;
    } catch (error) {
      return {
        rowId: row.id,
        regionId: Number(row.region_id),
        orgName: row.org_name,
        year: Number(row.year),
        issues: [...issues, `payload_rebuild_failed:${error instanceof Error ? error.message : String(error)}`],
        payloadSource: 'missing',
        envelopeMode: 'unsupported',
        sourceJobId: toNullableNumber(row.source_job_id),
        sourceReportVersionId: toNullableNumber(row.source_report_version_id),
        materializeStatus: row.materialize_status || null,
        skipReason: 'payload_rebuild_failed',
      };
    }
  }

  const narrativeCandidate = chooseNarrativeCandidate(row, effectivePayload);
  issues.push(...narrativeCandidate.issues);

  if (!narrativeCandidate.reportContent || !narrativeCandidate.narrative) {
    return {
      rowId: row.id,
      regionId: Number(row.region_id),
      orgName: row.org_name,
      year: Number(row.year),
      issues,
      payloadSource: 'missing',
      envelopeMode: 'unsupported',
      sourceJobId: toNullableNumber(row.source_job_id),
      sourceReportVersionId: toNullableNumber(row.source_report_version_id),
      materializeStatus: row.materialize_status || null,
      skipReason: 'unsupported_content_shape',
    };
  }

  const normalizedNarrative = reconcileGovInsightNarrativeWithPayload(
    narrativeCandidate.reportContent,
    effectivePayload
  );
  if (!normalizedNarrative) {
    return {
      rowId: row.id,
      regionId: Number(row.region_id),
      orgName: row.org_name,
      year: Number(row.year),
      issues: [...issues, 'reconciled_narrative_invalid'],
      payloadSource,
      envelopeMode: 'unsupported',
      sourceJobId: toNullableNumber(row.source_job_id),
      sourceReportVersionId: toNullableNumber(row.source_report_version_id),
      materializeStatus: row.materialize_status || null,
      skipReason: 'reconciled_narrative_invalid',
    };
  }

  if (stableStringify(normalizedNarrative) !== stableStringify(narrativeCandidate.reportContent)) {
    issues.push('narrative_reconciled_with_payload');
  }

  const nextSourceJobId = await resolveSourceJobId(row, sourceJobCache);
  const nextSourceReportVersionId =
    toNullableNumber((effectivePayload as any)?.sourceReportVersionId) ??
    toNullableNumber(row.source_report_version_id) ??
    extracted?.sourceReportVersionId ??
    null;
  const nextMaterializeStatus =
    String((effectivePayload as any)?.materializeStatus || row.materialize_status || extracted?.materializeStatus || '')
      .trim() || null;

  if ((row.protocol_version || '') !== 'gov_insight_ai_report_v1') {
    issues.push('protocol_version_outdated');
  }
  if ((row.payload_version || '') !== GOVINSIGHT_PAYLOAD_VERSION) {
    issues.push('payload_version_missing_or_outdated');
  }
  if ((row.prompt_version || '') !== GOVINSIGHT_PROMPT_VERSION) {
    issues.push('prompt_version_missing_or_outdated');
  }
  if ((row.output_schema_version || '') !== GOVINSIGHT_OUTPUT_SCHEMA_VERSION) {
    issues.push('output_schema_version_missing_or_outdated');
  }
  if (toNullableNumber(row.source_job_id) === null && nextSourceJobId !== null) {
    issues.push('source_job_id_backfilled');
  }
  if (!row.report_payload_json) {
    issues.push('report_payload_json_missing');
  }

  const nextEnvelope = buildStoredNarrativeEnvelope({
    reportContent: normalizedNarrative,
    narrative: normalizedNarrative,
    reportPayload: effectivePayload,
    materializeStatus: nextMaterializeStatus,
    sourceReportVersionId: nextSourceReportVersionId,
    sourceJobId: nextSourceJobId,
    modelUsed: row.model_used || extracted?.modelUsed || null,
    promptVersion: row.prompt_version || GOVINSIGHT_PROMPT_VERSION,
    payloadVersion: GOVINSIGHT_PAYLOAD_VERSION,
    outputSchemaVersion: row.output_schema_version || GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
  });

  const nextEnvelopeValidation = validateGovInsightStoredEnvelope(nextEnvelope);
  if (!nextEnvelopeValidation.valid) {
    return {
      rowId: row.id,
      regionId: Number(row.region_id),
      orgName: row.org_name,
      year: Number(row.year),
      issues: [...issues, ...nextEnvelopeValidation.errors.map((item) => `invalid_next_envelope:${item}`)],
      payloadSource: 'missing',
      envelopeMode: 'unsupported',
      sourceJobId: nextSourceJobId,
      sourceReportVersionId: nextSourceReportVersionId,
      materializeStatus: nextMaterializeStatus,
      skipReason: 'next_envelope_invalid',
    };
  }

  const nextContentJson = stableStringify(nextEnvelope);
  const currentContentJson = stableStringify(row.content_json);
  const nextReportPayloadJson = stableStringify(effectivePayload);
  const currentReportPayloadJson = row.report_payload_json ? stableStringify(row.report_payload_json) : null;

  if (currentContentJson !== nextContentJson) {
    issues.push('content_json_rewritten');
  }
  if (currentReportPayloadJson !== nextReportPayloadJson) {
    issues.push('report_payload_json_rewritten');
  }

  return {
    rowId: row.id,
    regionId: Number(row.region_id),
    orgName: row.org_name,
    year: Number(row.year),
    issues: Array.from(new Set(issues)),
    payloadSource,
    envelopeMode: narrativeCandidate.mode,
    sourceJobId: nextSourceJobId,
    sourceReportVersionId: nextSourceReportVersionId,
    materializeStatus: nextMaterializeStatus,
    nextContentJson,
    nextReportPayloadJson,
    nextProtocolVersion: 'gov_insight_ai_report_v1',
    nextPayloadVersion: GOVINSIGHT_PAYLOAD_VERSION,
    nextPromptVersion: row.prompt_version || GOVINSIGHT_PROMPT_VERSION,
    nextOutputSchemaVersion: row.output_schema_version || GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
  };
}

async function main(): Promise<void> {
  const apply = hasFlag('--apply');
  const regionId = parseNumberArg('region');
  const year = parseNumberArg('year');
  const limit = parseNumberArg('limit');

  const conditions: string[] = [];
  const params: Array<number> = [];
  let index = 1;
  if (regionId) {
    conditions.push(`region_id = $${index++}`);
    params.push(regionId);
  }
  if (year) {
    conditions.push(`year = $${index++}`);
    params.push(year);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limitClause = limit ? `LIMIT ${limit}` : '';

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
      source_job_id,
      source_report_version_id,
      report_payload_json
    FROM ai_decision_reports
    ${whereClause}
    ORDER BY id ASC
    ${limitClause}
    `,
    params
  );

  const sourceJobCache = new Map<string, number | null>();
  const decisions: RepairDecision[] = [];

  for (const row of result.rows) {
    decisions.push(await decideRepair(row, sourceJobCache));
  }

  const summary = {
    apply,
    scanned: decisions.length,
    repairable: decisions.filter((item) => !item.skipReason && item.issues.length > 0).length,
    skipped: decisions.filter((item) => Boolean(item.skipReason)).length,
    rebuiltPayload: decisions.filter((item) => item.payloadSource === 'rebuilt').length,
    preservedEnvelope: decisions.filter((item) => item.envelopeMode === 'preserved').length,
    rebuiltEnvelope: decisions.filter((item) => item.envelopeMode === 'rebuilt').length,
    unsupported: decisions.filter((item) => item.envelopeMode === 'unsupported').length,
    issueBreakdown: decisions.reduce<Record<string, number>>((acc, item) => {
      item.issues.forEach((issue) => {
        acc[issue] = (acc[issue] || 0) + 1;
      });
      return acc;
    }, {}),
  };

  console.log(JSON.stringify(summary, null, 2));

  const preview = decisions
    .filter((item) => item.issues.length > 0 || item.skipReason)
    .slice(0, 20)
    .map((item) => ({
      rowId: item.rowId,
      regionId: item.regionId,
      orgName: item.orgName,
      year: item.year,
      payloadSource: item.payloadSource,
      envelopeMode: item.envelopeMode,
      materializeStatus: item.materializeStatus,
      skipReason: item.skipReason || null,
      issues: item.issues,
    }));
  console.log(JSON.stringify({ preview }, null, 2));

  if (!apply) {
    return;
  }

  let updated = 0;
  for (const item of decisions) {
    if (item.skipReason || !item.nextContentJson || !item.nextProtocolVersion) {
      continue;
    }

    await pool.query(
      `
      UPDATE ai_decision_reports
      SET
        content_json = $2::jsonb,
        protocol_version = $3,
        payload_version = $4,
        prompt_version = $5,
        output_schema_version = $6,
        materialize_status = $7,
        source_job_id = $8,
        source_report_version_id = $9,
        report_payload_json = $10::jsonb,
        updated_at = NOW()
      WHERE id = $1
      `,
      [
        item.rowId,
        item.nextContentJson,
        item.nextProtocolVersion,
        item.nextPayloadVersion,
        item.nextPromptVersion,
        item.nextOutputSchemaVersion,
        item.materializeStatus,
        item.sourceJobId,
        item.sourceReportVersionId,
        item.nextReportPayloadJson,
      ]
    );

    updated += 1;
  }

  console.log(JSON.stringify({ apply, updated }, null, 2));
}

main()
  .catch((error) => {
    console.error('[govinsight-phase3-repair-ai-reports] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
