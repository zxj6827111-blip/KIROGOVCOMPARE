import { buildTable3Skeleton } from './LlmCommon';

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
  overallSituation: [/^\s*\u4e00\u3001/],
  activeDisclosure: [/^\s*\u4e8c\u3001/, /^\s*##\s*\u8868[\u4e8c2]/i],
  applicationRequests: [/^\s*\u4e09\u3001/, /^\s*##\s*\u8868[\u4e093]/i],
  reviewLitigation: [/^\s*\u56db\u3001/, /^\s*##\s*\u8868[\u56db4]/i],
  problemsAndImprovements: [/^\s*\u4e94\u3001/],
  otherMatters: [/^\s*\u516d\u3001/],
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

function blockFromCells(cells: CellValue[]): Table4Block {
  return {
    maintain: cells[0] ?? null,
    correct: cells[1] ?? null,
    other: cells[2] ?? null,
    unfinished: cells[3] ?? null,
    total: cells[4] ?? null,
  };
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

  const starts = orderedKeys.reduce<Record<SegmentKey, number>>((acc, key) => {
    acc[key] = findFirstMatchingLine(lines, SECTION_PATTERNS[key]);
    return acc;
  }, {} as Record<SegmentKey, number>);

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
    overallSituation: resolveBodySectionContent(split.segments.overallSituation, body?.overallSituation),
    problemsAndImprovements: resolveBodySectionContent(
      split.segments.problemsAndImprovements,
      body?.problemsAndImprovements
    ),
    otherMatters: resolveBodySectionContent(split.segments.otherMatters, body?.otherMatters),
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

  return normalized.length > cleanSegmentText(title).length;
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
  return [
    'You extract section 2 (active disclosure table) from a Chinese government information disclosure annual report.',
    'Return ONLY JSON that matches the schema.',
    'Preserve slash or dash markers as strings when they appear in cells.',
    'Use null only for truly blank cells.',
    'Map the rows to regulations, normativeDocuments, licensing, punishment, coercion, and fees.',
  ].join('\n');
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
  return [
    'You extract section 3 (received and processed disclosure requests) from a Chinese government information disclosure annual report.',
    'Return ONLY JSON that matches the schema.',
    'Preserve slash or dash markers as strings when they appear in cells.',
    'Use null only for truly blank cells.',
    'Use this exact output skeleton for tableData:',
    JSON.stringify(cloneTable3Skeleton(), null, 2),
  ].join('\n');
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
  return [
    'You extract section 4 (administrative review and litigation table) from a Chinese government information disclosure annual report.',
    'Return ONLY JSON that matches the schema.',
    'Important flattened-row rule: if the input contains one markdown row with 15 consecutive cells, map cells 1-5 to review, 6-10 to litigationDirect, and 11-15 to litigationPostReview.',
    'Map review to \u884c\u653f\u590d\u8bae, litigationDirect to \u672a\u7ecf\u590d\u8bae\u76f4\u63a5\u8d77\u8bc9, and litigationPostReview to \u590d\u8bae\u540e\u8d77\u8bc9.',
    'Preserve slash or dash markers as strings when they appear in cells.',
    'Use null only for truly blank cells.',
  ].join('\n');
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
        return cell !== null && cell !== undefined && String(cell).trim() !== '';
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
