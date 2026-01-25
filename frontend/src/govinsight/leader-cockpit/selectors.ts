import type { AnnualData, EntityProfile } from '../types';
import {
  LEADER_COCKPIT_CONNECTIONS,
  LEADER_COCKPIT_SERIES_YEARS,
} from './config';
import { metricDefinitions, metricEvidence } from './definitions';
import {
  assessRiskLevel,
  getRiskReason,
  MIN_N_FOR_RANKING
} from './riskPolicy';
import type {
  ActionPackTemplateInstance,
  AttributionItem,
  //   EntityMetrics,
  //   GovernanceSuggestion,
  LeaderCockpitModel,
  //   ManagementActionItem,
  MetricVariant,
  MetricValue,
  MissingType,
  ReasonCategory,
  ReasonItem,
  StabilityLevel,
  ValueStatus,
} from './types';
// import { STABILITY_RULES } from './riskRuleSet';
import { computeYoY, safeRate, safeShare } from './utils';
import { percentile, robustGapP90P10 } from './utils/stats';

const getSeriesYears = (year: number, span = LEADER_COCKPIT_SERIES_YEARS): number[] => {
  return Array.from({ length: span }, (_, idx) => year - (span - 1) + idx);
};

const getRecord = (entity: EntityProfile | null, year: number): AnnualData | undefined => {
  return entity?.data?.find((d) => d.year === year);
};

const metricStatus = (record?: AnnualData): MetricValue['status'] => {
  return record ? 'ok' : 'missing';
};

const buildMetric = (
  record: AnnualData | undefined,
  value: number | undefined,
  definitionKey: string
): MetricValue => {
  return {
    value,
    unit: metricDefinitions[definitionKey]?.unit,
    status: metricStatus(record),
    definition: metricDefinitions[definitionKey],
    evidence: metricEvidence[definitionKey],
  };
};

const sumValues = (...values: Array<number | undefined>): number => {
  return values.reduce<number>((acc, val) => acc + (val ?? 0), 0);
};

const buildMetricVariants = (
  records: AnnualData | undefined
): { disclosure: MetricVariant[]; correction: MetricVariant[] } => {
  const outcomes = records?.applications.outcomes;
  const totalHandled = outcomes
    ? sumValues(
      outcomes.public,
      outcomes.partial,
      outcomes.notOpen,
      outcomes.unable,
      outcomes.ignore
    )
    : undefined;

  const disclosure: MetricVariant[] = [
    {
      id: 'public_partial_over_closed',
      label: '(公开+部分公开)/办结',
      ...safeRate(sumValues(outcomes?.public, outcomes?.partial), totalHandled),
      formula: '(公开+部分公开)/办结',
    },
    {
      id: 'public_over_closed',
      label: '公开/办结',
      ...safeRate(outcomes?.public, totalHandled),
      formula: '公开/办结',
    },
    {
      id: 'public_partial_over_accepted',
      label: '(公开+部分公开)/受理合计',
      ...safeRate(sumValues(outcomes?.public, outcomes?.partial), records?.applications.totalHandled),
      formula: '(公开+部分公开)/受理合计',
    },
  ];

  const litigationConnected = LEADER_COCKPIT_CONNECTIONS.litigation;
  const hasLitigation = litigationConnected === 'connected'
    || (litigationConnected === 'auto' && records?.disputes?.litigation?.total !== undefined);

  const correction: MetricVariant[] = [
    {
      id: 'reconsideration_only',
      label: '复议纠错率',
      ...safeRate(records?.disputes.reconsideration.corrected, records?.disputes.reconsideration.total),
      formula: '复议纠错/复议结案',
    },
    {
      id: 'reconsideration_litigation',
      label: '复议+诉讼纠错率',
      ...(() => {
        if (!hasLitigation) return { status: 'not_connected' as const };
        const total = sumValues(
          records?.disputes.reconsideration.total,
          records?.disputes.litigation.total
        );
        const corrected = sumValues(
          records?.disputes.reconsideration.corrected,
          records?.disputes.litigation.corrected
        );
        return safeRate(corrected, total);
      })(),
      formula: '(复议纠错+诉讼纠错)/(复议立案+诉讼立案)',
    },
  ];

  return { disclosure, correction };
};

const buildReasonCategories = (
  current?: AnnualData,
  previous?: AnnualData
): { categories: ReasonCategory[]; topReasons: ReasonItem[] } => {
  if (!current?.applications?.outcomesDetail) {
    return {
      categories: [
        { id: 'A', name: 'A 法定不公开（不予公开）', total: undefined, share: undefined, status: 'missing', items: [] },
        { id: 'B', name: 'B 信息资产不足（无法提供）', total: undefined, share: undefined, status: 'missing', items: [] },
        { id: 'C', name: 'C 程序性不予处理', total: undefined, share: undefined, status: 'missing', items: [] },
      ],
      topReasons: [],
    };
  }

  const notOpen = current.applications.outcomesDetail.notOpen;
  const unable = current.applications.outcomesDetail.unable;
  const untreated = current.applications.outcomesDetail.untreated;

  const totals = {
    A: sumValues(
      notOpen.stateSecret,
      notOpen.lawForbidden,
      notOpen.danger,
      notOpen.thirdParty,
      notOpen.internal,
      notOpen.process,
      notOpen.enforcement,
      notOpen.adminQuery
    ),
    B: sumValues(unable.noInfo, unable.needCreation, unable.unclear),
    C: sumValues(
      untreated.complaint,
      untreated.repeat,
      untreated.publication,
      untreated.massive,
      untreated.confirm
    ),
  };

  const totalAll = totals.A + totals.B + totals.C;

  const buildItem = (
    id: string,
    name: string,
    value?: number,
    prevValue?: number,
    categoryId?: string
  ): ReasonItem => {
    const valueStatus: ReasonItem['valueStatus'] = value === undefined ? 'MISSING' : 'VALUE';
    const share = valueStatus === 'VALUE' ? safeShare(value, totalAll) : { status: 'missing' as const };
    return {
      id,
      name,
      value,
      valueStatus,
      share: share.status === 'ok' ? share.value : undefined,
      status: valueStatus === 'VALUE' ? 'ok' : 'missing',
      trend: valueStatus === 'VALUE' ? computeYoY(value, prevValue) : null,
      categoryId,
    };
  };

  const prevDetail = previous?.applications?.outcomesDetail;

  const itemsA: ReasonItem[] = [
    buildItem('A1', '国家秘密', notOpen.stateSecret, prevDetail?.notOpen.stateSecret, 'A'),
    buildItem('A2', '法律法规禁止', notOpen.lawForbidden, prevDetail?.notOpen.lawForbidden, 'A'),
    buildItem('A3', '三安全一稳定', notOpen.danger, prevDetail?.notOpen.danger, 'A'),
    buildItem('A4', '第三方合法权益', notOpen.thirdParty, prevDetail?.notOpen.thirdParty, 'A'),
    buildItem('A5', '内部事务信息', notOpen.internal, prevDetail?.notOpen.internal, 'A'),
    buildItem('A6', '过程性信息', notOpen.process, prevDetail?.notOpen.process, 'A'),
    buildItem('A7', '行政执法案卷', notOpen.enforcement, prevDetail?.notOpen.enforcement, 'A'),
    buildItem('A8', '行政查询事项', notOpen.adminQuery, prevDetail?.notOpen.adminQuery, 'A'),
  ];

  const itemsB: ReasonItem[] = [
    buildItem('B1', '本机关不掌握', unable.noInfo, prevDetail?.unable.noInfo, 'B'),
    buildItem('B2', '需另行制作', unable.needCreation, prevDetail?.unable.needCreation, 'B'),
    buildItem('B3', '补正后仍不明确', unable.unclear, prevDetail?.unable.unclear, 'B'),
  ];

  const itemsC: ReasonItem[] = [
    buildItem('C1', '信访举报投诉', untreated.complaint, prevDetail?.untreated.complaint, 'C'),
    buildItem('C2', '重复申请', untreated.repeat, prevDetail?.untreated.repeat, 'C'),
    buildItem('C3', '要求提供公开出版物', untreated.publication, prevDetail?.untreated.publication, 'C'),
    buildItem('C4', '大量反复申请', untreated.massive, prevDetail?.untreated.massive, 'C'),
    buildItem('C5', '要求确认或重新获取', untreated.confirm, prevDetail?.untreated.confirm, 'C'),
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
};

const buildActionPackTemplates = (model: LeaderCockpitModel): ActionPackTemplateInstance[] => {
  const templates: ActionPackTemplateInstance[] = [];

  const topReason = model.reasons.topReasons[0];
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

  templates.push({
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
  });

  templates.push({
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
  });

  templates.push({
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
  });

  return templates;
};

const buildAttributions = (
  items: ReasonItem[],
  total?: number
): AttributionItem[] => {
  return items.map((item) => ({
    id: item.id,
    label: item.name,
    value: item.value,
    valueStatus: item.valueStatus,
    share: total && item.valueStatus === 'VALUE'
      ? (item.value || 0) / total * 100
      : undefined,
    status: item.status,
  }));
};

export const buildLeaderCockpitModel = (
  entity: EntityProfile | null,
  year: number
): LeaderCockpitModel | null => {
  if (!entity) return null;

  const seriesYears = getSeriesYears(year);
  const current = getRecord(entity, year);
  const previous = getRecord(entity, year - 1);

  const disclosureVariants = buildMetricVariants(current).disclosure;
  const correctionVariants = buildMetricVariants(current).correction;
  const prevDisclosureVariants = buildMetricVariants(previous).disclosure;
  const prevCorrectionVariants = buildMetricVariants(previous).correction;

  const disclosureDefault = disclosureVariants[0];
  const correctionDefault = correctionVariants[0];

  const newApplications = buildMetric(current, current?.applications.newReceived, 'newApplications');
  newApplications.yoy = computeYoY(
    current?.applications.newReceived,
    previous?.applications.newReceived
  );

  const acceptedTotalValue = current?.applications.totalHandled
    ?? (current?.applications.newReceived || 0) + (current?.applications.carriedOver || 0);

  const acceptedTotal = buildMetric(current, acceptedTotalValue, 'acceptedTotal');
  acceptedTotal.yoy = computeYoY(
    acceptedTotalValue,
    previous?.applications.totalHandled
  );

  const substantiveDisclosureRate: MetricValue = {
    value: disclosureDefault.value,
    unit: '%',
    status: disclosureDefault.status,
    yoy: computeYoY(disclosureDefault.value, prevDisclosureVariants[0]?.value),
    variants: disclosureVariants,
    definition: metricDefinitions.substantiveDisclosureRate,
    evidence: metricEvidence.substantiveDisclosureRate,
  };

  const reconsiderationCorrectionRate: MetricValue = {
    value: correctionDefault.value,
    unit: '%',
    status: correctionDefault.status,
    yoy: computeYoY(correctionDefault.value, prevCorrectionVariants[0]?.value),
    variants: correctionVariants,
    definition: metricDefinitions.reconsiderationCorrectionRate,
    evidence: metricEvidence.reconsiderationCorrectionRate,
  };

  const trends: LeaderCockpitModel['trends'] = {
    pressure: {
      id: 'pressure',
      label: '压力（新收）',
      unit: '件',
      points: seriesYears.map((y) => {
        const rec = getRecord(entity, y);
        return {
          year: y,
          value: rec?.applications.newReceived,
          status: rec ? 'ok' : 'missing',
        };
      }),
    },
    quality: {
      id: 'quality',
      label: '质量（实质公开率）',
      unit: '%',
      points: seriesYears.map((y) => {
        const rec = getRecord(entity, y);
        const outcomes = rec?.applications.outcomes;
        const totalHandled = outcomes
          ? sumValues(
            outcomes.public,
            outcomes.partial,
            outcomes.notOpen,
            outcomes.unable,
            outcomes.ignore
          )
          : undefined;
        const rate = safeRate(sumValues(outcomes?.public, outcomes?.partial), totalHandled);
        return {
          year: y,
          value: rate.value,
          status: rec ? rate.status : 'missing',
        };
      }),
    },
    risk: {
      id: 'risk',
      label: '风险（复议纠错率）',
      unit: '%',
      points: seriesYears.map((y) => {
        const rec = getRecord(entity, y);
        const rate = safeRate(
          rec?.disputes.reconsideration.corrected,
          rec?.disputes.reconsideration.total
        );
        return {
          year: y,
          value: rate.value,
          status: rec ? rate.status : 'missing',
        };
      }),
    },
    serviceRatio: {
      id: 'serviceRatio',
      label: '监管—服务结构比（许可 vs 执法）',
      unit: '',
      points: seriesYears.map((y) => {
        const rec = getRecord(entity, y);
        const total = rec?.adminActions.punishment;
        const value = total && total > 0 ? (rec?.adminActions.licensing || 0) / total : undefined;
        return {
          year: y,
          value,
          status: rec ? (value === undefined ? 'missing' : 'ok') : 'missing',
        };
      }),
    },
  };

  const reasons = buildReasonCategories(current, previous);

  const disputeCasesValue = (() => {
    if (!current) return undefined;
    const litState = LEADER_COCKPIT_CONNECTIONS.litigation;
    const includeLit = litState === 'connected'
      || (litState === 'auto' && current.disputes.litigation.total !== undefined);
    return includeLit
      ? sumValues(current.disputes.reconsideration.total, current.disputes.litigation.total)
      : current.disputes.reconsideration.total;
  })();

  const correctionCasesValue = (() => {
    if (!current) return undefined;
    const litState = LEADER_COCKPIT_CONNECTIONS.litigation;
    const includeLit = litState === 'connected'
      || (litState === 'auto' && current.disputes.litigation.total !== undefined);
    return includeLit
      ? sumValues(current.disputes.reconsideration.corrected, current.disputes.litigation.corrected)
      : current.disputes.reconsideration.corrected;
  })();

  const disputeRate = safeRate(disputeCasesValue, current?.applications.newReceived);
  const correctionConversionRate = safeRate(correctionCasesValue, current?.applications.newReceived);
  const correctionRate = safeRate(correctionCasesValue, disputeCasesValue);

  const responseTypeValueStatus: ValueStatus = 'VALUE';
  const responseTypeAttributions: AttributionItem[] | undefined = current
    ? [
      { id: 'public', label: '公开', value: current.applications.outcomes.public, status: 'ok' as const, valueStatus: responseTypeValueStatus },
      { id: 'partial', label: '部分公开', value: current.applications.outcomes.partial, status: 'ok' as const, valueStatus: responseTypeValueStatus },
      { id: 'notOpen', label: '不予公开', value: current.applications.outcomes.notOpen, status: 'ok' as const, valueStatus: responseTypeValueStatus },
      { id: 'unable', label: '无法提供', value: current.applications.outcomes.unable, status: 'ok' as const, valueStatus: responseTypeValueStatus },
      { id: 'ignore', label: '其他处理', value: current.applications.outcomes.ignore, status: 'ok' as const, valueStatus: responseTypeValueStatus },
    ].sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 5)
    : undefined;

  const notices: string[] = [];
  if (!current) {
    notices.push('当前年度数据未接入，指标已标记待接入。');
  }
  if (LEADER_COCKPIT_CONNECTIONS.litigation === 'not_connected') {
    notices.push('诉讼数据未接入，纠错率口径以复议为主。');
  }

  const model: LeaderCockpitModel = {
    city: { id: entity.id, name: entity.name },
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
      newApplications: buildMetric(current, current?.applications.newReceived, 'newApplications'),
      disputeCases: {
        value: disputeCasesValue,
        unit: '件',
        status: metricStatus(current),
        definition: metricDefinitions.disputeConversion,
        evidence: metricEvidence.disputeConversion,
      },
      correctionCases: {
        value: correctionCasesValue,
        unit: '件',
        status: metricStatus(current),
        definition: metricDefinitions.correctionConversion,
        evidence: metricEvidence.correctionConversion,
      },
      rates: {
        disputeConversion: {
          value: disputeRate.value,
          unit: '%',
          status: disputeRate.status,
          definition: metricDefinitions.disputeConversion,
          evidence: metricEvidence.disputeConversion,
        },
        correctionConversion: {
          value: correctionConversionRate.value,
          unit: '%',
          status: correctionConversionRate.status,
          definition: metricDefinitions.correctionConversion,
          evidence: metricEvidence.correctionConversion,
        },
        correctionRate: {
          value: correctionRate.value,
          unit: '%',
          status: correctionRate.status,
          definition: metricDefinitions.correctionRate,
          evidence: metricEvidence.correctionRate,
        },
      },
      topAttributions: {
        byReason: buildAttributions(reasons.topReasons, sumValues(
          reasons.categories[0]?.total,
          reasons.categories[1]?.total,
          reasons.categories[2]?.total
        )),
        byResponseType: responseTypeAttributions,
      },
    },
    actionPacks: {
      templates: [] as ActionPackTemplateInstance[],
    },
    report: {},
    meta: {
      dataStatus: {},
      notices,
    },
  };

  model.actionPacks.templates = buildActionPackTemplates(model);

  return model;
};

// Entity Classification Helpers
const isDistrictName = (name: string): boolean => {
  const districtSuffixes = ['区', '县', '开发区', '园区', '文旅区', '高新区'];
  return districtSuffixes.some(suffix => name.endsWith(suffix));
};

const isDepartmentName = (name: string): boolean => {
  const departmentSuffixes = ['局', '委员会', '委', '办', '中心', '院', '馆', '所', '署', '厅'];
  return departmentSuffixes.some(suffix => name.endsWith(suffix));
};

type EntityType = 'district' | 'department' | 'unknown';

const classifyEntity = (name: string): EntityType => {
  if (isDistrictName(name)) return 'district';
  if (isDepartmentName(name)) return 'department';
  return 'unknown';
};

// Build Entity Comparison Model

// ============================================================================
// Logic Enhancements (Stability, Missing Type, Actions)
// ============================================================================

const assessStability = (n?: number, missingCount = 0): StabilityLevel => {
  if (n === undefined) return 'low';
  if (missingCount > 0 && n < 30) return 'low';

  if (n >= 100 && missingCount === 0) return 'high';
  if (n >= 30) return 'medium';
  return 'low';
};

const classifyMissingType = (entity: EntityProfile, year: number): MissingType => {
  // Simple heuristic based on data structure
  const yearData = entity.data?.find(d => d.year === year);
  if (!yearData) {
    // Check if parent has data implies connection exists? 
    // For now assuming if entity exists in system but no annual data -> not_reported
    // But distinguishing from not_connected (no capability) is hard without backend flag.
    // Fallback: Default to not_reported if we know the entity should have reports.
    return 'not_reported';
  }

  // If yearData exists but specific fields are missing/null, handled at metric level.
  // But for the EntityMetrics 'missingType' field, it usually refers to why the *row* is incomplete.
  // If we reached here, we likely have partial data.
  // We'll return 'unknown' if not explicitly handled.
  return 'unknown';
};

// Unused functions commented out to fix lint
// const generateInterviewList = ...
// const generateGovernanceSuggestions = ...

export const buildEntityComparisonModel = (
  cityEntity: EntityProfile | null,
  year: number,
  viewLevel: import('./types').ViewLevel,
  calibration: {
    disclosureMethod: import('./types').DisclosureMethod;
    correctionMethod: import('./types').CorrectionMethod;
    includesCarryOver: boolean;
    enableStableSample: boolean;
  } = {
      disclosureMethod: 'substantive',
      correctionMethod: 'reconsideration',
      includesCarryOver: false,
      enableStableSample: true
    }
): import('./types').EntityComparisonModel | null => {
  if (!cityEntity || viewLevel === 'city') return null;

  // Import risk assessment utilities
  // const { assessRiskLevel, getRiskReason } = require('./utils/riskAssessment'); // Removed in favor of riskPolicy.ts
  // const { MIN_N_FOR_RANKING } = require('./config'); // Removed in favor of riskPolicy.ts

  // Filter children by view level
  const targetType: EntityType = viewLevel === 'district' ? 'district' : 'department';
  const filteredChildren = (cityEntity.children || []).filter(
    child => classifyEntity(child.name) === targetType
  );

  console.log(`[buildEntityComparisonModel] ${viewLevel} view, calibration:`, calibration);

  if (filteredChildren.length === 0) return null;

  // Build metrics for each entity
  const entities: import('./types').EntityMetrics[] = filteredChildren.map(child => {
    const record = getRecord(child, year);

    if (!record) {
      return {
        id: child.id,
        name: child.name,
        newApplicationsStatus: 'MISSING' as const,
        acceptedTotalStatus: 'MISSING' as const,
        disclosureRateStatus: 'MISSING' as const,
        correctionRateStatus: 'MISSING' as const,
        status: 'missing' as const,
        riskLevel: 'missing' as const,
        riskReason: '数据待接入',
        isSampleSufficient: false,
        missingType: classifyMissingType(child, year) // Classify missing type
      };
    }

    // --- 1. Calculate Accepted Total (Calibration: includesCarryOver) ---
    // If includesCarryOver is true, used totalHandled (New + CarriedOver)
    // If false, use newReceived (New Only) - APPROXIMATION for demonstration
    // NOTE: In strict logic, changing denominator might invalidate outcome numerators if outcomes include carried over cases.
    // For this implementation, we will stick to totalHandled for RATE denominators to ensure < 100%,
    // but we can change the "Accepted Total" display value.
    const acceptedTotal = calibration.includesCarryOver
      ? record.applications.totalHandled
      : record.applications.newReceived;


    // --- 2. Calculate Disclosure Rate (Calibration: disclosureMethod) ---
    const outcomes = record.applications.outcomes;
    const totalHandled = record.applications.totalHandled; // Always use full handled for rate denominator to be safe

    let disclosureNumerator = 0;
    if (calibration.disclosureMethod === 'substantive') {
      // Substantive: Public + Partial
      disclosureNumerator = sumValues(outcomes?.public, outcomes?.partial);
    } else {
      // Absolute: Public only
      disclosureNumerator = outcomes?.public || 0;
    }

    const disclosureRate = safeRate(disclosureNumerator, totalHandled);


    // --- 3. Calculate Correction Rate (Calibration: correctionMethod) ---
    let correctionNumerator = 0;
    let correctionDenominator = 0;

    if (calibration.correctionMethod === 'reconsideration') {
      // Reconsideration Only
      correctionNumerator = record.disputes.reconsideration.corrected || 0;
      correctionDenominator = record.disputes.reconsideration.total || 0;
    } else {
      // Comprehensive: Reconsideration + Litigation
      correctionNumerator = sumValues(
        record.disputes.reconsideration.corrected,
        record.disputes.litigation.corrected
      );
      correctionDenominator = sumValues(
        record.disputes.reconsideration.total,
        record.disputes.litigation.total
      );
    }

    const correctionRate = safeRate(correctionNumerator, correctionDenominator);

    // Verify sample sufficiency using policy constant
    const isSampleSufficient = acceptedTotal !== undefined && acceptedTotal >= MIN_N_FOR_RANKING;

    const entityMetrics: import('./types').EntityMetrics = {
      id: child.id,
      name: child.name,
      newApplications: record.applications.newReceived,
      newApplicationsStatus: record.applications.newReceived !== undefined ? 'VALUE' as const : 'MISSING' as const,
      acceptedTotal,
      acceptedTotalStatus: acceptedTotal !== undefined ? 'VALUE' as const : 'MISSING' as const,
      disclosureRate: disclosureRate.status === 'ok' ? disclosureRate.value : undefined,
      disclosureRateStatus: disclosureRate.status === 'ok' ? 'VALUE' as const : 'MISSING' as const,
      disclosureNumerator,     // New field
      disclosureDenominator: totalHandled, // New field
      correctionRate: correctionRate.status === 'ok' ? correctionRate.value : undefined,
      correctionRateStatus: correctionRate.status === 'ok' ? 'VALUE' as const : 'MISSING' as const,
      correctionNumerator,
      correctionDenominator,
      status: 'ok' as const,
      isSampleSufficient,
      stability: assessStability(acceptedTotal, (disclosureRate.status !== 'ok' || correctionRate.status !== 'ok') ? 1 : 0),
    };

    // Assess risk level
    entityMetrics.riskLevel = assessRiskLevel(entityMetrics);
    entityMetrics.riskReason = getRiskReason(entityMetrics, entityMetrics.riskLevel);

    return entityMetrics;
  });

  // Calculate rankings (exclude MISSING and small samples if strict mode is on)
  const strictSample = calibration.enableStableSample;

  const rankByDisclosureRate = [...entities]
    .filter(e => e.disclosureRateStatus === 'VALUE' && (strictSample ? e.isSampleSufficient : true))
    .sort((a, b) => (b.disclosureRate || 0) - (a.disclosureRate || 0));

  const rankByCorrectionRate = [...entities]
    .filter(e => e.correctionRateStatus === 'VALUE' && (strictSample ? e.isSampleSufficient : true))
    .sort((a, b) => (a.correctionRate || 0) - (b.correctionRate || 0)); // Lower is better

  const rankByNewApplications = [...entities]
    .filter(e => e.newApplicationsStatus === 'VALUE')
    .sort((a, b) => (b.newApplications || 0) - (a.newApplications || 0));

  // Calculate statistics
  const validDisclosureRates = entities
    .filter(e => e.disclosureRateStatus === 'VALUE')
    .map(e => ({ rate: e.disclosureRate!, weight: e.acceptedTotal || 0 }));

  const validCorrectionRates = entities
    .filter(e => e.correctionRateStatus === 'VALUE')
    .map(e => ({ rate: e.correctionRate!, weight: e.acceptedTotal || 0 }));

  // Simple average
  const avgDisclosureRate = validDisclosureRates.length > 0
    ? validDisclosureRates.reduce((sum, item) => sum + item.rate, 0) / validDisclosureRates.length
    : undefined;

  const avgCorrectionRate = validCorrectionRates.length > 0
    ? validCorrectionRates.reduce((sum, item) => sum + item.rate, 0) / validCorrectionRates.length
    : undefined;

  // Weighted average
  const totalWeightDisclosure = validDisclosureRates.reduce((sum, item) => sum + item.weight, 0);
  const avgDisclosureRateWeighted = totalWeightDisclosure > 0
    ? validDisclosureRates.reduce((sum, item) => sum + item.rate * item.weight, 0) / totalWeightDisclosure
    : undefined;

  const totalWeightCorrection = validCorrectionRates.reduce((sum, item) => sum + item.weight, 0);
  const avgCorrectionRateWeighted = totalWeightCorrection > 0
    ? validCorrectionRates.reduce((sum, item) => sum + item.rate * item.weight, 0) / totalWeightCorrection
    : undefined;

  const maxDisclosureRate = validDisclosureRates.length > 0
    ? Math.max(...validDisclosureRates.map(item => item.rate))
    : undefined;

  const minDisclosureRate = validDisclosureRates.length > 0
    ? Math.min(...validDisclosureRates.map(item => item.rate))
    : undefined;

  const statistics = {
    total: entities.length,
    avgDisclosureRate,
    avgDisclosureRateWeighted,
    avgCorrectionRate,
    avgCorrectionRateWeighted,
    maxDisclosureRate,
    minDisclosureRate,

    // Robust Stats
    disclosureRateP90: percentile(validDisclosureRates.map(v => v.rate), 0.9),
    disclosureRateP10: percentile(validDisclosureRates.map(v => v.rate), 0.1),
    disclosureRateGapP90P10: robustGapP90P10(validDisclosureRates.map(v => v.rate)),

    // Coverage Stats
    disclosureRateCoverage: `${validDisclosureRates.length}/${entities.length}`,
    correctionRateCoverage: `${validCorrectionRates.length}/${entities.length}`,
    reasonCoverage: `${entities.length}/${entities.length}`, // Placeholder for reason coverage
  };

  return {
    city: { id: cityEntity.id, name: cityEntity.name },
    year,
    viewLevel,
    entities,
    rankings: {
      byDisclosureRate: rankByDisclosureRate,
      byCorrectionRate: rankByCorrectionRate,
      byNewApplications: rankByNewApplications
    },
    statistics,
    calibration,
  };
};

