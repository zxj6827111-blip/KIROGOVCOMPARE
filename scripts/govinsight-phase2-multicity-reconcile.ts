import pool from '../src/config/database-llm';
import { govInsightLeaderCockpitService } from '../src/services/GovInsightLeaderCockpitService';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';
import {
  extractGovInsightStoredEnvelope,
  validateGovInsightReportPayload,
} from '../src/services/GovInsightReportProtocol';
import { govInsightStatsV2Service } from '../src/services/GovInsightStatsV2Service';

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
  const raw = process.argv.find((arg) => arg.startsWith('--regions='))?.split('=')[1];
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function safePct(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return round1((numerator / denominator) * 100);
}

function eq(key: string, expected: unknown, actual: unknown): CheckResult {
  return {
    key,
    pass: expected === actual,
    expected,
    actual,
  };
}

async function pickSamples(year: number | null, limit: number, regions: number[]): Promise<Array<{ regionId: number; orgName: string; year: number }>> {
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
    ORDER BY year DESC, region_id ASC
    LIMIT $${params.length}
    `,
    params
  );

  return result.rows;
}

async function loadStoredReportMeta(regionId: number, year: number): Promise<{
  found: boolean;
  payloadSource: 'stored' | 'rebuilt' | 'missing';
  storedPayloadErrors: string[];
  storedPayloadAcceptedTotal: number | null;
}> {
  const result = await pool.query(
    `
    SELECT content_json, report_payload_json
    FROM ai_decision_reports
    WHERE region_id = $1 AND year = $2
    ORDER BY updated_at DESC NULLS LAST, id DESC
    LIMIT 1
    `,
    [regionId, year]
  );

  const row = result.rows[0];
  if (!row) {
    return {
      found: false,
      payloadSource: 'missing',
      storedPayloadErrors: [],
      storedPayloadAcceptedTotal: null,
    };
  }

  const envelope = extractGovInsightStoredEnvelope(row.content_json);
  const storedPayload = row.report_payload_json || envelope?.reportPayload || null;
  if (!storedPayload) {
    return {
      found: true,
      payloadSource: 'rebuilt',
      storedPayloadErrors: ['stored payload missing'],
      storedPayloadAcceptedTotal: null,
    };
  }

  const validation = validateGovInsightReportPayload(storedPayload);
  return {
    found: true,
    payloadSource: validation.valid ? 'stored' : 'rebuilt',
    storedPayloadErrors: validation.valid ? [] : validation.errors,
    storedPayloadAcceptedTotal: validation.valid ? asNumber((storedPayload as any).metricsSnapshot?.acceptedTotal) : null,
  };
}

async function verifySample(regionId: number, year: number, orgName: string): Promise<Record<string, unknown>> {
  const row = await govInsightStatsV2Service.getBestAvailableRow(regionId, year);
  if (!row) {
    throw new Error(`No stats_v2 row found for region=${regionId}, year=${year}`);
  }

  const payload = await govInsightReportPayloadService.build(regionId, year);
  const payloadValidation = validateGovInsightReportPayload(payload);
  if (!payloadValidation.valid) {
    throw new Error(`Invalid payload for region=${regionId}, year=${year}: ${payloadValidation.errors.slice(0, 6).join('; ')}`);
  }

  const cockpitModel = await govInsightLeaderCockpitService.buildModel(regionId, year);
  const districtComparison = await govInsightLeaderCockpitService.buildComparisonModel(regionId, year, 'district', {
    disclosureMethod: 'substantive',
    correctionMethod: 'reconsideration',
    includesCarryOver: false,
    enableStableSample: true,
  });
  const departmentComparison = await govInsightLeaderCockpitService.buildComparisonModel(regionId, year, 'department', {
    disclosureMethod: 'substantive',
    correctionMethod: 'reconsideration',
    includesCarryOver: false,
    enableStableSample: true,
  });
  const storedReportMeta = await loadStoredReportMeta(regionId, year);

  const acceptedTotal = asNumber(row.app_new) + asNumber(row.app_carried_over);
  const substantiveRate = safePct(asNumber(row.outcome_public) + asNumber(row.outcome_partial), acceptedTotal);
  const unableRate = safePct(asNumber(row.outcome_unable), acceptedTotal);
  const noInfoShareInUnable = safePct(asNumber(row.outcome_unable_no_info), asNumber(row.outcome_unable));
  const carryForwardRate = safePct(asNumber(row.app_carried_forward), acceptedTotal);
  const revRate = safePct(asNumber(row.rev_corrected), asNumber(row.rev_total));
  const litRate = safePct(asNumber(row.lit_corrected), asNumber(row.lit_total));
  const overallCorrectionRate = safePct(
    asNumber(row.rev_corrected) + asNumber(row.lit_corrected),
    asNumber(row.rev_total) + asNumber(row.lit_total)
  );

  const checks: CheckResult[] = [
    eq('materializeStatus', row.materialize_status, payload.materializeStatus),
    eq('payload.acceptedTotal', acceptedTotal, payload.metricsSnapshot.acceptedTotal),
    eq('payload.newReceived', asNumber(row.app_new), payload.metricsSnapshot.newReceived),
    eq('payload.substantiveRate', substantiveRate, payload.metricsSnapshot.substantiveRate),
    eq('payload.unableRate', unableRate, payload.metricsSnapshot.unableRate),
    eq('payload.noInfoShareInUnable', noInfoShareInUnable, payload.metricsSnapshot.noInfoShareInUnable),
    eq('payload.carryForwardRate', carryForwardRate, payload.metricsSnapshot.carryForwardRate),
    eq('payload.revRate', revRate, payload.metricsSnapshot.revRate),
    eq('payload.litRate', litRate, payload.metricsSnapshot.litRate),
    eq('payload.overallCorrectionRate', overallCorrectionRate, payload.metricsSnapshot.overallCorrectionRate),
    eq('cockpit.newApplications', cockpitModel?.metrics.newApplications.value ?? null, payload.metricsSnapshot.newReceived),
    eq('cockpit.acceptedTotal', cockpitModel?.metrics.acceptedTotal.value ?? null, payload.metricsSnapshot.acceptedTotal),
    eq('hierarchy.districtCoverage.total', districtComparison?.statistics.total ?? null, payload.hierarchyAnalysis?.districtCoverage.total ?? null),
    eq('hierarchy.departmentCoverage.total', departmentComparison?.statistics.total ?? null, payload.hierarchyAnalysis?.departmentCoverage.total ?? null),
  ];

  if (storedReportMeta.found && storedReportMeta.payloadSource === 'stored' && storedReportMeta.storedPayloadAcceptedTotal !== null) {
    checks.push(eq('storedPayload.acceptedTotal', payload.metricsSnapshot.acceptedTotal, storedReportMeta.storedPayloadAcceptedTotal));
  }

  const failures = checks.filter((check) => !check.pass);

  return {
    regionId,
    orgName,
    year,
    materializeStatus: row.materialize_status,
    payloadVersion: payload.version,
    metricVersion: payload.metricVersion,
    mappingVersion: payload.mappingVersion,
    payloadValidation: {
      valid: payloadValidation.valid,
      errorCount: payloadValidation.errors.length,
    },
    storedReport: storedReportMeta,
    hierarchyAnalysis: payload.hierarchyAnalysis
      ? {
          districtCoverage: payload.hierarchyAnalysis.districtCoverage,
          departmentCoverage: payload.hierarchyAnalysis.departmentCoverage,
          districtFocusCount: payload.hierarchyAnalysis.districtFocus.length,
          departmentFocusCount: payload.hierarchyAnalysis.departmentFocus.length,
        }
      : null,
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
    throw new Error('No official city samples found for multicity reconciliation.');
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
    console.error('[govinsight-phase2-multicity-reconcile] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
