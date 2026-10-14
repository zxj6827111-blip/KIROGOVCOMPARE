/**
 * 表三 / 表四 cells 与 fact 表的键定义（snake_case），以及 tableData ← cells 的还原。
 *
 * cells 与 fact_* 是由代码计算后入库的，键名一旦上线就成了对外契约：历史数据里的
 * row_key 不会因为字段改名而自己跟着变。所以这里把它当作唯一来源，物化和只读分析
 * 脚本都从这里取值，避免两侧各写一份 snake_case 而对不上。
 */

/** 表三 cells.row_key（= fact_application.response_type），按 tableData 字段路径索引。 */
export const TABLE3_CELL_ROW_KEYS: Record<string, string> = {
  newReceived: 'new_received',
  carriedOver: 'carried_over',
  'results.granted': 'granted',
  'results.partialGrant': 'partial_grant',
  'results.denied.stateSecret': 'denied_state_secret',
  'results.denied.lawForbidden': 'denied_law_forbidden',
  'results.denied.safetyStability': 'denied_safety_stability',
  'results.denied.thirdPartyRights': 'denied_third_party_rights',
  'results.denied.internalAffairs': 'denied_internal_affairs',
  'results.denied.processInfo': 'denied_process_info',
  'results.denied.enforcementCase': 'denied_enforcement_case',
  'results.denied.adminQuery': 'denied_admin_query',
  'results.unableToProvide.noInfo': 'unable_no_info',
  'results.unableToProvide.needCreation': 'unable_need_creation',
  'results.unableToProvide.unclear': 'unable_unclear',
  'results.notProcessed.complaint': 'not_processed_complaint',
  'results.notProcessed.repeat': 'not_processed_repeat',
  'results.notProcessed.publication': 'not_processed_publication',
  'results.notProcessed.massiveRequests': 'not_processed_massive_requests',
  'results.notProcessed.confirmInfo': 'not_processed_confirm_info',
  'results.other.overdueCorrection': 'other_overdue_correction',
  'results.other.overdueFee': 'other_overdue_fee',
  'results.other.otherReasons': 'other_other_reasons',
  'results.totalProcessed': 'total_processed',
  'results.carriedForward': 'carried_forward',
};

/** 表三 cells.col_key（= fact_application.applicant_type），按申请人路径索引。 */
export const TABLE3_CELL_COL_KEYS: Record<string, string> = {
  naturalPerson: 'natural_person',
  'legalPerson.commercial': 'legal_person_commercial',
  'legalPerson.research': 'legal_person_research',
  'legalPerson.social': 'legal_person_social',
  'legalPerson.legal': 'legal_person_legal',
  'legalPerson.other': 'legal_person_other',
  total: 'total',
};

export const TABLE3_ROW_KEY_BY_FIELD: Record<string, string> = TABLE3_CELL_ROW_KEYS;
export const FIELD_BY_TABLE3_ROW_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(TABLE3_CELL_ROW_KEYS).map(([field, rowKey]) => [rowKey, field])
);
export const ENTITY_BY_TABLE3_COL_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(TABLE3_CELL_COL_KEYS).map(([entity, colKey]) => [colKey, entity])
);

export type TableCellSemantic = 'ZERO' | 'EMPTY' | 'NA' | 'TEXT' | 'NUMERIC';

interface CellValue {
  colKey: string;
  rowKey: string;
  semantic: TableCellSemantic;
  num: number | null;
}

/**
 * 把 cells 行还原成 tableData 结构，供只读分析复用勾稽等式求解。
 * NA 用横杠字符串回填（而不是数字），保持和 parsed_json 一致，
 * 否则 EMPTY 与 NA 会在还原结果里被混为一谈。
 */
export function rebuildTableDataFromCells(rows: CellValue[]): Record<string, any> {
  const tableData: Record<string, any> = {};

  for (const cell of rows) {
    const entity = ENTITY_BY_TABLE3_COL_KEY[cell.colKey];
    const field = FIELD_BY_TABLE3_ROW_KEY[cell.rowKey];
    if (!entity || !field) continue;

    const segments = `${entity}.${field}`.split('.');
    let cursor = tableData;
    for (const segment of segments.slice(0, -1)) {
      if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {};
      cursor = cursor[segment];
    }
    const leaf = segments[segments.length - 1];
    if (cell.semantic === 'EMPTY') cursor[leaf] = null;
    else if (cell.semantic === 'NA') cursor[leaf] = '-';
    else cursor[leaf] = cell.num;
  }

  return tableData;
}
