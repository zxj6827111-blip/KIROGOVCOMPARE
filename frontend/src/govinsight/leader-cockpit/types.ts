export type DataStatus = 'ok' | 'missing' | 'not_connected' | 'changed_definition';
export type ValueStatus = 'VALUE' | 'MISSING';
export type ViewLevel = 'city' | 'district' | 'department';

export interface MetricDefinition {
  id: string;
  name: string;
  formula: string;
  description: string;
  unit?: string;
  notes?: string;
}

export interface EvidenceItem {
  id: string;
  title: string;
  source: string;
  detail: string;
  linkLabel?: string;
}

export interface MetricVariant {
  id: string;
  label: string;
  value?: number;
  status: DataStatus;
  formula: string;
}

export interface MetricValue {
  value?: number;
  unit?: string;
  status: DataStatus;
  yoy?: number | null;
  yoyLabel?: string;
  variants?: MetricVariant[];
  definition?: MetricDefinition;
  evidence?: EvidenceItem[];
}

export interface YearPoint {
  year: number;
  value?: number;
  status: DataStatus;
}

export interface YearSeries {
  id: string;
  label: string;
  unit?: string;
  points: YearPoint[];
}

export interface ReasonItem {
  id: string;
  name: string;
  value?: number;
  valueStatus: ValueStatus;
  share?: number;
  status: DataStatus;
  trend?: number | null;
  categoryId?: string;
  definition?: MetricDefinition;
  evidence?: EvidenceItem[];
}

export interface ReasonCategory {
  id: string;
  name: string;
  total?: number;
  share?: number;
  status: DataStatus;
  items: ReasonItem[];
}

export interface AttributionItem {
  id: string;
  label: string;
  value?: number;
  share?: number;
  status: DataStatus;
  valueStatus?: ValueStatus;
}

export interface ActionPackTemplateInstance {
  id: string;
  title: string;
  risk: string;
  rootCause: string;
  actions: string[];
  kpis: string[];
  ownerLine: string;
  cycle: string;
  acceptance: string;
  status: DataStatus;
  evidence?: EvidenceItem[];
}

export interface RectificationRow {
  id: string;
  issue: string;
  action: string;
  owner: string;
  dueDate?: string;
  kpi: string;
  status?: string;
}

export interface LeaderCockpitReport {
  content?: string;
  rectificationTable?: RectificationRow[];
  metricAppendix?: MetricDefinition[];
  keyFindings?: {
    id: string;
    text: string;
    evidence?: EvidenceItem[];
  }[];
}

export interface LeaderCockpitModel {
  city: { id: string; name: string };
  year: number;
  seriesYears: number[];
  metrics: {
    newApplications: MetricValue;
    acceptedTotal: MetricValue;
    substantiveDisclosureRate: MetricValue;
    reconsiderationCorrectionRate: MetricValue;
  };
  trends: {
    pressure: YearSeries;
    quality: YearSeries;
    risk: YearSeries;
    serviceRatio: YearSeries;
  };
  reasons: {
    categories: ReasonCategory[];
    topReasons: ReasonItem[];
  };
  funnel: {
    newApplications: MetricValue;
    disputeCases: MetricValue;
    correctionCases: MetricValue;
    rates: {
      disputeConversion: MetricValue;
      correctionConversion: MetricValue;
      correctionRate: MetricValue;
    };
    topAttributions: {
      byReason: AttributionItem[];
      byResponseType?: AttributionItem[];
    };
  };
  actionPacks: {
    templates: ActionPackTemplateInstance[];
  };
  report: LeaderCockpitReport;
  meta: {
    dataStatus: Record<string, DataStatus>;
    notices: string[];
  };
}

// Entity Comparison Model (for district and department views)
export type StabilityLevel = 'high' | 'medium' | 'low';
export type MissingType = 'not_connected' | 'not_reported' | 'parse_failed' | 'unknown';

export interface EntityMetrics {
  id: string;
  name: string;
  newApplications?: number;
  newApplicationsStatus?: ValueStatus;
  acceptedTotal?: number;
  acceptedTotalStatus?: ValueStatus;
  disclosureRate?: number;
  disclosureRateStatus?: ValueStatus;
  disclosureNumerator?: number;      // 实质公开数
  disclosureDenominator?: number;    // 办结数
  correctionRate?: number;
  correctionRateStatus?: ValueStatus;
  correctionNumerator?: number;      // 纠错数
  correctionDenominator?: number;    // 立案数
  status: DataStatus;
  riskLevel?: 'red' | 'yellow' | 'green' | 'missing';
  riskReason?: string;
  isSampleSufficient?: boolean;      // 样本量是否达到门槛

  // Enhancement D: stability
  stability?: StabilityLevel;

  // Enhancement B: missing type
  missingType?: MissingType;
}

export type DisclosureMethod = 'substantive' | 'absolute';
export type CorrectionMethod = 'reconsideration' | 'comprehensive';

export interface ManagementActionItem {
  id: string;
  entityName: string;
  reason: string; // e.g. "红牌: 公开率极低"
  metrics: string; // e.g. "35% (10/28)"
  link?: string;
}

export interface GovernanceSuggestion {
  id: string;
  title: string;
  content: string;
  kpi: string;
  ownerSuggestion: string;
  cycle: string;
}

export interface EntityComparisonModel {
  city: { id: string; name: string };
  year: number;
  viewLevel: ViewLevel;
  entities: EntityMetrics[];
  rankings: {
    byDisclosureRate: EntityMetrics[];
    byCorrectionRate: EntityMetrics[];
    byNewApplications: EntityMetrics[];
  };
  statistics: {
    total: number;
    avgDisclosureRate?: number;
    avgDisclosureRateWeighted?: number;
    avgCorrectionRate?: number;
    avgCorrectionRateWeighted?: number;
    maxDisclosureRate?: number;
    minDisclosureRate?: number;
    // Robust Gap
    disclosureRateP90?: number | null;
    disclosureRateP10?: number | null;
    disclosureRateGapP90P10?: number | null;
    // Coverage
    disclosureRateCoverage?: string;
    correctionRateCoverage?: string;
    reasonCoverage?: string;

    // Enhancement B: Detailed Coverage
    reportCoverage?: string; // 有年报/总数
    fieldCoverage?: string; // 关键字段齐全/总数
    parseSuccessRate?: string; // 解析成功/有年报
  };
  // Enhancement C: Management Actions (District only)
  managementActions?: {
    interviewList: ManagementActionItem[];
    commonShortcomings: { name: string; count: number }[];
    governanceSuggestions: GovernanceSuggestion[];
  };
  calibration: {
    disclosureMethod: DisclosureMethod;
    correctionMethod: CorrectionMethod;
    includesCarryOver: boolean;
    enableStableSample: boolean;
  };
}
