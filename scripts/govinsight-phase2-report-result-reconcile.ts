import pool from '../src/config/database-llm';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';
import {
  assessGovInsightNarrativeProtocolIssues,
  coerceLegacyGovInsightNarrative,
  extractGovInsightStoredEnvelope,
  getGovInsightNarrativeExpectedCounts,
  validateGovInsightNarrative,
  validateGovInsightReportPayload,
  validateGovInsightStoredEnvelope,
} from '../src/services/GovInsightReportProtocol';

type CheckResult = {
  key: string;
  pass: boolean;
  expected: unknown;
  actual: unknown;
};

function parseNumberArg(name: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) ? value : fallback;
}

function parseOptionalNumberArg(name: string): number | null {
  const raw = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!raw) return null;
  const value = Number(raw.split('=')[1]);
  return Number.isFinite(value) ? value : null;
}

function parseRegionsArg(): number[] {
  const singleRegionRaw = process.argv.find((arg) => arg.startsWith('--region='))?.split('=')[1];
  if (singleRegionRaw) {
    const region = Number(singleRegionRaw);
    return Number.isInteger(region) && region > 0 ? [region] : [];
  }

  const raw = process.argv.find((arg) => arg.startsWith('--regions='))?.split('=')[1];
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => isPlainObject(item)) : [];
}

function eq(key: string, expected: unknown, actual: unknown): CheckResult {
  return {
    key,
    pass: expected === actual,
    expected,
    actual,
  };
}

function startsWith(key: string, value: unknown, prefix: string): CheckResult {
  const actual = typeof value === 'string' ? value : '';
  return {
    key,
    pass: actual.startsWith(prefix),
    expected: prefix,
    actual,
  };
}

function atLeast(key: string, actual: number, expectedMinimum: number): CheckResult {
  return {
    key,
    pass: actual >= expectedMinimum,
    expected: `>= ${expectedMinimum}`,
    actual,
  };
}

async function pickSamples(
  year: number | null,
  limit: number,
  regions: number[]
): Promise<Array<{ regionId: number; orgName: string; year: number }>> {
  const params: Array<number | number[]> = [];
  const filters = [`unit_type = 'city'`, `materialize_status = 'official'`];

  if (year !== null) {
    params.push(year);
    filters.push(`year = $${params.length}`);
  }

  if (regions.length) {
    params.push(regions);
    filters.push(`region_id = ANY($${params.length}::int[])`);
  }

  params.push(limit);

  const result = await pool.query(
    `
    SELECT region_id::int AS "regionId", org_name AS "orgName", year
    FROM gov_open_annual_stats_v2
    WHERE ${filters.join(' AND ')}
      AND EXISTS (
        SELECT 1
        FROM ai_decision_reports reports
        WHERE reports.region_id = gov_open_annual_stats_v2.region_id
          AND reports.year = gov_open_annual_stats_v2.year
      )
    ORDER BY year DESC, region_id ASC
    LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
}

async function loadStoredReportRow(regionId: number, year: number): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `
    SELECT
      content_json,
      report_payload_json,
      protocol_version,
      payload_version,
      prompt_version,
      output_schema_version,
      materialize_status,
      source_job_id,
      source_report_version_id,
      model_used,
      updated_at
    FROM ai_decision_reports
    WHERE region_id = $1 AND year = $2
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [regionId, year]
  );

  return result.rows[0] || null;
}

async function verifySample(regionId: number, year: number, orgName: string): Promise<Record<string, unknown>> {
  const storedRow = await loadStoredReportRow(regionId, year);
  if (!storedRow) {
    throw new Error(`No ai_decision_reports row found for region=${regionId}, year=${year}`);
  }

  const extractedEnvelope = extractGovInsightStoredEnvelope(storedRow.content_json);
  const envelopeValidation = validateGovInsightStoredEnvelope(storedRow.content_json);
  const storedPayloadCandidate = storedRow.report_payload_json || extractedEnvelope?.reportPayload || null;
  const storedPayloadValidation = storedPayloadCandidate
    ? validateGovInsightReportPayload(storedPayloadCandidate)
    : { valid: false, errors: ['stored payload missing'] };
  const effectivePayload = storedPayloadValidation.valid
    ? storedPayloadCandidate
    : await govInsightReportPayloadService.build(regionId, year);
  const effectivePayloadValidation = validateGovInsightReportPayload(effectivePayload);
  if (!effectivePayloadValidation.valid) {
    throw new Error(
      `Invalid effective payload for region=${regionId}, year=${year}: ${effectivePayloadValidation.errors.slice(0, 8).join('; ')}`
    );
  }

  const rawNarrativeInput =
    (extractedEnvelope?.reportContent as Record<string, unknown> | null) ||
    (extractedEnvelope?.narrative as Record<string, unknown> | null) ||
    (isPlainObject(storedRow.content_json) ? (storedRow.content_json as Record<string, unknown>) : null);
  const storedNarrativeCandidate = rawNarrativeInput;
  const storedNarrativeValidation = storedNarrativeCandidate
    ? validateGovInsightNarrative(storedNarrativeCandidate)
    : { valid: false, errors: ['stored narrative missing'] };
  const storedNarrativeIssues =
    storedNarrativeValidation.valid && isPlainObject(effectivePayload)
      ? assessGovInsightNarrativeProtocolIssues(storedNarrativeCandidate, effectivePayload)
      : storedNarrativeValidation.errors;

  const forcePayloadRebuild = storedNarrativeValidation.valid && storedNarrativeIssues.length > 0;
  const effectiveNarrativeSource =
    storedNarrativeValidation.valid && storedNarrativeIssues.length === 0
      ? 'stored'
      : forcePayloadRebuild
        ? 'rebuilt_from_payload'
        : 'coerced_from_legacy';
  const effectiveNarrative = (
    effectiveNarrativeSource === 'stored'
      ? storedNarrativeCandidate
      : coerceLegacyGovInsightNarrative(rawNarrativeInput || {}, effectivePayload)
  ) as Record<string, unknown> | null;

  const effectiveNarrativeValidation = validateGovInsightNarrative(effectiveNarrative);
  if (!effectiveNarrativeValidation.valid || !effectiveNarrative) {
    throw new Error(
      `Invalid effective narrative for region=${regionId}, year=${year}: ${effectiveNarrativeValidation.errors.slice(0, 8).join('; ')}`
    );
  }

  const payloadMetadata = isPlainObject(effectivePayload.metadataSeeds)
    ? (effectivePayload.metadataSeeds as Record<string, unknown>)
    : {};
  const payloadRiskSeeds = asObjectArray(effectivePayload.riskPrioritySeeds);
  const payloadTaskSeeds = asObjectArray(effectivePayload.rectificationTaskSkeleton);
  const expectedCounts = getGovInsightNarrativeExpectedCounts(effectivePayload);
  const expectedRiskCount = expectedCounts.riskItems;
  const expectedTaskCount = expectedCounts.rectificationTasks;
  const narrativeMetadata = isPlainObject(effectiveNarrative.metadata)
    ? (effectiveNarrative.metadata as Record<string, unknown>)
    : {};
  const narrativeRiskItems = asObjectArray(effectiveNarrative.riskItems);
  const narrativeTasks = asObjectArray(effectiveNarrative.rectificationTasks);
  const narrativeOverallJudgments = asObjectArray(effectiveNarrative.overallJudgments);

  const checks: CheckResult[] = [
    eq('effectiveNarrative.reportTitle', String(payloadMetadata.reportTitle || ''), String(narrativeMetadata.reportTitle || '')),
    startsWith('effectiveNarrative.summaryLinePrefix', narrativeMetadata.summaryLine, '综合判断：'),
    atLeast('effectiveNarrative.overallJudgmentsCount', narrativeOverallJudgments.length, 3),
    eq('effectiveNarrative.riskItemsCount', expectedRiskCount, narrativeRiskItems.length),
    eq('effectiveNarrative.rectificationTasksCount', expectedTaskCount, narrativeTasks.length),
  ];

  const riskPrefixLength = Math.min(payloadRiskSeeds.length, narrativeRiskItems.length, expectedRiskCount);
  for (let index = 0; index < riskPrefixLength; index += 1) {
    checks.push(
      eq(
        `effectiveNarrative.riskPriority[${index}]`,
        String(payloadRiskSeeds[index]?.priorityLevel || ''),
        String(narrativeRiskItems[index]?.priorityLevel || '')
      )
    );
  }

  const taskPrefixLength = Math.min(payloadTaskSeeds.length, narrativeTasks.length, expectedTaskCount);
  for (let index = 0; index < taskPrefixLength; index += 1) {
    checks.push(
      eq(
        `effectiveNarrative.rectification.sequence[${index}]`,
        Number(payloadTaskSeeds[index]?.sequence || 0),
        Number(narrativeTasks[index]?.sequence || 0)
      )
    );
    checks.push(
      eq(
        `effectiveNarrative.rectification.taskType[${index}]`,
        String(payloadTaskSeeds[index]?.taskType || ''),
        String(narrativeTasks[index]?.taskType || '')
      )
    );
    checks.push(
      eq(
        `effectiveNarrative.rectification.priority[${index}]`,
        String(payloadTaskSeeds[index]?.priority || ''),
        String(narrativeTasks[index]?.priority || '')
      )
    );
  }

  const failures = checks.filter((item) => !item.pass);

  return {
    regionId,
    orgName,
    year,
    storedEnvelope: {
      extracted: Boolean(extractedEnvelope),
      valid: envelopeValidation.valid,
      errorCount: envelopeValidation.errors.length,
      errors: envelopeValidation.errors,
      protocolVersion: storedRow.protocol_version || extractedEnvelope?.protocolVersion || null,
      payloadVersion: storedRow.payload_version || extractedEnvelope?.payloadVersion || null,
      promptVersion: storedRow.prompt_version || extractedEnvelope?.promptVersion || null,
      outputSchemaVersion: storedRow.output_schema_version || extractedEnvelope?.outputSchemaVersion || null,
      materializeStatus: storedRow.materialize_status || extractedEnvelope?.materializeStatus || null,
      sourceJobId: storedRow.source_job_id || extractedEnvelope?.sourceJobId || null,
      sourceReportVersionId: storedRow.source_report_version_id || extractedEnvelope?.sourceReportVersionId || null,
      modelUsed: storedRow.model_used || extractedEnvelope?.modelUsed || null,
      updatedAt: storedRow.updated_at || null,
    },
    storedPayload: {
      source: storedPayloadValidation.valid ? 'stored' : 'rebuilt',
      valid: storedPayloadValidation.valid,
      errorCount: storedPayloadValidation.errors.length,
      errors: storedPayloadValidation.errors,
    },
    storedNarrative: {
      valid: storedNarrativeValidation.valid,
      issueCount: storedNarrativeIssues.length,
      issues: storedNarrativeIssues,
      effectiveSource: effectiveNarrativeSource,
    },
    effectivePayload: {
      version: (effectivePayload as Record<string, unknown>).version || null,
      materializeStatus: (effectivePayload as Record<string, unknown>).materializeStatus || null,
      metricVersion: (effectivePayload as Record<string, unknown>).metricVersion || null,
      mappingVersion: (effectivePayload as Record<string, unknown>).mappingVersion || null,
    },
    effectiveNarrative: {
      overallJudgmentsCount: narrativeOverallJudgments.length,
      riskItemsCount: narrativeRiskItems.length,
      rectificationTasksCount: narrativeTasks.length,
      summaryLine: narrativeMetadata.summaryLine || null,
      protocolExpectedRiskItemsCount: expectedRiskCount,
      protocolExpectedRectificationTasksCount: expectedTaskCount,
    },
    checks,
    failures,
  };
}

async function main(): Promise<void> {
  const year = parseOptionalNumberArg('year');
  const limit = parseNumberArg('limit', 4);
  const regions = parseRegionsArg();
  const samples = await pickSamples(year, limit, regions);

  if (!samples.length) {
    throw new Error('No official city samples found for report result reconciliation.');
  }

  const results = [];
  for (const sample of samples) {
    results.push(await verifySample(sample.regionId, sample.year, sample.orgName));
  }

  const failedSamples = results.filter((item) => Array.isArray((item as any).failures) && (item as any).failures.length > 0);

  console.log(
    JSON.stringify(
      {
        criteria: {
          year,
          limit,
          regions: regions.length ? regions : null,
        },
        totals: {
          samples: results.length,
          passed: results.length - failedSamples.length,
          failed: failedSamples.length,
        },
        results,
      },
      null,
      2
    )
  );

  if (failedSamples.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('[govinsight-phase2-report-result-reconcile] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
