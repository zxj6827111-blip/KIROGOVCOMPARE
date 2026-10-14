import {
  TABLE3_ENTITY_KEYS,
  TABLE3_FIELD_PATHS,
  TABLE3_ROW_LABELS,
  TABLE3_SUB_ENTITY_KEYS,
  splitTable3EntityPath,
} from '../utils/table3FieldTaxonomy';

type AnyRecord = Record<string, any>;

export interface ParsedOutputStabilizeOptions {
  table3?: boolean;
  table4?: boolean;
  /**
   * 表三丢值反推：勾稽等式唯一解 + 原文数字佐证，两关都过才写回 null 格。
   * 默认关闭，靠 LLM_PARSE_STABILIZE_MODE 里的 table3-null-backfill 令牌灰度。
   */
  table3NullBackfill?: boolean;
  /** 送给模型的同一段正文，反推的原文佐证门只用它；缺失则完全不反推。 */
  sourceText?: string;
}

function toFiniteNumber(value: any): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed === '/' || trimmed === '-' || trimmed === '--' || trimmed === '—') return null;
  const normalized = trimmed.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function collectStrictNumbers(paths: string[], source: AnyRecord): { values: number[]; ok: boolean } {
  const values: number[] = [];
  for (const path of paths) {
    const segments = path.split('.');
    let current: any = source;
    for (const seg of segments) {
      current = current?.[seg];
    }
    const value = toFiniteNumber(current);
    if (value === null) {
      return { values: [], ok: false };
    }
    values.push(value);
  }
  return { values, ok: true };
}

function assignIfChanged(target: AnyRecord, key: string, nextValue: number, repairTag: string, repairs: string[]): void {
  const current = toFiniteNumber(target?.[key]);
  if (current === null || current !== nextValue) {
    target[key] = nextValue;
    repairs.push(repairTag);
  }
}

function readNumericByPath(source: AnyRecord, path: string): number | null {
  const segments = path.split('.');
  let current: any = source;
  for (const seg of segments) {
    current = current?.[seg];
  }
  return toFiniteNumber(current);
}

function ensureObjectPath(target: AnyRecord, pathSegments: string[]): AnyRecord | null {
  let current: any = target;
  for (const seg of pathSegments) {
    if (!current || typeof current !== 'object') {
      return null;
    }
    if (!current[seg] || typeof current[seg] !== 'object') {
      current[seg] = {};
    }
    current = current[seg];
  }
  return current && typeof current === 'object' ? current : null;
}

function computeTable3IdentityTotal(node: AnyRecord | undefined): number | null {
  const newReceived = readNumericByPath(node || {}, 'newReceived');
  const carriedOver = readNumericByPath(node || {}, 'carriedOver');
  const carriedForward = readNumericByPath(node || {}, 'results.carriedForward');
  if (newReceived === null || carriedOver === null || carriedForward === null) {
    return null;
  }
  return newReceived + carriedOver - carriedForward;
}

/** 办理结果分项（不含总计与结转下年），用于「分项之和 = 办理结果总计」等式。 */
const TOTAL_PROCESSED_BREAKDOWN_PATHS = [
  'granted',
  'partialGrant',
  'denied.stateSecret',
  'denied.lawForbidden',
  'denied.safetyStability',
  'denied.thirdPartyRights',
  'denied.internalAffairs',
  'denied.processInfo',
  'denied.enforcementCase',
  'denied.adminQuery',
  'unableToProvide.noInfo',
  'unableToProvide.needCreation',
  'unableToProvide.unclear',
  'notProcessed.complaint',
  'notProcessed.repeat',
  'notProcessed.publication',
  'notProcessed.massiveRequests',
  'notProcessed.confirmInfo',
  'other.overdueCorrection',
  'other.overdueFee',
  'other.otherReasons',
];

interface Table3Equation {
  lhs: string[];
  rhs: string[];
}

/**
 * 表三的全部勾稽等式，路径相对 tableData。与 ConsistencyCheckService 的
 * t3_identity_* / t3_result_total_* / t3_col_sum_* 三族一一对应：反推用的等式和
 * 校验用的等式必须是同一套，否则修完值仍然过不了自己的检查。
 */
function buildTable3Equations(): Table3Equation[] {
  const equations: Table3Equation[] = [];

  for (const entity of TABLE3_ENTITY_KEYS) {
    equations.push({
      lhs: [`${entity}.newReceived`, `${entity}.carriedOver`],
      rhs: [`${entity}.results.totalProcessed`, `${entity}.results.carriedForward`],
    });
    equations.push({
      lhs: TOTAL_PROCESSED_BREAKDOWN_PATHS.map((field) => `${entity}.results.${field}`),
      rhs: [`${entity}.results.totalProcessed`],
    });
  }

  for (const field of TABLE3_FIELD_PATHS) {
    equations.push({
      lhs: TABLE3_SUB_ENTITY_KEYS.map((entity) => `${entity}.${field}`),
      rhs: [`total.${field}`],
    });
  }

  return equations;
}

const TABLE3_EQUATIONS = buildTable3Equations();

/** 反推候选：同一路径被多个等式解出不同值时记为冲突，最终不写。 */
function collectTable3NullCandidates(tableData: AnyRecord): Array<{ path: string; value: number }> {
  const solutions = new Map<string, number | null>();

  for (const equation of TABLE3_EQUATIONS) {
    const terms = [
      ...equation.lhs.map((path) => ({ path, sign: 1 })),
      ...equation.rhs.map((path) => ({ path, sign: -1 })),
    ];

    let unknownPath: string | null = null;
    let unknownSign = 0;
    let unknownCount = 0;
    let knownSum = 0;

    for (const term of terms) {
      const value = readNumericByPath(tableData, term.path);
      if (value === null) {
        unknownCount += 1;
        unknownPath = term.path;
        unknownSign = term.sign;
        continue;
      }
      knownSum += term.sign * value;
    }

    // 门①：勾稽唯一解。两个及以上未知数（例如整行没解析出来）留给人工/视觉复核。
    if (unknownCount !== 1 || !unknownPath) continue;

    // knownSum 为 0 时写成 0 而不是 -0，避免负零进 JSON 再进 cells。
    const solution = knownSum === 0 ? 0 : -unknownSign * knownSum;
    if (!Number.isInteger(solution) || solution < 0) continue;

    const previous = solutions.get(unknownPath);
    if (previous === undefined || previous === solution) {
      solutions.set(unknownPath, solution);
    } else {
      solutions.set(unknownPath, null);
    }
  }

  const accepted: Array<{ path: string; value: number }> = [];
  solutions.forEach((value, path) => {
    if (typeof value === 'number') accepted.push({ path, value });
  });
  return accepted;
}

const TABLE3_SOURCE_WINDOW_CHARS = 200;

function normalizeTable3SourceText(sourceText: string): string {
  const halfWidth = String(sourceText || '').replace(/[０-９]/g, (ch) =>
    String(ch.charCodeAt(0) - 0xff10)
  );
  return halfWidth.replace(/\s+/g, ' ').trim();
}

/**
 * 门②：原文佐证。取行名之后、下一个行名之前的窗口，要求解出的数字在其中作为独立
 * token 出现过一次。PDF 把表头打散时行名与数字仍留在同一段里，够用作证据；窗口里
 * 找不到就放弃反推，绝不用勾稽值冒充原文。
 */
function hasTable3SourceEvidence(normalizedText: string, fieldPath: string, solution: number): boolean {
  const label = TABLE3_ROW_LABELS[fieldPath];
  if (!label) return false;

  const valuePattern = new RegExp(`(^|[^0-9])${solution}([^0-9]|$)`);
  const otherLabels = Object.entries(TABLE3_ROW_LABELS)
    .filter(([path]) => path !== fieldPath)
    .map(([, text]) => text);

  let cursor = 0;
  for (;;) {
    const index = normalizedText.indexOf(label, cursor);
    if (index < 0) return false;

    const windowStart = index + label.length;
    let windowEnd = Math.min(normalizedText.length, windowStart + TABLE3_SOURCE_WINDOW_CHARS);
    for (const otherLabel of otherLabels) {
      const next = normalizedText.indexOf(otherLabel, windowStart);
      if (next >= 0 && next < windowEnd) windowEnd = next;
    }
    if (valuePattern.test(normalizedText.slice(windowStart, windowEnd))) return true;

    cursor = windowStart;
  }
}

function writeTable3ValueIfParentExists(tableData: AnyRecord, path: string, value: number): boolean {
  const segments = path.split('.');
  let parent: any = tableData;
  for (const segment of segments.slice(0, -1)) {
    if (!parent || typeof parent !== 'object') return false;
    parent = parent[segment];
  }
  if (!parent || typeof parent !== 'object') return false;
  parent[segments[segments.length - 1]] = value;
  return true;
}

/**
 * 只补 null，绝不把空白一律填 0：全库七成的 EMPTY 是原文本来就没数（那种情况由
 * 显示层的「缺失」标记和 visual_table3_empty_cells 复核项兜住，不由机器猜）。
 */
function backfillTable3Nulls(tableData: AnyRecord, sourceText: string, repairs: string[]): void {
  const normalizedText = normalizeTable3SourceText(sourceText);
  if (!normalizedText) return;

  for (const candidate of collectTable3NullCandidates(tableData)) {
    const fieldPath = splitTable3EntityPath(candidate.path)?.field;
    if (!fieldPath) continue;
    if (!hasTable3SourceEvidence(normalizedText, fieldPath, candidate.value)) continue;
    if (writeTable3ValueIfParentExists(tableData, candidate.path, candidate.value)) {
      repairs.push(`table_3_null_backfill:${candidate.path}=${candidate.value}`);
    }
  }
}

function readNodeByPath(source: AnyRecord, path: string): any {
  let current: any = source;
  for (const segment of path.split('.')) {
    current = current?.[segment];
  }
  return current;
}

/**
 * 影响面统计用的只读快照：这份表三有多少格是解析未取到值，其中多少格能被勾稽唯一
 * 反推出来。不含原文佐证门，所以 uniquelySolvablePaths 是"开关打开后的收益上限"。
 */
export function summarizeTable3NullBackfill(tableData: AnyRecord): {
  nullPaths: string[];
  uniquelySolvablePaths: string[];
} {
  if (!tableData || typeof tableData !== 'object') {
    return { nullPaths: [], uniquelySolvablePaths: [] };
  }

  const nullPaths: string[] = [];
  for (const entity of TABLE3_ENTITY_KEYS) {
    const node = readNodeByPath(tableData, entity);
    // 申请人整行不存在时 cells 里也没有这一列，属于"报告本来没有这行"，不算丢值。
    if (!node || typeof node !== 'object') continue;
    for (const field of TABLE3_FIELD_PATHS) {
      if (readNumericByPath(tableData, `${entity}.${field}`) === null) {
        nullPaths.push(`${entity}.${field}`);
      }
    }
  }

  const solvable = new Set(collectTable3NullCandidates(tableData).map((item) => item.path));
  return {
    nullPaths,
    uniquelySolvablePaths: nullPaths.filter((path) => solvable.has(path)),
  };
}

function stabilizeTable3(tableData: AnyRecord, repairs: string[]): void {
  const entityMap: Array<{ path: string; node: AnyRecord | undefined }> = [
    { path: 'naturalPerson', node: tableData?.naturalPerson },
    { path: 'legalPerson.commercial', node: tableData?.legalPerson?.commercial },
    { path: 'legalPerson.research', node: tableData?.legalPerson?.research },
    { path: 'legalPerson.social', node: tableData?.legalPerson?.social },
    { path: 'legalPerson.legal', node: tableData?.legalPerson?.legal },
    { path: 'legalPerson.other', node: tableData?.legalPerson?.other },
    { path: 'total', node: tableData?.total },
  ];

  const totalProcessedBreakdownPaths = TOTAL_PROCESSED_BREAKDOWN_PATHS;

  for (const entity of entityMap) {
    const results = entity.node?.results;
    if (!results || typeof results !== 'object') {
      continue;
    }

    const breakdown = collectStrictNumbers(totalProcessedBreakdownPaths, results);
    if (breakdown.ok) {
      const computedTotal = breakdown.values.reduce((sum, n) => sum + n, 0);
      const currentTotal = toFiniteNumber(results.totalProcessed);
      const identityTotal = computeTable3IdentityTotal(entity.node);

      // Be conservative here: some parses contain a stray detailed bucket that would
      // inflate totalProcessed if we always recompute it from the breakdown.
      if (currentTotal === null) {
        if (identityTotal === null || computedTotal === identityTotal) {
          assignIfChanged(
            results,
            'totalProcessed',
            computedTotal,
            `table_3.${entity.path}.results.totalProcessed`,
            repairs
          );
        }
        continue;
      }

      if (identityTotal !== null) {
        if (currentTotal === identityTotal) {
          continue;
        }
        if (computedTotal === identityTotal) {
          assignIfChanged(
            results,
            'totalProcessed',
            identityTotal,
            `table_3.${entity.path}.results.totalProcessed`,
            repairs
          );
        }
        continue;
      }

      if (currentTotal === 0 && computedTotal > 0) {
        assignIfChanged(
          results,
          'totalProcessed',
          computedTotal,
          `table_3.${entity.path}.results.totalProcessed`,
          repairs
        );
      }
    }
  }

  // Stabilize total row from applicant sub-rows.
  const subEntities: AnyRecord[] = [
    tableData?.naturalPerson,
    tableData?.legalPerson?.commercial,
    tableData?.legalPerson?.research,
    tableData?.legalPerson?.social,
    tableData?.legalPerson?.legal,
    tableData?.legalPerson?.other,
  ].filter(Boolean);

  if (tableData?.total && typeof tableData.total === 'object' && subEntities.length === 6) {
    const fields = [
      { path: 'newReceived', label: 'newReceived' },
      { path: 'carriedOver', label: 'carriedOver' },
      { path: 'results.granted', label: 'results.granted' },
      { path: 'results.partialGrant', label: 'results.partialGrant' },
      { path: 'results.denied.stateSecret', label: 'results.denied.stateSecret' },
      { path: 'results.denied.lawForbidden', label: 'results.denied.lawForbidden' },
      { path: 'results.denied.safetyStability', label: 'results.denied.safetyStability' },
      { path: 'results.denied.thirdPartyRights', label: 'results.denied.thirdPartyRights' },
      { path: 'results.denied.internalAffairs', label: 'results.denied.internalAffairs' },
      { path: 'results.denied.processInfo', label: 'results.denied.processInfo' },
      { path: 'results.denied.enforcementCase', label: 'results.denied.enforcementCase' },
      { path: 'results.denied.adminQuery', label: 'results.denied.adminQuery' },
      { path: 'results.unableToProvide.noInfo', label: 'results.unableToProvide.noInfo' },
      { path: 'results.unableToProvide.needCreation', label: 'results.unableToProvide.needCreation' },
      { path: 'results.unableToProvide.unclear', label: 'results.unableToProvide.unclear' },
      { path: 'results.notProcessed.complaint', label: 'results.notProcessed.complaint' },
      { path: 'results.notProcessed.repeat', label: 'results.notProcessed.repeat' },
      { path: 'results.notProcessed.publication', label: 'results.notProcessed.publication' },
      { path: 'results.notProcessed.massiveRequests', label: 'results.notProcessed.massiveRequests' },
      { path: 'results.notProcessed.confirmInfo', label: 'results.notProcessed.confirmInfo' },
      { path: 'results.other.overdueCorrection', label: 'results.other.overdueCorrection' },
      { path: 'results.other.overdueFee', label: 'results.other.overdueFee' },
      { path: 'results.other.otherReasons', label: 'results.other.otherReasons' },
      { path: 'results.totalProcessed', label: 'results.totalProcessed' },
      { path: 'results.carriedForward', label: 'results.carriedForward' },
    ];

    for (const field of fields) {
      const values: number[] = [];
      let allNumeric = true;
      for (const entity of subEntities) {
        const value = readNumericByPath(entity, field.path);
        if (value === null) {
          allNumeric = false;
          break;
        }
        values.push(value);
      }

      if (!allNumeric) {
        continue;
      }

      const computed = values.reduce((sum, n) => sum + n, 0);
      if (!field.path.includes('.')) {
        assignIfChanged(tableData.total, field.path, computed, `table_3.total.${field.label}`, repairs);
        continue;
      }

      const segments = field.path.split('.');
      const parent = ensureObjectPath(tableData.total, segments.slice(0, -1));
      const leafKey = segments[segments.length - 1];
      if (parent && leafKey) {
        assignIfChanged(parent, leafKey, computed, `table_3.total.${field.label}`, repairs);
      }
    }
  }
}

function stabilizeTable4(reviewLitigationData: AnyRecord, repairs: string[]): void {
  const blocks = ['review', 'litigationDirect', 'litigationPostReview'];
  for (const block of blocks) {
    const node = reviewLitigationData?.[block];
    if (!node || typeof node !== 'object') {
      continue;
    }
    const values = collectStrictNumbers(['maintain', 'correct', 'other', 'unfinished'], node);
    if (!values.ok) {
      continue;
    }
    const computed = values.values.reduce((sum, n) => sum + n, 0);
    assignIfChanged(node, 'total', computed, `table_4.${block}.total`, repairs);
  }
}

export function stabilizeParsedOutput<T>(
  output: T,
  userOptions?: ParsedOutputStabilizeOptions
): { output: T; repairs: string[] } {
  const repairs: string[] = [];
  if (!output || typeof output !== 'object') {
    return { output, repairs };
  }

  const options: Required<ParsedOutputStabilizeOptions> = {
    table3: true,
    table4: true,
    table3NullBackfill: false,
    sourceText: '',
    ...(userOptions || {}),
  };

  const parsed = output as AnyRecord;
  const sections = Array.isArray(parsed.sections) ? parsed.sections : [];

  for (const section of sections) {
    if (!section || typeof section !== 'object') {
      continue;
    }

    if (
      options.table3 &&
      section.type === 'table_3' &&
      section.tableData &&
      typeof section.tableData === 'object'
    ) {
      stabilizeTable3(section.tableData as AnyRecord, repairs);
      // 排在勾稽修复之后：totalProcessed 被补齐后，等式里剩下的那个未知数才是真唯一解。
      if (options.table3NullBackfill) {
        backfillTable3Nulls(section.tableData as AnyRecord, options.sourceText, repairs);
      }
    }

    if (
      options.table4 &&
      section.type === 'table_4' &&
      section.reviewLitigationData &&
      typeof section.reviewLitigationData === 'object'
    ) {
      stabilizeTable4(section.reviewLitigationData as AnyRecord, repairs);
    }
  }

  return { output, repairs };
}
