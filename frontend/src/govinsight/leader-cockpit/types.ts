export type DataStatus = 'ok' | 'missing' | 'not_connected' | 'changed_definition';

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
