import type { EvidenceItem, MetricDefinition } from './types';

export const metricDefinitions: Record<string, MetricDefinition> = {
  newApplications: {
    id: 'newApplications',
    name: '依申请新收',
    formula: '当年收到的政府信息公开依申请数量',
    description: '统计年度内新增接收的政府信息公开依申请件数。',
    unit: '件',
  },
  acceptedTotal: {
    id: 'acceptedTotal',
    name: '受理合计',
    formula: '当年新收 + 上年结转',
    description: '统计年度内受理总量，含当年新收和上年结转。',
    unit: '件',
  },
  substantiveDisclosureRate: {
    id: 'substantiveDisclosureRate',
    name: '实质公开率',
    formula: '(公开 + 部分公开) / 办结',
    description: '衡量办结事项中实质公开的占比，支持多口径切换。',
    unit: '%',
  },
  reconsiderationCorrectionRate: {
    id: 'reconsiderationCorrectionRate',
    name: '复议纠错率',
    formula: '复议纠错数 / 复议结案数',
    description: '衡量复议案件纠错占比，支持与诉讼合并口径切换。',
    unit: '%',
  },
  disputeConversion: {
    id: 'disputeConversion',
    name: '争议转化率',
    formula: '复议/诉讼立案数 / 依申请新收',
    description: '衡量依申请事项转化为争议案件的比例。',
    unit: '%',
  },
  correctionConversion: {
    id: 'correctionConversion',
    name: '纠错转化率',
    formula: '纠错数 / 依申请新收',
    description: '衡量纠错案件占新收事项的比例。',
    unit: '%',
  },
  correctionRate: {
    id: 'correctionRate',
    name: '纠错率',
    formula: '纠错数 / 立案数',
    description: '衡量争议案件纠错占比。',
    unit: '%',
  },
  serviceRatio: {
    id: 'serviceRatio',
    name: '监管—服务结构比',
    formula: '许可量 / 执法量',
    description: '结构代理指标，不直接等同营商环境优劣。',
  },
};

export const metricEvidence: Record<string, EvidenceItem[]> = {
  newApplications: [
    {
      id: 'ev_new_app',
      title: '表3：依申请新收',
      source: 'gov_open_annual_stats.app_new',
      detail: '年度新增接收依申请数量。',
    },
  ],
  acceptedTotal: [
    {
      id: 'ev_accept_total',
      title: '表3：受理合计',
      source: 'gov_open_annual_stats.app_new + app_carried_over',
      detail: '当年新收与上年结转之和。',
    },
  ],
  substantiveDisclosureRate: [
    {
      id: 'ev_substantive',
      title: '表3：答复类型结构',
      source: 'gov_open_annual_stats.outcome_public / outcome_partial',
      detail: '公开/部分公开口径明细。',
    },
  ],
  reconsiderationCorrectionRate: [
    {
      id: 'ev_reconsideration',
      title: '表4：行政复议纠错',
      source: 'gov_open_annual_stats.rev_corrected / rev_total',
      detail: '复议纠错案件占比。',
    },
  ],
  disputeConversion: [
    {
      id: 'ev_dispute',
      title: '表4：争议立案',
      source: 'gov_open_annual_stats.rev_total / lit_total',
      detail: '复议/诉讼立案数量。',
    },
  ],
  correctionConversion: [
    {
      id: 'ev_correction',
      title: '表4：纠错案件',
      source: 'gov_open_annual_stats.rev_corrected / lit_corrected',
      detail: '纠错案件数量。',
    },
  ],
  correctionRate: [
    {
      id: 'ev_correction_rate',
      title: '表4：纠错率',
      source: 'gov_open_annual_stats.rev_corrected / rev_total',
      detail: '纠错案件占立案比例。',
    },
  ],
  serviceRatio: [
    {
      id: 'ev_service_ratio',
      title: '表2：许可/执法结构',
      source: 'gov_open_annual_stats.action_licensing / action_punishment',
      detail: '行政许可与行政执法数量对比。',
    },
  ],
};
