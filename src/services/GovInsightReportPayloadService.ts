import pool from '../config/database-llm';
import { DerivedMetricsService } from './DerivedMetricsService';
import { govInsightStatsV2Service } from './GovInsightStatsV2Service';
import {
  CanonicalUnitType,
  DataQualityCheckItem,
  DataQualityV1,
  GOVINSIGHT_DATA_QUALITY_VERSION,
  GOVINSIGHT_METRIC_VERSION,
  GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
  GOVINSIGHT_PAYLOAD_VERSION,
  GOVINSIGHT_PROMPT_VERSION,
  HierarchyAnalysisV1,
  MaterializeStatus,
  MetricsSnapshotV1,
  ReportPayloadV1,
  ScorecardSnapshot,
} from './GovInsightReportProtocol';
import { govInsightLeaderCockpitService } from './GovInsightLeaderCockpitService';

const AUXILIARY_RISK_LEVEL_NOTE = '风险等级仅为辅助研判结果，不作为正式考核结论。';

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

function changePct(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return round1(((current - previous) / previous) * 100);
}

function formatPercent(value: number): string {
  return `${round1(value).toFixed(1)}%`;
}

function formatInteger(value: number): string {
  return Number(value || 0).toLocaleString('zh-CN');
}

function formatChangePct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return 'N/A';
  const rounded = round1(value);
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}%`;
}

function formatMetricValue(value: number, unit: '件' | '%' = '件'): string {
  if (unit === '%') return formatPercent(value);
  return `${formatInteger(value)}件`;
}

function formatCurrentAndPrevious(
  current: number,
  previous: number | null,
  unit: '件' | '%' = '件'
): { currentValue: string; previousValue: string } {
  return {
    currentValue: formatMetricValue(current, unit),
    previousValue: previous === null ? '无上年同期数据' : formatMetricValue(previous, unit),
  };
}

function yoySentence(label: string, current: number, previous: number | null, unit: '件' | '%' = '件'): string {
  const currentText = formatMetricValue(current, unit);
  const delta = previous === null ? null : changePct(current, previous);
  if (delta === null) return `${label}${currentText}。`;
  return `${label}${currentText}，较上年${formatChangePct(delta)}。`;
}

function scorecardStatus(value: number, goodThreshold: number, watchThreshold: number): ScorecardSnapshot['status'] {
  if (value <= goodThreshold) return 'good';
  if (value <= watchThreshold) return 'watch';
  return 'risk';
}

function buildRiskAssessment(metrics: MetricsSnapshotV1, dataQuality: DataQualityV1): ReportPayloadV1['riskAssessment'] {
  if (dataQuality.hasAnomaly) {
    return {
      rating: 'B',
      riskLabel: '需先复核数据',
      reason: '当前结构化数据存在勾稽异常或质量阻塞，事实性判断应先建立在复核基础上。',
    };
  }

  if (metrics.revRate < 10 && metrics.litRate < 10 && metrics.carryForwardRate <= 3) {
    return {
      rating: 'A',
      riskLabel: '总体可控',
      reason: '纠错占比和结转率总体处于相对平稳区间。',
    };
  }

  if (
    metrics.revRate >= 25 ||
    metrics.litRate >= 18 ||
    metrics.overallCorrectionRate >= 20 ||
    metrics.carryForwardRate >= 8
  ) {
    return {
      rating: 'C',
      riskLabel: '重点问题需集中攻坚',
      reason: '行政争议纠错占比或结转压力偏高，需集中部署整改。',
    };
  }

  if (metrics.unableRate >= 30 || metrics.noInfoShareInUnable >= 80) {
    return {
      rating: 'B',
      riskLabel: '需持续关注',
      reason: '依申请公开承压、信息检索协同或信息供给匹配仍需持续跟进。',
    };
  }

  return {
    rating: 'B',
    riskLabel: '总体可控，部分风险需持续关注',
    reason: '整体运行可控，但重点环节仍需加强过程管控。',
  };
}

interface PayloadSeedContext {
  orgName: string;
  year: number;
  currentRow: Record<string, any>;
  previousRow: Record<string, any> | null;
  currentMetrics: MetricsSnapshotV1;
  previousMetrics: MetricsSnapshotV1 | null;
  dataQuality: DataQualityV1;
  riskAssessment: ReportPayloadV1['riskAssessment'];
}

export class GovInsightReportPayloadService {
  async build(regionId: number, year: number): Promise<ReportPayloadV1> {
    const comparisonYear = year - 1;
    await govInsightStatsV2Service.materialize({ regionId, year });
    if (Number.isInteger(comparisonYear) && comparisonYear >= 1900) {
      await govInsightStatsV2Service.materialize({ regionId, year: comparisonYear });
    }
    await DerivedMetricsService.run({ regionId, year });

    const currentRow = await govInsightStatsV2Service.getBestAvailableRow(regionId, year);
    if (!currentRow) {
      throw new Error(`No stats_v2 row found for region ${regionId}, year ${year}`);
    }

    const previousRow = await govInsightStatsV2Service.getBestAvailableRow(regionId, year - 1);
    const current = this.buildMetricsSnapshot(currentRow, previousRow);
    const dataQuality = await this.buildDataQuality(currentRow, current);
    const riskAssessment = buildRiskAssessment(current, dataQuality);
    const previousMetrics = previousRow ? this.buildMetricsSnapshot(previousRow, null) : null;
    const hierarchyAnalysis = await this.buildHierarchyAnalysis(
      currentRow.unit_type,
      regionId,
      year
    );
    const seedContext: PayloadSeedContext = {
      orgName: String(currentRow.org_name || ''),
      year,
      currentRow,
      previousRow,
      currentMetrics: current,
      previousMetrics,
      dataQuality,
      riskAssessment,
    };

    return {
      version: GOVINSIGHT_PAYLOAD_VERSION,
      regionId,
      year,
      orgName: String(currentRow.org_name || ''),
      unitType: currentRow.unit_type,
      parentRegionId: currentRow.parent_region_id ?? null,
      cityRegionId: currentRow.city_region_id ?? null,
      materializeStatus: currentRow.materialize_status as MaterializeStatus,
      sourceReportVersionId: currentRow.source_report_version_id ?? null,
      metricVersion: String(currentRow.metric_version || GOVINSIGHT_METRIC_VERSION),
      mappingVersion: String(currentRow.mapping_version || ''),
      promptVersion: GOVINSIGHT_PROMPT_VERSION,
      outputSchemaVersion: GOVINSIGHT_OUTPUT_SCHEMA_VERSION,
      metricsSnapshot: current,
      dataQuality,
      riskAssessment,
      metadataSeeds: this.buildMetadataSeeds(seedContext),
      riskPrioritySeeds: this.buildRiskPrioritySeeds(seedContext),
      rectificationTaskSkeleton: this.buildRectificationTaskSkeleton(),
      appendixSkeleton: this.buildAppendixSkeleton(seedContext),
      contentBoundaries: this.buildContentBoundaries(dataQuality),
      hierarchyAnalysis,
    };
  }

  buildPrompt(payload: ReportPayloadV1): string {
    return `你正在起草一份供政务公开分管领导内部审阅的年度报告正文。
请严格依据下列“已校验结构化底稿”，输出兼容 ${GOVINSIGHT_OUTPUT_SCHEMA_VERSION} 的 JSON 正文。
不要输出 Markdown，不要补充解释，不要输出代码块，不要输出任何 JSON 以外的内容。

【总目标】
在既有总体框架和既定数据口径基础上，生成一份更接近正式定稿件的年度报告正文。
全文统一采用政府内部审阅材料口吻，克制、正式、稳妥，不出现系统字段名、技术实现名、产品说明语气或 AI 痕迹。

【总边界】
1. 首页指标、同比、占比、纠正率、整体纠正占比、结转率均已由程序计算完成，请直接引用，不得自行重算。
2. 不得新增上年同期值、县区排名、部门排序、原因分类、典型案例、责任认定或任何未经验证的事实。
3. 本报告不形成覆盖全部县区、部门的正式排名，不形成考核排序结论。
4. 已纳入监测范围且达到样本门槛的单位，如底稿已有重点样本提示，可与既定监测结果保持一致地体现“内部重点样本提示”边界；红黄绿标签仅用于内部研判和督办参考，不作为正式考核结论。
5. “三级监测重点摘要”由结构化监测结果单列展示，不新增 JSON 字段；正文相关表述必须与其口径一致，但不要在正文中擅自扩写新的样本、名单或排序。
6. 如存在数据勾稽异常、事实使用受限或阻塞状态，必须从严表述，并明确“需先复核源数据”。

【绝对禁用表达】
正文任意字段中均不得出现或变体出现以下内容：
- report_payload_v1
- 风险种子
- 整改骨架
- 系统底稿
- 系统生成
- 客户可以直接据此判断
- 分析层只能围绕……展开
- 任何系统实现说明、产品说明、技术说明、AI 说明语言

【固定写作分工】
1. metadata
用于首页标题、综合判断、总体概述和口径提示。
要求：
- 首页口吻应像正式内部材料，不写系统说明；
- 风险等级如有，仅写“辅助研判/内部参考”性质，不写成考核结论；
- 不重复解释技术实现过程。

2. overallJudgments
对应“总体判断”。
要求：
- 先写一段总述，再写 3 至 4 条关键判断；
- 不要写成“判断1/判断2”；
- 每条判断应体现“事实依据 + 审慎判断 + 管理含义”；
- 只可使用已校验底稿中可支撑的指标和事实；
- 不得出现强结论式趋势词，除非底稿已明确支持。

3. riskItems
对应“重点风险事项”。
要求：
- 必须区分“首要关注事项 / 重点关注事项 / 持续跟踪事项”；
- 顺序必须服从既定主次，不得自行改排序逻辑；
- 每项都写清：依据、表现、影响、关注点；
- 如涉及单位层监测，只能表述为“内部重点样本提示”或“部分已纳入监测单位出现关注信号”，不得写成覆盖全部单位的正式比较结论。

4. confirmedFacts
对应“确认事实”。
要求：
- 只写结构化数据能够直接支撑的事实摘录；
- 不写归因、推断、趋势判断、管理结论；
- 优先系统收拢以下事实（以实际有值项为准）：
  a. 新收申请数、上年结转、受理总量、结转下年；
  b. 予以公开、部分公开、不予公开、无法提供、不予处理、其他处理；
  c. 实质公开率、无法提供占比、“本机关不掌握相关信息”数量及其在“无法提供”中的占比；
  d. 行政复议总数、复议纠正数及占比；行政诉讼总数、诉讼纠正数及占比；整体纠正占比；
  e. 现行有效规章、现行有效规范性文件，以及底稿中已出现的主动公开基础指标。
- 这一部分要形成“事实收拢”的效果，不能过薄。

5. prudentAnalyses
对应“审慎分析”。
要求：
- 只能作审慎研判；
- 多用“表明、提示、反映、可能存在、需持续关注”等措辞；
- 不得超出证据边界下确定性结论；
- 不得写系统实现约束，不得解释模型如何生成；
- 与 confirmedFacts 明确分工：这里只做审慎研判，不重复机械罗列事实。

6. unansweredQuestions
对应“待补充问题”。
要求：
- 写清当前边界、当前尚不能支撑的结论、以及后续补数方向；
- 如涉及县区、部门比较，应表述为：
  “当前尚不足以形成覆盖全部单位的正式比较结论”
  或
  “现阶段仅能形成内部重点样本提示，尚不足以形成全量正式比较结论”
- 不得写成“完全不能识别任何重点样本”；
- 必须与“三级监测重点摘要”的既有口径保持一致，不冲突。

7. rectificationTasks
对应“整改任务清单”。
要求：
- 必须与既有任务安排逐项对应；
- 保留 sequence、taskType、priority 及全部必填字段；
- 不得删改已冻结的任务结构；
- 可以优化措辞，但不得擅自新增未验证任务，也不得打乱任务主次。

【风格要求】
1. 全文统一为政府内部审阅材料语言；
2. 不写宣传式、产品说明式、技术说明式语句；
3. 不堆砌套话，不夸大，不渲染；
4. 表述稳妥、简洁、可供领导把握和部署。

【口径一致性要求】
1. “不得正式排名”与“内部重点样本提示”必须同时成立，且不得冲突。
2. “确认事实”与“审慎分析”必须明显分章分工，不得混写。
3. “待补充问题”不得否定已存在的监测重点样本提示。
4. 风险等级、红黄绿标签、重点样本提示均只能用于内部研判和督办参考，不作为正式考核结论。

【自检要求】
生成前请自行检查：
1. 是否出现任何系统字段名、技术实现名或产品化表达；
2. confirmedFacts 是否只写事实、没有混入分析；
3. unansweredQuestions 是否与重点样本提示口径一致；
4. 是否出现了新的排名、排序、责任认定或未经验证事实；
5. rectificationTasks 是否保持既定结构和顺序；
6. 全文是否更像正式定稿件，而不是系统生成说明。

<已校验结构化底稿>
${JSON.stringify(payload, null, 2)}
</已校验结构化底稿>`;
  }

  private buildMetadataSeeds(context: PayloadSeedContext): ReportPayloadV1['metadataSeeds'] {
    const { dataQuality, orgName, year, previousMetrics, riskAssessment } = context;
    const summaryLine = dataQuality.hasAnomaly
      ? '综合判断：当前结构化数据需先行复核，复核前有关事实结论应从严使用。'
      : riskAssessment.rating === 'A'
        ? '综合判断：总体可控，重点环节运行相对平稳。'
        : riskAssessment.rating === 'B'
          ? '综合判断：总体可控，部分风险事项需持续关注。'
          : '综合判断：总体可控基础仍在，但重点问题需集中攻坚。';
    const overallOverview = dataQuality.hasAnomaly
      ? `从现有结构化统计数据看，${orgName}${year}年度政务公开工作仍可作综合研判，但依申请公开办理结果与结转关系存在勾稽异常，相关事实口径需先行复核。在复核完成前，对办理规模、分类结构和质量成效的判断应从严把握；对已经显现的依申请公开承压、答复规范性和争议防控等事项，仍应提前部署整改和督办。`
      : previousMetrics
        ? `从${year}年度政务公开运行情况看，${orgName}整体运行总体可控，但依申请公开办理压力、答复规范性、信息检索协同和争议防控等关键环节仍需持续压实责任。现有数据表明，有关问题已具备纳入年度重点整改和过程督办的必要性，需在责任分解、机制优化和闭环复盘中持续推进。`
        : `从${year}年度政务公开运行情况看，${orgName}整体运行总体可控，但依申请公开办理压力、答复规范性和争议防控等重点问题仍需持续关注。受限于缺少上年同期和业务明细数据，当前报告主要反映年度运行状态，并为下一步任务分解和督办落实提供依据。`;

    return {
      reportTitle: `${year}年度${orgName}政务公开智能辅策报告`,
      summaryLine,
      overallOverview,
      positioning: '供政府政务公开分管领导内部审阅，用于年度形势研判、问题识别、任务部署和督办落实。',
      evidenceBasis: previousMetrics
        ? '依据结构化统计数据及上年同期数据形成。首页核心指标、占比、同比和纠正率均由程序计算，不由模型口算生成。'
        : '依据结构化统计数据形成。缺少上年同期数据时，相关表述以现有数据能够直接支撑的内容为限。首页核心指标、占比和纠正率均由程序计算。',
      cautionNote: dataQuality.hasAnomaly
        ? '当前存在数据勾稽异常，事实层内容已按“先复核、后定性”原则处理；分析层内容仅作审慎提示。'
        : '本报告已将事实层与分析层分章表述，对证据不足内容自动降调处理，不使用无充分支撑的强趋势表述。',
      auxiliaryRiskLevel: `${riskAssessment.rating}级（${riskAssessment.riskLabel}）`,
      auxiliaryRiskLevelNote: AUXILIARY_RISK_LEVEL_NOTE,
    };
  }

  private buildRiskPrioritySeeds(context: PayloadSeedContext): ReportPayloadV1['riskPrioritySeeds'] {
    const { currentMetrics, previousMetrics, currentRow } = context;

    return [
      {
        sequence: 1,
        priorityLevel: '首要关注事项',
        riskName: '依申请公开承压上行风险',
        basis: `${yoySentence('新收申请', currentMetrics.newReceived, previousMetrics?.newReceived ?? null)}受理总量${formatInteger(currentMetrics.acceptedTotal)}件，结转率${formatPercent(currentMetrics.carryForwardRate)}。`,
        manifestation: '申请办理压力主要体现在受理规模、结转压力和跨环节协同负荷上，若流程压缩与质量管控不同步，容易形成后续争议。',
        impact: '将直接影响答复时效、审核质量和领导督办节奏，也可能挤占基层单位日常公开和业务办理资源。',
        focus: '重点关注高频申请主题、重复申请事项、积压环节和跨部门协同办理节点。',
      },
      {
        sequence: 2,
        priorityLevel: '首要关注事项',
        riskName: '答复规范性及复议诉讼风险',
        basis: `复议${formatInteger(asNumber(currentRow.rev_total))}件，复议纠正占比${formatPercent(currentMetrics.revRate)}；诉讼${formatInteger(asNumber(currentRow.lit_total))}件，诉讼纠正占比${formatPercent(currentMetrics.litRate)}。`,
        manifestation: '纠正案件反映答复文书、事实核查、法律适用、程序履行或说理完整性方面可能仍存在薄弱环节。',
        impact: '将影响依法行政评价，也可能带来投诉举报、重复申请和重点案件督办压力。',
        focus: '重点关注纠错案件复盘、法审把关、模板修订和重点领域案件的前端预防。',
      },
      {
        sequence: 3,
        priorityLevel: '首要关注事项',
        riskName: '“本机关不掌握相关信息”占比较高所反映的检索协同和口径适用风险',
        basis: `“本机关不掌握相关信息”${formatInteger(asNumber(currentRow.outcome_unable_no_info))}件，占“无法提供”比重${formatPercent(currentMetrics.noInfoShareInUnable)}。`,
        manifestation: '该现象既可能与申请事项本身有关，也提示信息形成、归集、目录管理、内部检索和跨部门调取机制仍需进一步规范。',
        impact: '如适用口径把握不准，容易引发争议，也不利于建立高频事项分流和源头治理机制。',
        focus: '重点关注检索留痕、协同调取路径、“不掌握相关信息”适用审查和高频事项反向公开。',
      },
      {
        sequence: 4,
        priorityLevel: '重点关注事项',
        riskName: '实质公开率及公开供给匹配风险',
        basis: `${yoySentence('实质公开率', currentMetrics.substantiveRate, previousMetrics?.substantiveRate ?? null, '%')}“无法提供”占比${formatPercent(currentMetrics.unableRate)}。`,
        manifestation: '实质公开率与无法提供占比的组合情况提示，主动公开供给与依申请公开需求之间仍可能存在匹配不足。',
        impact: '如主动公开供给不能及时覆盖高频事项，依申请公开受理压力和重复申请压力将难以有效缓解。',
        focus: '重点关注高频申请事项、专题公开补充、政策解读同步发布和栏目维护质量。',
      },
      {
        sequence: 5,
        priorityLevel: '重点关注事项',
        riskName: '基层能力与法治审查支撑风险',
        basis: `整体纠正占比${formatPercent(currentMetrics.overallCorrectionRate)}，说明前端办理与法审支撑仍需协同增强。`,
        manifestation: '基层单位在事实表述、法律适用、程序履行和文书说理方面可能存在不均衡情况，法审支撑能力也需持续提升。',
        impact: '将影响同类事项办理一致性，增加纠错和返工成本，削弱市级统筹治理效果。',
        focus: '重点关注基层培训、定点辅导、模板统一、重点案件抽查和法审前置。',
      },
    ];
  }

  private buildRectificationTaskSkeleton(): ReportPayloadV1['rectificationTaskSkeleton'] {
    return [
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
  }

  private buildAppendixSkeleton(context: PayloadSeedContext): ReportPayloadV1['appendixSkeleton'] {
    return {
      metricAuditRows: this.buildAppendixMetricAuditRows(context),
      usageBoundaries: this.buildAppendixBoundarySeeds(),
      supplementDataItems: this.buildAppendixSupplementSeeds(),
    };
  }

  private buildAppendixMetricAuditRows(
    context: PayloadSeedContext
  ): ReportPayloadV1['appendixSkeleton']['metricAuditRows'] {
    const { currentMetrics, previousMetrics } = context;

    return [
      {
        indicator: '新收申请数',
        sourceFields: 'app_new',
        formula: '直接读取结构化字段；同比变化 = (本年 - 上年) / 上年 × 100%',
        ...formatCurrentAndPrevious(currentMetrics.newReceived, previousMetrics?.newReceived ?? null),
        reconciliationNote: '仅使用结构化输入与上年同期字段，不由模型推断。',
      },
      {
        indicator: '上年同期新收申请数',
        sourceFields: 'previous.app_new',
        formula: '直接读取上年同期结构化字段',
        currentValue: previousMetrics ? formatMetricValue(previousMetrics.newReceived, '件') : '无上年同期数据',
        previousValue: '—',
        reconciliationNote: '若缺少上年同期数据，则同比字段自动置为不可比。',
      },
      {
        indicator: '同比变化',
        sourceFields: 'current.app_new + previous.app_new',
        formula: '(本年新收申请数 - 上年同期数) / 上年同期数 × 100%',
        currentValue: formatChangePct(changePct(currentMetrics.newReceived, previousMetrics?.newReceived ?? null)),
        previousValue: '—',
        reconciliationNote: '仅在存在上年同期数据时计算。',
      },
      {
        indicator: '实质公开率',
        sourceFields: 'outcome_public + outcome_partial + acceptedTotal',
        formula: '(予以公开 + 部分公开) / 受理总量 × 100%',
        ...formatCurrentAndPrevious(currentMetrics.substantiveRate, previousMetrics?.substantiveRate ?? null, '%'),
        reconciliationNote: '受理总量按“上年结转 + 本年新收”程序派生。',
      },
      {
        indicator: '无法提供占比',
        sourceFields: 'outcome_unable + acceptedTotal',
        formula: '无法提供 / 受理总量 × 100%',
        ...formatCurrentAndPrevious(currentMetrics.unableRate, previousMetrics?.unableRate ?? null, '%'),
        reconciliationNote: '涉及受理总量勾稽异常时，事实层不得直接引用该指标定性。',
      },
      {
        indicator: '“本机关不掌握相关信息”占“无法提供”比重',
        sourceFields: 'outcome_unable_no_info + outcome_unable',
        formula: '本机关不掌握相关信息 / 无法提供 × 100%',
        ...formatCurrentAndPrevious(currentMetrics.noInfoShareInUnable, previousMetrics?.noInfoShareInUnable ?? null, '%'),
        reconciliationNote: '仅用于辅助研判，不直接推导原因归属。',
      },
      {
        indicator: '复议纠正占比',
        sourceFields: 'rev_corrected + rev_total',
        formula: '复议纠正数 / 复议总数 × 100%',
        ...formatCurrentAndPrevious(currentMetrics.revRate, previousMetrics?.revRate ?? null, '%'),
        reconciliationNote: '仅反映结果比例，不直接等同于全部办理质量结论。',
      },
      {
        indicator: '诉讼纠正占比',
        sourceFields: 'lit_corrected + lit_total',
        formula: '诉讼纠正数 / 诉讼总数 × 100%',
        ...formatCurrentAndPrevious(currentMetrics.litRate, previousMetrics?.litRate ?? null, '%'),
        reconciliationNote: '仅用于辅助判断争议外溢风险。',
      },
      {
        indicator: '整体纠正占比',
        sourceFields: 'rev_corrected + lit_corrected + rev_total + lit_total',
        formula: '(复议纠正数 + 诉讼纠正数) / (复议总数 + 诉讼总数) × 100%',
        ...formatCurrentAndPrevious(currentMetrics.overallCorrectionRate, previousMetrics?.overallCorrectionRate ?? null, '%'),
        reconciliationNote: '用于综合观察行政争议纠错情况，不作为考核结论。',
      },
      {
        indicator: '结转率',
        sourceFields: 'app_carried_forward + acceptedTotal',
        formula: '结转下年 / 受理总量 × 100%',
        ...formatCurrentAndPrevious(currentMetrics.carryForwardRate, previousMetrics?.carryForwardRate ?? null, '%'),
        reconciliationNote: '与“办理结果合计 + 结转下年 = 受理总量”校验关系同步使用。',
      },
    ];
  }

  private buildAppendixBoundarySeeds(): ReportPayloadV1['appendixSkeleton']['usageBoundaries'] {
    return [
      {
        title: '适用范围',
        description: '本报告适用于年度工作研判、问题识别、任务部署和内部督办，可作为领导掌握情况和安排工作的参考。',
      },
      {
        title: '排序与考核边界',
        description: '本报告不形成覆盖全部县区、部门的正式排名，不作为正式考核结论；对已纳入监测范围且达到样本门槛的单位，可按既定阈值作内部重点样本提示，供研判和督办参考。',
      },
      {
        title: '事实使用边界',
        description: '事实层内容仅限于结构化统计数据能够直接证明的事项；如存在勾稽异常，应先复核源数据。',
      },
      {
        title: '深化分析条件',
        description: '如需形成正式比较结论、责任认定或更细分的原因分析，仍需结合申请台账、案件文书、明细分类数据和连续监测数据进一步核实。',
      },
    ];
  }

  private buildAppendixSupplementSeeds(): ReportPayloadV1['appendixSkeleton']['supplementDataItems'] {
    return [
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
    ];
  }

  private buildContentBoundaries(dataQuality: DataQualityV1): ReportPayloadV1['contentBoundaries'] {
    return {
      factConclusionAllowed: dataQuality.factConclusionAllowed,
      factConstraint: dataQuality.factConclusionAllowed
        ? '“确认事实”章节只能使用结构化统计数据能够直接证明的事项，不得加入原因归因、趋势推断和责任判断。'
        : '当前存在勾稽异常或阻塞状态，“确认事实”章节只能说明“需复核源数据”，不得展开事实性结论。',
      analysisConstraint:
        '“审慎分析”和“待补充问题”应围绕既有指标、重点事项和整改安排展开，必须使用“表明、提示、反映、可能存在、需持续关注”等审慎措辞，不作超出证据边界的确定性判断。',
      prohibitedScopes: [
        '不得形成覆盖全部县区、部门的正式排名或考核排序',
        '不得将红黄绿重点样本提示写成正式考核结论或责任认定',
        '不得自行补造上年同期值、原因分类、典型案例或责任归因',
        '不得改动附件指标公式或新增未经校验的统计口径',
      ],
      appendixGenerationRule: '附件按既定指标公式和使用边界生成，正文不得重算附件指标或另行改写附件口径说明。',
    };
  }

  private async buildHierarchyAnalysis(
    unitType: string,
    regionId: number,
    year: number
  ): Promise<HierarchyAnalysisV1 | undefined> {
    if (unitType !== 'city') {
      return undefined;
    }

    const calibration = {
      disclosureMethod: 'substantive' as const,
      correctionMethod: 'reconsideration' as const,
      includesCarryOver: false,
      enableStableSample: true,
    };

    const districtModel = await govInsightLeaderCockpitService.buildComparisonModel(
      regionId,
      year,
      'district',
      calibration
    );
    const departmentModel = await govInsightLeaderCockpitService.buildComparisonModel(
      regionId,
      year,
      'department',
      calibration
    );

    const toItems = (model: Awaited<ReturnType<typeof govInsightLeaderCockpitService.buildComparisonModel>>) =>
      (model?.entities || [])
        .filter((entity) => entity.status !== 'missing' || entity.riskLevel === 'red' || entity.riskLevel === 'yellow')
        .sort((a, b) => {
          const riskWeight = (level?: string) => {
            if (level === 'red') return 0;
            if (level === 'yellow') return 1;
            if (level === 'green') return 2;
            return 3;
          };
          const riskDelta = riskWeight(a.riskLevel) - riskWeight(b.riskLevel);
          if (riskDelta !== 0) return riskDelta;
          return (b.newApplications || 0) - (a.newApplications || 0);
        })
        .slice(0, 10)
        .map((entity) => ({
          // Comparison model ids follow "<unit_type>_<region_id>" generated by canonical_units.
          regionId: Number(String(entity.id).match(/(\d+)/)?.[1] || 0),
          orgId: entity.id,
          orgName: entity.name,
          unitType: (
            entity.id.startsWith('department_')
              ? 'department'
              : entity.id.startsWith('functional_zone_')
                ? 'functional_zone'
              : entity.id.startsWith('town_street_')
                  ? 'town_street'
                  : 'district'
          ) as CanonicalUnitType,
          materializeStatus: entity.status === 'missing' ? 'blocked_missing_facts' : 'official',
          riskLevel: entity.riskLevel || null,
          riskReason: entity.riskReason || null,
          newApplications: entity.newApplications ?? null,
          acceptedTotal: entity.acceptedTotal ?? null,
          disclosureRate: entity.disclosureRate ?? null,
          correctionRate: entity.correctionRate ?? null,
          isSampleSufficient: Boolean(entity.isSampleSufficient),
        }));

    return {
      districtCoverage: {
        available: Boolean(districtModel && districtModel.entities.length > 0),
        total: districtModel?.statistics.total || 0,
        reportCoverage: districtModel?.statistics.reportCoverage || '0/0',
        parseSuccessRate: districtModel?.statistics.parseSuccessRate || '0/0',
        statsCoverage: districtModel?.statistics.statsCoverage || districtModel?.statistics.reportCoverage || '0/0',
        analyzableCoverage: districtModel?.statistics.analyzableCoverage || districtModel?.statistics.fieldCoverage || '0/0',
        officialCoverage: districtModel?.statistics.officialCoverage || '0/0',
      },
      departmentCoverage: {
        available: Boolean(departmentModel && departmentModel.entities.length > 0),
        total: departmentModel?.statistics.total || 0,
        reportCoverage: departmentModel?.statistics.reportCoverage || '0/0',
        parseSuccessRate: departmentModel?.statistics.parseSuccessRate || '0/0',
        statsCoverage: departmentModel?.statistics.statsCoverage || departmentModel?.statistics.reportCoverage || '0/0',
        analyzableCoverage: departmentModel?.statistics.analyzableCoverage || departmentModel?.statistics.fieldCoverage || '0/0',
        officialCoverage: departmentModel?.statistics.officialCoverage || '0/0',
      },
      districtFocus: toItems(districtModel),
      departmentFocus: toItems(departmentModel),
    };
  }

  private buildMetricsSnapshot(currentRow: Record<string, any>, previousRow: Record<string, any> | null): MetricsSnapshotV1 {
    const acceptedTotal = asNumber(currentRow.app_new) + asNumber(currentRow.app_carried_over);
    const resolvedTotal =
      asNumber(currentRow.outcome_public) +
      asNumber(currentRow.outcome_partial) +
      asNumber(currentRow.outcome_not_open) +
      asNumber(currentRow.outcome_unable) +
      asNumber(currentRow.outcome_ignore) +
      asNumber(currentRow.outcome_other);

    const substantiveRate = safePct(
      asNumber(currentRow.outcome_public) + asNumber(currentRow.outcome_partial),
      acceptedTotal
    );
    const unableRate = safePct(asNumber(currentRow.outcome_unable), acceptedTotal);
    const noInfoShareInUnable = safePct(
      asNumber(currentRow.outcome_unable_no_info),
      asNumber(currentRow.outcome_unable)
    );
    const revRate = safePct(asNumber(currentRow.rev_corrected), asNumber(currentRow.rev_total));
    const litRate = safePct(asNumber(currentRow.lit_corrected), asNumber(currentRow.lit_total));
    const overallCorrectionRate = safePct(
      asNumber(currentRow.rev_corrected) + asNumber(currentRow.lit_corrected),
      asNumber(currentRow.rev_total) + asNumber(currentRow.lit_total)
    );
    const carryForwardRate = safePct(asNumber(currentRow.app_carried_forward), acceptedTotal);

    const previousAcceptedTotal = previousRow
      ? asNumber(previousRow.app_new) + asNumber(previousRow.app_carried_over)
      : null;
    const previousSubstantiveRate = previousRow
      ? safePct(asNumber(previousRow.outcome_public) + asNumber(previousRow.outcome_partial), previousAcceptedTotal || 0)
      : null;
    const previousUnableRate = previousRow
      ? safePct(asNumber(previousRow.outcome_unable), previousAcceptedTotal || 0)
      : null;
    const previousNoInfoShare = previousRow
      ? safePct(asNumber(previousRow.outcome_unable_no_info), asNumber(previousRow.outcome_unable))
      : null;
    const previousCorrectionRate = previousRow
      ? safePct(
          asNumber(previousRow.rev_corrected) + asNumber(previousRow.lit_corrected),
          asNumber(previousRow.rev_total) + asNumber(previousRow.lit_total)
        )
      : null;
    const previousCarryForwardRate = previousRow
      ? safePct(asNumber(previousRow.app_carried_forward), previousAcceptedTotal || 0)
      : null;

    const scorecards: ScorecardSnapshot[] = [
      {
        key: 'substantiveRate',
        label: '实质公开率',
        unit: '%',
        current: substantiveRate,
        previous: previousSubstantiveRate,
        changePct: changePct(substantiveRate, previousSubstantiveRate),
        status: substantiveRate >= 60 ? 'good' : substantiveRate >= 50 ? 'watch' : 'risk',
      },
      {
        key: 'unableRate',
        label: '无法提供占比',
        unit: '%',
        current: unableRate,
        previous: previousUnableRate,
        changePct: changePct(unableRate, previousUnableRate),
        status: scorecardStatus(unableRate, 15, 25),
      },
      {
        key: 'noInfoShareInUnable',
        label: '不掌握占无法提供比重',
        unit: '%',
        current: noInfoShareInUnable,
        previous: previousNoInfoShare,
        changePct: changePct(noInfoShareInUnable, previousNoInfoShare),
        status: scorecardStatus(noInfoShareInUnable, 50, 75),
      },
      {
        key: 'overallCorrectionRate',
        label: '整体纠正占比',
        unit: '%',
        current: overallCorrectionRate,
        previous: previousCorrectionRate,
        changePct: changePct(overallCorrectionRate, previousCorrectionRate),
        status: scorecardStatus(overallCorrectionRate, 10, 18),
      },
      {
        key: 'carryForwardRate',
        label: '结转率',
        unit: '%',
        current: carryForwardRate,
        previous: previousCarryForwardRate,
        changePct: changePct(carryForwardRate, previousCarryForwardRate),
        status: scorecardStatus(carryForwardRate, 3, 8),
      },
    ];

    return {
      version: GOVINSIGHT_METRIC_VERSION,
      regionId: asNumber(currentRow.region_id),
      year: asNumber(currentRow.year),
      materializeStatus: currentRow.materialize_status as MaterializeStatus,
      acceptedTotal,
      newReceived: asNumber(currentRow.app_new),
      carriedOver: asNumber(currentRow.app_carried_over),
      carriedForward: asNumber(currentRow.app_carried_forward),
      resolvedTotal,
      substantiveRate,
      unableRate,
      noInfoShareInUnable,
      revRate,
      litRate,
      overallCorrectionRate,
      carryForwardRate,
      yoy: {
        newReceived: changePct(asNumber(currentRow.app_new), previousRow ? asNumber(previousRow.app_new) : null),
        substantiveRate: changePct(substantiveRate, previousSubstantiveRate),
        unableRate: changePct(unableRate, previousUnableRate),
        noInfoShareInUnable: changePct(noInfoShareInUnable, previousNoInfoShare),
        overallCorrectionRate: changePct(overallCorrectionRate, previousCorrectionRate),
        carryForwardRate: changePct(carryForwardRate, previousCarryForwardRate),
      },
      scorecards,
    };
  }

  private async buildDataQuality(
    currentRow: Record<string, any>,
    metrics: MetricsSnapshotV1
  ): Promise<DataQualityV1> {
    const checks: DataQualityCheckItem[] = [];
    const acceptedTotal = metrics.acceptedTotal;
    const resolvedTotal = metrics.resolvedTotal;
    const unableBreakdownTotal =
      asNumber(currentRow.outcome_unable_no_info) +
      asNumber(currentRow.outcome_unable_need_creation) +
      asNumber(currentRow.outcome_unable_unclear);

    checks.push({
      key: 'accepted_total_formula',
      label: '受理总量 = 上年结转 + 本年新收',
      passed: acceptedTotal === asNumber(currentRow.app_new) + asNumber(currentRow.app_carried_over),
      actual: acceptedTotal,
      expected: asNumber(currentRow.app_new) + asNumber(currentRow.app_carried_over),
      note: '受理总量必须由结构化字段程序派生，不允许模型自行生成。',
    });

    checks.push({
      key: 'resolved_total_balance',
      label: '办理结果合计 + 结转下年 = 受理总量',
      passed: resolvedTotal + asNumber(currentRow.app_carried_forward) === acceptedTotal,
      actual: resolvedTotal + asNumber(currentRow.app_carried_forward),
      expected: acceptedTotal,
      note: '用于校验办理结果与结转下年是否形成闭环。',
    });

    checks.push({
      key: 'unable_breakdown_balance',
      label: '无法提供子项合计 = 无法提供总量',
      passed: unableBreakdownTotal === asNumber(currentRow.outcome_unable),
      actual: unableBreakdownTotal,
      expected: asNumber(currentRow.outcome_unable),
      note: '用于校验无法提供分类明细是否完整。',
    });

    const consistencyRes = currentRow.source_report_version_id
      ? await pool.query(
          `
          SELECT summary_json
          FROM report_consistency_runs
          WHERE report_version_id = $1
            AND status = 'succeeded'
          ORDER BY COALESCE(finished_at, created_at) DESC, id DESC
          LIMIT 1
          `,
          [currentRow.source_report_version_id]
        )
      : { rows: [] as any[] };

    const consistencySummary = consistencyRes.rows[0]?.summary_json || null;

    const derivedRes = await pool.query(
      `
      SELECT derived_risk_score
      FROM derived_unit_year_metrics
      WHERE region_id = $1 AND year = $2
      ORDER BY updated_at DESC
      LIMIT 1
      `,
      [currentRow.region_id, currentRow.year]
    );

    const warnings: string[] = [];
    if (String(currentRow.materialize_status).startsWith('blocked_')) {
      warnings.push(`当前统计结果处于 ${currentRow.materialize_status} 状态，正式结论需谨慎使用。`);
    }
    if (checks.some((item) => !item.passed)) {
      warnings.push('依申请公开办理结果与结转关系存在勾稽异常，需先复核事实层口径。');
    }
    if (consistencySummary && asNumber(consistencySummary.fail) > 0) {
      warnings.push(`一致性校验存在 ${asNumber(consistencySummary.fail)} 项 FAIL，需要先核实源报告与结构化结果。`);
    }

    const derivedRiskScore = derivedRes.rows[0] ? asNumber(derivedRes.rows[0].derived_risk_score) : null;
    if (derivedRiskScore !== null && derivedRiskScore > 0) {
      warnings.push(`派生风险分值为 ${derivedRiskScore}，建议在正式成文前关注质量风险和争议风险。`);
    }

    const hasAnomaly =
      String(currentRow.materialize_status).startsWith('blocked_') || checks.some((item) => !item.passed);

    return {
      version: GOVINSIGHT_DATA_QUALITY_VERSION,
      materializeStatus: currentRow.materialize_status as MaterializeStatus,
      hasAnomaly,
      factConclusionAllowed: !hasAnomaly,
      warnings,
      checks,
      consistencySummary,
      derivedRiskScore,
    };
  }
}

export const govInsightReportPayloadService = new GovInsightReportPayloadService();
