import { buildTable3Skeleton } from './LlmCommon';
import { injectCommonRules } from './PromptRules';

type JsonSchema = Record<string, unknown>;
type ParsedSection = Record<string, unknown>;
type SegmentKey =
  | 'overallSituation'
  | 'activeDisclosure'
  | 'applicationRequests'
  | 'reviewLitigation'
  | 'problemsAndImprovements'
  | 'otherMatters';

type CellValue = number | string | null;

const TITLES = {
  overallSituation: '\u4e00\u3001\u603b\u4f53\u60c5\u51b5',
  activeDisclosure: '\u4e8c\u3001\u4e3b\u52a8\u516c\u5f00\u653f\u5e9c\u4fe1\u606f\u60c5\u51b5',
  applicationRequests: '\u4e09\u3001\u6536\u5230\u548c\u5904\u7406\u653f\u5e9c\u4fe1\u606f\u516c\u5f00\u7533\u8bf7\u60c5\u51b5',
  reviewLitigation: '\u56db\u3001\u653f\u5e9c\u4fe1\u606f\u516c\u5f00\u884c\u653f\u590d\u8bae\u3001\u884c\u653f\u8bc9\u8bbc\u60c5\u51b5',
  problemsAndImprovements: '\u4e94\u3001\u5b58\u5728\u7684\u4e3b\u8981\u95ee\u9898\u53ca\u6539\u8fdb\u60c5\u51b5',
  otherMatters: '\u516d\u3001\u5176\u4ed6\u9700\u8981\u62a5\u544a\u7684\u4e8b\u9879',
} as const;

const TABLE_TITLES = {
  table2: '## \u8868\u4e8c\uff1a\u4e3b\u52a8\u516c\u5f00\u653f\u5e9c\u4fe1\u606f\u60c5\u51b5',
  table3: '## \u8868\u4e09\uff1a\u6536\u5230\u548c\u5904\u7406\u653f\u5e9c\u4fe1\u606f\u516c\u5f00\u7533\u8bf7\u60c5\u51b5',
  table4: '## \u8868\u56db\uff1a\u653f\u5e9c\u4fe1\u606f\u516c\u5f00\u884c\u653f\u590d\u8bae\u3001\u884c\u653f\u8bc9\u8bbc\u60c5\u51b5',
} as const;

const SECTION_PATTERNS: Record<SegmentKey, RegExp[]> = {
  // Keyword-first where possible; bare numbered headings are fallbacks only.
  overallSituation: [
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001\u603b\u4f53\u60c5\u51b5/,
    /^\s*#{0,6}\s*\u4e00\u3001/,
    /^\s*[\uFF08(]\u4e00[\uFF09)]\s*\u4e3b\u52a8\u516c\u5f00/,
  ],
  activeDisclosure: [
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001\u4e3b\u52a8\u516c\u5f00/,
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001.{0,20}\u4e3b\u52a8\u516c\u5f00\u653f\u5e9c\u4fe1\u606f/,
    /^\s*##\s*\u8868[\u4e8c2]/i,
    /^\s*#{0,6}\s*\u4e8c\u3001(?!.*\u7533\u8bf7)(?!.*\u590d\u8bae)/,
  ],
  applicationRequests: [
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001.{0,40}\u7533\u8bf7/,
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001.{0,40}\u6536\u5230\u548c\u5904\u7406/,
    /^\s*##\s*\u8868[\u4e093]/i,
    /^\s*##\s*.{0,12}\u6536\u5230\u548c\u5904\u7406.{0,12}\u7533\u8bf7/,
  ],
  reviewLitigation: [
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001.{0,40}\u884c\u653f\u590d\u8bae/,
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001.{0,40}\u884c\u653f\u8bc9\u8bbc/,
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001.{0,40}\u590d\u8bae.{0,12}\u8bc9\u8bbc/,
    /^\s*##\s*\u8868[\u56db4]/i,
  ],
  problemsAndImprovements: [
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001.{0,20}\u4e3b\u8981\u95ee\u9898/,
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001.{0,20}\u6539\u8fdb\u60c5\u51b5/,
    /^\s*#{0,6}\s*\u4e94\u3001(?!.*\u7533\u8bf7)(?!.*\u4fe1\u606f\u7ba1\u7406)/,
    /^\s*[\uFF08(]\u4e00[\uFF09)]\s*\u5b58\u5728\u7684\u4e3b\u8981\u95ee\u9898/,
  ],
  otherMatters: [
    /^\s*#{0,6}\s*[\u4e00\u4e8c\u4e09\u56db\u4e94\u516d]\u3001.{0,20}\u5176\u4ed6\u9700\u8981\u62a5\u544a/,
    /^\s*#{0,6}\s*\u516d\u3001/,
    /^\s*[\uFF08(]\u4e00[\uFF09)]\s*\u8d2f\u5f7b\u843d\u5b9e\u653f\u52a1\u516c\u5f00\u5e74\u5ea6\u5de5\u4f5c\u8981\u70b9\u60c5\u51b5/,
    /^\s*[\uFF08(]\u4e8c[\uFF09)]\s*\u6536\u53d6\u4fe1\u606f\u5904\u7406\u8d39\u60c5\u51b5/,
    /^\s*\u5176\u4ed6\u9700\u8981\u62a5\u544a\u7684\u4e8b\u9879/,
  ],
};

const BODY_KEYS: Array<Extract<SegmentKey, 'overallSituation' | 'problemsAndImprovements' | 'otherMatters'>> = [
  'overallSituation',
  'problemsAndImprovements',
  'otherMatters',
];

const REQUIRED_SEGMENTS: SegmentKey[] = [
  'overallSituation',
  'activeDisclosure',
  'applicationRequests',
  'reviewLitigation',
  'problemsAndImprovements',
];

export interface AnnualReportSplitResult {
  canUseSegmentedParse: boolean;
  missingSections: SegmentKey[];
  fullText: string;
  bodyText: string;
  table2Text: string;
  table3Text: string;
  table4Text: string;
  segments: Record<SegmentKey, string | null>;
}

export interface BodyParseResponse {
  overallSituation: string | null;
  problemsAndImprovements: string | null;
  otherMatters: string | null;
}

export interface Table2ParseResponse {
  activeDisclosureData: Record<string, unknown> | null;
}

export interface Table3ParseResponse {
  tableData: Record<string, unknown> | null;
}

export interface Table4Block {
  maintain: CellValue;
  correct: CellValue;
  other: CellValue;
  unfinished: CellValue;
  total: CellValue;
}

export interface Table4Data {
  review: Table4Block;
  litigationDirect: Table4Block;
  litigationPostReview: Table4Block;
}

export interface Table4ParseResponse {
  reviewLitigationData: Table4Data | null;
}

function buildCellSchema(): JsonSchema {
  return {
    anyOf: [{ type: 'number' }, { type: 'string' }, { type: 'null' }],
  };
}

function buildTable4BlockSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['maintain', 'correct', 'other', 'unfinished', 'total'],
    additionalProperties: true,
    properties: {
      maintain: buildCellSchema(),
      correct: buildCellSchema(),
      other: buildCellSchema(),
      unfinished: buildCellSchema(),
      total: buildCellSchema(),
    },
  };
}

function cleanSegmentText(text: string): string {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = typeof value === 'string' ? cleanSegmentText(value) : '';
  return normalized || null;
}

function stripLeadingSectionTitle(content: string | null, title: string): string | null {
  const normalized = normalizeOptionalText(content);
  if (!normalized) {
    return null;
  }

  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = normalized
    .replace(new RegExp(`^\\s*#{0,6}\\s*${escapedTitle}\\s*`, 'u'), '')
    .trim();

  return stripped || normalized;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pickFirst(obj: Record<string, any> | null | undefined, keys: string[]): unknown {
  if (!obj) return undefined;
  for (const key of keys) {
    if (obj[key] !== undefined) {
      return obj[key];
    }
  }
  return undefined;
}

function normalizeTable2Row(row: unknown, fieldMap: Record<string, string[]>): Record<string, unknown> | null {
  const emptyRow = Object.fromEntries(Object.keys(fieldMap).map((targetKey) => [targetKey, null]));
  if (!isPlainObject(row)) {
    return emptyRow;
  }

  const normalized: Record<string, unknown> = {};
  for (const [targetKey, aliases] of Object.entries(fieldMap)) {
    normalized[targetKey] = pickFirst(row, [targetKey, ...aliases]) ?? null;
  }
  return normalized;
}

function normalizeTable4Block(block: unknown): Table4Block | null {
  if (!isPlainObject(block)) {
    return null;
  }

  return {
    maintain: (pickFirst(block, ['maintain', 'resultMaintained', 'maintained', '维持', '结果维持']) ?? null) as CellValue,
    correct: (pickFirst(block, ['correct', 'resultCorrected', 'corrected', '纠正', '结果纠正']) ?? null) as CellValue,
    other: (pickFirst(block, ['other', 'otherResults', 'otherResult', '其他', '其他结果']) ?? null) as CellValue,
    unfinished: (pickFirst(block, ['unfinished', 'pending', 'notClosed', 'unclosed', '未审结', '尚未审结']) ?? null) as CellValue,
    total: (pickFirst(block, ['total', 'sum', '合计', '总计']) ?? null) as CellValue,
  };
}

export function normalizeTable2ParseResponse(response: unknown): Table2ParseResponse {
  const source = isPlainObject(response) ? response : {};
  const data = isPlainObject(source.activeDisclosureData)
    ? source.activeDisclosureData
    : isPlainObject(source.table_2)
      ? source.table_2
      : source;

  return {
    activeDisclosureData: {
      regulations: normalizeTable2Row(data.regulations, {
        made: ['created', 'formulated', 'issued', '制定', '制发'],
        repealed: ['abolished', 'repeal', '废止'],
        valid: ['effective', 'currentlyEffective', '现行有效'],
      }),
      normativeDocuments: normalizeTable2Row(data.normativeDocuments, {
        made: ['created', 'formulated', 'issued', '制定', '制发'],
        repealed: ['abolished', 'repeal', '废止'],
        valid: ['effective', 'currentlyEffective', '现行有效'],
      }),
      licensing: normalizeTable2Row(data.licensing, { processed: ['handled', 'count', 'processedCount', '处理决定数量'] }),
      punishment: normalizeTable2Row(data.punishment, { processed: ['handled', 'count', 'processedCount', '处理决定数量'] }),
      coercion: normalizeTable2Row(data.coercion, { processed: ['handled', 'count', 'processedCount', '处理决定数量'] }),
      fees: normalizeTable2Row(data.fees, { amount: ['processed', 'count', 'total', '收费金额'] }),
    },
  };
}

export function normalizeTable3ParseResponse(response: unknown): Table3ParseResponse {
  const source = isPlainObject(response) ? response : {};
  return {
    tableData: (isPlainObject(source.tableData) ? source.tableData : isPlainObject(source.table_3) ? source.table_3 : source) as Record<string, unknown>,
  };
}

export function normalizeTable4ParseResponse(response: unknown): Table4ParseResponse {
  const source = isPlainObject(response) ? response : {};
  const data = isPlainObject(source.reviewLitigationData)
    ? source.reviewLitigationData
    : isPlainObject(source.table_4)
      ? source.table_4
      : source;
  const review = pickFirst(data, ['review', 'administrativeReview', '行政复议']);
  const litigationDirect = pickFirst(data, [
    'litigationDirect',
    'directLitigation',
    'litigation_direct',
    '未经复议直接起诉',
    '未经复议直接诉讼',
  ]);
  const litigationPostReview = pickFirst(data, [
    'litigationPostReview',
    'postReviewLitigation',
    'litigation_post_review',
    '复议后起诉',
    '复议后诉讼',
  ]);

  return {
    reviewLitigationData: {
      review: normalizeTable4Block(review) || blockFromCells([]),
      litigationDirect: normalizeTable4Block(litigationDirect) || blockFromCells([]),
      litigationPostReview: normalizeTable4Block(litigationPostReview) || blockFromCells([]),
    },
  };
}

function findFirstMatchingLine(lines: string[], patterns: RegExp[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (patterns.some((pattern) => pattern.test(line))) {
      return index;
    }
  }
  return -1;
}

function findFirstMatchingLineFrom(lines: string[], patterns: RegExp[], startIndex: number): number {
  const start = Math.max(0, startIndex);
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (patterns.some((pattern) => pattern.test(line))) {
      return index;
    }
  }
  return -1;
}

function findLeadInStartForAnnualReport(lines: string[]): number {
  const scanLimit = Math.min(lines.length, 20);
  for (let index = 0; index < scanLimit; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    if (/^\s*\u6b63\u6587\s*$/.test(line)) {
      continue;
    }
    if (/\u5e74\u5ea6\u62a5\u544a/.test(line)) {
      return index + 1;
    }
  }
  return -1;
}

function cloneTable3Skeleton(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(buildTable3Skeleton()));
}

function toCellValue(raw: string): CellValue {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (trimmed === '/' || trimmed === '-' || trimmed === '--' || trimmed === '\u2014' || trimmed === '\u7a7a') {
    return trimmed;
  }
  return trimmed;
}

function isTable4PlaceholderText(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed) return true;
  if (trimmed === '/' || trimmed === '／' || trimmed === '-' || trimmed === '--' || trimmed === '—' || trimmed === '－－') {
    return true;
  }
  if (/^[-—–:\/\\\s]+$/.test(trimmed)) {
    return true;
  }
  if (/^[-—–]{2,}$/.test(trimmed) || /^\/+$/.test(trimmed)) {
    return true;
  }
  return false;
}

function blockFromCells(cells: CellValue[]): Table4Block {
  return {
    maintain: cells[0] ?? null,
    correct: cells[1] ?? null,
    other: cells[2] ?? null,
    unfinished: cells[3] ?? null,
    total: cells[4] ?? null,
  };
}


/** True when segment text looks like administrative review / litigation (table_4). */
export function looksLikeReviewLitigationSegment(text: string | null | undefined): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (/\u884c\u653f\u590d\u8bae|\u884c\u653f\u8bc9\u8bbc|\u590d\u8bae.{0,8}\u8bc9\u8bbc/.test(t)) return true;
  // Flattened table headers commonly include 维持/纠正 with 复议 context
  if (/\u590d\u8bae/.test(t) && /(\u7ef4\u6301|\u7ea0\u6b63|\u8bc9\u8bbc)/.test(t)) return true;
  return false;
}

/** True when segment is applications prose (table_3 narrative) rather than litigation. */
export function looksLikeApplicationOnlySegment(text: string | null | undefined): boolean {
  const t = String(text || '');
  if (!t.trim()) return false;
  if (!/(\u7533\u8bf7|\u6536\u5230\u548c\u5904\u7406)/.test(t)) return false;
  return !looksLikeReviewLitigationSegment(t);
}

export function splitAnnualReportForSegmentedParse(text: string): AnnualReportSplitResult {
  const fullText = cleanSegmentText(text);
  const lines = fullText.split('\n');
  const orderedKeys: SegmentKey[] = [
    'overallSituation',
    'activeDisclosure',
    'applicationRequests',
    'reviewLitigation',
    'problemsAndImprovements',
    'otherMatters',
  ];

  const canonicalOverallStart = findFirstMatchingLine(lines, SECTION_PATTERNS.overallSituation.slice(0, 1));
  const inferredOverallStart = canonicalOverallStart >= 0 ? canonicalOverallStart : findLeadInStartForAnnualReport(lines);

  const starts = orderedKeys.reduce<Record<SegmentKey, number>>((acc, key) => {
    if (key === 'overallSituation') {
      const fallbackStart = inferredOverallStart >= 0 ? inferredOverallStart : findFirstMatchingLine(lines, SECTION_PATTERNS[key]);
      acc[key] = fallbackStart;
      return acc;
    }

    acc[key] = findFirstMatchingLine(lines, SECTION_PATTERNS[key]);
    return acc;
  }, {} as Record<SegmentKey, number>);
  // Keyword re-scan for mis-numbered sections (Shanghai / non-standard outlines).
  if (starts.activeDisclosure < 0) {
    starts.activeDisclosure = findFirstMatchingLine(lines, SECTION_PATTERNS.activeDisclosure);
  }
  if (starts.applicationRequests < 0) {
    starts.applicationRequests = findFirstMatchingLine(lines, SECTION_PATTERNS.applicationRequests);
  }
  if (starts.reviewLitigation < 0) {
    starts.reviewLitigation = findFirstMatchingLine(lines, SECTION_PATTERNS.reviewLitigation);
  }
  // If the first table_4 hit is applications-only prose, search further for real litigation.
  if (starts.reviewLitigation >= 0) {
    const reviewLine = String(lines[starts.reviewLitigation] || '');
    const isApplicationOnly =
      /\u7533\u8bf7/.test(reviewLine) && !/(\u590d\u8bae|\u8bc9\u8bbc)/.test(reviewLine);
    if (isApplicationOnly) {
      if (starts.applicationRequests < 0 || starts.applicationRequests > starts.reviewLitigation) {
        starts.applicationRequests = starts.reviewLitigation;
      }
      starts.reviewLitigation = findFirstMatchingLineFrom(
        lines,
        SECTION_PATTERNS.reviewLitigation,
        starts.reviewLitigation + 1
      );
    }
  }


  if (starts.problemsAndImprovements < 0 && starts.reviewLitigation >= 0) {
    starts.problemsAndImprovements = findFirstMatchingLineFrom(
      lines,
      [
        /^\s*[（(]\u4e00[）)]\s*\u5b58\u5728\u7684\u4e3b\u8981\u95ee\u9898/,
        /^\s*1\u3001.+(?:\u6709\u5f85|\u4e0d\u8db3|\u95ee\u9898|\u52a0\u5f3a|\u6df1\u5316|\u63d0\u5347)/,
      ],
      starts.reviewLitigation + 1
    );
  }

  if (starts.otherMatters < 0 && starts.problemsAndImprovements >= 0) {
    starts.otherMatters = findFirstMatchingLineFrom(
      lines,
      [
        /^\s*[（(]\u4e00[）)]\s*\u8d2f\u5f7b\u843d\u5b9e\u653f\u52a1\u516c\u5f00\u5e74\u5ea6\u5de5\u4f5c\u8981\u70b9\u60c5\u51b5/,
        /^\s*\u8d2f\u5f7b\u843d\u5b9e\u653f\u52a1\u516c\u5f00\u5e74\u5ea6\u5de5\u4f5c\u8981\u70b9\u60c5\u51b5/,
        /^\s*[（(]\u4e8c[）)]\s*\u6536\u53d6\u4fe1\u606f\u5904\u7406\u8d39\u60c5\u51b5/,
      ],
      starts.problemsAndImprovements + 1
    );
  }

  const segments = orderedKeys.reduce<Record<SegmentKey, string | null>>((acc, key, index) => {
    const start = starts[key];
    if (start < 0) {
      acc[key] = null;
      return acc;
    }

    let end = lines.length;
    for (let nextIndex = index + 1; nextIndex < orderedKeys.length; nextIndex += 1) {
      const nextStart = starts[orderedKeys[nextIndex]];
      if (nextStart > start) {
        end = nextStart;
        break;
      }
    }

    const sliced = cleanSegmentText(lines.slice(start, end).join('\n'));
    acc[key] = sliced || null;
    return acc;
  }, {} as Record<SegmentKey, string | null>);

  const bodyText = BODY_KEYS.map((key) => segments[key]).filter(Boolean).join('\n\n');
  
  // table4 segment self-check: drop mis-sliced applications text and re-locate litigation.
  if (segments.reviewLitigation && looksLikeApplicationOnlySegment(segments.reviewLitigation)) {
    const currentStart = starts.reviewLitigation;
    const relocated = currentStart >= 0
      ? findFirstMatchingLineFrom(lines, SECTION_PATTERNS.reviewLitigation, currentStart + 1)
      : findFirstMatchingLine(lines, SECTION_PATTERNS.reviewLitigation);
    if (relocated >= 0 && relocated !== currentStart) {
      starts.reviewLitigation = relocated;
      // rebuild reviewLitigation segment only
      let end = lines.length;
      for (const key of ['problemsAndImprovements', 'otherMatters'] as SegmentKey[]) {
        if (starts[key] > relocated) {
          end = starts[key];
          break;
        }
      }
      segments.reviewLitigation = lines.slice(relocated, end).join('\n');
    } else if (!looksLikeReviewLitigationSegment(segments.reviewLitigation)) {
      segments.reviewLitigation = null;
    }
  }

const missingSections = REQUIRED_SEGMENTS.filter((key) => !segments[key]);

  return {
    canUseSegmentedParse: missingSections.length === 0,
    missingSections,
    fullText,
    bodyText: cleanSegmentText(bodyText),
    table2Text: cleanSegmentText(segments.activeDisclosure || ''),
    table3Text: cleanSegmentText(segments.applicationRequests || ''),
    table4Text: cleanSegmentText(segments.reviewLitigation || ''),
    segments,
  };
}

export function buildBodyParseSystemInstruction(): string {
  return [
    'You extract verbatim text sections from a Chinese government information disclosure annual report.',
    'The user input contains only section 1, section 5, and section 6 of one annual report.',
    'Return ONLY JSON that matches the schema.',
    'Copy the original section text verbatim. Do not summarize, rewrite, or omit details.',
    'If one of the three sections is absent from the input, return null for that field.',
  ].join('\n');
}

export function buildBodyParsePrompt(bodyText: string): string {
  return [
    `Extract exact text for these sections: ${TITLES.overallSituation}, ${TITLES.problemsAndImprovements}, ${TITLES.otherMatters}.`,
    '',
    '[BEGIN INPUT]',
    bodyText,
    '[END INPUT]',
  ].join('\n');
}

export function buildBodyParseResponseSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['overallSituation', 'problemsAndImprovements', 'otherMatters'],
    additionalProperties: true,
    properties: {
      overallSituation: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      problemsAndImprovements: { anyOf: [{ type: 'string' }, { type: 'null' }] },
      otherMatters: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
  };
}

function resolveBodySectionContent(sourceSegment: string | null, candidate: unknown): string | null {
  const normalizedSource = normalizeOptionalText(sourceSegment);
  if (normalizedSource) {
    return normalizedSource;
  }

  return normalizeOptionalText(candidate);
}

export function resolveSegmentedBodyParseResponse(
  body: Partial<BodyParseResponse> | null | undefined,
  split: Pick<AnnualReportSplitResult, 'segments'>
): BodyParseResponse {
  return {
    overallSituation: stripLeadingSectionTitle(
      resolveBodySectionContent(split.segments.overallSituation, body?.overallSituation),
      TITLES.overallSituation
    ),
    problemsAndImprovements: stripLeadingSectionTitle(
      resolveBodySectionContent(split.segments.problemsAndImprovements, body?.problemsAndImprovements),
      TITLES.problemsAndImprovements
    ),
    otherMatters: stripLeadingSectionTitle(
      resolveBodySectionContent(split.segments.otherMatters, body?.otherMatters),
      TITLES.otherMatters
    ),
  };
}

function findTextSectionCandidate(sections: ParsedSection[], title: string, fallbackIndex: number): ParsedSection | undefined {
  const exact = sections.find((section) => section?.type === 'text' && section?.title === title);
  if (exact) {
    return exact;
  }

  const textSections = sections.filter((section) => section?.type === 'text');
  return textSections[fallbackIndex];
}

function findTableSectionCandidate(sections: ParsedSection[], type: string, title: string): ParsedSection | undefined {
  return (
    sections.find((section) => section?.type === type && section?.title === title) ||
    sections.find((section) => section?.type === type) ||
    sections.find((section) => section?.title === title)
  );
}

function mergeCanonicalSection(existing: ParsedSection | undefined, canonical: ParsedSection): ParsedSection {
  if (!existing || typeof existing !== 'object') {
    return canonical;
  }
  return {
    ...existing,
    ...canonical,
  };
}

function hasMeaningfulNarrativeContent(content: unknown, title: string): boolean {
  const normalized = normalizeOptionalText(content);
  if (!normalized) {
    return false;
  }

  const escapedTitle = cleanSegmentText(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const contentWithoutTitle = normalized
    .replace(new RegExp(`^\\s*#{0,6}\\s*${escapedTitle}\\s*`, 'u'), '')
    .trim();

  return contentWithoutTitle.length > 0;
}

export function normalizeAnnualReportOutputFromSource<T>(
  output: T,
  sourceText: string
): { output: T; repairs: string[]; validationIssues: string[]; applied: boolean } {
  const repairs: string[] = [];
  const validationIssues: string[] = [];

  if (!output || typeof output !== 'object') {
    return { output, repairs, validationIssues, applied: false };
  }

  const split = splitAnnualReportForSegmentedParse(sourceText);
  if (!split.canUseSegmentedParse) {
    return { output, repairs, validationIssues, applied: false };
  }

  const parsed = output as Record<string, unknown>;
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections.filter((section): section is ParsedSection => !!section && typeof section === 'object')
    : [];

  const existingOverall = findTextSectionCandidate(sections, TITLES.overallSituation, 0);
  const existingProblems = findTextSectionCandidate(sections, TITLES.problemsAndImprovements, 1);
  const existingOther = findTextSectionCandidate(sections, TITLES.otherMatters, 2);
  const existingTable2 = findTableSectionCandidate(sections, 'table_2', TITLES.activeDisclosure);
  const existingTable3 = findTableSectionCandidate(sections, 'table_3', TITLES.applicationRequests);
  const existingTable4 = findTableSectionCandidate(sections, 'table_4', TITLES.reviewLitigation);

  const body = resolveSegmentedBodyParseResponse(
    {
      overallSituation: existingOverall?.content as string | null | undefined,
      problemsAndImprovements: existingProblems?.content as string | null | undefined,
      otherMatters: existingOther?.content as string | null | undefined,
    },
    split
  );

  if (normalizeOptionalText(existingOverall?.content) !== body.overallSituation) {
    repairs.push('annual_report.text.section_1_from_source');
  }
  if (normalizeOptionalText(existingProblems?.content) !== body.problemsAndImprovements) {
    repairs.push('annual_report.text.section_5_from_source');
  }
  if (normalizeOptionalText(existingOther?.content) !== body.otherMatters) {
    repairs.push('annual_report.text.section_6_from_source');
  }

  const canonicalSections = mergeSegmentedAnnualReportParse({
    body,
    table2: {
      activeDisclosureData: (existingTable2?.activeDisclosureData as Record<string, unknown> | null | undefined) ?? null,
    },
    table3: {
      tableData: (existingTable3?.tableData as Record<string, unknown> | null | undefined) ?? null,
    },
    table4: {
      reviewLitigationData: (existingTable4?.reviewLitigationData as Table4Data | null | undefined) ?? null,
    },
  }).sections as ParsedSection[];

  const normalizedSections: ParsedSection[] = [
    mergeCanonicalSection(existingOverall, canonicalSections[0]),
    mergeCanonicalSection(existingTable2, canonicalSections[1]),
    mergeCanonicalSection(existingTable3, canonicalSections[2]),
    mergeCanonicalSection(existingTable4, canonicalSections[3]),
    mergeCanonicalSection(existingProblems, canonicalSections[4]),
    mergeCanonicalSection(existingOther, canonicalSections[5]),
  ];

  const needsCanonicalOrder =
    sections.length !== normalizedSections.length ||
    normalizedSections.some((section, index) => {
      const current = sections[index];
      return current?.type !== section.type || current?.title !== section.title;
    });
  if (needsCanonicalOrder) {
    repairs.push('annual_report.sections_canonicalized');
  }

  parsed.sections = normalizedSections;

  if (!hasMeaningfulNarrativeContent(normalizedSections[0]?.content, TITLES.overallSituation)) {
    validationIssues.push('missing_text_section:overallSituation');
  }
  if (!hasMeaningfulNarrativeContent(normalizedSections[4]?.content, TITLES.problemsAndImprovements)) {
    validationIssues.push('missing_text_section:problemsAndImprovements');
  }
  if (split.segments.otherMatters && !hasMeaningfulNarrativeContent(normalizedSections[5]?.content, TITLES.otherMatters)) {
    validationIssues.push('missing_text_section:otherMatters');
  }

  if (!normalizedSections[1]?.activeDisclosureData || typeof normalizedSections[1].activeDisclosureData !== 'object') {
    validationIssues.push('missing_structured_section:table_2');
  }
  if (!normalizedSections[2]?.tableData || typeof normalizedSections[2].tableData !== 'object') {
    validationIssues.push('missing_structured_section:table_3');
  }
  if (!normalizedSections[3]?.reviewLitigationData || typeof normalizedSections[3].reviewLitigationData !== 'object') {
    validationIssues.push('missing_structured_section:table_4');
  }

  return { output, repairs, validationIssues, applied: true };
}

export function buildTable2ParseSystemInstruction(): string {
  return injectCommonRules([
    'You extract section 2 (active disclosure table) from a Chinese government information disclosure annual report.',
    'Return ONLY JSON that matches the schema.',
    'Preserve slash or dash markers as strings when they appear in cells.',
    'Use null only for truly blank cells.',
    'Map the rows to regulations, normativeDocuments, licensing, punishment, coercion, and fees.',
  ].join('\n'));
}

export function buildTable2ParsePrompt(table2Text: string): string {
  return [
    `Extract structured data for ${TITLES.activeDisclosure}.`,
    'Row mapping:',
    `- regulations = \u89c4\u7ae0`,
    `- normativeDocuments = \u884c\u653f\u89c4\u8303\u6027\u6587\u4ef6`,
    `- licensing.processed = \u884c\u653f\u8bb8\u53ef`,
    `- punishment.processed = \u884c\u653f\u5904\u7f5a`,
    `- coercion.processed = \u884c\u653f\u5f3a\u5236`,
    `- fees.amount = \u884c\u653f\u4e8b\u4e1a\u6027\u6536\u8d39`,
    '',
    '[BEGIN INPUT]',
    table2Text,
    '[END INPUT]',
  ].join('\n');
}

export function buildTable2ParseResponseSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['activeDisclosureData'],
    additionalProperties: true,
    properties: {
      activeDisclosureData: {
        type: 'object',
        additionalProperties: true,
        properties: {
          regulations: {
            type: 'object',
            additionalProperties: true,
            properties: {
              made: buildCellSchema(),
              repealed: buildCellSchema(),
              valid: buildCellSchema(),
            },
          },
          normativeDocuments: {
            type: 'object',
            additionalProperties: true,
            properties: {
              made: buildCellSchema(),
              repealed: buildCellSchema(),
              valid: buildCellSchema(),
            },
          },
          licensing: {
            type: 'object',
            additionalProperties: true,
            properties: {
              processed: buildCellSchema(),
            },
          },
          punishment: {
            type: 'object',
            additionalProperties: true,
            properties: {
              processed: buildCellSchema(),
            },
          },
          coercion: {
            type: 'object',
            additionalProperties: true,
            properties: {
              processed: buildCellSchema(),
            },
          },
          fees: {
            type: 'object',
            additionalProperties: true,
            properties: {
              amount: buildCellSchema(),
            },
          },
        },
      },
    },
  };
}

export function buildTable3ParseSystemInstruction(): string {
  return injectCommonRules([
    'You extract section 3 (received and processed disclosure requests) from a Chinese government information disclosure annual report.',
    'Return ONLY JSON that matches the schema.',
    'Preserve slash or dash markers as strings when they appear in cells.',
    'Use null only for truly blank cells.',
    'Use this exact output skeleton for tableData:',
    JSON.stringify(cloneTable3Skeleton(), null, 2),
  ].join('\n'));
}

export function buildTable3ParsePrompt(table3Text: string): string {
  return [
    `Extract structured data for ${TITLES.applicationRequests}.`,
    'Applicant mapping:',
    '- naturalPerson',
    '- legalPerson.commercial',
    '- legalPerson.research',
    '- legalPerson.social',
    '- legalPerson.legal',
    '- legalPerson.other',
    '- total',
    '',
    '[BEGIN INPUT]',
    table3Text,
    '[END INPUT]',
  ].join('\n');
}

export function buildTable3ParseResponseSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['tableData'],
    additionalProperties: true,
    properties: {
      tableData: {
        type: 'object',
        additionalProperties: true,
      },
    },
  };
}

export function buildTable4ParseSystemInstruction(): string {
  return injectCommonRules([
    'You extract section 4 (administrative review and litigation table) from a Chinese government information disclosure annual report.',
    'Return ONLY JSON that matches the schema.',
    'Important flattened-row rule: if the input contains one markdown row with 15 consecutive cells, map cells 1-5 to review, 6-10 to litigationDirect, and 11-15 to litigationPostReview.',
    'Map review to \u884c\u653f\u590d\u8bae, litigationDirect to \u672a\u7ecf\u590d\u8bae\u76f4\u63a5\u8d77\u8bc9, and litigationPostReview to \u590d\u8bae\u540e\u8d77\u8bc9.',
    'Preserve slash or dash markers as strings when they appear in cells.',
    'Use null only for truly blank cells.',
  ].join('\n'), { includeTable4Rules: true });
}

export function buildTable4ParsePrompt(table4Text: string): string {
  return [
    `Extract structured data for ${TITLES.reviewLitigation}.`,
    '',
    '[BEGIN INPUT]',
    table4Text,
    '[END INPUT]',
  ].join('\n');
}

export function buildTable4ParseResponseSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['reviewLitigationData'],
    additionalProperties: true,
    properties: {
      reviewLitigationData: {
        type: 'object',
        required: ['review', 'litigationDirect', 'litigationPostReview'],
        additionalProperties: true,
        properties: {
          review: buildTable4BlockSchema(),
          litigationDirect: buildTable4BlockSchema(),
          litigationPostReview: buildTable4BlockSchema(),
        },
      },
    },
  };
}

export function tryParseFlattenedTable4(table4Text: string): Table4Data | null {
  const lines = cleanSegmentText(table4Text).split('\n');
  for (const line of lines) {
    if (!line.includes('|')) continue;
    const cells = line
      .split('|')
      .map((cell) => cell.trim())
      .filter((cell) => cell.length > 0);

    if (cells.length < 15) {
      continue;
    }

    if (cells.every((cell) => isTable4PlaceholderText(cell))) {
      continue;
    }

    const candidate = cells.slice(0, 15).map(toCellValue);
    const hasMeaningfulValue = candidate.some((value) => value !== null && value !== '');
    if (!hasMeaningfulValue) {
      continue;
    }

    return {
      review: blockFromCells(candidate.slice(0, 5)),
      litigationDirect: blockFromCells(candidate.slice(5, 10)),
      litigationPostReview: blockFromCells(candidate.slice(10, 15)),
    };
  }

  return null;
}

export function hasMeaningfulTable4Data(value: unknown): value is Table4Data {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const blocks = ['review', 'litigationDirect', 'litigationPostReview'] as const;
  for (const block of blocks) {
    const node = (value as Record<string, any>)[block];
    if (!node || typeof node !== 'object') {
      return false;
    }

    const fields = ['maintain', 'correct', 'other', 'unfinished', 'total'] as const;
    if (
      fields.some((field) => {
        const cell = node[field];
        if (cell === null || cell === undefined) {
          return false;
        }
        const normalized = String(cell).trim();
        return normalized !== '' && !isTable4PlaceholderText(normalized);
      })
    ) {
      return true;
    }
  }

  return false;
}

export function mergeSegmentedAnnualReportParse(parts: {
  body: BodyParseResponse;
  table2: Table2ParseResponse;
  table3: Table3ParseResponse;
  table4: Table4ParseResponse;
}): { sections: Array<Record<string, unknown>> } {
  return {
    sections: [
      {
        title: TITLES.overallSituation,
        type: 'text',
        content: parts.body?.overallSituation ?? null,
      },
      {
        title: TITLES.activeDisclosure,
        type: 'table_2',
        activeDisclosureData: parts.table2?.activeDisclosureData ?? null,
      },
      {
        title: TITLES.applicationRequests,
        type: 'table_3',
        tableData: parts.table3?.tableData ?? null,
      },
      {
        title: TITLES.reviewLitigation,
        type: 'table_4',
        reviewLitigationData: parts.table4?.reviewLitigationData ?? null,
      },
      {
        title: TITLES.problemsAndImprovements,
        type: 'text',
        content: parts.body?.problemsAndImprovements ?? null,
      },
      {
        title: TITLES.otherMatters,
        type: 'text',
        content: parts.body?.otherMatters ?? null,
      },
    ],
  };
}

export const SEGMENTED_ANNUAL_REPORT_TITLES = {
  ...TITLES,
  ...TABLE_TITLES,
};
