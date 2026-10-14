/**
 * 表三（依申请公开情况）的行/列规范标签。
 *
 * 视觉复核要把 OCR 读到的行名对回字段，确定性修复要去原文里找证据，两边用的是
 * 同一张行表 —— 各写一份正则就会出现"复核面板说的行"和"反推填的格"不是同一行。
 * 这里只放纯数据，任何服务都可以 import（视觉复核/物化都依赖 DB，不能反向引用）。
 * cells / fact_application 的 snake_case 键在 src/utils/table3CellKeys.ts。
 */

/** 申请人列（表三的列头），顺序与 PDF 从左到右一致。 */
export const TABLE3_ENTITY_LABELS: Record<string, string> = {
  naturalPerson: '自然人',
  'legalPerson.commercial': '商业企业',
  'legalPerson.research': '科研机构',
  'legalPerson.social': '社会公益组织',
  'legalPerson.legal': '法律服务机构',
  'legalPerson.other': '其他组织',
  total: '总计',
};

/** 六个分项申请人，总计列由它们求和得出。 */
export const TABLE3_SUB_ENTITY_KEYS = [
  'naturalPerson',
  'legalPerson.commercial',
  'legalPerson.research',
  'legalPerson.social',
  'legalPerson.legal',
  'legalPerson.other',
];

export const TABLE3_ENTITY_KEYS = [...TABLE3_SUB_ENTITY_KEYS, 'total'];

/**
 * 指标行标签（相对申请人节点的字段路径 → PDF 行名关键词）。
 * 关键词取自原表的行名，不带「三、本年度办理结果」这类层级前缀，
 * 因为 PDF 文字层经常把前缀和数字拆到不同行。
 */
export const TABLE3_ROW_LABELS: Record<string, string> = {
  newReceived: '本年新收',
  carriedOver: '上年结转',
  'results.granted': '予以公开',
  'results.partialGrant': '部分公开',
  'results.denied.stateSecret': '属于国家秘密',
  'results.denied.lawForbidden': '法律行政法规禁止公开',
  'results.denied.safetyStability': '危及安全稳定',
  'results.denied.thirdPartyRights': '保护第三方合法权益',
  'results.denied.internalAffairs': '内部事务信息',
  'results.denied.processInfo': '过程性信息',
  'results.denied.enforcementCase': '行政执法案卷',
  'results.denied.adminQuery': '行政查询事项',
  'results.unableToProvide.noInfo': '本机关不掌握相关政府信息',
  'results.unableToProvide.needCreation': '没有现成信息需要另行制作',
  'results.unableToProvide.unclear': '补正后申请内容仍不明确',
  'results.notProcessed.complaint': '信访举报投诉类申请',
  'results.notProcessed.repeat': '重复申请',
  'results.notProcessed.publication': '公开出版物',
  'results.notProcessed.massiveRequests': '大量反复申请',
  'results.notProcessed.confirmInfo': '确认或重新出具',
  'results.other.overdueCorrection': '逾期不补正',
  'results.other.overdueFee': '逾期未缴纳费用',
  'results.other.otherReasons': '其他处理',
  'results.totalProcessed': '办理结果总计',
  'results.carriedForward': '结转下年度',
};

export const TABLE3_FIELD_PATHS = Object.keys(TABLE3_ROW_LABELS);

/** 'legalPerson.commercial.results.partialGrant' → { entity, field: 'results.partialGrant' } */
export function splitTable3EntityPath(
  path: string
): { entity: string; field: string } | null {
  for (const entity of TABLE3_ENTITY_KEYS) {
    const prefix = `${entity}.`;
    if (path.startsWith(prefix)) return { entity, field: path.slice(prefix.length) };
  }
  return null;
}
