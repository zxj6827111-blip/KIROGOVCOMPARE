export type CanonicalUnitType =
  | 'province'
  | 'city'
  | 'district'
  | 'department'
  | 'town_street'
  | 'functional_zone'
  | 'unknown';

export type MaterializeStatus =
  | 'official'
  | 'preview'
  | 'blocked_missing_facts'
  | 'blocked_mapping_pending'
  | 'blocked_unknown_unit_type';

export const GOVINSIGHT_CANONICAL_MAPPING_VERSION = 'canonical_units_v1';
export const GOVINSIGHT_METRIC_VERSION = 'metrics_snapshot_v1';
export const GOVINSIGHT_DATA_QUALITY_VERSION = 'data_quality_v1';
export const GOVINSIGHT_PAYLOAD_VERSION = 'report_payload_v1';
export const GOVINSIGHT_PROMPT_VERSION = 'gov_insight_backend_prompt_v3';
export const GOVINSIGHT_OUTPUT_SCHEMA_VERSION = 'govInsightFormalReportV2';
export const GOVINSIGHT_AI_REPORT_PROTOCOL_VERSION = 'gov_insight_ai_report_v1';
export const GOVINSIGHT_FORMAL_REPORT_FORMAT = 'govInsightFormalReportV2';

const GOVINSIGHT_RISK_PRIORITY_LEVELS = ['首要关注事项', '重点关注事项', '持续跟踪事项'] as const;
const GOVINSIGHT_TASK_TYPES = ['机制建设类', '规范整治类', '能力提升类', '平台治理类', '监督保障类'] as const;
const GOVINSIGHT_TASK_PRIORITIES = ['近期立即推进', '年内持续推进', '中期完善'] as const;

const GOVINSIGHT_MAX_OVERALL_JUDGMENTS = 4;
const GOVINSIGHT_MAX_RISK_ITEMS = 5;
const GOVINSIGHT_MAX_RECTIFICATION_TASKS = 7;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function pushIfInvalidString(errors: string[], path: string, value: unknown): void {
  if (!isNonEmptyString(value)) {
    errors.push(`${path} must be a non-empty string`);
  }
}

function pushIfNotObject(errors: string[], path: string, value: unknown): value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  return true;
}

function pushIfNotArray(errors: string[], path: string, value: unknown): value is unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return false;
  }
  return true;
}

export function buildGovInsightNarrativeResponseSchema(): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: [
      'metadata',
      'overallJudgments',
      'riskItems',
      'confirmedFacts',
      'prudentAnalyses',
      'unansweredQuestions',
      'rectificationTasks',
      'closing',
      'notes',
    ],
    properties: {
      metadata: {
        type: 'object',
        additionalProperties: false,
        required: ['reportTitle', 'summaryLine', 'overallOverview', 'positioning', 'evidenceBasis', 'cautionNote'],
        properties: {
          reportTitle: { type: 'string' },
          summaryLine: { type: 'string' },
          overallOverview: { type: 'string' },
          positioning: { type: 'string' },
          evidenceBasis: { type: 'string' },
          cautionNote: { type: 'string' },
        },
      },
      overallJudgments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['heading', 'factBasis', 'riskJudgment', 'managementImplication'],
          properties: {
            heading: { type: 'string' },
            factBasis: { type: 'string' },
            riskJudgment: { type: 'string' },
            managementImplication: { type: 'string' },
          },
        },
      },
      riskItems: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['priorityLevel', 'riskName', 'basis', 'manifestation', 'impact', 'focus'],
          properties: {
            priorityLevel: { type: 'string', enum: [...GOVINSIGHT_RISK_PRIORITY_LEVELS] },
            riskName: { type: 'string' },
            basis: { type: 'string' },
            manifestation: { type: 'string' },
            impact: { type: 'string' },
            focus: { type: 'string' },
          },
        },
      },
      confirmedFacts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['category', 'points'],
          properties: {
            category: { type: 'string' },
            points: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      prudentAnalyses: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['topic', 'analysis', 'support', 'caution'],
          properties: {
            topic: { type: 'string' },
            analysis: { type: 'string' },
            support: { type: 'string' },
            caution: { type: 'string' },
          },
        },
      },
      unansweredQuestions: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['question', 'currentLimit', 'nextDataNeeded'],
          properties: {
            question: { type: 'string' },
            currentLimit: { type: 'string' },
            nextDataNeeded: { type: 'string' },
          },
        },
      },
      rectificationTasks: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'sequence',
            'taskName',
            'taskType',
            'priority',
            'problem',
            'measure',
            'leadUnit',
            'supportUnits',
            'responsibilityLevel',
            'deadline',
            'milestones',
            'trackingIndicator',
            'supervisionMethod',
          ],
          properties: {
            sequence: { type: 'number' },
            taskName: { type: 'string' },
            taskType: { type: 'string', enum: [...GOVINSIGHT_TASK_TYPES] },
            priority: { type: 'string', enum: [...GOVINSIGHT_TASK_PRIORITIES] },
            problem: { type: 'string' },
            measure: { type: 'string' },
            leadUnit: { type: 'string' },
            supportUnits: { type: 'string' },
            responsibilityLevel: { type: 'string' },
            deadline: { type: 'string' },
            milestones: { type: 'array', items: { type: 'string' } },
            trackingIndicator: { type: 'string' },
            supervisionMethod: { type: 'string' },
          },
        },
      },
      closing: { type: 'string' },
      notes: { type: 'array', items: { type: 'string' } },
    },
  };
}

export function validateGovInsightNarrative(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!pushIfNotObject(errors, 'report', value)) {
    return { valid: false, errors };
  }

  const metadata = value.metadata;
  if (pushIfNotObject(errors, 'metadata', metadata)) {
    pushIfInvalidString(errors, 'metadata.reportTitle', metadata.reportTitle);
    pushIfInvalidString(errors, 'metadata.summaryLine', metadata.summaryLine);
    pushIfInvalidString(errors, 'metadata.overallOverview', metadata.overallOverview);
    pushIfInvalidString(errors, 'metadata.positioning', metadata.positioning);
    pushIfInvalidString(errors, 'metadata.evidenceBasis', metadata.evidenceBasis);
    pushIfInvalidString(errors, 'metadata.cautionNote', metadata.cautionNote);
  }

  const overallJudgments = value.overallJudgments;
  if (pushIfNotArray(errors, 'overallJudgments', overallJudgments)) {
    overallJudgments.forEach((item, index) => {
      if (!pushIfNotObject(errors, `overallJudgments[${index}]`, item)) return;
      pushIfInvalidString(errors, `overallJudgments[${index}].heading`, item.heading);
      pushIfInvalidString(errors, `overallJudgments[${index}].factBasis`, item.factBasis);
      pushIfInvalidString(errors, `overallJudgments[${index}].riskJudgment`, item.riskJudgment);
      pushIfInvalidString(errors, `overallJudgments[${index}].managementImplication`, item.managementImplication);
    });
  }

  const riskItems = value.riskItems;
  if (pushIfNotArray(errors, 'riskItems', riskItems)) {
    riskItems.forEach((item, index) => {
      if (!pushIfNotObject(errors, `riskItems[${index}]`, item)) return;
      if (!GOVINSIGHT_RISK_PRIORITY_LEVELS.includes(item.priorityLevel as any)) {
        errors.push(`riskItems[${index}].priorityLevel must be one of ${GOVINSIGHT_RISK_PRIORITY_LEVELS.join(', ')}`);
      }
      pushIfInvalidString(errors, `riskItems[${index}].riskName`, item.riskName);
      pushIfInvalidString(errors, `riskItems[${index}].basis`, item.basis);
      pushIfInvalidString(errors, `riskItems[${index}].manifestation`, item.manifestation);
      pushIfInvalidString(errors, `riskItems[${index}].impact`, item.impact);
      pushIfInvalidString(errors, `riskItems[${index}].focus`, item.focus);
    });
  }

  const confirmedFacts = value.confirmedFacts;
  if (pushIfNotArray(errors, 'confirmedFacts', confirmedFacts)) {
    confirmedFacts.forEach((item, index) => {
      if (!pushIfNotObject(errors, `confirmedFacts[${index}]`, item)) return;
      pushIfInvalidString(errors, `confirmedFacts[${index}].category`, item.category);
      if (!isStringArray(item.points)) {
        errors.push(`confirmedFacts[${index}].points must be an array of strings`);
      }
    });
  }

  const prudentAnalyses = value.prudentAnalyses;
  if (pushIfNotArray(errors, 'prudentAnalyses', prudentAnalyses)) {
    prudentAnalyses.forEach((item, index) => {
      if (!pushIfNotObject(errors, `prudentAnalyses[${index}]`, item)) return;
      pushIfInvalidString(errors, `prudentAnalyses[${index}].topic`, item.topic);
      pushIfInvalidString(errors, `prudentAnalyses[${index}].analysis`, item.analysis);
      pushIfInvalidString(errors, `prudentAnalyses[${index}].support`, item.support);
      pushIfInvalidString(errors, `prudentAnalyses[${index}].caution`, item.caution);
    });
  }

  const unansweredQuestions = value.unansweredQuestions;
  if (pushIfNotArray(errors, 'unansweredQuestions', unansweredQuestions)) {
    unansweredQuestions.forEach((item, index) => {
      if (!pushIfNotObject(errors, `unansweredQuestions[${index}]`, item)) return;
      pushIfInvalidString(errors, `unansweredQuestions[${index}].question`, item.question);
      pushIfInvalidString(errors, `unansweredQuestions[${index}].currentLimit`, item.currentLimit);
      pushIfInvalidString(errors, `unansweredQuestions[${index}].nextDataNeeded`, item.nextDataNeeded);
    });
  }

  const rectificationTasks = value.rectificationTasks;
  if (pushIfNotArray(errors, 'rectificationTasks', rectificationTasks)) {
    rectificationTasks.forEach((item, index) => {
      if (!pushIfNotObject(errors, `rectificationTasks[${index}]`, item)) return;
      if (typeof item.sequence !== 'number' || !Number.isFinite(item.sequence)) {
        errors.push(`rectificationTasks[${index}].sequence must be a number`);
      }
      if (!GOVINSIGHT_TASK_TYPES.includes(item.taskType as any)) {
        errors.push(`rectificationTasks[${index}].taskType must be one of ${GOVINSIGHT_TASK_TYPES.join(', ')}`);
      }
      if (!GOVINSIGHT_TASK_PRIORITIES.includes(item.priority as any)) {
        errors.push(`rectificationTasks[${index}].priority must be one of ${GOVINSIGHT_TASK_PRIORITIES.join(', ')}`);
      }
      pushIfInvalidString(errors, `rectificationTasks[${index}].taskName`, item.taskName);
      pushIfInvalidString(errors, `rectificationTasks[${index}].problem`, item.problem);
      pushIfInvalidString(errors, `rectificationTasks[${index}].measure`, item.measure);
      pushIfInvalidString(errors, `rectificationTasks[${index}].leadUnit`, item.leadUnit);
      pushIfInvalidString(errors, `rectificationTasks[${index}].supportUnits`, item.supportUnits);
      pushIfInvalidString(errors, `rectificationTasks[${index}].responsibilityLevel`, item.responsibilityLevel);
      pushIfInvalidString(errors, `rectificationTasks[${index}].deadline`, item.deadline);
      pushIfInvalidString(errors, `rectificationTasks[${index}].trackingIndicator`, item.trackingIndicator);
      pushIfInvalidString(errors, `rectificationTasks[${index}].supervisionMethod`, item.supervisionMethod);
      if (!isStringArray(item.milestones)) {
        errors.push(`rectificationTasks[${index}].milestones must be an array of strings`);
      }
    });
  }

  pushIfInvalidString(errors, 'closing', value.closing);
  if (!isStringArray(value.notes)) {
    errors.push('notes must be an array of strings');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateGovInsightReportPayload(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!pushIfNotObject(errors, 'reportPayload', value)) {
    return { valid: false, errors };
  }

  if (value.version !== GOVINSIGHT_PAYLOAD_VERSION) {
    errors.push(`reportPayload.version must equal ${GOVINSIGHT_PAYLOAD_VERSION}`);
  }
  if (!pushIfNotObject(errors, 'reportPayload.metricsSnapshot', value.metricsSnapshot)) {
    // noop
  }
  if (!pushIfNotObject(errors, 'reportPayload.dataQuality', value.dataQuality)) {
    // noop
  }
  if (!pushIfNotObject(errors, 'reportPayload.riskAssessment', value.riskAssessment)) {
    // noop
  }
  if (!pushIfNotObject(errors, 'reportPayload.metadataSeeds', value.metadataSeeds)) {
    // noop
  }
  if (!pushIfNotArray(errors, 'reportPayload.riskPrioritySeeds', value.riskPrioritySeeds)) {
    // noop
  }
  if (!pushIfNotArray(errors, 'reportPayload.rectificationTaskSkeleton', value.rectificationTaskSkeleton)) {
    // noop
  }
  if (!pushIfNotObject(errors, 'reportPayload.appendixSkeleton', value.appendixSkeleton)) {
    // noop
  } else {
    if (!pushIfNotArray(errors, 'reportPayload.appendixSkeleton.metricAuditRows', value.appendixSkeleton.metricAuditRows)) {
      // noop
    }
    if (!pushIfNotArray(errors, 'reportPayload.appendixSkeleton.usageBoundaries', value.appendixSkeleton.usageBoundaries)) {
      // noop
    }
    if (!pushIfNotArray(errors, 'reportPayload.appendixSkeleton.supplementDataItems', value.appendixSkeleton.supplementDataItems)) {
      // noop
    }
  }
  if (!pushIfNotObject(errors, 'reportPayload.contentBoundaries', value.contentBoundaries)) {
    // noop
  }
  if (value.hierarchyAnalysis != null && !pushIfNotObject(errors, 'reportPayload.hierarchyAnalysis', value.hierarchyAnalysis)) {
    // noop
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateGovInsightStoredEnvelope(value: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!pushIfNotObject(errors, 'storedEnvelope', value)) {
    return { valid: false, errors };
  }

  if (value._reportFormat !== GOVINSIGHT_FORMAL_REPORT_FORMAT) {
    errors.push(`storedEnvelope._reportFormat must equal ${GOVINSIGHT_FORMAL_REPORT_FORMAT}`);
  }
  if (value._protocolVersion !== GOVINSIGHT_AI_REPORT_PROTOCOL_VERSION) {
    errors.push(`storedEnvelope._protocolVersion must equal ${GOVINSIGHT_AI_REPORT_PROTOCOL_VERSION}`);
  }
  if (!isPlainObject(value.narrative)) {
    errors.push('storedEnvelope.narrative must be an object');
  }
  if (!isPlainObject(value.reportContent)) {
    errors.push('storedEnvelope.reportContent must be an object');
  }
  if (isPlainObject(value.narrative)) {
    const validation = validateGovInsightNarrative(value.narrative);
    if (!validation.valid) {
      errors.push(...validation.errors.map((item) => `storedEnvelope.narrative.${item}`));
    }
  }
  if (isPlainObject(value.reportContent)) {
    const validation = validateGovInsightNarrative(value.reportContent);
    if (!validation.valid) {
      errors.push(...validation.errors.map((item) => `storedEnvelope.reportContent.${item}`));
    }
  }
  if (value.reportPayload != null) {
    const payloadValidation = validateGovInsightReportPayload(value.reportPayload);
    if (!payloadValidation.valid) {
      errors.push(...payloadValidation.errors.map((item) => `storedEnvelope.${item}`));
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export interface ScorecardSnapshot {
  key: string;
  label: string;
  unit: '%' | '件';
  current: number;
  previous: number | null;
  changePct: number | null;
  status: 'good' | 'watch' | 'risk';
}

export interface MetricsSnapshotV1 {
  version: typeof GOVINSIGHT_METRIC_VERSION;
  regionId: number;
  year: number;
  materializeStatus: MaterializeStatus;
  acceptedTotal: number;
  newReceived: number;
  carriedOver: number;
  carriedForward: number;
  resolvedTotal: number;
  substantiveRate: number;
  unableRate: number;
  noInfoShareInUnable: number;
  revRate: number;
  litRate: number;
  overallCorrectionRate: number;
  carryForwardRate: number;
  yoy: Record<string, number | null>;
  scorecards: ScorecardSnapshot[];
}

export interface DataQualityCheckItem {
  key: string;
  label: string;
  passed: boolean;
  actual: number | null;
  expected: number | null;
  note: string;
}

export interface DataQualityV1 {
  version: typeof GOVINSIGHT_DATA_QUALITY_VERSION;
  materializeStatus: MaterializeStatus;
  hasAnomaly: boolean;
  factConclusionAllowed: boolean;
  warnings: string[];
  checks: DataQualityCheckItem[];
  consistencySummary: {
    fail: number;
    uncertain: number;
    pass: number;
    notAssessable: number;
    total: number;
  } | null;
  derivedRiskScore: number | null;
}

export interface ReportMetadataSeedV1 {
  reportTitle: string;
  summaryLine: string;
  overallOverview: string;
  positioning: string;
  evidenceBasis: string;
  cautionNote: string;
  auxiliaryRiskLevel: string;
  auxiliaryRiskLevelNote: string;
}

export interface RiskPrioritySeedV1 {
  sequence: number;
  priorityLevel: '首要关注事项' | '重点关注事项' | '持续跟踪事项';
  riskName: string;
  basis: string;
  manifestation: string;
  impact: string;
  focus: string;
}

export interface RectificationTaskSeedV1 {
  sequence: number;
  taskName: string;
  taskType: '机制建设类' | '规范整治类' | '能力提升类' | '平台治理类' | '监督保障类';
  priority: '近期立即推进' | '年内持续推进' | '中期完善';
  problem: string;
  measure: string;
  leadUnit: string;
  supportUnits: string;
  responsibilityLevel: string;
  deadline: string;
  milestones: string[];
  trackingIndicator: string;
  supervisionMethod: string;
}

export interface AppendixMetricAuditRowV1 {
  indicator: string;
  sourceFields: string;
  formula: string;
  currentValue: string;
  previousValue: string;
  reconciliationNote: string;
}

export interface AppendixBoundarySeedV1 {
  title: string;
  description: string;
}

export interface AppendixSupplementSeedV1 {
  item: string;
  purpose: string;
  suggestedSource: string;
  note: string;
}

export interface ContentBoundaryV1 {
  factConclusionAllowed: boolean;
  factConstraint: string;
  analysisConstraint: string;
  prohibitedScopes: string[];
  appendixGenerationRule: string;
}

export interface HierarchyAnalysisItemV1 {
  regionId: number;
  orgId: string;
  orgName: string;
  unitType: CanonicalUnitType;
  materializeStatus: MaterializeStatus | string | null;
  riskLevel: 'red' | 'yellow' | 'green' | 'missing' | null;
  riskReason: string | null;
  newApplications: number | null;
  acceptedTotal: number | null;
  disclosureRate: number | null;
  correctionRate: number | null;
  isSampleSufficient: boolean;
}

export interface HierarchyCoverageV1 {
  available: boolean;
  total: number;
  reportCoverage: string;
  parseSuccessRate: string;
  statsCoverage: string;
  analyzableCoverage: string;
  officialCoverage: string;
}

export interface HierarchyAnalysisV1 {
  districtCoverage: HierarchyCoverageV1;
  departmentCoverage: HierarchyCoverageV1;
  districtFocus: HierarchyAnalysisItemV1[];
  departmentFocus: HierarchyAnalysisItemV1[];
}

export interface ReportPayloadV1 {
  version: typeof GOVINSIGHT_PAYLOAD_VERSION;
  regionId: number;
  year: number;
  orgName: string;
  unitType: CanonicalUnitType;
  parentRegionId: number | null;
  cityRegionId: number | null;
  materializeStatus: MaterializeStatus;
  sourceReportVersionId: number | null;
  metricVersion: string;
  mappingVersion: string;
  promptVersion: string;
  outputSchemaVersion: string;
  metricsSnapshot: MetricsSnapshotV1;
  dataQuality: DataQualityV1;
  riskAssessment: {
    rating: 'A' | 'B' | 'C';
    riskLabel: string;
    reason: string;
  };
  metadataSeeds: ReportMetadataSeedV1;
  riskPrioritySeeds: RiskPrioritySeedV1[];
  rectificationTaskSkeleton: RectificationTaskSeedV1[];
  appendixSkeleton: {
    metricAuditRows: AppendixMetricAuditRowV1[];
    usageBoundaries: AppendixBoundarySeedV1[];
    supplementDataItems: AppendixSupplementSeedV1[];
  };
  contentBoundaries: ContentBoundaryV1;
  hierarchyAnalysis?: HierarchyAnalysisV1;
}

interface StoredNarrativeEnvelopeInput {
  narrative?: Record<string, unknown> | null;
  reportContent?: Record<string, unknown> | null;
  reportPayload?: ReportPayloadV1 | Record<string, unknown> | null;
  materializeStatus?: MaterializeStatus | string | null;
  sourceReportVersionId?: number | null;
  sourceJobId?: number | null;
  modelUsed?: string | null;
  promptVersion?: string | null;
  payloadVersion?: string | null;
  outputSchemaVersion?: string | null;
}

export interface GovInsightStoredEnvelopeView {
  reportFormat: string | null;
  protocolVersion: string | null;
  promptVersion: string | null;
  payloadVersion: string | null;
  outputSchemaVersion: string | null;
  materializeStatus: string | null;
  sourceReportVersionId: number | null;
  sourceJobId: number | null;
  modelUsed: string | null;
  reportPayload: ReportPayloadV1 | Record<string, unknown> | null;
  narrative: Record<string, unknown> | null;
  reportContent: Record<string, unknown> | null;
}

function toNullableFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLooseText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function ensureChineseSentence(value: unknown): string {
  const text = normalizeLooseText(value);
  if (!text) return '';
  return /[。！？]$/.test(text) ? text : `${text}。`;
}

function firstNonEmptyText(...values: unknown[]): string {
  for (const value of values) {
    const text = normalizeLooseText(value);
    if (text) return text;
  }
  return '';
}

function toNonEmptyStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ensureChineseSentence(item))
    .filter(Boolean);
}

function uniqueStringList(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => isPlainObject(item));
}

function mergeNarrativeItemsWithFallback(
  overrides: Record<string, unknown>[] | null | undefined,
  fallback: Record<string, unknown>[],
  maxItems: number
): Record<string, unknown>[] {
  const normalizedOverrides = Array.isArray(overrides)
    ? overrides.filter((item): item is Record<string, unknown> => isPlainObject(item))
    : [];
  const merged = normalizedOverrides.length
    ? [...normalizedOverrides, ...fallback.slice(normalizedOverrides.length)]
    : fallback;
  return merged.slice(0, maxItems);
}

export function getGovInsightNarrativeExpectedCounts(
  payload: ReportPayloadV1 | Record<string, unknown> | null | undefined
): {
  overallJudgments: number;
  riskItems: number;
  rectificationTasks: number;
} {
  if (!payload || !isPlainObject(payload)) {
    return {
      overallJudgments: 0,
      riskItems: 0,
      rectificationTasks: 0,
    };
  }

  const riskPrioritySeeds = asObjectArray(payload.riskPrioritySeeds);
  const rectificationTaskSkeleton = asObjectArray(payload.rectificationTaskSkeleton);

  return {
    overallJudgments: Math.min(riskPrioritySeeds.length, 3),
    riskItems: Math.min(riskPrioritySeeds.length, GOVINSIGHT_MAX_RISK_ITEMS),
    rectificationTasks: Math.min(rectificationTaskSkeleton.length, GOVINSIGHT_MAX_RECTIFICATION_TASKS),
  };
}

export function assessGovInsightNarrativeProtocolIssues(
  narrative: Record<string, unknown> | null | undefined,
  payload: ReportPayloadV1 | Record<string, unknown> | null | undefined
): string[] {
  if (!narrative || !isPlainObject(narrative)) {
    return ['stored narrative missing'];
  }
  if (!payload || !isPlainObject(payload)) {
    return [];
  }

  const issues: string[] = [];
  const expectedCounts = getGovInsightNarrativeExpectedCounts(payload);
  const overallJudgments = asObjectArray(narrative.overallJudgments);
  const riskItems = asObjectArray(narrative.riskItems);
  const rectificationTasks = asObjectArray(narrative.rectificationTasks);
  const payloadRiskSeeds = asObjectArray(payload.riskPrioritySeeds);
  const payloadTaskSeeds = asObjectArray(payload.rectificationTaskSkeleton);

  if (expectedCounts.overallJudgments > 0 && overallJudgments.length < expectedCounts.overallJudgments) {
    issues.push(`overallJudgments too short: ${overallJudgments.length}/${expectedCounts.overallJudgments}`);
  }
  if (expectedCounts.riskItems > 0 && riskItems.length < expectedCounts.riskItems) {
    issues.push(`riskItems shorter than protocol expectation: ${riskItems.length}/${expectedCounts.riskItems}`);
  }
  if (expectedCounts.rectificationTasks > 0 && rectificationTasks.length < expectedCounts.rectificationTasks) {
    issues.push(
      `rectificationTasks shorter than protocol expectation: ${rectificationTasks.length}/${expectedCounts.rectificationTasks}`
    );
  }

  const riskPrefixLength = Math.min(riskItems.length, payloadRiskSeeds.length, expectedCounts.riskItems);
  for (let index = 0; index < riskPrefixLength; index += 1) {
    const actual = String(riskItems[index]?.priorityLevel || '');
    const expected = String(payloadRiskSeeds[index]?.priorityLevel || '');
    if (actual !== expected) {
      issues.push(`risk priority mismatch at index ${index}: ${actual} !== ${expected}`);
    }
  }

  const taskPrefixLength = Math.min(rectificationTasks.length, payloadTaskSeeds.length, expectedCounts.rectificationTasks);
  for (let index = 0; index < taskPrefixLength; index += 1) {
    const actualTask = rectificationTasks[index];
    const expectedTask = payloadTaskSeeds[index];
    if (Number(actualTask?.sequence) !== Number(expectedTask?.sequence)) {
      issues.push(
        `rectification sequence mismatch at index ${index}: ${String(actualTask?.sequence || '')} !== ${String(expectedTask?.sequence || '')}`
      );
    }
    if (String(actualTask?.taskType || '') !== String(expectedTask?.taskType || '')) {
      issues.push(
        `rectification taskType mismatch at index ${index}: ${String(actualTask?.taskType || '')} !== ${String(expectedTask?.taskType || '')}`
      );
    }
    if (String(actualTask?.priority || '') !== String(expectedTask?.priority || '')) {
      issues.push(
        `rectification priority mismatch at index ${index}: ${String(actualTask?.priority || '')} !== ${String(expectedTask?.priority || '')}`
      );
    }
  }

  return issues;
}

function coercePriorityLevel(value: unknown, fallback: string): string {
  const raw = normalizeLooseText(value).toLowerCase();
  if (!raw) return fallback;
  if (raw.includes('首要') || raw.includes('高') || raw.includes('high')) return '首要关注事项';
  if (raw.includes('重点') || raw.includes('中') || raw.includes('medium')) return '重点关注事项';
  if (raw.includes('持续') || raw.includes('低') || raw.includes('low')) return '持续跟踪事项';
  return fallback;
}

export function synthesizeGovInsightNarrativeFromPayload(
  payload: ReportPayloadV1 | Record<string, unknown>,
  overrides?: {
    metadata?: Record<string, unknown>;
    overallJudgments?: Record<string, unknown>[];
    riskItems?: Record<string, unknown>[];
    confirmedFacts?: Record<string, unknown>[];
    prudentAnalyses?: Record<string, unknown>[];
    unansweredQuestions?: Record<string, unknown>[];
    rectificationTasks?: Record<string, unknown>[];
    closing?: string;
    notes?: string[];
  }
): Record<string, unknown> | null {
  if (!isPlainObject(payload)) return null;

  const metadataSeeds = isPlainObject(payload.metadataSeeds) ? payload.metadataSeeds : {};
  const riskPrioritySeeds = Array.isArray(payload.riskPrioritySeeds)
    ? payload.riskPrioritySeeds.filter((item): item is Record<string, unknown> => isPlainObject(item))
    : [];
  const rectificationTaskSkeleton = Array.isArray(payload.rectificationTaskSkeleton)
    ? payload.rectificationTaskSkeleton.filter((item): item is Record<string, unknown> => isPlainObject(item))
    : [];
  const appendixSkeleton = isPlainObject(payload.appendixSkeleton) ? payload.appendixSkeleton : {};
  const contentBoundaries = isPlainObject(payload.contentBoundaries) ? payload.contentBoundaries : {};
  const dataQuality = isPlainObject(payload.dataQuality) ? payload.dataQuality : {};
  const riskAssessment = isPlainObject(payload.riskAssessment) ? payload.riskAssessment : {};
  const metricsSnapshot = isPlainObject(payload.metricsSnapshot) ? payload.metricsSnapshot : {};
  const orgName = firstNonEmptyText(payload.orgName, metadataSeeds.reportTitle);
  const year = toNullableFiniteNumber(payload.year);
  const expectedCounts = getGovInsightNarrativeExpectedCounts(payload);

  const fallbackMetadata: Record<string, unknown> = {
    reportTitle:
      firstNonEmptyText(
        overrides?.metadata?.reportTitle,
        metadataSeeds.reportTitle,
        year && orgName ? `${year}年度${orgName}政府信息公开智能辅策报告` : ''
      ) || '政府信息公开智能辅策报告',
    summaryLine:
      firstNonEmptyText(overrides?.metadata?.summaryLine, metadataSeeds.summaryLine) ||
      '综合判断：当前报告依据年度结构化统计数据整理形成，相关结论应在既有证据边界内审慎使用。',
    overallOverview:
      firstNonEmptyText(overrides?.metadata?.overallOverview, metadataSeeds.overallOverview) ||
      '本报告依据年度结构化统计数据和既有材料整理形成，用于反映当前工作运行情况、重点风险事项和下一步整改方向。',
    positioning:
      firstNonEmptyText(overrides?.metadata?.positioning, metadataSeeds.positioning) ||
      '供政府信息公开分管工作内部研判、任务分解和过程督办使用。',
    evidenceBasis:
      firstNonEmptyText(overrides?.metadata?.evidenceBasis, metadataSeeds.evidenceBasis) ||
      '依据年度结构化统计数据及既有材料整理形成。',
    cautionNote:
      firstNonEmptyText(overrides?.metadata?.cautionNote, metadataSeeds.cautionNote) ||
      '如结构化数据存在勾稽异常或证据边界不足，相关事实性结论应从严使用。',
  };

  const fallbackOverallJudgments =
    overrides?.overallJudgments?.filter((item) => isPlainObject(item) && validateGovInsightNarrative({
      metadata: fallbackMetadata,
      overallJudgments: [item],
      riskItems: [],
      confirmedFacts: [],
      prudentAnalyses: [],
      unansweredQuestions: [],
      rectificationTasks: [],
      closing: '占位。',
      notes: [],
    }).errors.length === 0) || [];

  const defaultOverallJudgments: Record<string, unknown>[] =
    fallbackOverallJudgments.length > 0
      ? fallbackOverallJudgments
      : (riskPrioritySeeds.slice(0, 3).map((seed, index) => ({
          heading: firstNonEmptyText(seed.riskName, `重点判断${index + 1}`),
          factBasis: ensureChineseSentence(firstNonEmptyText(seed.basis, fallbackMetadata.overallOverview)),
          riskJudgment: ensureChineseSentence(firstNonEmptyText(seed.manifestation, riskAssessment.reason)),
          managementImplication: ensureChineseSentence(firstNonEmptyText(seed.focus, '建议持续纳入后续整改和过程督办。')),
        })) as Record<string, unknown>[]);

  if (defaultOverallJudgments.length === 0) {
      defaultOverallJudgments.push({
        heading: '总体运行判断',
        factBasis: ensureChineseSentence(fallbackMetadata.overallOverview),
        riskJudgment: ensureChineseSentence(firstNonEmptyText(riskAssessment.reason, '当前报告依据现有统计数据形成综合判断。')),
        managementImplication: '建议围绕重点风险事项继续完善整改闭环和过程督办。',
      });
  }

  const defaultRiskItems: Record<string, unknown>[] =
    overrides?.riskItems?.filter((item) => isPlainObject(item)) ||
    riskPrioritySeeds.map((seed, index) => ({
      priorityLevel: coercePriorityLevel(seed.priorityLevel, index < 3 ? '首要关注事项' : '重点关注事项'),
      riskName: firstNonEmptyText(seed.riskName, `重点风险事项${index + 1}`),
      basis: ensureChineseSentence(firstNonEmptyText(seed.basis, fallbackMetadata.overallOverview)),
      manifestation: ensureChineseSentence(firstNonEmptyText(seed.manifestation, riskAssessment.reason)),
      impact: ensureChineseSentence(firstNonEmptyText(seed.impact, '如不及时处置，可能对后续规范化治理和争议防控形成压力。')),
      focus: ensureChineseSentence(firstNonEmptyText(seed.focus, '建议纳入后续任务分解和督办跟踪。')),
    }));

  if (defaultRiskItems.length === 0) {
    defaultRiskItems.push({
      priorityLevel: '重点关注事项',
      riskName: '基础数据和重点环节仍需持续跟进',
      basis: ensureChineseSentence(firstNonEmptyText(riskAssessment.reason, fallbackMetadata.overallOverview)),
      manifestation: '从现有数据看，重点环节仍需继续梳理问题、压实责任并完善闭环管理。',
      impact: '如相关基础工作推进不及时，可能影响后续研判使用和整改落实效果。',
      focus: '建议围绕基础数据复核、重点风险整治和过程督办持续推进。',
    });
  }

  const seededOverallJudgments = riskPrioritySeeds.slice(0, 3).map((seed, index) => ({
    heading: firstNonEmptyText(seed.riskName, `重点判断${index + 1}`),
    factBasis: ensureChineseSentence(firstNonEmptyText(seed.basis, fallbackMetadata.overallOverview)),
    riskJudgment: ensureChineseSentence(firstNonEmptyText(seed.manifestation, riskAssessment.reason)),
    managementImplication: ensureChineseSentence(
      firstNonEmptyText(seed.focus, '建议继续纳入后续整改和过程督办。')
    ),
  })) as Record<string, unknown>[];
  const seededRiskItems = riskPrioritySeeds.map((seed, index) => ({
    priorityLevel: coercePriorityLevel(
      seed.priorityLevel,
      index < 3 ? GOVINSIGHT_RISK_PRIORITY_LEVELS[0] : GOVINSIGHT_RISK_PRIORITY_LEVELS[1]
    ),
    riskName: firstNonEmptyText(seed.riskName, `重点风险事项${index + 1}`),
    basis: ensureChineseSentence(firstNonEmptyText(seed.basis, fallbackMetadata.overallOverview)),
    manifestation: ensureChineseSentence(firstNonEmptyText(seed.manifestation, riskAssessment.reason)),
    impact: ensureChineseSentence(
      firstNonEmptyText(seed.impact, '如不及时处置，可能对后续规范化治理和争议防控形成压力。')
    ),
    focus: ensureChineseSentence(firstNonEmptyText(seed.focus, '建议纳入后续任务分解和督办跟踪。')),
  }));

  const mergedOverallJudgments = mergeNarrativeItemsWithFallback(
    fallbackOverallJudgments,
    seededOverallJudgments.length ? seededOverallJudgments : defaultOverallJudgments,
    expectedCounts.overallJudgments || GOVINSIGHT_MAX_OVERALL_JUDGMENTS
  );
  const mergedRiskItems = mergeNarrativeItemsWithFallback(
    overrides?.riskItems,
    seededRiskItems.length ? seededRiskItems : defaultRiskItems,
    expectedCounts.riskItems || GOVINSIGHT_MAX_RISK_ITEMS
  );

  const defaultConfirmedFacts =
    overrides?.confirmedFacts?.filter((item) => isPlainObject(item)) ||
    [
      {
        category: '依申请公开办理规模情况',
        points: [
          year ? `${year}年度有关核心指标已形成年度统计摘录。` : '',
          toNullableFiniteNumber(metricsSnapshot.newReceived) !== null
            ? `本年新收申请${Number(metricsSnapshot.newReceived).toLocaleString('zh-CN')}件。`
            : '',
          toNullableFiniteNumber(metricsSnapshot.carriedOver) !== null
            ? `上年结转${Number(metricsSnapshot.carriedOver).toLocaleString('zh-CN')}件。`
            : '',
          toNullableFiniteNumber(metricsSnapshot.acceptedTotal) !== null
            ? `受理总量${Number(metricsSnapshot.acceptedTotal).toLocaleString('zh-CN')}件。`
            : '',
          toNullableFiniteNumber(metricsSnapshot.carriedForward) !== null
            ? `结转下年${Number(metricsSnapshot.carriedForward).toLocaleString('zh-CN')}件。`
            : '',
        ].filter(Boolean),
      },
      {
        category: '办理结果结构情况',
        points: [
          toNullableFiniteNumber(metricsSnapshot.substantiveRate) !== null
            ? `实质公开率${Number(metricsSnapshot.substantiveRate).toFixed(1)}%。`
            : '',
          toNullableFiniteNumber(metricsSnapshot.unableRate) !== null
            ? `无法提供占比${Number(metricsSnapshot.unableRate).toFixed(1)}%。`
            : '',
          toNullableFiniteNumber(metricsSnapshot.noInfoShareInUnable) !== null
            ? `“本机关不掌握相关信息”占“无法提供”比重${Number(metricsSnapshot.noInfoShareInUnable).toFixed(1)}%。`
            : '',
          toNullableFiniteNumber(metricsSnapshot.carryForwardRate) !== null
            ? `结转率${Number(metricsSnapshot.carryForwardRate).toFixed(1)}%。`
            : '',
        ].filter(Boolean),
      },
      {
        category: '行政争议情况',
        points: [
          toNullableFiniteNumber(metricsSnapshot.revRate) !== null
            ? `复议纠正占比${Number(metricsSnapshot.revRate).toFixed(1)}%。`
            : '',
          toNullableFiniteNumber(metricsSnapshot.litRate) !== null
            ? `诉讼纠正占比${Number(metricsSnapshot.litRate).toFixed(1)}%。`
            : '',
          toNullableFiniteNumber(metricsSnapshot.overallCorrectionRate) !== null
            ? `整体纠正占比${Number(metricsSnapshot.overallCorrectionRate).toFixed(1)}%。`
            : '',
        ].filter(Boolean),
      },
    ].filter((item) => Array.isArray(item.points) && item.points.length > 0);

  const defaultPrudentAnalyses =
    overrides?.prudentAnalyses?.filter((item) => isPlainObject(item)) ||
    defaultRiskItems.slice(0, 3).map((item) => ({
      topic: firstNonEmptyText(item.riskName, '重点分析'),
      analysis: ensureChineseSentence(firstNonEmptyText(item.manifestation, item.basis, fallbackMetadata.overallOverview)),
      support: ensureChineseSentence(firstNonEmptyText(item.basis, riskAssessment.reason)),
      caution: ensureChineseSentence(
        firstNonEmptyText(
          contentBoundaries.analysisConstraint,
          '上述分析仅依据当前结构化结果和已留存材料作出，仍需结合源台账和业务明细审慎使用。'
        )
      ),
    }));

  const defaultUnansweredQuestions =
    overrides?.unansweredQuestions?.filter((item) => isPlainObject(item)) ||
    (() => {
      const warnings = Array.isArray(dataQuality.warnings) ? dataQuality.warnings.map((item) => ensureChineseSentence(item)) : [];
      const prohibitedScopes = Array.isArray(contentBoundaries.prohibitedScopes)
        ? contentBoundaries.prohibitedScopes.map((item) => ensureChineseSentence(item))
        : [];
      const items: Record<string, unknown>[] = [];

      if (warnings.length) {
        items.push({
          question: '当前结构化数据中仍有哪些口径需要进一步复核？',
          currentLimit: warnings.slice(0, 2).join(' '),
          nextDataNeeded: '建议补充源年报台账、分类明细和对应审核记录，完成勾稽复核后再固化事实性判断。',
        });
      }

      if (prohibitedScopes.length) {
        items.push({
          question: '本轮报告尚不能扩展到哪些超边界内容？',
          currentLimit: prohibitedScopes.slice(0, 2).join(' '),
          nextDataNeeded: '建议待区县、部门和专题明细完成结构化治理后，再纳入后续专题分析。',
        });
      }

        if (!items.length) {
          items.push({
            question: '当前报告还缺少哪些支撑长期趋势判断的底层材料？',
            currentLimit: '现有记录主要基于年度统计数据和既有报告内容，缺少更细粒度业务台账。',
            nextDataNeeded: '建议补充多年度对照数据、错因明细和单位层级明细后，再开展更深层研判。',
          });
        }

      return items;
    })();

  const defaultRectificationTasks =
    overrides?.rectificationTasks?.filter((item) => isPlainObject(item)) ||
    rectificationTaskSkeleton.map((task, index) => ({
      sequence: toNullableFiniteNumber(task.sequence) ?? index + 1,
      taskName: firstNonEmptyText(task.taskName, `整改任务${index + 1}`),
      taskType: firstNonEmptyText(task.taskType, GOVINSIGHT_TASK_TYPES[0]),
      priority: firstNonEmptyText(task.priority, GOVINSIGHT_TASK_PRIORITIES[0]),
      problem: ensureChineseSentence(
        firstNonEmptyText(task.problem, '需围绕重点风险持续完善治理流程。')
      ),
      measure: ensureChineseSentence(
        firstNonEmptyText(task.measure, '建议按照统一台账和既定安排细化整改措施。')
      ),
      leadUnit: firstNonEmptyText(task.leadUnit, '市政府办公室'),
      supportUnits: firstNonEmptyText(task.supportUnits, '有关地区、有关部门'),
      responsibilityLevel: firstNonEmptyText(task.responsibilityLevel, '市级统筹'),
      deadline: firstNonEmptyText(task.deadline, '按年度工作安排持续推进'),
      milestones: Array.isArray(task.milestones)
        ? task.milestones.map((item) => ensureChineseSentence(item)).filter(Boolean)
        : ['形成任务台账并持续跟踪整改进展。'],
      trackingIndicator: firstNonEmptyText(task.trackingIndicator, '整改任务完成率'),
      supervisionMethod: ensureChineseSentence(
        firstNonEmptyText(task.supervisionMethod, '纳入常态化督办和阶段性复盘。')
      ),
    }));

  const seededRectificationTasks = rectificationTaskSkeleton.map((task, index) => ({
    sequence: toNullableFiniteNumber(task.sequence) ?? index + 1,
    taskName: firstNonEmptyText(task.taskName, `整改任务${index + 1}`),
    taskType: firstNonEmptyText(task.taskType, GOVINSIGHT_TASK_TYPES[0]),
    priority: firstNonEmptyText(task.priority, GOVINSIGHT_TASK_PRIORITIES[0]),
    problem: ensureChineseSentence(
      firstNonEmptyText(task.problem, '需围绕重点风险持续完善治理流程。')
    ),
    measure: ensureChineseSentence(
      firstNonEmptyText(task.measure, '建议按照统一台账和既定安排细化整改措施。')
    ),
    leadUnit: firstNonEmptyText(task.leadUnit, '市政府办公室'),
    supportUnits: firstNonEmptyText(task.supportUnits, '有关地区、有关部门'),
    responsibilityLevel: firstNonEmptyText(task.responsibilityLevel, '市级统筹'),
    deadline: firstNonEmptyText(task.deadline, '按年度工作安排持续推进'),
    milestones: Array.isArray(task.milestones)
      ? task.milestones.map((item) => ensureChineseSentence(item)).filter(Boolean)
      : ['形成任务台账并持续跟踪整改进展。'],
    trackingIndicator: firstNonEmptyText(task.trackingIndicator, '整改任务完成率'),
    supervisionMethod: ensureChineseSentence(
      firstNonEmptyText(task.supervisionMethod, '纳入常态化督办和阶段性复盘。')
    ),
  }));

  const mergedRectificationTasks = mergeNarrativeItemsWithFallback(
    overrides?.rectificationTasks,
    seededRectificationTasks.length ? seededRectificationTasks : defaultRectificationTasks,
    expectedCounts.rectificationTasks || GOVINSIGHT_MAX_RECTIFICATION_TASKS
  );

  const defaultClosing =
    firstNonEmptyText(
      overrides?.closing,
      fallbackMetadata.overallOverview,
      riskAssessment.reason,
      '建议围绕重点风险、基础数据和整改任务持续推进闭环落实。'
    ) || '建议围绕重点风险、基础数据和整改任务持续推进闭环落实。';

  const defaultNotes = uniqueStringList(
    [
      ...((overrides?.notes || []).map((item) => ensureChineseSentence(item)).filter(Boolean) as string[]),
      ...(Array.isArray(dataQuality.warnings) ? dataQuality.warnings.map((item) => ensureChineseSentence(item)) : []),
      ...(Array.isArray(appendixSkeleton.usageBoundaries)
        ? appendixSkeleton.usageBoundaries
            .filter((item): item is Record<string, unknown> => isPlainObject(item))
            .map((item) => ensureChineseSentence(firstNonEmptyText(item.description, item.title)))
        : []),
    ]
  ).slice(0, 8);

  const report: Record<string, unknown> = {
    metadata: fallbackMetadata,
    overallJudgments: mergedOverallJudgments.slice(0, GOVINSIGHT_MAX_OVERALL_JUDGMENTS),
    riskItems: mergedRiskItems.slice(0, GOVINSIGHT_MAX_RISK_ITEMS),
    confirmedFacts: defaultConfirmedFacts.slice(0, 4),
    prudentAnalyses: defaultPrudentAnalyses.slice(0, 4),
    unansweredQuestions: defaultUnansweredQuestions.slice(0, 4),
    rectificationTasks: mergedRectificationTasks.slice(0, GOVINSIGHT_MAX_RECTIFICATION_TASKS),
    closing: ensureChineseSentence(defaultClosing),
    notes: defaultNotes.length
      ? defaultNotes
      : ['本报告依据年度结构化统计数据整理形成，供内部研判参考。'],
  };

  const validation = validateGovInsightNarrative(report);
  if (validation.valid) {
    return report;
  }

  return null;
}

function coerceLegacySummaryNarrative(
  raw: Record<string, unknown>,
  payload: ReportPayloadV1 | Record<string, unknown>
): Record<string, unknown> | null {
  const critique = isPlainObject(raw.critique) ? raw.critique : {};
  const strengths = toNonEmptyStringArray(critique.strengths);
  const weaknesses = toNonEmptyStringArray(critique.weaknesses);
  const plans = asObjectArray(raw.futurePlan);
  const payloadRiskSeeds = Array.isArray(payload.riskPrioritySeeds)
    ? payload.riskPrioritySeeds.filter((item): item is Record<string, unknown> => isPlainObject(item))
    : [];
  const payloadTaskSeeds = Array.isArray(payload.rectificationTaskSkeleton)
    ? payload.rectificationTaskSkeleton.filter((item): item is Record<string, unknown> => isPlainObject(item))
    : [];

  const overallJudgments: Record<string, unknown>[] = [];
  const summary = ensureChineseSentence(raw.summary);
  if (summary) {
    overallJudgments.push({
      heading: '总体运行判断',
      factBasis: summary,
      riskJudgment: ensureChineseSentence(firstNonEmptyText(weaknesses[0], payloadRiskSeeds[0]?.manifestation)),
      managementImplication: ensureChineseSentence(firstNonEmptyText(plans[0]?.title, payloadTaskSeeds[0]?.taskName, '建议围绕重点风险持续完善整改闭环。')),
    });
  }
  if (strengths.length) {
    overallJudgments.push({
      heading: '基础工作情况',
      factBasis: strengths.slice(0, 2).join(' '),
      riskJudgment: ensureChineseSentence(firstNonEmptyText(weaknesses[1], payloadRiskSeeds[1]?.manifestation, '说明基础工作与风险治理仍需统筹推进。')),
      managementImplication: ensureChineseSentence(firstNonEmptyText(plans[1]?.title, payloadTaskSeeds[1]?.taskName, '建议将基础工作优势转化为稳定治理能力。')),
    });
  }

  const riskItems = weaknesses.map((item, index) => {
    const fallback = payloadRiskSeeds[index] || payloadRiskSeeds[payloadRiskSeeds.length - 1] || {};
    return {
      priorityLevel: coercePriorityLevel(fallback.priorityLevel, index < 2 ? '首要关注事项' : '重点关注事项'),
      riskName: firstNonEmptyText(fallback.riskName, `重点风险事项${index + 1}`),
      basis: ensureChineseSentence(item),
      manifestation: ensureChineseSentence(firstNonEmptyText(fallback.manifestation, item)),
      impact: ensureChineseSentence(firstNonEmptyText(fallback.impact, '如不及时整改，可能继续影响规范办理和争议防控。')),
      focus: ensureChineseSentence(firstNonEmptyText(fallback.focus, '建议纳入后续重点整改事项。')),
    };
  });

  const confirmedFacts = strengths.length
    ? [{ category: '可确认的工作基础', points: strengths.slice(0, 5) }]
    : undefined;

  const prudentAnalyses = weaknesses.slice(0, 3).map((item, index) => {
    const fallback = payloadRiskSeeds[index] || {};
    return {
      topic: firstNonEmptyText(fallback.riskName, `重点分析${index + 1}`),
      analysis: ensureChineseSentence(item),
      support: ensureChineseSentence(firstNonEmptyText(fallback.basis, raw.summary)),
      caution: ensureChineseSentence('上述分析主要依据历史已生成内容整理形成，仍需结合结构化底座和源材料复核使用。'),
    };
  });

  const rectificationTasks = plans.map((item, index) => {
    const fallback = payloadTaskSeeds[index] || payloadTaskSeeds[payloadTaskSeeds.length - 1] || {};
    const planTitle = firstNonEmptyText(item.title, fallback.taskName, `整改任务${index + 1}`);
    const planContent = ensureChineseSentence(firstNonEmptyText(item.content, fallback.measure, '建议结合统一规则进一步细化整改动作。'));
    return {
      sequence: toNullableFiniteNumber(fallback.sequence) ?? index + 1,
      taskName: planTitle,
      taskType: firstNonEmptyText(fallback.taskType, '机制建设类'),
      priority: firstNonEmptyText(fallback.priority, '近期立即推进'),
      problem: ensureChineseSentence(firstNonEmptyText(fallback.problem, weaknesses[index], summary, '需围绕重点问题持续完善治理机制。')),
      measure: planContent,
      leadUnit: firstNonEmptyText(fallback.leadUnit, '市政府办公室'),
      supportUnits: firstNonEmptyText(fallback.supportUnits, '有关地区、有关部门'),
      responsibilityLevel: firstNonEmptyText(fallback.responsibilityLevel, '市级统筹'),
      deadline: firstNonEmptyText(fallback.deadline, '按年度计划持续推进'),
      milestones: Array.isArray(fallback.milestones)
        ? fallback.milestones.map((milestone) => ensureChineseSentence(milestone)).filter(Boolean)
        : [planContent],
      trackingIndicator: firstNonEmptyText(fallback.trackingIndicator, '任务完成率'),
      supervisionMethod: ensureChineseSentence(firstNonEmptyText(fallback.supervisionMethod, '纳入阶段性督办和复盘。')),
    };
  });

  return synthesizeGovInsightNarrativeFromPayload(payload, {
    metadata: {
      overallOverview: summary,
    },
    overallJudgments,
    riskItems,
    confirmedFacts,
    prudentAnalyses,
    rectificationTasks,
    closing: summary,
    notes: uniqueStringList([...strengths.slice(0, 2), ...weaknesses.slice(0, 2)]),
  });
}

function coerceLegacySectionNarrative(
  raw: Record<string, unknown>,
  payload: ReportPayloadV1 | Record<string, unknown>
): Record<string, unknown> | null {
  const executiveSummary = isPlainObject(raw.executiveSummary) ? raw.executiveSummary : {};
  const sections = isPlainObject(raw.sections) ? raw.sections : {};
  const problems = asObjectArray(raw.problems);
  const actionPlan = asObjectArray(raw.actionPlan);
  const payloadRiskSeeds = Array.isArray(payload.riskPrioritySeeds)
    ? payload.riskPrioritySeeds.filter((item): item is Record<string, unknown> => isPlainObject(item))
    : [];
  const payloadTaskSeeds = Array.isArray(payload.rectificationTaskSkeleton)
    ? payload.rectificationTaskSkeleton.filter((item): item is Record<string, unknown> => isPlainObject(item))
    : [];

  const overallJudgments: Record<string, unknown>[] = [];
  const sectionEntries: Array<[string, string]> = [
    ['requestAnalysis', '依申请公开运行情况'],
    ['legalRiskAnalysis', '争议风险情况'],
    ['disclosureAnalysis', '主动公开与平台支撑情况'],
  ];
  sectionEntries.forEach(([key, heading], index) => {
    const section = isPlainObject(sections[key]) ? sections[key] : null;
    if (!section) return;
    overallJudgments.push({
      heading,
      factBasis: ensureChineseSentence(firstNonEmptyText(section.summary, executiveSummary.overview)),
      riskJudgment: ensureChineseSentence(
        firstNonEmptyText(
          Array.isArray(section.bullets) ? section.bullets[0] : '',
          problems[index]?.description,
          payloadRiskSeeds[index]?.manifestation
        )
      ),
      managementImplication: ensureChineseSentence(
        firstNonEmptyText(actionPlan[index]?.title, payloadTaskSeeds[index]?.taskName, '建议围绕该项工作持续细化整改和督办。')
      ),
    });
  });

  const riskItems = problems.map((problem, index) => {
    const fallback = payloadRiskSeeds[index] || payloadRiskSeeds[payloadRiskSeeds.length - 1] || {};
    return {
      priorityLevel: coercePriorityLevel(problem.priority, firstNonEmptyText(fallback.priorityLevel, index < 2 ? '首要关注事项' : '重点关注事项')),
      riskName: firstNonEmptyText(problem.title, fallback.riskName, `重点风险事项${index + 1}`),
      basis: ensureChineseSentence(firstNonEmptyText(problem.description, fallback.basis)),
      manifestation: ensureChineseSentence(firstNonEmptyText(problem.cause, fallback.manifestation, problem.description)),
      impact: ensureChineseSentence(firstNonEmptyText(problem.impact, fallback.impact, '如不及时处置，可能持续影响治理质效和争议防控。')),
      focus: ensureChineseSentence(firstNonEmptyText(problem.focus, fallback.focus, '建议纳入年度重点整改任务。')),
    };
  });

  const confirmedFacts: Record<string, unknown>[] = [];
  sectionEntries.forEach(([key, heading]) => {
    const section = isPlainObject(sections[key]) ? sections[key] : null;
    const bullets = section && Array.isArray(section.bullets) ? section.bullets.map((item) => ensureChineseSentence(item)).filter(Boolean) : [];
    if (bullets.length) {
      confirmedFacts.push({
        category: heading,
        points: bullets.slice(0, 5),
      });
    }
  });

  const prudentAnalyses = problems.slice(0, 4).map((problem, index) => {
    const fallback = payloadRiskSeeds[index] || {};
    return {
      topic: firstNonEmptyText(problem.title, fallback.riskName, `重点分析${index + 1}`),
      analysis: ensureChineseSentence(firstNonEmptyText(problem.description, problem.cause, fallback.manifestation)),
      support: ensureChineseSentence(firstNonEmptyText(problem.cause, fallback.basis, executiveSummary.overview)),
      caution: ensureChineseSentence('上述分析主要依据既有统计数据和历史材料整理形成，仍需结合源台账和业务明细审慎使用。'),
    };
  });

  const rectificationTasks = actionPlan.map((item, index) => {
    const fallback = payloadTaskSeeds[index] || payloadTaskSeeds[payloadTaskSeeds.length - 1] || {};
    const measureParts = uniqueStringList([
      ensureChineseSentence(item.target),
      ensureChineseSentence(item.deliverable),
      ensureChineseSentence(fallback.measure),
    ]).filter(Boolean);
    return {
      sequence: toNullableFiniteNumber(fallback.sequence) ?? index + 1,
      taskName: firstNonEmptyText(item.title, fallback.taskName, `整改任务${index + 1}`),
      taskType: firstNonEmptyText(fallback.taskType, '机制建设类'),
      priority: firstNonEmptyText(fallback.priority, '近期立即推进'),
      problem: ensureChineseSentence(firstNonEmptyText(problems[index]?.description, fallback.problem, executiveSummary.overview, '需围绕重点风险持续完善治理机制。')),
      measure: measureParts.join(' ') || ensureChineseSentence(firstNonEmptyText(fallback.measure, '建议结合统一规则进一步细化整改动作。')),
      leadUnit: firstNonEmptyText(item.owner, fallback.leadUnit, '市政府办公室'),
      supportUnits: firstNonEmptyText(fallback.supportUnits, '有关地区、有关部门'),
      responsibilityLevel: firstNonEmptyText(fallback.responsibilityLevel, '市级统筹'),
      deadline: firstNonEmptyText(item.timeline, fallback.deadline, '按年度计划持续推进'),
      milestones: measureParts.length ? measureParts.slice(0, 3) : ['纳入台账并持续跟踪整改进展。'],
      trackingIndicator: firstNonEmptyText(item.deliverable, fallback.trackingIndicator, '整改任务完成率'),
      supervisionMethod: ensureChineseSentence(firstNonEmptyText(fallback.supervisionMethod, '纳入阶段性督办和结果复盘。')),
    };
  });

  const dataNotes = toNonEmptyStringArray(raw.dataNotes);
  const summaryLine =
    firstNonEmptyText(executiveSummary.summaryLine) ||
    firstNonEmptyText(executiveSummary.headline)
      ? `综合判断：${firstNonEmptyText(executiveSummary.summaryLine, executiveSummary.headline)}`.replace(/^综合判断：综合判断：/, '综合判断：')
      : '';

  return synthesizeGovInsightNarrativeFromPayload(payload, {
    metadata: {
      summaryLine,
      overallOverview: firstNonEmptyText(executiveSummary.overview, raw.closing),
    },
    overallJudgments,
    riskItems,
    confirmedFacts,
    prudentAnalyses,
    rectificationTasks,
    closing: firstNonEmptyText(raw.closing, executiveSummary.overview),
    notes: dataNotes,
  });
}

export function reconcileGovInsightNarrativeWithPayload(
  raw: unknown,
  payload?: ReportPayloadV1 | Record<string, unknown> | null
): Record<string, unknown> | null {
  if (!payload || !isPlainObject(payload)) {
    return isPlainObject(raw) ? raw : null;
  }

  const overrides = isPlainObject(raw)
    ? {
        metadata: isPlainObject(raw.metadata) ? (raw.metadata as Record<string, unknown>) : undefined,
        overallJudgments: asObjectArray(raw.overallJudgments),
        riskItems: asObjectArray(raw.riskItems),
        confirmedFacts: asObjectArray(raw.confirmedFacts),
        prudentAnalyses: asObjectArray(raw.prudentAnalyses),
        unansweredQuestions: asObjectArray(raw.unansweredQuestions),
        rectificationTasks: asObjectArray(raw.rectificationTasks),
        closing: isNonEmptyString(raw.closing) ? raw.closing : undefined,
        notes: isStringArray(raw.notes) ? raw.notes : undefined,
      }
    : undefined;

  return synthesizeGovInsightNarrativeFromPayload(payload, overrides);
}

export function coerceLegacyGovInsightNarrative(
  raw: unknown,
  payload?: ReportPayloadV1 | Record<string, unknown> | null
): Record<string, unknown> | null {
  if (isPlainObject(raw)) {
    const directValidation = validateGovInsightNarrative(raw);
    if (directValidation.valid) {
      return reconcileGovInsightNarrativeWithPayload(raw, payload) || raw;
    }
  }

  if (!payload || !isPlainObject(payload) || !isPlainObject(raw)) {
    return payload && isPlainObject(payload) ? synthesizeGovInsightNarrativeFromPayload(payload) : null;
  }

  if (typeof raw.summary === 'string' || isPlainObject(raw.critique) || Array.isArray(raw.futurePlan)) {
    const converted = coerceLegacySummaryNarrative(raw, payload);
    if (converted) return converted;
  }

  if (Array.isArray(raw.problems) || isPlainObject(raw.sections) || Array.isArray(raw.actionPlan)) {
    const converted = coerceLegacySectionNarrative(raw, payload);
    if (converted) return converted;
  }

  return synthesizeGovInsightNarrativeFromPayload(payload);
}

export function buildStoredNarrativeEnvelope(
  input: StoredNarrativeEnvelopeInput
): Record<string, unknown> {
  const reportContent =
    input.reportContent && typeof input.reportContent === 'object'
      ? input.reportContent
      : input.narrative && typeof input.narrative === 'object'
        ? input.narrative
        : null;
  const narrative =
    input.narrative && typeof input.narrative === 'object'
      ? input.narrative
      : input.reportContent && typeof input.reportContent === 'object'
        ? input.reportContent
        : null;

  return {
    _reportFormat: GOVINSIGHT_FORMAL_REPORT_FORMAT,
    _protocolVersion: GOVINSIGHT_AI_REPORT_PROTOCOL_VERSION,
    promptVersion: input.promptVersion || GOVINSIGHT_PROMPT_VERSION,
    payloadVersion: input.payloadVersion || GOVINSIGHT_PAYLOAD_VERSION,
    outputSchemaVersion: input.outputSchemaVersion || GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
    materializeStatus: input.materializeStatus || null,
    sourceReportVersionId: input.sourceReportVersionId ?? null,
    sourceJobId: input.sourceJobId ?? null,
    modelUsed: input.modelUsed || null,
    reportPayload: input.reportPayload || null,
    narrative,
    reportContent,
  };
}

export function extractGovInsightStoredEnvelope(value: unknown): GovInsightStoredEnvelopeView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const envelope = value as Record<string, unknown>;
  const reportPayload =
    envelope.reportPayload && typeof envelope.reportPayload === 'object' && !Array.isArray(envelope.reportPayload)
      ? (envelope.reportPayload as ReportPayloadV1 | Record<string, unknown>)
      : null;
  const narrative =
    envelope.narrative && typeof envelope.narrative === 'object' && !Array.isArray(envelope.narrative)
      ? (envelope.narrative as Record<string, unknown>)
      : null;
  const reportContent =
    envelope.reportContent && typeof envelope.reportContent === 'object' && !Array.isArray(envelope.reportContent)
      ? (envelope.reportContent as Record<string, unknown>)
      : null;

  if (!narrative && !reportContent) {
    return null;
  }

  return {
    reportFormat: isNonEmptyString(envelope._reportFormat) ? envelope._reportFormat : null,
    protocolVersion: isNonEmptyString(envelope._protocolVersion) ? envelope._protocolVersion : null,
    promptVersion: isNonEmptyString(envelope.promptVersion) ? envelope.promptVersion : null,
    payloadVersion: isNonEmptyString(envelope.payloadVersion) ? envelope.payloadVersion : null,
    outputSchemaVersion: isNonEmptyString(envelope.outputSchemaVersion) ? envelope.outputSchemaVersion : null,
    materializeStatus: isNonEmptyString(envelope.materializeStatus) ? envelope.materializeStatus : null,
    sourceReportVersionId: toNullableFiniteNumber(envelope.sourceReportVersionId),
    sourceJobId: toNullableFiniteNumber(envelope.sourceJobId),
    modelUsed: isNonEmptyString(envelope.modelUsed) ? envelope.modelUsed : null,
    reportPayload,
    narrative,
    reportContent,
  };
}
