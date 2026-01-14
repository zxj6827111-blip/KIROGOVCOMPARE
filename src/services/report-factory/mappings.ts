export type IssueSeverity = 'high' | 'medium' | 'low';
export type IssueCategory = 'active_disclosure' | 'application' | 'legal_proceeding' | 'general';

export const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

export const CATEGORY_ORDER: IssueCategory[] = [
  'active_disclosure',
  'application',
  'legal_proceeding',
  'general',
];

const SEVERITY_ALIASES: Record<string, IssueSeverity> = {
  critical: 'high',
  high: 'high',
  medium: 'medium',
  low: 'low',
  info: 'low',
};

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  active_disclosure: '主动公开',
  application: '依申请公开',
  legal_proceeding: '复议诉讼',
  general: '通用',
};

export const CATEGORY_TO_METRIC: Partial<Record<IssueCategory, string>> = {
  active_disclosure: 'active_disclosure_total',
  application: 'application_received_total',
  legal_proceeding: 'legal_review_total',
};

export const CATEGORY_ACTIONS: Record<IssueCategory, string[]> = {
  active_disclosure: [
    '复核主动公开事项清单与统计口径，确保分项填报一致。',
    '补齐缺失字段并触发物化更新，避免统计口径偏差。',
  ],
  application: [
    '核对依申请公开受理、结转与处理数的逻辑，确保按年度口径统计。',
    '完善拒绝/部分公开原因分类，确保数据可追溯。',
  ],
  legal_proceeding: [
    '复核复议/诉讼台账与公开年报数据一致性。',
    '补充未完结案件说明并更新结果分类口径。',
  ],
  general: [
    '检查填报规则与表格校验，修正异常值或缺失值。',
    '确认数据来源与汇总逻辑，更新后重新物化版本。',
  ],
};

export function normalizeSeverity(severity?: string | null): IssueSeverity {
  const normalized = String(severity || '').trim().toLowerCase();
  return SEVERITY_ALIASES[normalized] || 'low';
}

export function inferCategoryFromTable(tableId?: string | null): IssueCategory {
  if (!tableId) return 'general';
  switch (tableId) {
    case 'active_disclosure':
      return 'active_disclosure';
    case 'application':
      return 'application';
    case 'legal_proceeding':
      return 'legal_proceeding';
    default:
      return 'general';
  }
}

export function inferCategoryFromRule(ruleCode?: string | null): IssueCategory {
  const normalized = String(ruleCode || '').toLowerCase();
  if (normalized.includes('active')) return 'active_disclosure';
  if (normalized.includes('application')) return 'application';
  if (normalized.includes('legal') || normalized.includes('review') || normalized.includes('litigation')) {
    return 'legal_proceeding';
  }
  return 'general';
}
