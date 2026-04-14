import { AnnualData, EntityProfile } from '../types';

export type ReportRating = 'A' | 'B' | 'C';
export type ReportSignal = 'up' | 'down' | 'flat';
export type ReportStatus = 'good' | 'watch' | 'risk';
export type RiskPriorityLevel = '首要关注事项' | '重点关注事项' | '持续跟踪事项';
export type RectificationTaskType =
  | '机制建设类'
  | '规范整治类'
  | '能力提升类'
  | '平台治理类'
  | '监督保障类';
export type RectificationTaskPriority = '近期立即推进' | '年内持续推进' | '中期完善';

export interface AnnualReportSummary {
  title: string;
  publishDate: string;
  available: boolean;
  unitName?: string;
  rawTextPreview?: string;
  highlights: string[];
  problemSnippets: string[];
  improvements: string[];
  sections: {
    proactiveDisclosure: string;
    requestDisclosure: string;
    platformConstruction: string;
    supervision: string;
    problems: string;
    improvements: string;
  };
}

export interface ScorecardItem {
  key: string;
  label: string;
  unit: string;
  current: number;
  previous: number;
  changePct: number | null;
  signal: ReportSignal;
  status: ReportStatus;
  interpretation: string;
}

export interface ReconciliationCheck {
  key: string;
  label: string;
  expected: number;
  actual: number;
  passed: boolean;
  note: string;
}

export interface DataQualityStatus {
  hasAnomaly: boolean;
  factConclusionAllowed: boolean;
  warnings: string[];
  reconciliationChecks: ReconciliationCheck[];
}

export interface ReportMetricsSnapshot {
  year: number;
  newReceived: number;
  carriedOver: number;
  acceptedTotal: number;
  carriedForward: number;
  resolvedTotal: number;
  substantiveCount: number;
  publicCount: number;
  partialCount: number;
  notOpenCount: number;
  unableCount: number;
  ignoreCount: number;
  otherCount: number;
  substantiveRate: number;
  notOpenRate: number;
  unableRate: number;
  ignoreRate: number;
  otherRate: number;
  carryForwardRate: number;
  naturalCount: number;
  legalCount: number;
  naturalShare: number;
  legalShare: number;
  revTotal: number;
  revCorrected: number;
  revRate: number;
  litTotal: number;
  litCorrected: number;
  litRate: number;
  disputesTotal: number;
  disputesCorrected: number;
  overallCorrectionRate: number;
  regPublished: number;
  regActive: number;
  regAbolished: number;
  docPublished: number;
  docActive: number;
  docAbolished: number;
  actionLicensing: number;
  actionPunishment: number;
  actionForce: number;
  feeAmount: number;
  noInfoCount: number;
  needCreationCount: number;
  unclearCount: number;
  noInfoShareInUnable: number;
  stateSecretCount: number;
  lawForbiddenCount: number;
  dangerCount: number;
  thirdPartyCount: number;
  internalCount: number;
  processCount: number;
  enforcementCount: number;
  adminQueryCount: number;
  untreatedComplaintCount: number;
  repeatCount: number;
  publicationCount: number;
  massiveCount: number;
  confirmCount: number;
  overdueCorrectionCount: number;
  overdueFeeCount: number;
  otherReasonCount: number;
}

export interface ReportContextPayload {
  orgName: string;
  year: number;
  rating: ReportRating;
  riskLabel: string;
  auxiliaryRiskLevelNote: string;
  current: ReportMetricsSnapshot;
  previous: ReportMetricsSnapshot | null;
  provinceReference: ReportMetricsSnapshot | null;
  topSignals: string[];
  dataWarnings: string[];
  comparisonNotes: string[];
  annualReportSummary?: AnnualReportSummary | null;
  dataQuality: DataQualityStatus;
}

export interface ReportMetadata {
  reportTitle: string;
  summaryLine: string;
  overallOverview: string;
  positioning: string;
  evidenceBasis: string;
  cautionNote: string;
  auxiliaryRiskLevel: string;
  auxiliaryRiskLevelNote: string;
}

export interface OverallJudgmentItem {
  heading: string;
  factBasis: string;
  riskJudgment: string;
  managementImplication: string;
}

export interface RiskItem {
  priorityLevel: RiskPriorityLevel;
  riskName: string;
  basis: string;
  manifestation: string;
  impact: string;
  focus: string;
}

export interface FactGroupItem {
  category: string;
  points: string[];
}

export interface PrudentAnalysisItem {
  topic: string;
  analysis: string;
  support: string;
  caution: string;
}

export interface UnansweredQuestionItem {
  question: string;
  currentLimit: string;
  nextDataNeeded: string;
}

export interface RectificationTaskItem {
  sequence: number;
  taskName: string;
  taskType: RectificationTaskType;
  priority: RectificationTaskPriority;
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

export interface AppendixMetricRow {
  indicator: string;
  sourceFields: string;
  formula: string;
  currentValue: string;
  previousValue: string;
  reconciliationNote: string;
}

export interface AppendixBoundaryItem {
  title: string;
  description: string;
}

export interface AppendixSupplementItem {
  item: string;
  purpose: string;
  suggestedSource: string;
  note: string;
}

export interface ReportAppendices {
  metricAuditRows: AppendixMetricRow[];
  reconciliationChecks: ReconciliationCheck[];
  usageBoundaries: AppendixBoundaryItem[];
  supplementDataItems: AppendixSupplementItem[];
}

export interface EnhancedAIReportResponse {
  version: 'v4';
  metadata: ReportMetadata;
  overallJudgments: OverallJudgmentItem[];
  riskItems: RiskItem[];
  confirmedFacts: FactGroupItem[];
  prudentAnalyses: PrudentAnalysisItem[];
  unansweredQuestions: UnansweredQuestionItem[];
  rectificationTasks: RectificationTaskItem[];
  closing: string;
  notes: string[];
  scorecards: ScorecardItem[];
  dataQuality: DataQualityStatus;
  appendices: ReportAppendices;
}

interface FormalNarrativePayload {
  metadata?: Partial<ReportMetadata>;
  overallJudgments?: unknown;
  riskItems?: unknown;
  confirmedFacts?: unknown;
  prudentAnalyses?: unknown;
  unansweredQuestions?: unknown;
  rectificationTasks?: unknown;
  closing?: unknown;
  notes?: unknown;
}

interface LegacyAIReportResponse {
  summary?: unknown;
}

interface StoredNarrativeEnvelope {
  _reportFormat: 'govInsightNarrativeV1' | 'govInsightFormalReportV2';
  narrative: Record<string, unknown>;
}

const FORMAL_REPORT_FORMAT = 'govInsightFormalReportV2';
const RISK_PRIORITY_ORDER: Record<RiskPriorityLevel, number> = {
  首要关注事项: 1,
  重点关注事项: 2,
  持续跟踪事项: 3,
};

const TASK_TYPE_VALUES: RectificationTaskType[] = [
  '机制建设类',
  '规范整治类',
  '能力提升类',
  '平台治理类',
  '监督保障类',
];

const TASK_PRIORITY_VALUES: RectificationTaskPriority[] = ['近期立即推进', '年内持续推进', '中期完善'];

const safeDivide = (num: number, den: number): number => {
  if (!den) return 0;
  return num / den;
};

const round1 = (value: number): number => Math.round(value * 10) / 10;

const sumNumbers = (...values: Array<number | undefined | null>): number =>
  values.reduce((total, value) => total + (Number.isFinite(Number(value)) ? Number(value) : 0), 0);

const normalizeText = (value: unknown): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const SOFTENING_RULES: Array<[RegExp, string]> = [
  [/显著改善/g, '有所改善'],
  [/显著提升/g, '有所提升'],
  [/显著优化/g, '有所优化'],
  [/明显改善/g, '有改善迹象'],
  [/明显提升/g, '有所提升'],
  [/明显优化/g, '有所优化'],
  [/明显扩容/g, '有所增加'],
  [/大幅提升/g, '有所上升'],
  [/大幅下降/g, '有所下降'],
  [/大幅优化/g, '有所优化'],
  [/持续向好/g, '总体可控'],
  [/成效明显/g, '取得一定进展'],
  [/智慧治理/g, '政务公开'],
  [/联合研判/g, '综合分析'],
  [/图表研判/g, '数据分析'],
  [/黄色关注/g, '需持续关注'],
  [/红色预警/g, '需重点警惕'],
];

const softenInferenceText = (value: unknown, fallback = ''): string => {
  let text = normalizeText(value || fallback);
  SOFTENING_RULES.forEach(([pattern, replacement]) => {
    text = text.replace(pattern, replacement);
  });
  return text;
};

const sanitizeStringArray = (value: unknown, fallback: string[] = []): string[] => {
  const source = Array.isArray(value) ? value : fallback;
  return source
    .map((item) => softenInferenceText(item))
    .filter(Boolean);
};

const uniqueStrings = (items: string[]): string[] => Array.from(new Set(items.filter(Boolean)));

const sanitizeMilestones = (value: unknown, fallback: string[] = []): string[] => {
  if (Array.isArray(value)) {
    const next = value
      .map((item) => softenInferenceText(item))
      .filter(Boolean)
      .slice(0, 5);
    return next.length ? next : fallback;
  }

  const normalized = softenInferenceText(value);
  if (!normalized) return fallback;

  const parts = normalized
    .split(/[；;]\s*|\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);

  return parts.length ? parts : fallback;
};

const annualSummaryAvailable = (summary?: AnnualReportSummary | null): boolean => Boolean(summary?.available);

const annualSummaryText = (summary?: AnnualReportSummary | null): string =>
  [
    ...(summary?.highlights || []),
    ...(summary?.problemSnippets || []),
    ...(summary?.improvements || []),
    summary?.sections?.platformConstruction || '',
    summary?.sections?.supervision || '',
    summary?.sections?.proactiveDisclosure || '',
    summary?.sections?.requestDisclosure || '',
    summary?.sections?.problems || '',
    summary?.sections?.improvements || '',
  ]
    .filter(Boolean)
    .join('\n');

const summaryMentionsMedia = (summary?: AnnualReportSummary | null): boolean =>
  /新媒体|网站|平台|栏目|专题/.test(annualSummaryText(summary));

const summaryMentionsPolicy = (summary?: AnnualReportSummary | null): boolean =>
  /解读|回应|政策|触达/.test(annualSummaryText(summary));

export const formatPercent = (value: number): string => `${round1(value).toFixed(1)}%`;

export const formatInteger = (value: number): string => Number(value || 0).toLocaleString('zh-CN');

export const formatChangePct = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) return 'N/A';
  const rounded = round1(value);
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
};

export const changePct = (current: number, previous: number): number | null => {
  if (!previous) return null;
  return ((current - previous) / previous) * 100;
};

const formatMetricValue = (value: number, unit: '件' | '%' | '万元' = '件'): string => {
  if (unit === '%') return formatPercent(value);
  if (unit === '万元') return `${formatInteger(value)}万元`;
  return `${formatInteger(value)}件`;
};

const formatCurrentAndPrevious = (
  current: number,
  previous: number | null,
  unit: '件' | '%' | '万元' = '件'
): { currentValue: string; previousValue: string } => ({
  currentValue: formatMetricValue(current, unit),
  previousValue: previous === null ? '无上年同期数据' : formatMetricValue(previous, unit),
});

export const buildMetricsSnapshot = (data: AnnualData): ReportMetricsSnapshot => {
  const detail = data.applications.outcomesDetail;
  const newReceived = data.applications.newReceived;
  const carriedOver = data.applications.carriedOver;
  const acceptedTotal = newReceived + carriedOver;
  const publicCount = data.applications.outcomes.public;
  const partialCount = data.applications.outcomes.partial;
  const unableCount = data.applications.outcomes.unable;
  const notOpenCount = data.applications.outcomes.notOpen;
  const ignoreCount = data.applications.outcomes.ignore;
  const otherCount = data.applications.outcomes.other ?? 0;
  const resolvedTotal = publicCount + partialCount + unableCount + notOpenCount + ignoreCount + otherCount;
  const carriedForward = data.applications.carriedForward;
  const substantiveCount = publicCount + partialCount;
  const noInfoCount = detail?.unable.noInfo ?? data.applications.outcomes.unableNoInfo ?? 0;
  const needCreationCount = detail?.unable.needCreation ?? data.applications.outcomes.unableNeedCreation ?? 0;
  const unclearCount = detail?.unable.unclear ?? data.applications.outcomes.unableUnclear ?? 0;
  const stateSecretCount = detail?.notOpen.stateSecret ?? 0;
  const lawForbiddenCount = detail?.notOpen.lawForbidden ?? 0;
  const dangerCount = detail?.notOpen.danger ?? data.applications.outcomes.notOpenDanger ?? 0;
  const thirdPartyCount = detail?.notOpen.thirdParty ?? data.applications.outcomes.notOpenThirdParty ?? 0;
  const internalCount = detail?.notOpen.internal ?? data.applications.outcomes.notOpenInternal ?? 0;
  const processCount = detail?.notOpen.process ?? data.applications.outcomes.notOpenProcess ?? 0;
  const enforcementCount = detail?.notOpen.enforcement ?? 0;
  const adminQueryCount = detail?.notOpen.adminQuery ?? data.applications.outcomes.notOpenAdminQuery ?? 0;
  const untreatedComplaintCount = detail?.untreated.complaint ?? 0;
  const repeatCount = detail?.untreated.repeat ?? data.applications.outcomes.ignoreRepeat ?? 0;
  const publicationCount = detail?.untreated.publication ?? 0;
  const massiveCount = detail?.untreated.massive ?? 0;
  const confirmCount = detail?.untreated.confirm ?? 0;
  const overdueCorrectionCount = detail?.other.overdueCorrection ?? 0;
  const overdueFeeCount = detail?.other.overdueFee ?? 0;
  const otherReasonCount = detail?.other.other ?? data.applications.outcomes.other ?? 0;
  const naturalCount = data.applications.sources.natural;
  const legalCount = Math.max(0, newReceived - naturalCount);
  const revTotal = data.disputes.reconsideration.total;
  const revCorrected = data.disputes.reconsideration.corrected;
  const litTotal = data.disputes.litigation.total;
  const litCorrected = data.disputes.litigation.corrected;

  return {
    year: data.year,
    newReceived,
    carriedOver,
    acceptedTotal,
    carriedForward,
    resolvedTotal,
    substantiveCount,
    publicCount,
    partialCount,
    notOpenCount,
    unableCount,
    ignoreCount,
    otherCount,
    substantiveRate: round1(safeDivide(substantiveCount, acceptedTotal) * 100),
    notOpenRate: round1(safeDivide(notOpenCount, acceptedTotal) * 100),
    unableRate: round1(safeDivide(unableCount, acceptedTotal) * 100),
    ignoreRate: round1(safeDivide(ignoreCount, acceptedTotal) * 100),
    otherRate: round1(safeDivide(otherCount, acceptedTotal) * 100),
    carryForwardRate: round1(safeDivide(carriedForward, acceptedTotal) * 100),
    naturalCount,
    legalCount,
    naturalShare: round1(safeDivide(naturalCount, newReceived) * 100),
    legalShare: round1(safeDivide(legalCount, newReceived) * 100),
    revTotal,
    revCorrected,
    revRate: round1(safeDivide(revCorrected, revTotal) * 100),
    litTotal,
    litCorrected,
    litRate: round1(safeDivide(litCorrected, litTotal) * 100),
    disputesTotal: revTotal + litTotal,
    disputesCorrected: revCorrected + litCorrected,
    overallCorrectionRate: round1(safeDivide(revCorrected + litCorrected, revTotal + litTotal) * 100),
    regPublished: data.regulations.published,
    regActive: data.regulations.active,
    regAbolished: data.regulations.abolished,
    docPublished: data.normativeDocuments.published,
    docActive: data.normativeDocuments.active,
    docAbolished: data.normativeDocuments.abolished,
    actionLicensing: data.adminActions.licensing,
    actionPunishment: data.adminActions.punishment,
    actionForce: data.adminActions.force,
    feeAmount: data.fees.amount,
    noInfoCount,
    needCreationCount,
    unclearCount,
    noInfoShareInUnable: round1(safeDivide(noInfoCount, unableCount) * 100),
    stateSecretCount,
    lawForbiddenCount,
    dangerCount,
    thirdPartyCount,
    internalCount,
    processCount,
    enforcementCount,
    adminQueryCount,
    untreatedComplaintCount,
    repeatCount,
    publicationCount,
    massiveCount,
    confirmCount,
    overdueCorrectionCount,
    overdueFeeCount,
    otherReasonCount,
  };
};

const buildDataQualityStatus = (data: AnnualData): DataQualityStatus => {
  const snapshot = buildMetricsSnapshot(data);
  const detail = data.applications.outcomesDetail;
  const rawAcceptedField = Number(data.applications.totalHandled || 0);
  const notOpenDetailSum = sumNumbers(
    detail?.notOpen.stateSecret,
    detail?.notOpen.lawForbidden,
    detail?.notOpen.danger,
    detail?.notOpen.thirdParty,
    detail?.notOpen.internal,
    detail?.notOpen.process,
    detail?.notOpen.enforcement,
    detail?.notOpen.adminQuery
  );
  const unableDetailSum = sumNumbers(detail?.unable.noInfo, detail?.unable.needCreation, detail?.unable.unclear);
  const untreatedDetailSum = sumNumbers(
    detail?.untreated.complaint,
    detail?.untreated.repeat,
    detail?.untreated.publication,
    detail?.untreated.massive,
    detail?.untreated.confirm
  );
  const otherDetailSum = sumNumbers(
    detail?.other.overdueCorrection,
    detail?.other.overdueFee,
    detail?.other.other
  );
  const ignoreDetailSum = untreatedDetailSum + otherDetailSum;

  const checks: ReconciliationCheck[] = [
    {
      key: 'accepted_total_formula',
      label: '受理总量 = 上年结转 + 本年新收',
      expected: snapshot.carriedOver + snapshot.newReceived,
      actual: snapshot.acceptedTotal,
      passed: snapshot.acceptedTotal === snapshot.carriedOver + snapshot.newReceived,
      note: '受理总量由结构化字段程序派生，不允许模型自行生成。',
    },
    {
      key: 'accepted_total_field',
      label: '结构化受理总量字段与程序派生值一致',
      expected: snapshot.acceptedTotal,
      actual: rawAcceptedField,
      passed: !rawAcceptedField || rawAcceptedField === snapshot.acceptedTotal,
      note: '当前 totalHandled 字段在系统中按受理总量口径使用，用于交叉校验。',
    },
    {
      key: 'accepted_total_balance',
      label: '办理结果合计 + 结转下年 = 受理总量',
      expected: snapshot.acceptedTotal,
      actual: snapshot.resolvedTotal + snapshot.carriedForward,
      passed: snapshot.resolvedTotal + snapshot.carriedForward === snapshot.acceptedTotal,
      note: '用于校验依申请公开办理结果与结转关系是否闭合。',
    },
    {
      key: 'not_open_detail_sum',
      label: '不予公开子项合计 = 不予公开总量',
      expected: snapshot.notOpenCount,
      actual: notOpenDetailSum,
      passed: snapshot.notOpenCount === notOpenDetailSum,
      note: '用于校验不予公开分类明细是否完整。',
    },
    {
      key: 'unable_detail_sum',
      label: '无法提供子项合计 = 无法提供总量',
      expected: snapshot.unableCount,
      actual: unableDetailSum,
      passed: snapshot.unableCount === unableDetailSum,
      note: '用于校验无法提供分类明细是否完整。',
    },
    {
      key: 'ignore_detail_sum',
      label: '不予处理子项合计 = 不予处理总量',
      expected: snapshot.ignoreCount,
      actual: untreatedDetailSum,
      passed: snapshot.ignoreCount === untreatedDetailSum,
      note: '用于校验“不予处理”分类明细是否完整。',
    },
    {
      key: 'other_detail_sum',
      label: '其他处理子项合计 = 其他处理总量',
      expected: snapshot.otherCount,
      actual: otherDetailSum,
      passed: snapshot.otherCount === otherDetailSum,
      note: '用于校验“其他处理”分类明细是否完整。',
    },
  ];

  const warnings: string[] = [];
  if (checks.some((item) => !item.passed)) warnings.push('数据勾稽异常，需复核源数据后再形成事实性结论。');
  if (!checks.find((item) => item.key === 'accepted_total_balance')?.passed) {
    warnings.push('依申请公开办理结果合计与结转下年之间未形成闭环，需先核实受理总量和分类口径。');
  }
  if (!checks.find((item) => item.key === 'not_open_detail_sum')?.passed) {
    warnings.push('“不予公开”分类明细与总量不一致，涉及事实层表述应从严使用。');
  }
  if (!checks.find((item) => item.key === 'unable_detail_sum')?.passed) {
    warnings.push('“无法提供”分类明细与总量不一致，相关占比和结构判断需先复核。');
  }
  if (!checks.find((item) => item.key === 'ignore_detail_sum')?.passed) {
    warnings.push('“不予处理”分类明细与总量不一致，相关事实层表述需先复核。');
  }
  if (!checks.find((item) => item.key === 'other_detail_sum')?.passed) {
    warnings.push('“其他处理”分类明细与总量不一致，相关事实层表述需先复核。');
  }

  return {
    hasAnomaly: checks.some((item) => !item.passed),
    factConclusionAllowed: checks.every((item) => item.passed),
    warnings,
    reconciliationChecks: checks,
  };
};

export const determineRating = (
  current: ReportMetricsSnapshot,
  previous: ReportMetricsSnapshot | null,
  dataQuality: DataQualityStatus
): { rating: ReportRating; riskLabel: string; reason: string } => {
  if (dataQuality.hasAnomaly) {
    return { rating: 'B', riskLabel: '需先复核数据', reason: '当前结构化数据存在勾稽异常，事实性结论应先建立在源数据复核基础上。' };
  }
  const revGrowth = changePct(current.revTotal, previous?.revTotal || 0);
  if (current.revRate < 10 && current.litRate < 10 && current.carryForwardRate <= 3) {
    return { rating: 'A', riskLabel: '总体可控', reason: '纠错占比和结转率总体处于相对平稳区间。' };
  }

  if (
    current.revRate >= 25 ||
    current.litRate >= 18 ||
    current.overallCorrectionRate >= 20 ||
    current.carryForwardRate >= 8
  ) {
    return { rating: 'C', riskLabel: '重点问题需集中攻坚', reason: '行政争议纠错占比或结转压力偏高，需集中部署整改。' };
  }

  if ((revGrowth !== null && revGrowth > 40) || current.unableRate >= 30 || current.noInfoShareInUnable >= 80) {
    return { rating: 'B', riskLabel: '需持续关注', reason: '依申请公开承压、信息检索协同或争议风险仍需持续跟踪。' };
  }

  return { rating: 'B', riskLabel: '总体可控，部分风险需持续关注', reason: '整体运行可控，但重点环节仍需加强过程管控。' };
};

const toSignal = (value: number | null): ReportSignal => {
  if (value === null || Math.abs(value) < 0.05) return 'flat';
  return value > 0 ? 'up' : 'down';
};

const cardStatusFromRate = (value: number, goodThreshold: number, watchThreshold: number): ReportStatus => {
  if (value <= goodThreshold) return 'good';
  if (value <= watchThreshold) return 'watch';
  return 'risk';
};

export const buildScorecards = (
  current: ReportMetricsSnapshot,
  previous: ReportMetricsSnapshot | null
): ScorecardItem[] => {
  const previousValue = <T extends keyof ReportMetricsSnapshot>(key: T): number => previous?.[key] || 0;

  return [
    {
      key: 'newReceived',
      label: '新收申请数',
      unit: '件',
      current: current.newReceived,
      previous: previousValue('newReceived'),
      changePct: changePct(current.newReceived, previousValue('newReceived')),
      signal: toSignal(changePct(current.newReceived, previousValue('newReceived'))),
      status: current.newReceived > previousValue('newReceived') * 1.15 ? 'watch' : 'good',
      interpretation: '反映依申请公开办理压力和资源投入需求。',
    },
    {
      key: 'substantiveRate',
      label: '实质公开率',
      unit: '%',
      current: current.substantiveRate,
      previous: previousValue('substantiveRate'),
      changePct: changePct(current.substantiveRate, previousValue('substantiveRate')),
      signal: toSignal(changePct(current.substantiveRate, previousValue('substantiveRate'))),
      status: current.substantiveRate >= 60 ? 'good' : current.substantiveRate >= 50 ? 'watch' : 'risk',
      interpretation: '反映公开供给与依申请公开需求的衔接情况。',
    },
    {
      key: 'unableRate',
      label: '无法提供占比',
      unit: '%',
      current: current.unableRate,
      previous: previousValue('unableRate'),
      changePct: changePct(current.unableRate, previousValue('unableRate')),
      signal: toSignal(changePct(current.unableRate, previousValue('unableRate'))),
      status: cardStatusFromRate(current.unableRate, 20, 30),
      interpretation: '反映信息掌握、内部检索和协同调取能力。',
    },
    {
      key: 'noInfoShareInUnable',
      label: '“不掌握相关信息”占无法提供比重',
      unit: '%',
      current: current.noInfoShareInUnable,
      previous: previousValue('noInfoShareInUnable'),
      changePct: changePct(current.noInfoShareInUnable, previousValue('noInfoShareInUnable')),
      signal: toSignal(changePct(current.noInfoShareInUnable, previousValue('noInfoShareInUnable'))),
      status: cardStatusFromRate(current.noInfoShareInUnable, 60, 80),
      interpretation: '反映“不掌握相关信息”是否已成为主要处置方式。',
    },
    {
      key: 'revRate',
      label: '复议纠正占比',
      unit: '%',
      current: current.revRate,
      previous: previousValue('revRate'),
      changePct: changePct(current.revRate, previousValue('revRate')),
      signal: toSignal(changePct(current.revRate, previousValue('revRate'))),
      status: cardStatusFromRate(current.revRate, 10, 20),
      interpretation: '反映答复规范性、法律适用和文书说理质量。',
    },
    {
      key: 'litRate',
      label: '诉讼纠正占比',
      unit: '%',
      current: current.litRate,
      previous: previousValue('litRate'),
      changePct: changePct(current.litRate, previousValue('litRate')),
      signal: toSignal(changePct(current.litRate, previousValue('litRate'))),
      status: cardStatusFromRate(current.litRate, 8, 15),
      interpretation: '反映行政争议外溢后的诉讼风险。',
    },
    {
      key: 'overallCorrectionRate',
      label: '整体纠正占比',
      unit: '%',
      current: current.overallCorrectionRate,
      previous: previousValue('overallCorrectionRate'),
      changePct: changePct(current.overallCorrectionRate, previousValue('overallCorrectionRate')),
      signal: toSignal(changePct(current.overallCorrectionRate, previousValue('overallCorrectionRate'))),
      status: cardStatusFromRate(current.overallCorrectionRate, 10, 18),
      interpretation: '反映复议、诉讼纠错的综合水平。',
    },
    {
      key: 'carryForwardRate',
      label: '结转率',
      unit: '%',
      current: current.carryForwardRate,
      previous: previousValue('carryForwardRate'),
      changePct: changePct(current.carryForwardRate, previousValue('carryForwardRate')),
      signal: toSignal(changePct(current.carryForwardRate, previousValue('carryForwardRate'))),
      status: cardStatusFromRate(current.carryForwardRate, 3, 8),
      interpretation: '反映当年办理闭环情况和积压压力。',
    },
  ];
};

export const buildDataWarnings = (
  current: ReportMetricsSnapshot,
  previous: ReportMetricsSnapshot | null,
  annualReportSummary: AnnualReportSummary | null | undefined,
  dataQuality: DataQualityStatus
): string[] => {
  const warnings = [...dataQuality.warnings];

  if (!previous) warnings.push('缺少上年同期数据，涉及趋势变化的判断已按审慎口径处理。');
  if (current.noInfoShareInUnable >= 80) {
    warnings.push('“本机关不掌握相关信息”占无法提供比重较高，需关注信息形成留痕和内部检索机制。');
  }
  if (current.overallCorrectionRate >= 20) {
    warnings.push('复议、诉讼整体纠正占比偏高，需将案件复盘与答复规范整治同步推进。');
  }
  if (!annualSummaryAvailable(annualReportSummary)) {
    warnings.push('年度报告摘要信息不完整，平台建设、政策解读和监督保障等内容以现有材料为限。');
  }

  return uniqueStrings(warnings);
};

export const buildTopSignals = (
  current: ReportMetricsSnapshot,
  previous: ReportMetricsSnapshot | null,
  dataQuality: DataQualityStatus
): string[] => {
  const items: string[] = [];

  if (dataQuality.hasAnomaly) {
    items.push('当前结构化数据存在勾稽异常，涉及事实层内容应先复核源数据。');
  }

  if (!previous) {
    items.push(`新收申请 ${formatInteger(current.newReceived)}件。`);
    items.push(`实质公开率 ${formatPercent(current.substantiveRate)}。`);
    items.push(`无法提供占比 ${formatPercent(current.unableRate)}。`);
    items.push(`整体纠正占比 ${formatPercent(current.overallCorrectionRate)}。`);
    return items;
  }

  items.push(`新收申请 ${formatInteger(current.newReceived)}件，较上年 ${formatChangePct(changePct(current.newReceived, previous.newReceived))}。`);
  items.push(`实质公开率 ${formatPercent(current.substantiveRate)}，较上年 ${formatChangePct(changePct(current.substantiveRate, previous.substantiveRate))}。`);
  items.push(`“无法提供”占比 ${formatPercent(current.unableRate)}，较上年 ${formatChangePct(changePct(current.unableRate, previous.unableRate))}。`);
  items.push(`整体纠正占比 ${formatPercent(current.overallCorrectionRate)}，较上年 ${formatChangePct(changePct(current.overallCorrectionRate, previous.overallCorrectionRate))}。`);
  items.push(`“本机关不掌握相关信息”占无法提供比重 ${formatPercent(current.noInfoShareInUnable)}，较上年 ${formatChangePct(changePct(current.noInfoShareInUnable, previous.noInfoShareInUnable))}。`);
  return items;
};

const buildComparisonNotes = (previous: ReportMetricsSnapshot | null): string[] => {
  if (!previous) return ['当前缺少上年同期数据，不宜作趋势性或“明显改善”类判断。'];
  return ['具备上年同期数据，可作同比描述，但仍不宜据此单独形成长期趋势结论。'];
};

export const buildReportContextPayload = (
  orgName: string,
  current: AnnualData,
  previous: AnnualData | null,
  provinceReference?: AnnualData | null,
  annualReportSummary?: AnnualReportSummary | null
): ReportContextPayload => {
  const currentSnapshot = buildMetricsSnapshot(current);
  const previousSnapshot = previous ? buildMetricsSnapshot(previous) : null;
  const provinceSnapshot = provinceReference ? buildMetricsSnapshot(provinceReference) : null;
  const dataQuality = buildDataQualityStatus(current);
  const ratingResult = determineRating(currentSnapshot, previousSnapshot, dataQuality);
  const auxiliaryRiskLevelNote = '风险等级仅为辅助研判结果，不作为正式考核结论。';

  return {
    orgName,
    year: current.year,
    rating: ratingResult.rating,
    riskLabel: ratingResult.riskLabel,
    auxiliaryRiskLevelNote,
    current: currentSnapshot,
    previous: previousSnapshot,
    provinceReference: provinceSnapshot,
    topSignals: buildTopSignals(currentSnapshot, previousSnapshot, dataQuality),
    dataWarnings: buildDataWarnings(currentSnapshot, previousSnapshot, annualReportSummary, dataQuality),
    comparisonNotes: buildComparisonNotes(previousSnapshot),
    annualReportSummary: annualReportSummary || null,
    dataQuality,
  };
};

const metadataFallback = (context: ReportContextPayload): ReportMetadata => {
  const summaryLine = context.dataQuality.hasAnomaly
    ? '综合判断：当前结构化数据需先行复核，复核前有关事实结论应从严使用。'
    : context.rating === 'A'
      ? '综合判断：总体可控，重点环节运行相对平稳。'
      : context.rating === 'B'
        ? '综合判断：总体可控，部分风险事项需持续关注。'
        : '综合判断：总体可控基础仍在，但重点问题需集中攻坚。';
  const overallOverview = context.dataQuality.hasAnomaly
    ? `从现有年度报告摘要和结构化统计数据看，${context.orgName}${context.year}年度政务公开工作仍可作综合研判，但依申请公开办理结果与结转关系存在勾稽异常，相关事实口径需先行复核。在复核完成前，对办理规模、分类结构和质量成效的判断应从严把握；对已经显现的依申请公开承压、答复规范性和争议防控等事项，仍应提前部署整改和督办。`
    : context.previous
      ? `从${context.year}年度政务公开运行情况看，${context.orgName}整体运行总体可控，但依申请公开办理压力、答复规范性、信息检索协同和争议防控等关键环节仍需持续压实责任。现有数据表明，有关问题已具备纳入年度重点整改和过程督办的必要性，需在责任分解、机制优化和闭环复盘中持续推进。`
      : `从${context.year}年度政务公开运行情况看，${context.orgName}整体运行总体可控，但依申请公开办理压力、答复规范性和争议防控等重点问题仍需持续关注。受限于缺少上年同期和业务明细数据，当前报告主要反映年度运行状态，并为下一步任务分解和督办落实提供依据。`;

  return {
    reportTitle: `${context.year}年度${context.orgName}政务公开智能辅策报告`,
    summaryLine,
    overallOverview,
    positioning: '供政府政务公开分管领导内部审阅，用于年度形势研判、问题识别、任务部署和督办落实。',
    evidenceBasis: annualSummaryAvailable(context.annualReportSummary)
      ? '依据年度报告摘要、结构化统计数据及上年同期数据形成。首页核心指标、占比、同比和纠正率均由程序计算，不由模型口算生成。'
      : '依据结构化统计数据及上年同期数据形成。年度报告摘要信息不完整时，相关表述以现有数据能够直接支撑的内容为限。首页核心指标、占比、同比和纠正率均由程序计算。',
    cautionNote: context.dataQuality.hasAnomaly
      ? '当前存在数据勾稽异常，事实层内容已按“先复核、后定性”原则处理；分析层内容仅作审慎提示。'
      : '本报告已将事实层与分析层分章表述，对证据不足内容自动降调处理，不使用无充分支撑的强趋势表述。',
    auxiliaryRiskLevel: `${context.rating}级（${context.riskLabel}）`,
    auxiliaryRiskLevelNote: context.auxiliaryRiskLevelNote,
  };
};

const yoySentence = (label: string, current: number, previous: number | null, unit: '件' | '%' = '件'): string => {
  const currentText = formatMetricValue(current, unit);
  const delta = previous === null ? null : changePct(current, previous);
  if (delta === null) return `${label}${currentText}。`;
  return `${label}${currentText}，较上年${formatChangePct(delta)}。`;
};

const buildRuleBasedOverallJudgments = (
  context: ReportContextPayload,
  annualReportSummary?: AnnualReportSummary | null
): OverallJudgmentItem[] => {
  const current = context.current;
  const previous = context.previous;

  if (context.dataQuality.hasAnomaly) {
    return [
      {
        heading: '统计口径和源台账关系需先行复核',
        factBasis: '当前结构化统计数据在依申请公开办理结果、分类明细与结转关系上存在勾稽异常。',
        riskJudgment: '这表明本年度综合研判首先要解决数据准确性问题，复核前不宜对办理规模、分类结构和成效作直接定性。',
        managementImplication: '建议先对受理总量、办理结果、结转下年和分类明细之间的对应关系开展专项复核，再据此形成事实性结论和督办要求。',
      },
      {
        heading: '依申请公开承压和答复质量问题仍应前置处置',
        factBasis: `新收申请${formatInteger(current.newReceived)}件，复议${formatInteger(current.revTotal)}件，诉讼${formatInteger(current.litTotal)}件。`,
        riskJudgment: '即使暂不使用存在争议的分类结果，依申请公开承压和行政争议风险仍已对日常治理形成现实压力。',
        managementImplication: '应同步推进台账复核、答复规范整治和争议案件复盘，避免“先应付、后返工”的被动局面。',
      },
      {
        heading: '后续整改应坚持边复核、边完善、边督办',
        factBasis: '当前报告已能够识别部分重点问题，但对单位差异、错因结构和高频申请主题仍缺少明细台账支撑。',
        riskJudgment: '如仅依据汇总数据部署任务，容易出现整改抓手不细、责任分解不准、督办落点不清的问题。',
        managementImplication: '下一步应将数据复核、任务分解和过程督办一体推进，以台账补数带动整改精准化。',
      },
    ].map((item) => ({
      heading: softenInferenceText(item.heading),
      factBasis: softenInferenceText(item.factBasis),
      riskJudgment: softenInferenceText(item.riskJudgment),
      managementImplication: softenInferenceText(item.managementImplication),
    }));
  }
  const currentItems: OverallJudgmentItem[] = [
    {
      heading: '依申请公开办理压力仍需纳入年度重点统筹',
      factBasis: `${yoySentence('新收申请', current.newReceived, previous?.newReceived ?? null)}受理总量${formatInteger(current.acceptedTotal)}件，结转率${formatPercent(current.carryForwardRate)}。`,
      riskJudgment: previous
        ? '申请受理量、结转率和同比变化表明，依申请公开办理任务仍对日常治理形成持续压力。'
        : '从本年度受理规模和结转情况看，依申请公开办理任务仍需保持足够的资源投入和流程保障。',
      managementImplication: '需将受理、审核、法审、复核和督办资源前置统筹，避免压力持续向末端单位传导。',
    },
    {
      heading: '答复规范性和行政争议防控仍是质量治理重点',
      factBasis: `复议纠正占比${formatPercent(current.revRate)}，诉讼纠正占比${formatPercent(current.litRate)}，整体纠正占比${formatPercent(current.overallCorrectionRate)}。`,
      riskJudgment: '纠正占比表明答复文书、事实核查、法律适用和程序把关等环节仍需持续夯实。',
      managementImplication: '应把复议诉讼结果与答复模板修订、法审前置和案件复盘联动起来，形成闭环纠偏机制。',
    },
    {
      heading: '信息掌握和内部检索协同能力仍需进一步压实',
      factBasis: `“无法提供”占比${formatPercent(current.unableRate)}，“本机关不掌握相关信息”占无法提供比重${formatPercent(current.noInfoShareInUnable)}。`,
      riskJudgment: '该结构既可能反映申请事项超出掌握范围，也提示信息形成留痕、归集检索和跨部门调取环节可能仍有薄弱点。',
      managementImplication: '需同步规范“不掌握相关信息”适用口径，完善检索留痕、目录管理和协同调取机制。',
    },
    {
      heading: '主动公开供给已有基础，但分流效能仍需通过台账验证',
      factBasis: `实质公开率${formatPercent(current.substantiveRate)}，现行有效规章${formatInteger(current.regActive)}件，现行有效规范性文件${formatInteger(current.docActive)}件。`,
      riskJudgment: '现有数据一定程度上说明主动公开基础尚在，但是否对高频申请形成有效分流，当前尚缺明细台账作进一步证明。',
      managementImplication: '应以高频申请事项为牵引，推动专题公开、政策解读和标准化答复协同联动。',
    },
  ];

  if (annualSummaryAvailable(annualReportSummary) && annualReportSummary?.problemSnippets?.length) {
    currentItems[1].factBasis = `${currentItems[1].factBasis} 根据年报显示，${annualReportSummary.problemSnippets.slice(0, 2).join('；')}。`;
  }

  return currentItems.map((item) => ({
    heading: softenInferenceText(item.heading),
    factBasis: softenInferenceText(item.factBasis),
    riskJudgment: softenInferenceText(item.riskJudgment),
    managementImplication: softenInferenceText(item.managementImplication),
  }));
};

const buildRuleBasedRiskItems = (
  context: ReportContextPayload,
  annualReportSummary?: AnnualReportSummary | null
): RiskItem[] => {
  const current = context.current;
  const previous = context.previous;
  const items: RiskItem[] = [
    {
      priorityLevel: '首要关注事项',
      riskName: '依申请公开承压上行风险',
      basis: `${yoySentence('新收申请', current.newReceived, previous?.newReceived ?? null)}受理总量${formatInteger(current.acceptedTotal)}件，结转率${formatPercent(current.carryForwardRate)}。`,
      manifestation: '申请办理压力主要体现在受理规模、结转压力和跨环节协同负荷上，若流程压缩与质量管控不同步，容易形成后续争议。',
      impact: '将直接影响答复时效、审核质量和领导督办节奏，也可能挤占基层单位日常公开和业务办理资源。',
      focus: '重点关注高频申请主题、重复申请事项、积压环节和跨部门协同办理节点。',
    },
    {
      priorityLevel: '首要关注事项',
      riskName: '答复规范性及复议诉讼风险',
      basis: `复议${formatInteger(current.revTotal)}件，复议纠正占比${formatPercent(current.revRate)}；诉讼${formatInteger(current.litTotal)}件，诉讼纠正占比${formatPercent(current.litRate)}。`,
      manifestation: '纠正案件反映答复文书、事实核查、法律适用、程序履行或说理完整性方面可能仍存在薄弱环节。',
      impact: '将影响依法行政评价，也可能带来投诉举报、重复申请和重点案件督办压力。',
      focus: '重点关注纠错案件复盘、法审把关、模板修订和重点领域案件的前端预防。',
    },
    {
      priorityLevel: '首要关注事项',
      riskName: '“本机关不掌握相关信息”占比较高所反映的检索协同和口径适用风险',
      basis: `“本机关不掌握相关信息”${formatInteger(current.noInfoCount)}件，占“无法提供”比重${formatPercent(current.noInfoShareInUnable)}。`,
      manifestation: '该现象既可能与申请事项本身有关，也提示信息形成、归集、目录管理、内部检索和跨部门调取机制仍需进一步规范。',
      impact: '如适用口径把握不准，容易引发争议，也不利于建立高频事项分流和源头治理机制。',
      focus: '重点关注检索留痕、协同调取路径、“不掌握相关信息”适用审查和高频事项反向公开。',
    },
    {
      priorityLevel: '重点关注事项',
      riskName: '实质公开率及公开供给匹配风险',
      basis: `${yoySentence('实质公开率', current.substantiveRate, previous?.substantiveRate ?? null, '%')}“无法提供”占比${formatPercent(current.unableRate)}。`,
      manifestation: '实质公开率与无法提供占比的组合情况提示，主动公开供给与依申请公开需求之间仍可能存在匹配不足。',
      impact: '如主动公开供给不能及时覆盖高频事项，依申请公开受理压力和重复申请压力将难以有效缓解。',
      focus: '重点关注高频申请事项、专题公开补充、政策解读同步发布和栏目维护质量。',
    },
    {
      priorityLevel: '重点关注事项',
      riskName: '基层能力与法治审查支撑风险',
      basis: annualReportSummary?.problemSnippets?.length
        ? `根据年报显示，${annualReportSummary.problemSnippets.slice(0, 2).join('；')}。`
        : `整体纠正占比${formatPercent(current.overallCorrectionRate)}，说明前端办理与法审支撑仍需协同增强。`,
      manifestation: '基层单位在事实表述、法律适用、程序履行和文书说理方面可能存在不均衡情况，法审支撑能力也需持续提升。',
      impact: '将影响同类事项办理一致性，增加纠错和返工成本，削弱市级统筹治理效果。',
      focus: '重点关注基层培训、定点辅导、模板统一、重点案件抽查和法审前置。',
    },
  ];

  if (summaryMentionsMedia(annualReportSummary)) {
    items.push({
      priorityLevel: '持续跟踪事项',
      riskName: '政务新媒体内容审核和平台运行风险',
      basis: annualReportSummary?.sections?.platformConstruction
        ? `根据年报显示，${annualReportSummary.sections.platformConstruction}`
        : annualReportSummary?.sections?.supervision
          ? `根据年报显示，${annualReportSummary.sections.supervision}`
          : '年度报告涉及平台建设和监督保障内容。',
      manifestation: '平台和新媒体如缺少常态化审核、更新和巡检，容易出现信息更新不及时、口径不一致或风险信息外溢。',
      impact: '将影响主动公开公信力，也可能削弱主动公开对依申请公开的分流作用。',
      focus: '重点关注内容审核、更新时效、栏目维护和问题信息闭环处置。',
    });
  }

  if (annualSummaryAvailable(annualReportSummary) || summaryMentionsPolicy(annualReportSummary)) {
    items.push({
      priorityLevel: '持续跟踪事项',
      riskName: '政策解读质效及精准触达问题',
      basis: annualReportSummary?.sections?.improvements
        ? `根据年报显示，${annualReportSummary.sections.improvements}`
        : annualReportSummary?.highlights?.length
          ? `根据年报显示，${annualReportSummary.highlights.slice(0, 2).join('；')}`
          : '年度报告涉及主动公开和政策解读相关内容。',
      manifestation: '政策解读如与群众高频关切、申请主题和公开栏目衔接不够，解读的分流和释疑作用可能受限。',
      impact: '将影响政策公开的可读性、可及性和精准触达效果，也不利于前端化解依申请公开压力。',
      focus: '重点关注解读选题与高频申请主题衔接、发布时点、问答化表达和效果评估数据。',
    });
  }

  return items
    .map((item) => ({
      priorityLevel: item.priorityLevel,
      riskName: softenInferenceText(item.riskName),
      basis: softenInferenceText(item.basis),
      manifestation: softenInferenceText(item.manifestation),
      impact: softenInferenceText(item.impact),
      focus: softenInferenceText(item.focus),
    }))
    .sort((a, b) => RISK_PRIORITY_ORDER[a.priorityLevel] - RISK_PRIORITY_ORDER[b.priorityLevel]);
};

const buildRuleBasedClosing = (context: ReportContextPayload): string => {
  if (context.dataQuality.hasAnomaly) {
    return softenInferenceText(
      `${context.year}年度${context.orgName}政务公开工作总体研判仍可继续推进，但应把数据复核作为当前首要基础工作。下一步要坚持问题导向和结果导向并重，先把源台账、统计口径和勾稽关系核准，再围绕依申请公开办理、答复规范和争议防控等重点事项压实责任、闭环督办，确保整改部署建立在真实可靠的数据基础之上。`
    );
  }

  return softenInferenceText(
    `${context.year}年度${context.orgName}政务公开工作总体可控，但依申请公开承压、答复规范、信息检索协同和争议防控等重点问题仍需持续攻坚。下一步应坚持问题导向，进一步压实牵头责任和配合责任，围绕重点任务分解推进、过程督办和闭环整改，推动相关问题在整改中见效、在规范中固化。`
  );
};

const buildRuleBasedNotes = (context: ReportContextPayload): string[] =>
  uniqueStrings(sanitizeStringArray([context.auxiliaryRiskLevelNote, ...context.comparisonNotes, ...context.dataWarnings]));

const buildRuleBasedConfirmedFacts = (
  context: ReportContextPayload,
  annualReportSummary?: AnnualReportSummary | null
): FactGroupItem[] => {
  if (!context.dataQuality.factConclusionAllowed) {
    return [
      {
        category: '数据勾稽及事实使用提示',
        points: [
          '当前结构化统计数据存在勾稽异常，相关事实性结论暂不直接展开。',
          '需优先复核受理总量、办理结果合计、结转下年以及分类明细之间的对应关系。',
          '在源数据复核完成前，事实层内容以“需复核源数据”口径处理，不据此作定量定性判断。',
        ],
      },
    ];
  }

  const current = context.current;
  const groups: FactGroupItem[] = [
    {
      category: '主动公开和制度信息情况',
      points: [
        `根据公开数据，现行有效规章${formatInteger(current.regActive)}件，现行有效规范性文件${formatInteger(current.docActive)}件。`,
        `根据公开数据，行政许可公开${formatInteger(current.actionLicensing)}件，行政处罚公开${formatInteger(current.actionPunishment)}件，行政强制公开${formatInteger(current.actionForce)}件。`,
        annualSummaryAvailable(annualReportSummary) && annualReportSummary?.sections?.proactiveDisclosure
          ? `根据年报显示，${annualReportSummary.sections.proactiveDisclosure}`
          : '根据已掌握数据，主动公开部分事实主要以结构化统计数据为依据。',
      ],
    },
    {
      category: '依申请公开办理情况',
      points: [
        `根据公开数据，本年新收申请${formatInteger(current.newReceived)}件，上年结转${formatInteger(current.carriedOver)}件，受理总量${formatInteger(current.acceptedTotal)}件，结转下年${formatInteger(current.carriedForward)}件。`,
        `根据公开数据，予以公开${formatInteger(current.publicCount)}件，部分公开${formatInteger(current.partialCount)}件，不予公开${formatInteger(current.notOpenCount)}件，无法提供${formatInteger(current.unableCount)}件，不予处理${formatInteger(current.ignoreCount)}件，其他处理${formatInteger(current.otherCount)}件。`,
        `根据公开数据，自然人申请占比${formatPercent(current.naturalShare)}，法人及其他组织申请占比${formatPercent(current.legalShare)}。`,
      ],
    },
    {
      category: '行政复议与诉讼情况',
      points: [
        `根据公开数据，行政复议${formatInteger(current.revTotal)}件，其中纠正${formatInteger(current.revCorrected)}件。`,
        `根据公开数据，行政诉讼${formatInteger(current.litTotal)}件，其中纠正${formatInteger(current.litCorrected)}件。`,
        `根据公开数据，复议纠正占比${formatPercent(current.revRate)}，诉讼纠正占比${formatPercent(current.litRate)}，整体纠正占比${formatPercent(current.overallCorrectionRate)}。`,
      ],
    },
  ];

  if (annualSummaryAvailable(annualReportSummary)) {
    groups.push({
      category: '平台建设和监督保障情况',
      points: [
        annualReportSummary?.sections?.platformConstruction
          ? `根据年报显示，${annualReportSummary.sections.platformConstruction}`
          : '根据年报显示，平台建设情况已在年度报告中披露。',
        annualReportSummary?.sections?.supervision
          ? `根据年报显示，${annualReportSummary.sections.supervision}`
          : '根据年报显示，监督保障、培训考核等情况已在年度报告中披露。',
      ],
    });
  }

  return groups.map((group) => ({
    category: softenInferenceText(group.category),
    points: sanitizeStringArray(group.points),
  }));
};

const buildRuleBasedPrudentAnalyses = (
  context: ReportContextPayload,
  annualReportSummary?: AnnualReportSummary | null
): PrudentAnalysisItem[] => {
  const current = context.current;
  const previous = context.previous;
  const items: PrudentAnalysisItem[] = [];

  if (context.dataQuality.hasAnomaly) {
    items.push({
      topic: '当前数据勾稽异常对研判使用的影响',
      analysis: '现有结构化统计数据在依申请公开办理结果和结转关系上存在勾稽异常，提示当前报告在使用事实层数据时应先复核源台账，再作进一步定量判断。',
      support: '相关校验已经触发“办理结果合计 + 结转下年 = 受理总量”等勾稽异常标记。',
      caution: '该提示仅针对数据使用边界，不直接等同于业务办理本身存在同等程度问题。',
    });
  }
  items.push(
    {
      topic: '依申请公开高位运行的治理含义',
      analysis: previous
        ? `新收申请${formatInteger(current.newReceived)}件，较上年${formatChangePct(changePct(current.newReceived, previous.newReceived))}；结转率${formatPercent(current.carryForwardRate)}。这些数据表明依申请公开仍需持续投入受理、审核和协同资源。`
        : `从本年度新收申请${formatInteger(current.newReceived)}件、结转率${formatPercent(current.carryForwardRate)}看，依申请公开办理任务仍对日常治理形成持续压力。`,
      support: `受理总量${formatInteger(current.acceptedTotal)}件，实质公开率${formatPercent(current.substantiveRate)}。`,
      caution: previous
        ? '该判断主要基于本年与上年同期数据，不宜据此单独推演长期趋势。'
        : '因缺少上年同期数据，该判断仅反映本年度运行状态，不构成趋势性结论。',
    },
    {
      topic: '复议纠错占比对答复质量和法治风险的提示',
      analysis: `复议纠正占比${formatPercent(current.revRate)}，整体纠正占比${formatPercent(current.overallCorrectionRate)}，一定程度上说明答复文书规范性、事实核查和法律适用仍需持续关注。`,
      support: `复议${formatInteger(current.revTotal)}件，诉讼${formatInteger(current.litTotal)}件。`,
      caution: '纠正占比并不当然等同于全部办理质量问题，仍需结合具体案件错因和领域分布进一步分析。',
    },
    {
      topic: '“本机关不掌握相关信息”占比较高现象的双向解释',
      analysis: `“本机关不掌握相关信息”占“无法提供”比重为${formatPercent(current.noInfoShareInUnable)}，提示一方面可能存在申请事项超出掌握范围，另一方面也可能存在信息归集、检索留痕或跨部门调取不够顺畅的情况。`,
      support: `“本机关不掌握相关信息”${formatInteger(current.noInfoCount)}件，“无法提供”总量${formatInteger(current.unableCount)}件。`,
      caution: '在缺少申请主题明细和办理台账的情况下，不宜将该现象简单单向归因于某一治理短板。',
    },
    {
      topic: '主动公开与依申请公开之间的联动关系',
      analysis: annualSummaryAvailable(annualReportSummary)
        ? '从年报摘要和结构化数据综合看，主动公开供给具备一定基础，但其是否已对高频依申请事项形成实质性分流，目前仍需结合明细台账进一步验证。'
        : '从现有结构化数据看，主动公开基础已经存在，但对依申请公开分流的实际作用目前尚无法直接证明。',
      support: `实质公开率${formatPercent(current.substantiveRate)}，现行有效规范性文件${formatInteger(current.docActive)}件。`,
      caution: '当前只能提出治理含义，不能将主动公开与分流效果直接作因果绑定。',
    }
  );

  return items.map((item) => ({
    topic: softenInferenceText(item.topic),
    analysis: softenInferenceText(item.analysis),
    support: softenInferenceText(item.support),
    caution: softenInferenceText(item.caution),
  }));
};

const buildRuleBasedUnansweredQuestions = (): UnansweredQuestionItem[] =>
  [
    {
      question: '当前尚难判断各县区、各部门之间的差异程度及重点问题是否集中于少数单位。',
      currentLimit: '现有数据以年度汇总口径为主，缺少按县区、按部门拆分后的明细台账。',
      nextDataNeeded: '补充县区和部门分户统计台账、季度监测数据及重点单位问题清单后，可进一步开展差异分析。',
    },
    {
      question: '当前尚难准确识别高频申请主题分布及其变化情况。',
      currentLimit: '现有数据未包含申请事项主题、关键词和领域标签。',
      nextDataNeeded: '补充依申请公开收件台账、主题分类字段和重复申请标识后，可进一步识别高频事项并反向纳入主动公开。',
    },
    {
      question: '当前尚难判断复议纠错的具体原因类型及其占比。',
      currentLimit: '现有数据仅反映复议总量和纠正结果，未区分事实认定、程序履行、法律适用或文书说理等原因。',
      nextDataNeeded: '补充复议案件复盘台账、错因标签和案件摘要后，可进一步形成原因分类分析。',
    },
    {
      question: '当前尚难归纳典型争议案件的共性问题。',
      currentLimit: '现有数据缺少典型案件材料、答复文书、复议决定书和诉讼裁判文书。',
      nextDataNeeded: '补充典型案件样本、文书底稿和法审意见后，可进一步提炼共性问题并修订模板。',
    },
    {
      question: '当前尚难评估主动公开对依申请公开分流的实际效果。',
      currentLimit: '现有数据没有专题公开页面访问、站内检索命中和重复申请回落情况。',
      nextDataNeeded: '补充专题公开运营数据、站内检索数据和重复申请跟踪数据后，可进一步评估分流成效。',
    },
    {
      question: '当前尚难判断重点问题是否集中于特定领域或业务线。',
      currentLimit: '现有数据未按自然资源、住建、征地拆迁、社会保障等具体领域拆分。',
      nextDataNeeded: '补充按领域归口的申请、复议、诉讼和纠错台账后，可进一步开展领域聚集分析。',
    },
  ].map((item) => ({
    question: softenInferenceText(item.question),
    currentLimit: softenInferenceText(item.currentLimit),
    nextDataNeeded: softenInferenceText(item.nextDataNeeded),
  }));

const buildRuleBasedRectificationTasks = (): RectificationTaskItem[] => {
  const tasks: RectificationTaskItem[] = [
    {
      sequence: 1,
      taskName: '完善年度统计台账和勾稽校验机制',
      taskType: '机制建设类',
      priority: '近期立即推进',
      problem: '年度统计数据在事实使用和综合研判中的基础支撑作用仍需进一步夯实。',
      measure: '统一受理总量、办理结果、结转下年和分类明细口径，建立年度统计台账、复核流程和程序化勾稽校验机制。',
      leadUnit: '市政府办公室',
      supportUnits: '市司法行政部门、有关县区、有关部门',
      responsibilityLevel: '市级统筹',
      deadline: '1个月内建立校验规则，3个月内完成年度台账复核',
      milestones: ['1个月内形成统一统计口径和校验清单', '2个月内完成历史台账核对与问题修正', '3个月内将勾稽校验纳入常态化填报流程'],
      trackingIndicator: '勾稽校验通过率、问题数据修正率、源台账完整率',
      supervisionMethod: '纳入月度调度，对存在重复错项的单位发督办函，实行销号管理',
    },
    {
      sequence: 2,
      taskName: '建立高频申请事项反向纳入主动公开机制',
      taskType: '机制建设类',
      priority: '近期立即推进',
      problem: '高频依申请事项反复进入办理渠道，主动公开供给与申请需求衔接仍需加强。',
      measure: '梳理高频申请主题和重复申请事项，形成反向纳入主动公开清单、专题公开目录和标准化答复口径。',
      leadUnit: '市政府办公室',
      supportUnits: '市司法行政部门、有关县区、有关部门',
      responsibilityLevel: '市级统筹',
      deadline: '3个月内形成首批清单并完成专题上线',
      milestones: ['1个月内梳理高频申请主题并形成清单', '2个月内完成专题公开目录和答复口径模板', '3个月内上线首批专题并跟踪重复申请变化'],
      trackingIndicator: '高频主题清单形成率、专题公开上线率、重复申请回落情况',
      supervisionMethod: '纳入月度调度，按季度抽查专题更新情况并实行销号管理',
    },
    {
      sequence: 3,
      taskName: '规范依申请公开答复文书和法审把关',
      taskType: '规范整治类',
      priority: '近期立即推进',
      problem: '答复文书规范性、说理完整性和法律适用一致性仍需进一步提升。',
      measure: '围绕受理告知、检索说明、法律依据引用、救济途径告知等关键环节，统一答复模板并完善法审前置机制。',
      leadUnit: '市政府办公室',
      supportUnits: '市司法行政部门、有关县区、有关部门',
      responsibilityLevel: '市级统筹',
      deadline: '2个月内完成模板修订并组织使用',
      milestones: ['1个月内形成统一文书模板和审查要点', '2个月内完成首轮培训并上线使用', '季度内完成一次重点案件专项评查'],
      trackingIndicator: '统一模板覆盖率、专项评查合格率、退回修改率',
      supervisionMethod: '开展专项评查，对重点单位发督办函，并纳入季度通报',
    },
    {
      sequence: 4,
      taskName: '开展复议诉讼纠错案件复盘和错因回溯',
      taskType: '监督保障类',
      priority: '近期立即推进',
      problem: '纠错案件尚未稳定形成可回灌前端办理的复盘成果。',
      measure: '建立复议诉讼纠错案件逐案复盘台账，对事实认定、程序履行、法律适用和文书说理等问题开展标签化归集。',
      leadUnit: '市政府办公室',
      supportUnits: '市司法行政部门、有关县区、有关部门',
      responsibilityLevel: '市级统筹',
      deadline: '1个月内建账，年内持续复盘更新',
      milestones: ['1个月内建立纠错案件复盘台账', '每季度形成错因汇总和典型问题清单', '年内形成可用于培训和模板修订的复盘成果'],
      trackingIndicator: '纠错案件复盘率、错因标签完整率、复盘成果转化率',
      supervisionMethod: '纳入季度调度，定期会商，并将复盘结果反馈有关单位整改',
    },
    {
      sequence: 5,
      taskName: '健全跨部门调取和内部检索留痕机制',
      taskType: '机制建设类',
      priority: '年内持续推进',
      problem: '跨部门协同调取和内部检索机制不够顺畅，“不掌握相关信息”适用风险需要管控。',
      measure: '建立跨部门调取目录、检索留痕制度和协同办理流程，对“不掌握相关信息”类答复实行必要审查和留痕管理。',
      leadUnit: '有关主管部门',
      supportUnits: '市政府办公室、市司法行政部门、有关县区、有关部门',
      responsibilityLevel: '部门',
      deadline: '3个月内形成协同流程，年内持续完善',
      milestones: ['1个月内明确调取目录和责任链条', '2个月内上线检索留痕和内部流转要求', '年内结合抽查情况持续完善适用口径'],
      trackingIndicator: '跨部门调取时长、检索留痕覆盖率、“不掌握相关信息”审查率',
      supervisionMethod: '按季度抽查办理卷宗和检索记录，对问题单位限期整改',
    },
    {
      sequence: 6,
      taskName: '开展基层培训和定点辅导',
      taskType: '能力提升类',
      priority: '年内持续推进',
      problem: '基层单位办理质量和规范化水平存在差异，薄弱环节仍需定向帮扶。',
      measure: '围绕高频错因、典型文书和重点领域案件，组织分层分类培训，对薄弱单位开展定点辅导和现场复盘。',
      leadUnit: '市政府办公室',
      supportUnits: '市司法行政部门、有关县区、有关部门',
      responsibilityLevel: '县区',
      deadline: '6个月内完成一轮培训辅导，年内持续跟进',
      milestones: ['2个月内形成分层培训计划和课件', '4个月内完成重点单位定点辅导', '6个月内形成辅导评估和问题回访结果'],
      trackingIndicator: '培训覆盖率、重点单位辅导完成率、重复错情下降情况',
      supervisionMethod: '建立培训和辅导台账，按节点跟踪并实行销号管理',
    },
    {
      sequence: 7,
      taskName: '强化政务新媒体和公开平台内容审核',
      taskType: '平台治理类',
      priority: '年内持续推进',
      problem: '政务新媒体和公开平台内容审核、更新维护和风险防控仍需压实责任。',
      measure: '建立内容审核清单、更新时限和敏感信息复核机制，定期开展巡检和问题整改，推动平台治理与主动公开要求同步落实。',
      leadUnit: '市政府办公室',
      supportUnits: '有关主管部门、有关县区、有关部门',
      responsibilityLevel: '部门',
      deadline: '2个月内完成审核清单并启动巡检，年内持续推进',
      milestones: ['1个月内形成审核清单和巡检规则', '2个月内完成首轮巡检和问题交办', '年内持续开展复查并形成整改评估'],
      trackingIndicator: '栏目更新及时率、巡检覆盖率、问题整改完成率',
      supervisionMethod: '按季度抽查，对重点单位发督办函，并将问题整改情况纳入年度评估',
    },
  ];

  return tasks.map((item) => ({
    ...item,
    taskName: softenInferenceText(item.taskName),
    problem: softenInferenceText(item.problem),
    measure: softenInferenceText(item.measure),
    leadUnit: softenInferenceText(item.leadUnit),
    supportUnits: softenInferenceText(item.supportUnits),
    responsibilityLevel: softenInferenceText(item.responsibilityLevel),
    deadline: softenInferenceText(item.deadline),
    milestones: sanitizeStringArray(item.milestones),
    trackingIndicator: softenInferenceText(item.trackingIndicator),
    supervisionMethod: softenInferenceText(item.supervisionMethod),
  }));
};

const buildAppendixMetricRows = (context: ReportContextPayload): AppendixMetricRow[] => {
  const current = context.current;
  const previous = context.previous;
  return [
    {
      indicator: '新收申请数',
      sourceFields: 'applications.newReceived',
      formula: '直接读取结构化字段；同比变化 = (本年 - 上年) / 上年 × 100%',
      ...formatCurrentAndPrevious(current.newReceived, previous?.newReceived ?? null),
      reconciliationNote: '仅使用结构化输入与上年同期字段，不由模型推断。',
    },
    {
      indicator: '上年同期新收申请数',
      sourceFields: 'previous.applications.newReceived',
      formula: '直接读取上年同期结构化字段',
      currentValue: previous ? formatMetricValue(previous.newReceived, '件') : '无上年同期数据',
      previousValue: '—',
      reconciliationNote: '若缺少上年同期数据，则同比字段自动置为不可比。',
    },
    {
      indicator: '同比变化',
      sourceFields: 'current.newReceived + previous.newReceived',
      formula: '(本年新收申请数 - 上年同期数) / 上年同期数 × 100%',
      currentValue: formatChangePct(changePct(current.newReceived, previous?.newReceived || 0)),
      previousValue: '—',
      reconciliationNote: '仅在存在上年同期数据时计算。',
    },
    {
      indicator: '实质公开率',
      sourceFields: 'outcomes.public + outcomes.partial + acceptedTotal',
      formula: '(予以公开 + 部分公开) / 受理总量 × 100%',
      ...formatCurrentAndPrevious(current.substantiveRate, previous?.substantiveRate ?? null, '%'),
      reconciliationNote: '受理总量按“上年结转 + 本年新收”程序派生。',
    },
    {
      indicator: '无法提供占比',
      sourceFields: 'outcomes.unable + acceptedTotal',
      formula: '无法提供 / 受理总量 × 100%',
      ...formatCurrentAndPrevious(current.unableRate, previous?.unableRate ?? null, '%'),
      reconciliationNote: '涉及受理总量勾稽异常时，事实层不得直接引用该指标定性。',
    },
    {
      indicator: '“本机关不掌握相关信息”占“无法提供”比重',
      sourceFields: 'outcomesDetail.unable.noInfo + outcomes.unable',
      formula: '本机关不掌握相关信息 / 无法提供 × 100%',
      ...formatCurrentAndPrevious(current.noInfoShareInUnable, previous?.noInfoShareInUnable ?? null, '%'),
      reconciliationNote: '仅用于辅助研判，不直接推导原因归属。',
    },
    {
      indicator: '复议纠正占比',
      sourceFields: 'disputes.reconsideration.corrected + disputes.reconsideration.total',
      formula: '复议纠正数 / 复议总数 × 100%',
      ...formatCurrentAndPrevious(current.revRate, previous?.revRate ?? null, '%'),
      reconciliationNote: '仅反映结果比例，不直接等同于全部办理质量结论。',
    },
    {
      indicator: '诉讼纠正占比',
      sourceFields: 'disputes.litigation.corrected + disputes.litigation.total',
      formula: '诉讼纠正数 / 诉讼总数 × 100%',
      ...formatCurrentAndPrevious(current.litRate, previous?.litRate ?? null, '%'),
      reconciliationNote: '仅用于辅助判断争议外溢风险。',
    },
    {
      indicator: '整体纠正占比',
      sourceFields: '复议纠正数 + 诉讼纠正数 + 复议总数 + 诉讼总数',
      formula: '(复议纠正数 + 诉讼纠正数) / (复议总数 + 诉讼总数) × 100%',
      ...formatCurrentAndPrevious(current.overallCorrectionRate, previous?.overallCorrectionRate ?? null, '%'),
      reconciliationNote: '用于综合观察行政争议纠错情况，不作为考核结论。',
    },
    {
      indicator: '结转率',
      sourceFields: 'applications.carriedForward + acceptedTotal',
      formula: '结转下年 / 受理总量 × 100%',
      ...formatCurrentAndPrevious(current.carryForwardRate, previous?.carryForwardRate ?? null, '%'),
      reconciliationNote: '与“办理结果合计 + 结转下年 = 受理总量”校验关系同步使用。',
    },
  ].map((item) => ({
    ...item,
    indicator: softenInferenceText(item.indicator),
    sourceFields: softenInferenceText(item.sourceFields),
    formula: softenInferenceText(item.formula),
    currentValue: softenInferenceText(item.currentValue),
    previousValue: softenInferenceText(item.previousValue),
    reconciliationNote: softenInferenceText(item.reconciliationNote),
  }));
};

const buildAppendixBoundaries = (): AppendixBoundaryItem[] =>
  [
    {
      title: '适用范围',
      description: '本报告适用于年度综合研判、问题识别、任务部署和内部督办，不直接替代业务台账和正式通报材料。',
    },
    {
      title: '不适用范围',
      description: '本报告不适用于县区排名、部门排序、单一案件责任认定、个案定性和正式考核结论。',
    },
    {
      title: '事实使用边界',
      description: '事实层内容仅限于年度报告摘要和结构化统计数据能够直接证明的事项；如存在勾稽异常，应先复核源数据。',
    },
    {
      title: '深化分析条件',
      description: '需结合申请台账、案件文书、明细分类数据和季度监测数据，方可进一步开展原因分类、领域分布和重点单位分析。',
    },
  ].map((item) => ({
    title: softenInferenceText(item.title),
    description: softenInferenceText(item.description),
  }));

const buildAppendixSupplementItems = (): AppendixSupplementItem[] =>
  [
    {
      item: '依申请公开申请台账',
      purpose: '识别高频申请主题、重复申请事项和办理链条堵点。',
      suggestedSource: '收件台账、承办流转记录、主题标签库',
      note: '建议至少补充申请主题、领域标签、承办单位和办理结果字段。',
    },
    {
      item: '复议诉讼案件明细',
      purpose: '分析纠错原因类型和争议案件共性问题。',
      suggestedSource: '复议案件复盘台账、诉讼裁判文书、法审意见',
      note: '建议形成统一错因标签，便于专项评查和模板修订。',
    },
    {
      item: '高频申请主题库',
      purpose: '支撑高频事项反向纳入主动公开和专题解读。',
      suggestedSource: '申请主题分类表、重复申请识别结果',
      note: '建议按主题、领域、申请主体类型建立动态更新机制。',
    },
    {
      item: '主动公开栏目映射表',
      purpose: '评估主动公开供给与依申请公开需求的匹配度。',
      suggestedSource: '网站栏目清单、专题公开目录、信息发布台账',
      note: '建议建立栏目与高频申请主题的映射关系。',
    },
    {
      item: '政策解读效果数据',
      purpose: '评估政策解读触达效果及其分流作用。',
      suggestedSource: '解读发布台账、访问量、检索命中、问答反馈',
      note: '建议与高频申请主题联动监测。',
    },
    {
      item: '新媒体巡检问题台账',
      purpose: '支撑平台治理和内容审核风险管控。',
      suggestedSource: '巡检记录、问题清单、整改回访结果',
      note: '建议按栏目、账号、问题类型建立整改闭环。',
    },
    {
      item: '培训覆盖和错情通报数据',
      purpose: '评估基层能力提升效果和重点单位整改情况。',
      suggestedSource: '培训签到台账、抽查结果、错情通报记录',
      note: '建议与重点单位辅导台账同步维护。',
    },
  ].map((item) => ({
    item: softenInferenceText(item.item),
    purpose: softenInferenceText(item.purpose),
    suggestedSource: softenInferenceText(item.suggestedSource),
    note: softenInferenceText(item.note),
  }));

const buildReportAppendices = (context: ReportContextPayload): ReportAppendices => ({
  metricAuditRows: buildAppendixMetricRows(context),
  reconciliationChecks: context.dataQuality.reconciliationChecks,
  usageBoundaries: buildAppendixBoundaries(),
  supplementDataItems: buildAppendixSupplementItems(),
});

export const buildAiNarrativePrompt = (context: ReportContextPayload): string => {
  return `
请根据输入的政务公开年度报告摘要、结构化统计数据及上年同期数据，生成一份“准正式定稿版”的政府信息公开智能辅策报告，供政府政务公开分管领导内部审阅使用。

【目标】
在现有成熟目录结构基础上，进一步提升正式程度、风险事项主次感、整改任务分办感、结语收束感和数据边界表达。

【固定目录结构】
一、总体判断
二、需要重点关注的风险事项
三、基于年报可以确认的事实
四、基于数据作出的审慎分析
五、当前报告尚无法充分回答的问题
六、下一步工作建议与整改任务清单
七、结语

【核心约束】
1. 首页指标、同比、占比、纠正率、整体纠正占比、结转率均已由程序计算，请直接使用，不要自行重算。
2. 不得自行生成上年同期值、县区排名、部门排序、原因分类、典型案例。
3. 如果 dataQuality.factConclusionAllowed 为 false，则“基于年报可以确认的事实”章节不得展开事实性结论，应明确写出“数据勾稽异常，需复核源数据”。
4. 附件由系统程序生成，你只需返回正文结构化内容。

【写法要求】
1. metadata.summaryLine 必须写成“综合判断：……”式机关化表达，不得出现系统状态页措辞。
2. overallJudgments 写成“总体概述 + 3—4条关键判断”，不要写成“判断1/判断2”。
3. riskItems 必须区分“首要关注事项 / 重点关注事项 / 持续跟踪事项”，不得同权罗列。
4. confirmedFacts 只能写年度报告摘要和结构化数据能够直接证明的事实，不得加入推断性归因。
5. prudentAnalyses 必须使用审慎措辞，如“表明、提示、反映出、可能存在、一定程度上说明、需持续关注”。
6. unansweredQuestions 必须保留，采用“问题 + 当前边界 + 后续补数建议”的表达。
7. rectificationTasks 必须写成可分办、可督办、可跟踪的任务分解表。

【风险事项默认优先级】
1. 首要关注：依申请公开承压上行风险、答复规范性及复议诉讼风险、“本机关不掌握相关信息”占比较高所反映的检索协同和口径适用风险。
2. 重点关注：实质公开率及公开供给匹配风险、基层能力与法治审查支撑风险。
3. 持续跟踪：政务新媒体内容审核和平台运行风险、政策解读质效及精准触达问题。

【任务分解表字段】
sequence、taskName、taskType、priority、problem、measure、leadUnit、supportUnits、responsibilityLevel、deadline、milestones、trackingIndicator、supervisionMethod。

【风格约束】
1. 统一采用政府机关正式材料风格。
2. 不得使用“显著、明显、大幅、持续向好、成效明显”等无充分支撑词。
3. 不得将辅助研判标签写成正式考核结论。
4. 不要写成宣传稿、产品说明书或 AI 自动分析稿。

【输出要求】
仅返回合法 JSON，不要输出 Markdown，不要补充解释文字。

输入数据如下：
${JSON.stringify(context, null, 2)}
`.trim();
};

export const getNarrativeResponseSchema = () => ({
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
          priorityLevel: { type: 'string', enum: ['首要关注事项', '重点关注事项', '持续跟踪事项'] },
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
        required: ['sequence', 'taskName', 'taskType', 'priority', 'problem', 'measure', 'leadUnit', 'supportUnits', 'responsibilityLevel', 'deadline', 'milestones', 'trackingIndicator', 'supervisionMethod'],
        properties: {
          sequence: { type: 'number' },
          taskName: { type: 'string' },
          taskType: { type: 'string', enum: TASK_TYPE_VALUES },
          priority: { type: 'string', enum: TASK_PRIORITY_VALUES },
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
});

const sanitizeMetadata = (
  value: unknown,
  fallback: ReportMetadata,
  context: ReportContextPayload
): ReportMetadata => {
  const obj = typeof value === 'object' && value ? (value as Record<string, unknown>) : {};
  return {
    reportTitle: softenInferenceText(obj.reportTitle || fallback.reportTitle),
    summaryLine: softenInferenceText(obj.summaryLine || fallback.summaryLine),
    overallOverview: softenInferenceText(obj.overallOverview || fallback.overallOverview),
    positioning: softenInferenceText(obj.positioning || fallback.positioning),
    evidenceBasis: softenInferenceText(obj.evidenceBasis || fallback.evidenceBasis),
    cautionNote: softenInferenceText(obj.cautionNote || fallback.cautionNote),
    auxiliaryRiskLevel: `${context.rating}级（${context.riskLabel}）`,
    auxiliaryRiskLevelNote: context.auxiliaryRiskLevelNote,
  };
};

const sanitizeOverallJudgments = (value: unknown, fallback: OverallJudgmentItem[]): OverallJudgmentItem[] => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => {
      const obj = typeof item === 'object' && item ? (item as Record<string, unknown>) : {};
      return {
        heading: softenInferenceText(obj.heading),
        factBasis: softenInferenceText(obj.factBasis),
        riskJudgment: softenInferenceText(obj.riskJudgment),
        managementImplication: softenInferenceText(obj.managementImplication),
      };
    })
    .filter((item) => item.heading && item.factBasis && item.riskJudgment && item.managementImplication)
    .slice(0, 4);

  return normalized.length ? normalized : fallback;
};

const normalizeRiskPriority = (value: unknown): RiskPriorityLevel => {
  const normalized = softenInferenceText(value);
  if (normalized === '重点关注事项') return '重点关注事项';
  if (normalized === '持续跟踪事项' || normalized === '需持续跟踪') return '持续跟踪事项';
  if (normalized === '当前应优先关注') return '首要关注事项';
  return '首要关注事项';
};

const sanitizeRiskItems = (value: unknown, fallback: RiskItem[]): RiskItem[] => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => {
      const obj = typeof item === 'object' && item ? (item as Record<string, unknown>) : {};
      return {
        priorityLevel: normalizeRiskPriority(obj.priorityLevel),
        riskName: softenInferenceText(obj.riskName),
        basis: softenInferenceText(obj.basis),
        manifestation: softenInferenceText(obj.manifestation),
        impact: softenInferenceText(obj.impact),
        focus: softenInferenceText(obj.focus),
      };
    })
    .filter((item) => item.riskName && item.basis && item.manifestation && item.impact && item.focus)
    .slice(0, 7)
    .sort((a, b) => RISK_PRIORITY_ORDER[a.priorityLevel] - RISK_PRIORITY_ORDER[b.priorityLevel]);

  return normalized.length ? normalized : fallback;
};

const sanitizeFactGroups = (value: unknown, fallback: FactGroupItem[]): FactGroupItem[] => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => {
      const obj = typeof item === 'object' && item ? (item as Record<string, unknown>) : {};
      return {
        category: softenInferenceText(obj.category),
        points: sanitizeStringArray(obj.points),
      };
    })
    .filter((item) => item.category && item.points.length);

  return normalized.length ? normalized : fallback;
};

const sanitizePrudentAnalyses = (
  value: unknown,
  fallback: PrudentAnalysisItem[]
): PrudentAnalysisItem[] => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => {
      const obj = typeof item === 'object' && item ? (item as Record<string, unknown>) : {};
      return {
        topic: softenInferenceText(obj.topic),
        analysis: softenInferenceText(obj.analysis),
        support: softenInferenceText(obj.support),
        caution: softenInferenceText(obj.caution),
      };
    })
    .filter((item) => item.topic && item.analysis && item.support && item.caution)
    .slice(0, 5);

  return normalized.length ? normalized : fallback;
};

const sanitizeUnansweredQuestions = (
  value: unknown,
  fallback: UnansweredQuestionItem[]
): UnansweredQuestionItem[] => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item) => {
      const obj = typeof item === 'object' && item ? (item as Record<string, unknown>) : {};
      return {
        question: softenInferenceText(obj.question),
        currentLimit: softenInferenceText(obj.currentLimit),
        nextDataNeeded: softenInferenceText(obj.nextDataNeeded),
      };
    })
    .filter((item) => item.question && item.currentLimit && item.nextDataNeeded)
    .slice(0, 8);

  return normalized.length ? normalized : fallback;
};

const sanitizeRectificationTasks = (
  value: unknown,
  fallback: RectificationTaskItem[]
): RectificationTaskItem[] => {
  if (!Array.isArray(value)) return fallback;
  const normalized = value
    .map((item, index) => {
      const obj = typeof item === 'object' && item ? (item as Record<string, unknown>) : {};
      const fallbackItem = fallback[index] || fallback[fallback.length - 1];
      const taskType = TASK_TYPE_VALUES.includes(obj.taskType as RectificationTaskType)
        ? (obj.taskType as RectificationTaskType)
        : fallbackItem?.taskType || '机制建设类';
      const priority = TASK_PRIORITY_VALUES.includes(obj.priority as RectificationTaskPriority)
        ? (obj.priority as RectificationTaskPriority)
        : fallbackItem?.priority || '近期立即推进';

      return {
        sequence: Number(obj.sequence || index + 1),
        taskName: softenInferenceText(obj.taskName || obj.problem || fallbackItem?.taskName),
        taskType,
        priority,
        problem: softenInferenceText(obj.problem || fallbackItem?.problem),
        measure: softenInferenceText(obj.measure || fallbackItem?.measure),
        leadUnit: softenInferenceText(obj.leadUnit || fallbackItem?.leadUnit),
        supportUnits: softenInferenceText(obj.supportUnits || fallbackItem?.supportUnits),
        responsibilityLevel: softenInferenceText(obj.responsibilityLevel || fallbackItem?.responsibilityLevel),
        deadline: softenInferenceText(obj.deadline || fallbackItem?.deadline),
        milestones: sanitizeMilestones(obj.milestones, fallbackItem?.milestones || []),
        trackingIndicator: softenInferenceText(obj.trackingIndicator || fallbackItem?.trackingIndicator),
        supervisionMethod: softenInferenceText(obj.supervisionMethod || fallbackItem?.supervisionMethod),
      };
    })
    .filter(
      (item) =>
        item.sequence > 0 &&
        item.taskName &&
        item.problem &&
        item.measure &&
        item.leadUnit &&
        item.supportUnits &&
        item.responsibilityLevel &&
        item.deadline &&
        item.milestones.length &&
        item.trackingIndicator &&
        item.supervisionMethod
    )
    .slice(0, 10);

  return normalized.length ? normalized : fallback;
};

const isFormalStoredEnvelope = (value: unknown): value is StoredNarrativeEnvelope => {
  const obj = value as StoredNarrativeEnvelope;
  return (
    !!obj &&
    typeof obj === 'object' &&
    (obj._reportFormat === FORMAL_REPORT_FORMAT || obj._reportFormat === 'govInsightNarrativeV1') &&
    !!obj.narrative &&
    typeof obj.narrative === 'object'
  );
};

const isFormalNarrativePayload = (value: unknown): value is FormalNarrativePayload => {
  const obj = value as FormalNarrativePayload;
  return (
    !!obj &&
    typeof obj === 'object' &&
    Array.isArray(obj.overallJudgments) &&
    Array.isArray(obj.riskItems) &&
    Array.isArray(obj.confirmedFacts) &&
    Array.isArray(obj.prudentAnalyses) &&
    Array.isArray(obj.unansweredQuestions) &&
    Array.isArray(obj.rectificationTasks)
  );
};

const isNormalizedFormalReport = (value: unknown): value is EnhancedAIReportResponse => {
  const obj = value as EnhancedAIReportResponse & { version?: string };
  return (
    !!obj &&
    typeof obj === 'object' &&
    (obj.version === 'v3' || obj.version === 'v4') &&
    !!obj.metadata &&
    Array.isArray(obj.overallJudgments) &&
    Array.isArray(obj.riskItems) &&
    Array.isArray(obj.confirmedFacts) &&
    Array.isArray(obj.prudentAnalyses) &&
    Array.isArray(obj.unansweredQuestions) &&
    Array.isArray(obj.rectificationTasks) &&
    Array.isArray(obj.scorecards)
  );
};

export const buildRuleBasedEnhancedReport = (
  entity: EntityProfile,
  year: number,
  annualReportSummary?: AnnualReportSummary | null
): EnhancedAIReportResponse | null => {
  const current = entity.data.find((item) => item.year === year);
  if (!current) return null;
  const previous = entity.data.find((item) => item.year === year - 1) || null;
  const context = buildReportContextPayload(entity.name, current, previous, undefined, annualReportSummary);

  return {
    version: 'v4',
    metadata: metadataFallback(context),
    overallJudgments: buildRuleBasedOverallJudgments(context, annualReportSummary),
    riskItems: buildRuleBasedRiskItems(context, annualReportSummary),
    confirmedFacts: buildRuleBasedConfirmedFacts(context, annualReportSummary),
    prudentAnalyses: buildRuleBasedPrudentAnalyses(context, annualReportSummary),
    unansweredQuestions: buildRuleBasedUnansweredQuestions(),
    rectificationTasks: buildRuleBasedRectificationTasks(),
    closing: buildRuleBasedClosing(context),
    notes: buildRuleBasedNotes(context),
    scorecards: buildScorecards(context.current, context.previous),
    dataQuality: context.dataQuality,
    appendices: buildReportAppendices(context),
  };
};

const buildEnhancedReportFromNarrative = (
  narrative: Record<string, unknown>,
  entity: EntityProfile,
  year: number,
  annualReportSummary?: AnnualReportSummary | null
): EnhancedAIReportResponse | null => {
  const current = entity.data.find((item) => item.year === year);
  if (!current) return null;
  const previous = entity.data.find((item) => item.year === year - 1) || null;
  const context = buildReportContextPayload(entity.name, current, previous, undefined, annualReportSummary);
  const fallback = buildRuleBasedEnhancedReport(entity, year, annualReportSummary);
  if (!fallback) return null;
  if (!isFormalNarrativePayload(narrative)) return fallback;

  return {
    version: 'v4',
    metadata: sanitizeMetadata(narrative.metadata, fallback.metadata, context),
    overallJudgments: context.dataQuality.hasAnomaly
      ? fallback.overallJudgments
      : sanitizeOverallJudgments(narrative.overallJudgments, fallback.overallJudgments),
    riskItems: sanitizeRiskItems(narrative.riskItems, fallback.riskItems),
    confirmedFacts: context.dataQuality.factConclusionAllowed
      ? sanitizeFactGroups(narrative.confirmedFacts, fallback.confirmedFacts)
      : fallback.confirmedFacts,
    prudentAnalyses: sanitizePrudentAnalyses(narrative.prudentAnalyses, fallback.prudentAnalyses),
    unansweredQuestions: sanitizeUnansweredQuestions(narrative.unansweredQuestions, fallback.unansweredQuestions),
    rectificationTasks: sanitizeRectificationTasks(narrative.rectificationTasks, fallback.rectificationTasks),
    closing: softenInferenceText(narrative.closing, fallback.closing),
    notes: uniqueStrings(sanitizeStringArray(narrative.notes, fallback.notes)),
    scorecards: buildScorecards(context.current, context.previous),
    dataQuality: context.dataQuality,
    appendices: buildReportAppendices(context),
  };
};

export const normalizeReportData = (
  raw: unknown,
  entity: EntityProfile,
  year: number,
  annualReportSummary?: AnnualReportSummary | null
): EnhancedAIReportResponse | null => {
  const current = entity.data.find((item) => item.year === year) || null;
  const previous = entity.data.find((item) => item.year === year - 1) || null;
  const context = current ? buildReportContextPayload(entity.name, current, previous, undefined, annualReportSummary) : null;
  const fallback = buildRuleBasedEnhancedReport(entity, year, annualReportSummary);

  if (isNormalizedFormalReport(raw)) {
    if (!context || !fallback) return raw.version === 'v4' ? raw : { ...raw, version: 'v4' as const };
    return {
      version: 'v4',
      metadata: sanitizeMetadata(raw.metadata, fallback.metadata, context),
      overallJudgments: context.dataQuality.hasAnomaly
        ? fallback.overallJudgments
        : sanitizeOverallJudgments(raw.overallJudgments, fallback.overallJudgments),
      riskItems: sanitizeRiskItems(raw.riskItems, fallback.riskItems),
      confirmedFacts: context.dataQuality.factConclusionAllowed
        ? sanitizeFactGroups(raw.confirmedFacts, fallback.confirmedFacts)
        : fallback.confirmedFacts,
      prudentAnalyses: sanitizePrudentAnalyses(raw.prudentAnalyses, fallback.prudentAnalyses),
      unansweredQuestions: sanitizeUnansweredQuestions(raw.unansweredQuestions, fallback.unansweredQuestions),
      rectificationTasks: sanitizeRectificationTasks(raw.rectificationTasks, fallback.rectificationTasks),
      closing: softenInferenceText(raw.closing, fallback.closing),
      notes: uniqueStrings(sanitizeStringArray(raw.notes, fallback.notes)),
      scorecards: buildScorecards(context.current, context.previous),
      dataQuality: context.dataQuality,
      appendices: buildReportAppendices(context),
    };
  }

  if (isFormalStoredEnvelope(raw)) {
    return buildEnhancedReportFromNarrative(raw.narrative, entity, year, annualReportSummary);
  }

  if (isFormalNarrativePayload(raw)) {
    return buildEnhancedReportFromNarrative(raw as Record<string, unknown>, entity, year, annualReportSummary);
  }

  const legacy = raw as LegacyAIReportResponse;
  if (legacy && typeof legacy === 'object' && typeof legacy.summary === 'string') return fallback;
  return fallback;
};

export const getFormalReportStorageFormat = (): string => FORMAL_REPORT_FORMAT;
