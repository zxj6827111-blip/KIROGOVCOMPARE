import pool from '../src/config/database-llm';
import { govInsightReportPayloadService } from '../src/services/GovInsightReportPayloadService';
import { validateGovInsightReportPayload } from '../src/services/GovInsightReportProtocol';
import { transformYearData } from '../frontend/src/govinsight/data';
import {
  buildRuleBasedEnhancedReport,
  normalizeReportData,
  type EnhancedAIReportResponse,
} from '../frontend/src/govinsight/utils/aiReport';
import type { AnnualDataRecord, EntityProfile } from '../frontend/src/govinsight/types';

function readNumericArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : undefined;
}

async function loadAnnualDataRecords(regionId: number, year: number): Promise<AnnualDataRecord[]> {
  const result = await pool.query(
    `
    SELECT
      s.region_id,
      s.year,
      s.org_id,
      s.org_name,
      s.unit_type AS org_type,
      NULL::text AS parent_id,
      s.unit_type AS canonical_unit_type,
      s.parent_region_id::text AS canonical_parent_region_id,
      s.city_region_id::text AS city_region_id,
      s.materialize_status,
      s.is_official,
      s.metric_version,
      s.mapping_version,
      s.reg_published,
      s.reg_active,
      s.reg_abolished,
      s.doc_published,
      s.doc_active,
      s.doc_abolished,
      s.action_licensing,
      s.action_punishment,
      s.action_force,
      s.fees_amount,
      s.app_new,
      s.app_carried_over,
      s.source_natural,
      s.outcome_public,
      s.outcome_partial,
      s.outcome_unable,
      s.outcome_unable_no_info,
      s.outcome_unable_need_creation,
      s.outcome_unable_unclear,
      s.outcome_not_open,
      s.outcome_not_open_state_secret,
      s.outcome_not_open_law_forbidden,
      s.outcome_not_open_danger,
      s.outcome_not_open_process,
      s.outcome_not_open_internal,
      s.outcome_not_open_third_party,
      s.outcome_not_open_enforcement,
      s.outcome_not_open_admin_query,
      s.outcome_ignore,
      s.outcome_complaint,
      s.outcome_ignore_repeat,
      s.outcome_publication,
      s.outcome_massive,
      s.outcome_confirm,
      s.outcome_other,
      s.outcome_overdue_correction,
      s.outcome_overdue_fee,
      s.outcome_other_reasons,
      s.app_carried_forward,
      s.rev_total,
      s.rev_corrected,
      s.lit_total,
      s.lit_corrected
    FROM gov_open_annual_stats_v2 s
    WHERE s.region_id = $1
      AND s.year IN ($2, $3)
      AND s.materialize_status = 'official'
    ORDER BY s.year ASC
    `,
    [regionId, year - 1, year]
  );

  return result.rows as AnnualDataRecord[];
}

function buildSyntheticNarrative(payload: Awaited<ReturnType<typeof govInsightReportPayloadService.build>>): EnhancedAIReportResponse {
  return {
    version: 'v4',
    metadata: {
      reportTitle: payload.metadataSeeds.reportTitle,
      summaryLine: payload.metadataSeeds.summaryLine,
      overallOverview: payload.metadataSeeds.overallOverview,
      positioning: payload.metadataSeeds.positioning,
      evidenceBasis: payload.metadataSeeds.evidenceBasis,
      cautionNote: payload.metadataSeeds.cautionNote,
      auxiliaryRiskLevel: payload.metadataSeeds.auxiliaryRiskLevel,
      auxiliaryRiskLevelNote: payload.metadataSeeds.auxiliaryRiskLevelNote,
    },
    overallJudgments: [
      {
        heading: '总体判断',
        factBasis: '核心指标、风险等级和数据质量均来自后端 payload。',
        riskJudgment: '总体可控，但重点环节仍需持续关注。',
        managementImplication: '应继续以统一底座和统一规则推进生成链路。',
      },
    ],
    riskItems: [
      {
        priorityLevel: '首要关注事项',
        riskName: '测试风险事项',
        basis: '测试依据。',
        manifestation: '测试表现。',
        impact: '测试影响。',
        focus: '测试重点。',
      },
    ],
    confirmedFacts: [
      {
        category: '事实提示',
        points: ['事实层应以后端结构化数据为准。'],
      },
    ],
    prudentAnalyses: [
      {
        topic: '审慎分析',
        analysis: '测试分析内容。',
        support: '测试支撑内容。',
        caution: '测试边界内容。',
      },
    ],
    unansweredQuestions: [
      {
        question: '测试问题？',
        currentLimit: '当前边界。',
        nextDataNeeded: '后续补数建议。',
      },
    ],
    rectificationTasks: payload.rectificationTaskSkeleton,
    closing: '测试结语。',
    notes: [payload.metadataSeeds.auxiliaryRiskLevelNote],
    scorecards: [],
    dataQuality: {
      hasAnomaly: false,
      factConclusionAllowed: true,
      warnings: [],
      reconciliationChecks: [],
    },
    appendices: {
      metricAuditRows: [],
      reconciliationChecks: [],
      usageBoundaries: [],
      supplementDataItems: [],
    },
  };
}

async function main(): Promise<void> {
  const regionId = readNumericArg('region') || 721;
  const year = readNumericArg('year') || 2024;

  const payload = await govInsightReportPayloadService.build(regionId, year);
  const payloadValidation = validateGovInsightReportPayload(payload);
  if (!payloadValidation.valid) {
    throw new Error(`Invalid report_payload_v1: ${payloadValidation.errors.join('; ')}`);
  }

  const records = await loadAnnualDataRecords(regionId, year);
  if (records.length === 0) {
    throw new Error(`No official gov_open_annual_stats_v2 rows found for region=${regionId}, year=${year}`);
  }

  const entity: EntityProfile = {
    id: String(records[records.length - 1].org_id || regionId),
    name: String(records[records.length - 1].org_name || regionId),
    type: 'city',
    regionId,
    canonicalUnitType: records[records.length - 1].canonical_unit_type || 'city',
    canonicalParentRegionId: records[records.length - 1].canonical_parent_region_id
      ? Number(records[records.length - 1].canonical_parent_region_id)
      : null,
    cityRegionId: records[records.length - 1].city_region_id
      ? Number(records[records.length - 1].city_region_id)
      : null,
    materializeStatus: records[records.length - 1].materialize_status || null,
    isOfficial: Boolean(records[records.length - 1].is_official),
    data: records.map(transformYearData),
  };

  const ruleReport = buildRuleBasedEnhancedReport(entity, year, null, payload);
  if (!ruleReport) {
    throw new Error('Failed to build rule-based enhanced report');
  }

  const normalizedReport = normalizeReportData(buildSyntheticNarrative(payload), entity, year, null, payload);
  if (!normalizedReport) {
    throw new Error('Failed to normalize synthetic AI report');
  }

  if (ruleReport.appendices.metricAuditRows[0]?.sourceFields !== 'app_new') {
    throw new Error('Rule-based report appendices are not using backend appendixSkeleton');
  }
  if (normalizedReport.appendices.metricAuditRows[0]?.sourceFields !== 'app_new') {
    throw new Error('Normalized report appendices are not using backend appendixSkeleton');
  }
  if (ruleReport.rectificationTasks.length !== payload.rectificationTaskSkeleton.length) {
    throw new Error('Rule-based rectification task count does not match backend skeleton');
  }
  if (normalizedReport.dataQuality.reconciliationChecks.length !== payload.dataQuality.checks.length) {
    throw new Error('Normalized report reconciliation checks do not match backend payload');
  }

  console.log(
    JSON.stringify(
      {
        regionId,
        year,
        payloadValid: payloadValidation.valid,
        ruleReport: {
          metricAuditSource: ruleReport.appendices.metricAuditRows[0]?.sourceFields || null,
          appendixMetricAuditRowCount: ruleReport.appendices.metricAuditRows.length,
          rectificationTaskCount: ruleReport.rectificationTasks.length,
        },
        normalizedReport: {
          metricAuditSource: normalizedReport.appendices.metricAuditRows[0]?.sourceFields || null,
          reconciliationCheckCount: normalizedReport.appendices.reconciliationChecks.length,
          firstTaskName: normalizedReport.rectificationTasks[0]?.taskName || null,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[govinsight-phase1-regression] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
