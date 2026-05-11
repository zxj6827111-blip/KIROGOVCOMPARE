import pool from '../config/database-llm';

type DataStatus = 'ok' | 'missing' | 'not_connected' | 'changed_definition';
type ValueStatus = 'VALUE' | 'MISSING';
type ViewLevel = 'city' | 'district' | 'department';
type StabilityLevel = 'high' | 'medium' | 'low';
type MissingType = 'not_connected' | 'not_reported' | 'parse_failed' | 'unknown';
type RiskLevel = 'red' | 'yellow' | 'green' | 'missing';
type DisclosureMethod = 'substantive' | 'absolute';
type CorrectionMethod = 'reconsideration' | 'comprehensive';

interface MetricVariant {
  id: string;
  label: string;
  value?: number;
  status: DataStatus;
  formula: string;
}

interface MetricValue {
  value?: number;
  unit?: string;
  status: DataStatus;
  yoy?: number | null;
  variants?: MetricVariant[];
}

interface YearPoint {
  year: number;
  value?: number;
  status: DataStatus;
}

interface YearSeries {
  id: string;
  label: string;
  unit?: string;
  points: YearPoint[];
}

interface ReasonItem {
  id: string;
  name: string;
  value?: number;
  valueStatus: ValueStatus;
  share?: number;
  status: DataStatus;
  trend?: number | null;
  categoryId?: string;
}

interface ReasonCategory {
  id: string;
  name: string;
  total?: number;
  share?: number;
  status: DataStatus;
  items: ReasonItem[];
}

interface AttributionItem {
  id: string;
  label: string;
  value?: number;
  share?: number;
  status: DataStatus;
  valueStatus?: ValueStatus;
}

interface ActionPackTemplateInstance {
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
}

interface LeaderCockpitReport {
  content?: string;
  rectificationTable?: Array<Record<string, unknown>>;
  metricAppendix?: Array<Record<string, unknown>>;
  keyFindings?: Array<Record<string, unknown>>;
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

export interface EntityMetrics {
  id: string;
  name: string;
  newApplications?: number;
  newApplicationsStatus?: ValueStatus;
  acceptedTotal?: number;
  acceptedTotalStatus?: ValueStatus;
  disclosureRate?: number;
  disclosureRateStatus?: ValueStatus;
  disclosureNumerator?: number;
  disclosureDenominator?: number;
  correctionRate?: number;
  correctionRateStatus?: ValueStatus;
  correctionNumerator?: number;
  correctionDenominator?: number;
  status: DataStatus;
  riskLevel?: RiskLevel;
  riskReason?: string;
  isSampleSufficient?: boolean;
  stability?: StabilityLevel;
  missingType?: MissingType;
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
    disclosureRateP90?: number | null;
    disclosureRateP10?: number | null;
    disclosureRateGapP90P10?: number | null;
    disclosureRateCoverage?: string;
    correctionRateCoverage?: string;
    reasonCoverage?: string;
    reportCoverage?: string;
    fieldCoverage?: string;
    parseSuccessRate?: string;
    statsCoverage?: string;
    analyzableCoverage?: string;
    officialCoverage?: string;
  };
  calibration: {
    disclosureMethod: DisclosureMethod;
    correctionMethod: CorrectionMethod;
    includesCarryOver: boolean;
    enableStableSample: boolean;
  };
}

interface ComparisonCalibration {
  disclosureMethod: DisclosureMethod;
  correctionMethod: CorrectionMethod;
  includesCarryOver: boolean;
  enableStableSample: boolean;
}

type StatsRow = Record<string, any>;

const LEADER_COCKPIT_SERIES_YEARS = 5;
const MIN_N_FOR_RANKING = 30;
const LITIGATION_CONNECTION: 'auto' | 'connected' | 'not_connected' = 'auto';
const RISK_THRESHOLDS = {
  disclosureRate: {
    red: 40,
    yellow: 45,
  },
  correctionRate: {
    red: 15,
    yellow: 10,
  },
};

function asNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function computeYoY(current?: number, previous?: number): number | null {
  if (current === undefined || previous === undefined) return null;
  if (previous === 0) return null;
  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function safeRate(
  numerator?: number,
  denominator?: number
): { value?: number; status: DataStatus } {
  if (denominator === undefined || denominator === null) {
    return { status: 'missing' };
  }
  if (denominator === 0) {
    return { status: 'changed_definition' };
  }
  if (numerator === undefined || numerator === null) {
    return { status: 'missing' };
  }
  return { value: (numerator / denominator) * 100, status: 'ok' };
}

function safeShare(
  part?: number,
  total?: number
): { value?: number; status: DataStatus } {
  if (total === undefined || total === null) {
    return { status: 'missing' };
  }
  if (total === 0) {
    return { status: 'changed_definition' };
  }
  if (part === undefined || part === null) {
    return { status: 'missing' };
  }
  return { value: (part / total) * 100, status: 'ok' };
}

function percentile(values: number[], q: number): number | null {
  const cleaned = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!cleaned.length) return null;
  const index = (cleaned.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return cleaned[lower];
  const weight = index - lower;
  return cleaned[lower] * (1 - weight) + cleaned[upper] * weight;
}

function robustGapP90P10(values: number[]): number | null {
  const p90 = percentile(values, 0.9);
  const p10 = percentile(values, 0.1);
  if (p90 === null || p10 === null) return null;
  return p90 - p10;
}

function sumValues(...values: Array<number | undefined>): number {
  return values.reduce<number>((acc, value) => acc + (value ?? 0), 0);
}

function getSeriesYears(year: number, span = LEADER_COCKPIT_SERIES_YEARS): number[] {
  return Array.from({ length: span }, (_, idx) => year - (span - 1) + idx);
}

function getMetricStatus(row: StatsRow | null): DataStatus {
  if (!row) return 'missing';
  if (String(row.materialize_status || '').startsWith('blocked_')) return 'missing';
  return 'ok';
}

function buildMetricValue(
  row: StatsRow | null,
  value: number | undefined,
  unit?: string
): MetricValue {
  return {
    value,
    unit,
    status: getMetricStatus(row),
  };
}

function buildMetricVariants(row: StatsRow | null): { disclosure: MetricVariant[]; correction: MetricVariant[] } {
  const totalHandled = row
    ? sumValues(
        asNumber(row.outcome_public),
        asNumber(row.outcome_partial),
        asNumber(row.outcome_not_open),
        asNumber(row.outcome_unable),
        asNumber(row.outcome_ignore),
        asNumber(row.outcome_other)
      )
    : undefined;

  const disclosure: MetricVariant[] = [
    {
      id: 'public_partial_over_closed',
      label: '(公开+部分公开)/办结',
      ...safeRate(sumValues(asNumber(row?.outcome_public), asNumber(row?.outcome_partial)), totalHandled),
      formula: '(公开+部分公开)/办结',
    },
    {
      id: 'public_over_closed',
      label: '公开/办结',
      ...safeRate(asNumber(row?.outcome_public), totalHandled),
      formula: '公开/办结',
    },
    {
      id: 'public_partial_over_accepted',
      label: '(公开+部分公开)/受理合计',
      ...safeRate(
        sumValues(asNumber(row?.outcome_public), asNumber(row?.outcome_partial)),
        sumValues(asNumber(row?.app_new), asNumber(row?.app_carried_over))
      ),
      formula: '(公开+部分公开)/受理合计',
    },
  ];

  const hasLitigation = LITIGATION_CONNECTION === 'connected'
    || (LITIGATION_CONNECTION === 'auto' && row?.lit_total !== undefined);

  const correction: MetricVariant[] = [
    {
      id: 'reconsideration_only',
      label: '复议纠错率',
      ...safeRate(asNumber(row?.rev_corrected), asNumber(row?.rev_total)),
      formula: '复议纠错/复议结案',
    },
    {
      id: 'reconsideration_litigation',
      label: '复议+诉讼纠错率',
      ...(() => {
        if (!hasLitigation) return { status: 'not_connected' as const };
        const total = sumValues(asNumber(row?.rev_total), asNumber(row?.lit_total));
        const corrected = sumValues(asNumber(row?.rev_corrected), asNumber(row?.lit_corrected));
        return safeRate(corrected, total);
      })(),
      formula: '(复议纠错+诉讼纠错)/(复议立案+诉讼立案)',
    },
  ];

  return { disclosure, correction };
}

function buildReasonCategories(
  current: StatsRow | null,
  previous: StatsRow | null
): { categories: ReasonCategory[]; topReasons: ReasonItem[] } {
  if (!current) {
    return {
      categories: [
        { id: 'A', name: 'A 法定不公开（不予公开）', total: undefined, share: undefined, status: 'missing', items: [] },
        { id: 'B', name: 'B 信息资产不足（无法提供）', total: undefined, share: undefined, status: 'missing', items: [] },
        { id: 'C', name: 'C 程序性不予处理', total: undefined, share: undefined, status: 'missing', items: [] },
      ],
      topReasons: [],
    };
  }

  const totals = {
    A: sumValues(
      asNumber(current.outcome_not_open_state_secret),
      asNumber(current.outcome_not_open_law_forbidden),
      asNumber(current.outcome_not_open_danger),
      asNumber(current.outcome_not_open_third_party),
      asNumber(current.outcome_not_open_internal),
      asNumber(current.outcome_not_open_process),
      asNumber(current.outcome_not_open_enforcement),
      asNumber(current.outcome_not_open_admin_query)
    ),
    B: sumValues(
      asNumber(current.outcome_unable_no_info),
      asNumber(current.outcome_unable_need_creation),
      asNumber(current.outcome_unable_unclear)
    ),
    C: sumValues(
      asNumber(current.outcome_complaint),
      asNumber(current.outcome_ignore_repeat),
      asNumber(current.outcome_publication),
      asNumber(current.outcome_massive),
      asNumber(current.outcome_confirm)
    ),
  };

  const totalAll = totals.A + totals.B + totals.C;

  const buildItem = (
    id: string,
    name: string,
    currentValue?: number,
    previousValue?: number,
    categoryId?: string
  ): ReasonItem => {
    const valueStatus: ValueStatus = currentValue === undefined ? 'MISSING' : 'VALUE';
    const share = valueStatus === 'VALUE' ? safeShare(currentValue, totalAll) : { status: 'missing' as const };
    return {
      id,
      name,
      value: currentValue,
      valueStatus,
      share: share.status === 'ok' ? share.value : undefined,
      status: valueStatus === 'VALUE' ? 'ok' : 'missing',
      trend: valueStatus === 'VALUE' ? computeYoY(currentValue, previousValue) : null,
      categoryId,
    };
  };

  const itemsA: ReasonItem[] = [
    buildItem('A1', '国家秘密', asNumber(current.outcome_not_open_state_secret), previous ? asNumber(previous.outcome_not_open_state_secret) : undefined, 'A'),
    buildItem('A2', '法律法规禁止', asNumber(current.outcome_not_open_law_forbidden), previous ? asNumber(previous.outcome_not_open_law_forbidden) : undefined, 'A'),
    buildItem('A3', '三安全一稳定', asNumber(current.outcome_not_open_danger), previous ? asNumber(previous.outcome_not_open_danger) : undefined, 'A'),
    buildItem('A4', '第三方合法权益', asNumber(current.outcome_not_open_third_party), previous ? asNumber(previous.outcome_not_open_third_party) : undefined, 'A'),
    buildItem('A5', '内部事务信息', asNumber(current.outcome_not_open_internal), previous ? asNumber(previous.outcome_not_open_internal) : undefined, 'A'),
    buildItem('A6', '过程性信息', asNumber(current.outcome_not_open_process), previous ? asNumber(previous.outcome_not_open_process) : undefined, 'A'),
    buildItem('A7', '行政执法案卷', asNumber(current.outcome_not_open_enforcement), previous ? asNumber(previous.outcome_not_open_enforcement) : undefined, 'A'),
    buildItem('A8', '行政查询事项', asNumber(current.outcome_not_open_admin_query), previous ? asNumber(previous.outcome_not_open_admin_query) : undefined, 'A'),
  ];

  const itemsB: ReasonItem[] = [
    buildItem('B1', '本机关不掌握', asNumber(current.outcome_unable_no_info), previous ? asNumber(previous.outcome_unable_no_info) : undefined, 'B'),
    buildItem('B2', '需另行制作', asNumber(current.outcome_unable_need_creation), previous ? asNumber(previous.outcome_unable_need_creation) : undefined, 'B'),
    buildItem('B3', '补正后仍不明确', asNumber(current.outcome_unable_unclear), previous ? asNumber(previous.outcome_unable_unclear) : undefined, 'B'),
  ];

  const itemsC: ReasonItem[] = [
    buildItem('C1', '信访举报投诉', asNumber(current.outcome_complaint), previous ? asNumber(previous.outcome_complaint) : undefined, 'C'),
    buildItem('C2', '重复申请', asNumber(current.outcome_ignore_repeat), previous ? asNumber(previous.outcome_ignore_repeat) : undefined, 'C'),
    buildItem('C3', '要求提供公开出版物', asNumber(current.outcome_publication), previous ? asNumber(previous.outcome_publication) : undefined, 'C'),
    buildItem('C4', '大量反复申请', asNumber(current.outcome_massive), previous ? asNumber(previous.outcome_massive) : undefined, 'C'),
    buildItem('C5', '要求确认或重新获取', asNumber(current.outcome_confirm), previous ? asNumber(previous.outcome_confirm) : undefined, 'C'),
  ];

  const categories: ReasonCategory[] = [
    {
      id: 'A',
      name: 'A 法定不公开（不予公开）',
      total: totals.A,
      share: safeShare(totals.A, totalAll).value,
      status: 'ok',
      items: itemsA,
    },
    {
      id: 'B',
      name: 'B 信息资产不足（无法提供）',
      total: totals.B,
      share: safeShare(totals.B, totalAll).value,
      status: 'ok',
      items: itemsB,
    },
    {
      id: 'C',
      name: 'C 程序性不予处理',
      total: totals.C,
      share: safeShare(totals.C, totalAll).value,
      status: 'ok',
      items: itemsC,
    },
  ];

  const topReasons = [...itemsA, ...itemsB, ...itemsC]
    .filter((item) => item.valueStatus === 'VALUE')
    .sort((a, b) => (b.value || 0) - (a.value || 0))
    .slice(0, 5);

  return { categories, topReasons };
}

function buildActionPackTemplates(topReason?: ReasonItem): ActionPackTemplateInstance[] {
  const templates: ActionPackTemplateInstance[] = [];

  if (topReason) {
    templates.push({
      id: `pack-${topReason.id}`,
      title: `围绕“${topReason.name}”的整改行动包`,
      risk: '办理结果集中于单一原因，易引发质疑与复议压力。',
      rootCause: '制度口径解释不足，信息资产完备性不够。',
      actions: [
        '梳理对应事项的公开边界与标准化答复模板。',
        '建立信息资产台账，明确责任科室与更新周期。',
        '开展专项复盘，形成同类事项的统一口径。',
      ],
      kpis: ['公开边界说明覆盖率 >= 90%', '同类事项纠错率下降 10%'],
      ownerLine: '条线牵头单位',
      cycle: '30 天',
      acceptance: '形成台账与模板，完成专班复盘纪要',
      status: 'ok',
    });
  }

  templates.push(
    {
      id: 'pack-asset',
      title: '信息资产不足类专项整改',
      risk: '无法提供类事项占比偏高，影响公众获取体验。',
      rootCause: '信息资产未沉淀或未形成更新机制。',
      actions: [
        '建立目录清单与责任清单，明确每类事项的来源。',
        '补齐历史资料与档案数字化归档。',
        '形成跨部门协同更新流程。',
      ],
      kpis: ['信息资产清单覆盖率 >= 95%', '无法提供类占比下降 8%'],
      ownerLine: '信息资源条线',
      cycle: '60 天',
      acceptance: '清单上线并完成首轮核对',
      status: 'ok',
    },
    {
      id: 'pack-process',
      title: '流程程序类优化行动包',
      risk: '补正/重复申请类占比偏高，办件效率受影响。',
      rootCause: '申请指引与补正说明不够清晰。',
      actions: [
        '完善申请指引与补正模板，突出必填项。',
        '增加线上预审提示与咨询通道。',
        '建立重复申请识别与沟通机制。',
      ],
      kpis: ['补正率下降 5%', '重复申请识别率 >= 90%'],
      ownerLine: '办理流程条线',
      cycle: '45 天',
      acceptance: '指引与补正模板完成更新并上线',
      status: 'ok',
    },
    {
      id: 'pack-legal',
      title: '法治风险类治理行动包',
      risk: '纠错率偏高，争议成本上升。',
      rootCause: '复议关注事项缺少前置风险评估。',
      actions: [
        '建立高风险事项复核清单。',
        '针对纠错高频事项开展案例研讨。',
        '完善风险预警与复盘机制。',
      ],
      kpis: ['纠错率下降 5%', '高风险事项复核覆盖率 >= 90%'],
      ownerLine: '法制条线',
      cycle: '60 天',
      acceptance: '形成复核清单与案例复盘材料',
      status: 'ok',
    }
  );

  return templates;
}

function buildAttributions(items: ReasonItem[], total?: number): AttributionItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.name,
    value: item.value,
    valueStatus: item.valueStatus,
    share: total && item.valueStatus === 'VALUE'
      ? ((item.value || 0) / total) * 100
      : undefined,
    status: item.status,
  }));
}

function assessStability(n?: number, missingCount = 0): StabilityLevel {
  if (n === undefined) return 'low';
  if (missingCount > 0 && n < 30) return 'low';
  if (n >= 100 && missingCount === 0) return 'high';
  if (n >= 30) return 'medium';
  return 'low';
}

function assessRiskLevel(entity: EntityMetrics): RiskLevel {
  if (entity.status === 'missing') return 'missing';
  if (!entity.isSampleSufficient) return 'green';

  if (entity.correctionRateStatus === 'VALUE' && entity.correctionRate !== undefined) {
    if (entity.correctionRate > RISK_THRESHOLDS.correctionRate.red) return 'red';
    if (entity.correctionRate > RISK_THRESHOLDS.correctionRate.yellow) return 'yellow';
  }

  if (entity.disclosureRateStatus === 'VALUE' && entity.disclosureRate !== undefined) {
    if (entity.disclosureRate < RISK_THRESHOLDS.disclosureRate.red) return 'red';
    if (entity.disclosureRate < RISK_THRESHOLDS.disclosureRate.yellow) return 'yellow';
  }

  return 'green';
}

function getRiskReason(entity: EntityMetrics, level: RiskLevel): string {
  if (level === 'missing') return '缺失：数据待接入或未填报';

  if (!entity.isSampleSufficient) {
    return `观察：样本不足 (N=${entity.acceptedTotal || 0} < ${MIN_N_FOR_RANKING})，不参与风险评级`;
  }

  if (level === 'red') {
    if (entity.correctionRate !== undefined && entity.correctionRate > RISK_THRESHOLDS.correctionRate.red) {
      return `红牌：纠错率 ${entity.correctionRate.toFixed(1)}% > ${RISK_THRESHOLDS.correctionRate.red}% (且 N=${entity.acceptedTotal} >= ${MIN_N_FOR_RANKING})`;
    }
    if (entity.disclosureRate !== undefined && entity.disclosureRate < RISK_THRESHOLDS.disclosureRate.red) {
      return `红牌：公开率 ${entity.disclosureRate.toFixed(1)}% < ${RISK_THRESHOLDS.disclosureRate.red}% (且 N=${entity.acceptedTotal} >= ${MIN_N_FOR_RANKING})`;
    }
  }

  if (level === 'yellow') {
    if (entity.correctionRate !== undefined && entity.correctionRate > RISK_THRESHOLDS.correctionRate.yellow) {
      return `黄牌：纠错率 ${entity.correctionRate.toFixed(1)}% > ${RISK_THRESHOLDS.correctionRate.yellow}%`;
    }
    if (entity.disclosureRate !== undefined && entity.disclosureRate < RISK_THRESHOLDS.disclosureRate.yellow) {
      return `黄牌：公开率 ${entity.disclosureRate.toFixed(1)}% < ${RISK_THRESHOLDS.disclosureRate.yellow}%`;
    }
  }

  return '正常：指标在安全范围内';
}

function buildMaterializeOrderSql(alias = 's'): string {
  return `CASE ${alias}.materialize_status
    WHEN 'official' THEN 0
    WHEN 'preview' THEN 1
    WHEN 'blocked_mapping_pending' THEN 2
    WHEN 'blocked_unknown_unit_type' THEN 3
    WHEN 'blocked_missing_facts' THEN 4
    ELSE 5
  END`;
}

export class GovInsightLeaderCockpitService {
  async buildModel(regionId: number, year: number): Promise<LeaderCockpitModel | null> {
    const entityMeta = await this.getEntityMeta(regionId);
    if (!entityMeta) return null;

    const rows = await this.getRegionRows(regionId);
    const rowMap = new Map<number, StatsRow>(rows.map((row) => [asNumber(row.year), row]));
    const current = rowMap.get(year) || null;
    const previous = rowMap.get(year - 1) || null;
    const seriesYears = getSeriesYears(year);

    const disclosureVariants = buildMetricVariants(current).disclosure;
    const correctionVariants = buildMetricVariants(current).correction;
    const prevDisclosureVariants = buildMetricVariants(previous).disclosure;
    const prevCorrectionVariants = buildMetricVariants(previous).correction;

    const disclosureDefault = disclosureVariants[0];
    const correctionDefault = correctionVariants[0];

    const newApplications = buildMetricValue(current, current ? asNumber(current.app_new) : undefined, '件');
    newApplications.yoy = computeYoY(
      current ? asNumber(current.app_new) : undefined,
      previous ? asNumber(previous.app_new) : undefined
    );

    const acceptedTotalValue = current
      ? sumValues(asNumber(current.app_new), asNumber(current.app_carried_over))
      : undefined;
    const previousAcceptedTotal = previous
      ? sumValues(asNumber(previous.app_new), asNumber(previous.app_carried_over))
      : undefined;
    const acceptedTotal = buildMetricValue(current, acceptedTotalValue, '件');
    acceptedTotal.yoy = computeYoY(acceptedTotalValue, previousAcceptedTotal);

    const substantiveDisclosureRate: MetricValue = {
      value: disclosureDefault.value,
      unit: '%',
      status: disclosureDefault.status,
      yoy: computeYoY(disclosureDefault.value, prevDisclosureVariants[0]?.value),
      variants: disclosureVariants,
    };

    const reconsiderationCorrectionRate: MetricValue = {
      value: correctionDefault.value,
      unit: '%',
      status: correctionDefault.status,
      yoy: computeYoY(correctionDefault.value, prevCorrectionVariants[0]?.value),
      variants: correctionVariants,
    };

    const trends: LeaderCockpitModel['trends'] = {
      pressure: {
        id: 'pressure',
        label: '压力（新收）',
        unit: '件',
        points: seriesYears.map((seriesYear) => {
          const row = rowMap.get(seriesYear) || null;
          return {
            year: seriesYear,
            value: row ? asNumber(row.app_new) : undefined,
            status: getMetricStatus(row),
          };
        }),
      },
      quality: {
        id: 'quality',
        label: '质量（实质公开率）',
        unit: '%',
        points: seriesYears.map((seriesYear) => {
          const row = rowMap.get(seriesYear) || null;
          const totalHandled = row
            ? sumValues(
                asNumber(row.outcome_public),
                asNumber(row.outcome_partial),
                asNumber(row.outcome_not_open),
                asNumber(row.outcome_unable),
                asNumber(row.outcome_ignore),
                asNumber(row.outcome_other)
              )
            : undefined;
          const rate = safeRate(sumValues(asNumber(row?.outcome_public), asNumber(row?.outcome_partial)), totalHandled);
          return {
            year: seriesYear,
            value: rate.value,
            status: row ? rate.status : 'missing',
          };
        }),
      },
      risk: {
        id: 'risk',
        label: '风险（复议纠错率）',
        unit: '%',
        points: seriesYears.map((seriesYear) => {
          const row = rowMap.get(seriesYear) || null;
          const rate = safeRate(asNumber(row?.rev_corrected), asNumber(row?.rev_total));
          return {
            year: seriesYear,
            value: rate.value,
            status: row ? rate.status : 'missing',
          };
        }),
      },
      serviceRatio: {
        id: 'serviceRatio',
        label: '监管—服务结构比（许可 vs 执法）',
        unit: '',
        points: seriesYears.map((seriesYear) => {
          const row = rowMap.get(seriesYear) || null;
          const total = row ? asNumber(row.action_punishment) : undefined;
          const value = total && total > 0 ? asNumber(row?.action_licensing) / total : undefined;
          return {
            year: seriesYear,
            value,
            status: row ? (value === undefined ? 'missing' : 'ok') : 'missing',
          };
        }),
      },
    };

    const reasons = buildReasonCategories(current, previous);
    const includeLitigation = LITIGATION_CONNECTION === 'connected'
      || (LITIGATION_CONNECTION === 'auto' && current?.lit_total !== undefined);
    const disputeCasesValue = current
      ? includeLitigation
        ? sumValues(asNumber(current.rev_total), asNumber(current.lit_total))
        : asNumber(current.rev_total)
      : undefined;
    const correctionCasesValue = current
      ? includeLitigation
        ? sumValues(asNumber(current.rev_corrected), asNumber(current.lit_corrected))
        : asNumber(current.rev_corrected)
      : undefined;
    const disputeRate = safeRate(disputeCasesValue, current ? asNumber(current.app_new) : undefined);
    const correctionConversionRate = safeRate(correctionCasesValue, current ? asNumber(current.app_new) : undefined);
    const correctionRate = safeRate(correctionCasesValue, disputeCasesValue);

    const responseTypeAttributions: AttributionItem[] | undefined = current
      ? [
          { id: 'public', label: '公开', value: asNumber(current.outcome_public), status: 'ok' as const, valueStatus: 'VALUE' as const },
          { id: 'partial', label: '部分公开', value: asNumber(current.outcome_partial), status: 'ok' as const, valueStatus: 'VALUE' as const },
          { id: 'notOpen', label: '不予公开', value: asNumber(current.outcome_not_open), status: 'ok' as const, valueStatus: 'VALUE' as const },
          { id: 'unable', label: '无法提供', value: asNumber(current.outcome_unable), status: 'ok' as const, valueStatus: 'VALUE' as const },
          { id: 'ignore', label: '其他处理', value: asNumber(current.outcome_ignore), status: 'ok' as const, valueStatus: 'VALUE' as const },
        ]
          .sort((a, b) => (b.value || 0) - (a.value || 0))
          .slice(0, 5)
      : undefined;

    const notices: string[] = [];
    if (!current) {
      notices.push('当前年度数据未接入，指标已标记待接入。');
    }
    if (LITIGATION_CONNECTION === 'not_connected') {
      notices.push('诉讼数据未接入，纠错率口径以复议为主。');
    }

    const totalReasonCount = sumValues(
      reasons.categories[0]?.total,
      reasons.categories[1]?.total,
      reasons.categories[2]?.total
    );

    return {
      city: { id: entityMeta.orgId, name: entityMeta.name },
      year,
      seriesYears,
      metrics: {
        newApplications,
        acceptedTotal,
        substantiveDisclosureRate,
        reconsiderationCorrectionRate,
      },
      trends,
      reasons,
      funnel: {
        newApplications: buildMetricValue(current, current ? asNumber(current.app_new) : undefined, '件'),
        disputeCases: {
          value: disputeCasesValue,
          unit: '件',
          status: getMetricStatus(current),
        },
        correctionCases: {
          value: correctionCasesValue,
          unit: '件',
          status: getMetricStatus(current),
        },
        rates: {
          disputeConversion: {
            value: disputeRate.value,
            unit: '%',
            status: disputeRate.status,
          },
          correctionConversion: {
            value: correctionConversionRate.value,
            unit: '%',
            status: correctionConversionRate.status,
          },
          correctionRate: {
            value: correctionRate.value,
            unit: '%',
            status: correctionRate.status,
          },
        },
        topAttributions: {
          byReason: buildAttributions(reasons.topReasons, totalReasonCount),
          byResponseType: responseTypeAttributions,
        },
      },
      actionPacks: {
        templates: buildActionPackTemplates(reasons.topReasons[0]),
      },
      report: {},
      meta: {
        dataStatus: {},
        notices,
      },
    };
  }

  async buildComparisonModel(
    regionId: number,
    year: number,
    viewLevel: Exclude<ViewLevel, 'city'>,
    calibration: ComparisonCalibration
  ): Promise<EntityComparisonModel | null> {
    const entityMeta = await this.getEntityMeta(regionId);
    if (!entityMeta) return null;

    const rows = await this.getDirectChildRows(regionId, year, viewLevel);
    if (!rows.length) {
      return {
        city: { id: entityMeta.orgId, name: entityMeta.name },
        year,
        viewLevel,
        entities: [],
        rankings: {
          byDisclosureRate: [],
          byCorrectionRate: [],
          byNewApplications: [],
        },
        statistics: {
          total: 0,
          disclosureRateCoverage: '0/0',
          correctionRateCoverage: '0/0',
          reasonCoverage: '0/0',
          reportCoverage: '0/0',
          fieldCoverage: '0/0',
          parseSuccessRate: '0/0',
          statsCoverage: '0/0',
          analyzableCoverage: '0/0',
          officialCoverage: '0/0',
        },
        calibration,
      };
    }

    const entities = rows.map((row) => {
      if (!row.stats_row_exists) {
        return {
          id: row.org_id,
          name: row.org_name,
          newApplicationsStatus: 'MISSING',
          acceptedTotalStatus: 'MISSING',
          disclosureRateStatus: 'MISSING',
          correctionRateStatus: 'MISSING',
          status: 'missing',
          riskLevel: 'missing',
          riskReason: '数据待接入',
          isSampleSufficient: false,
          missingType: 'not_reported',
        } as EntityMetrics;
      }

      const acceptedTotal = calibration.includesCarryOver
        ? sumValues(asNumber(row.app_new), asNumber(row.app_carried_over))
        : asNumber(row.app_new);
      const totalHandled = sumValues(
        asNumber(row.outcome_public),
        asNumber(row.outcome_partial),
        asNumber(row.outcome_not_open),
        asNumber(row.outcome_unable),
        asNumber(row.outcome_ignore),
        asNumber(row.outcome_other)
      );

      const disclosureNumerator = calibration.disclosureMethod === 'substantive'
        ? sumValues(asNumber(row.outcome_public), asNumber(row.outcome_partial))
        : asNumber(row.outcome_public);
      const disclosureRate = safeRate(disclosureNumerator, totalHandled);

      const correctionNumerator = calibration.correctionMethod === 'reconsideration'
        ? asNumber(row.rev_corrected)
        : sumValues(asNumber(row.rev_corrected), asNumber(row.lit_corrected));
      const correctionDenominator = calibration.correctionMethod === 'reconsideration'
        ? asNumber(row.rev_total)
        : sumValues(asNumber(row.rev_total), asNumber(row.lit_total));
      const correctionRate = safeRate(correctionNumerator, correctionDenominator);
      const isSampleSufficient = acceptedTotal !== undefined && acceptedTotal >= MIN_N_FOR_RANKING;

      const entityMetrics: EntityMetrics = {
        id: row.org_id,
        name: row.org_name,
        newApplications: asNumber(row.app_new),
        newApplicationsStatus: 'VALUE',
        acceptedTotal,
        acceptedTotalStatus: 'VALUE',
        disclosureRate: disclosureRate.status === 'ok' ? disclosureRate.value : undefined,
        disclosureRateStatus: disclosureRate.status === 'ok' ? 'VALUE' : 'MISSING',
        disclosureNumerator,
        disclosureDenominator: totalHandled,
        correctionRate: correctionRate.status === 'ok' ? correctionRate.value : undefined,
        correctionRateStatus: correctionRate.status === 'ok' ? 'VALUE' : 'MISSING',
        correctionNumerator,
        correctionDenominator,
        status: String(row.materialize_status || '').startsWith('blocked_') ? 'missing' : 'ok',
        isSampleSufficient,
        stability: assessStability(
          acceptedTotal,
          disclosureRate.status !== 'ok' || correctionRate.status !== 'ok' ? 1 : 0
        ),
        missingType: String(row.materialize_status || '').startsWith('blocked_') ? 'parse_failed' : 'unknown',
      };

      entityMetrics.riskLevel = assessRiskLevel(entityMetrics);
      entityMetrics.riskReason = getRiskReason(entityMetrics, entityMetrics.riskLevel);
      return entityMetrics;
    });

    const strictSample = calibration.enableStableSample;
    const rankedByDisclosure = [...entities]
      .filter((entity) => entity.disclosureRateStatus === 'VALUE' && (strictSample ? entity.isSampleSufficient : true))
      .sort((a, b) => (b.disclosureRate || 0) - (a.disclosureRate || 0));
    const rankedByCorrection = [...entities]
      .filter((entity) => entity.correctionRateStatus === 'VALUE' && (strictSample ? entity.isSampleSufficient : true))
      .sort((a, b) => (a.correctionRate || 0) - (b.correctionRate || 0));
    const rankedByNewApplications = [...entities]
      .filter((entity) => entity.newApplicationsStatus === 'VALUE')
      .sort((a, b) => (b.newApplications || 0) - (a.newApplications || 0));

    const validDisclosureRates = entities
      .filter((entity) => entity.disclosureRateStatus === 'VALUE' && entity.disclosureRate !== undefined)
      .map((entity) => ({ rate: entity.disclosureRate as number, weight: entity.acceptedTotal || 0 }));
    const validCorrectionRates = entities
      .filter((entity) => entity.correctionRateStatus === 'VALUE' && entity.correctionRate !== undefined)
      .map((entity) => ({ rate: entity.correctionRate as number, weight: entity.acceptedTotal || 0 }));

    const avgDisclosureRate = validDisclosureRates.length
      ? validDisclosureRates.reduce((sum, item) => sum + item.rate, 0) / validDisclosureRates.length
      : undefined;
    const totalDisclosureWeight = validDisclosureRates.reduce((sum, item) => sum + item.weight, 0);
    const avgDisclosureRateWeighted = totalDisclosureWeight > 0
      ? validDisclosureRates.reduce((sum, item) => sum + item.rate * item.weight, 0) / totalDisclosureWeight
      : undefined;

    const avgCorrectionRate = validCorrectionRates.length
      ? validCorrectionRates.reduce((sum, item) => sum + item.rate, 0) / validCorrectionRates.length
      : undefined;
    const totalCorrectionWeight = validCorrectionRates.reduce((sum, item) => sum + item.weight, 0);
    const avgCorrectionRateWeighted = totalCorrectionWeight > 0
      ? validCorrectionRates.reduce((sum, item) => sum + item.rate * item.weight, 0) / totalCorrectionWeight
      : undefined;

    const maxDisclosureRate = validDisclosureRates.length
      ? Math.max(...validDisclosureRates.map((item) => item.rate))
      : undefined;
    const minDisclosureRate = validDisclosureRates.length
      ? Math.min(...validDisclosureRates.map((item) => item.rate))
      : undefined;

    const totalEntities = rows.length;
    const statsCovered = rows.filter((row) => row.stats_row_exists).length;
    const analyzableCovered = rows.filter(
      (row) => row.stats_row_exists && !String(row.materialize_status || '').startsWith('blocked_')
    ).length;
    const officialCovered = rows.filter((row) => String(row.materialize_status || '') === 'official').length;
    const parseSucceeded = analyzableCovered;

    return {
      city: { id: entityMeta.orgId, name: entityMeta.name },
      year,
      viewLevel,
      entities,
      rankings: {
        byDisclosureRate: rankedByDisclosure,
        byCorrectionRate: rankedByCorrection,
        byNewApplications: rankedByNewApplications,
      },
      statistics: {
        total: entities.length,
        avgDisclosureRate,
        avgDisclosureRateWeighted,
        avgCorrectionRate,
        avgCorrectionRateWeighted,
        maxDisclosureRate,
        minDisclosureRate,
        disclosureRateP90: percentile(validDisclosureRates.map((value) => value.rate), 0.9),
        disclosureRateP10: percentile(validDisclosureRates.map((value) => value.rate), 0.1),
        disclosureRateGapP90P10: robustGapP90P10(validDisclosureRates.map((value) => value.rate)),
        disclosureRateCoverage: `${validDisclosureRates.length}/${entities.length}`,
        correctionRateCoverage: `${validCorrectionRates.length}/${entities.length}`,
        reasonCoverage: `${analyzableCovered}/${entities.length}`,
        reportCoverage: `${statsCovered}/${totalEntities}`,
        fieldCoverage: `${analyzableCovered}/${totalEntities}`,
        parseSuccessRate: statsCovered > 0 ? `${parseSucceeded}/${statsCovered}` : '0/0',
        statsCoverage: `${statsCovered}/${totalEntities}`,
        analyzableCoverage: `${analyzableCovered}/${totalEntities}`,
        officialCoverage: `${officialCovered}/${totalEntities}`,
      },
      calibration,
    };
  }

  private async getEntityMeta(regionId: number): Promise<{ orgId: string; name: string } | null> {
    const result = await pool.query(
      `
      SELECT
        r.id AS region_id,
        r.name,
        COALESCE(cu.unit_type, 'unknown') AS unit_type
      FROM regions r
      LEFT JOIN canonical_units cu ON cu.region_id = r.id
      WHERE r.id = $1
      LIMIT 1
      `,
      [regionId]
    );

    const row = result.rows[0];
    if (!row) return null;
    return {
      orgId: `${String(row.unit_type || 'unknown')}_${regionId}`,
      name: String(row.name || ''),
    };
  }

  private async getRegionRows(regionId: number): Promise<StatsRow[]> {
    const result = await pool.query(
      `
      SELECT *
      FROM gov_open_annual_stats_v2 s
      WHERE s.region_id = $1
      ORDER BY s.year ASC, ${buildMaterializeOrderSql('s')} ASC, s.updated_at DESC
      `,
      [regionId]
    );

    const deduped = new Map<number, StatsRow>();
    for (const row of result.rows) {
      const year = asNumber(row.year);
      if (!deduped.has(year)) {
        deduped.set(year, row);
      }
    }
    return Array.from(deduped.values());
  }

  private async getDirectChildRows(
    parentRegionId: number,
    year: number,
    viewLevel: Exclude<ViewLevel, 'city'>
  ): Promise<StatsRow[]> {
    const unitTypes = viewLevel === 'district'
      ? ['district', 'town_street', 'functional_zone']
      : ['department'];

    const result = await pool.query(
      `
      WITH child_units AS (
        SELECT
          cu.region_id,
          cu.unit_type,
          r.name AS org_name,
          CONCAT(cu.unit_type, '_', cu.region_id) AS org_id
        FROM canonical_units cu
        JOIN regions r ON r.id = cu.region_id
        WHERE cu.parent_region_id = $1
          AND cu.unit_type = ANY($2::text[])
      )
      SELECT
        child_units.region_id,
        child_units.unit_type,
        child_units.org_name,
        child_units.org_id,
        stats.materialize_status,
        stats.app_new,
        stats.app_carried_over,
        stats.outcome_public,
        stats.outcome_partial,
        stats.outcome_not_open,
        stats.outcome_unable,
        stats.outcome_ignore,
        stats.outcome_other,
        stats.rev_total,
        stats.rev_corrected,
        stats.lit_total,
        stats.lit_corrected,
        CASE WHEN stats.region_id IS NULL THEN FALSE ELSE TRUE END AS stats_row_exists
      FROM child_units
      LEFT JOIN LATERAL (
        SELECT *
        FROM gov_open_annual_stats_v2 s
        WHERE s.region_id = child_units.region_id
          AND s.year = $3
        ORDER BY ${buildMaterializeOrderSql('s')} ASC, s.updated_at DESC
        LIMIT 1
      ) stats ON TRUE
      ORDER BY child_units.org_name ASC
      `,
      [parentRegionId, unitTypes, year]
    );

    return result.rows;
  }
}

export const govInsightLeaderCockpitService = new GovInsightLeaderCockpitService();
