type SectionLike = {
  title?: string;
  type?: string;
  content?: string;
  [key: string]: any;
};

export type AlignedSection<T extends SectionLike = SectionLike> = {
  title: string;
  type?: string;
  oldSec?: T;
  newSec?: T;
};

export type SectionTitleIssue = {
  title: string;
  normalizedTitle: string;
  expectedOrdinal: string;
  actualOrdinal: string;
  reason: string;
};

export type SectionAlignmentRule = {
  sectionType?: string | null;
  section_type?: string | null;
  leftKey?: string | null;
  left_key?: string | null;
  rightKey?: string | null;
  right_key?: string | null;
  canonicalKey?: string | null;
  canonical_key?: string | null;
  enabled?: boolean | null;
};

const CHINESE_NUMERAL_ORDER = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const TOP_LEVEL_HEADING_PATTERN = /(^|\r?\n)\s*([一二三四五六七八九十]+)[、.．]\s*([^\r\n]{2,80})\s*(?=\r?\n|$)/g;

const stripParentheticalAnnotations = (title?: string): string =>
  String(title || '').replace(/[（(][^）)]*[）)]/g, '');

const normalizeTitleText = (title?: string): string =>
  stripParentheticalAnnotations(title)
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, '')
    .replace(/^[|｜丨lLiI1]+(?=[一二三四五六七八九十])/g, '')
    .replace(/[，,。、.．：:；;！!？?（）()【】\[\]《》<>“”"‘’'·]/g, '');

const getTitleParts = (title?: string) => {
  const compact = normalizeTitleText(title);
  const match = compact.match(/^(?:第)?([一二三四五六七八九十]+)(?:章节|章|节|部分|条)?/);
  const ordinal = match?.[1] || '';
  const body = ordinal
    ? compact.replace(/^(?:第)?[一二三四五六七八九十]+(?:章节|章|节|部分|条)?/, '')
    : compact;

  return { compact, ordinal, body };
};

const normalizeProblemSectionBody = (body: string): string =>
  [body, body.replace(/^(?:政府信息公开工作|政务公开工作|政务信息工作|信息公开工作)/g, '')]
    .map((value) =>
      value.replace(
        /^(?:存在的主要问题|存在的?问题|存在主要问题|存在问题)(?:及|和|与)?(?:改进情况|改进措施|改进方向|改进思路)$/g,
        '存在的主要问题改进情况'
      )
    )
    .find((value) => value === '存在的主要问题改进情况') || body;

const normalizeTableTitleBody = (body: string, type = ''): string => {
  if (type === 'table_2') {
    const normalized = body.replace(/^(?:行政机关|本年度|本年)/g, '');
    if (/^主动公开(?:政府|政务)?信息的?情况$/.test(normalized)) return '主动公开政府信息情况';
    return normalized;
  }

  if (type === 'table_3') {
    const normalized = body.replace(/^行政机关/g, '');
    if (/^收到和处理(?:政府)?信息公开申请情况(?:统计表)?$/.test(normalized)) {
      return '收到和处理政府信息公开申请情况';
    }
    return normalized;
  }

  if (type === 'table_4') {
    const normalized = body
      .replace(/^行政机关/g, '')
      .replace(/^因/g, '')
      .replace(/工作/g, '')
      .replace(/被/g, '')
      .replace(/提起/g, '');
    if (normalized.includes('行政复议') && normalized.includes('行政诉讼')) {
      return '政府信息公开行政复议行政诉讼情况';
    }
    return normalized;
  }

  return body;
};

const normalizeTitleBody = (body?: string, type = ''): string => {
  const withoutReportWorkPrefix = normalizeProblemSectionBody(String(body || ''))
    .replace(/^(?:\d{4}年)?(?:(?:政府信息公开|政务公开|信息公开)(?:工作)?)?(?:工作)?总体(?:工作|落实)?情况$/g, '总体情况');

  return normalizeTableTitleBody(withoutReportWorkPrefix, type);
};

const getStandardSectionTitle = (normalizedBody: string, type = ''): { expectedOrdinal: string; normalizedTitle: string } | null => {
  if (type === 'table_2' && normalizedBody === '主动公开政府信息情况') {
    return { expectedOrdinal: '二', normalizedTitle: '二、主动公开政府信息情况' };
  }

  if (type === 'table_3' && normalizedBody === '收到和处理政府信息公开申请情况') {
    return { expectedOrdinal: '三', normalizedTitle: '三、收到和处理政府信息公开申请情况' };
  }

  if (type === 'table_4' && normalizedBody === '政府信息公开行政复议行政诉讼情况') {
    return { expectedOrdinal: '四', normalizedTitle: '四、政府信息公开行政复议、行政诉讼情况' };
  }

  if (/^table_[234]$/.test(type || '')) return null;

  if (normalizedBody === '总体情况') {
    return { expectedOrdinal: '一', normalizedTitle: '一、总体情况' };
  }

  if (normalizedBody === '存在的主要问题改进情况') {
    return { expectedOrdinal: '五', normalizedTitle: '五、存在的主要问题及改进情况' };
  }

  if (normalizedBody === '其他需要报告的事项') {
    return { expectedOrdinal: '六', normalizedTitle: '六、其他需要报告的事项' };
  }

  return null;
};

export const normalizeComparisonSectionTitle = (title?: string, type = ''): string => {
  const { compact, ordinal, body } = getTitleParts(title);
  if (!compact) return `${type || 'section'}:empty`;
  if (compact === '标题' || compact.includes('年度报告')) return `title:${compact}`;

  const normalizedBody = normalizeTitleBody(body, type);
  if (/^table_[234]$/.test(type || '')) {
    return `${type}:${normalizedBody || body || compact}`;
  }

  const normalizedOrdinal = ordinal || (normalizedBody === '总体情况' ? '一' : normalizedBody === '其他需要报告的事项' ? '六' : '');
  const semanticOrdinal = normalizedBody === '存在的主要问题改进情况'
    ? '五'
    : normalizedBody === '其他需要报告的事项'
      ? '六'
      : '';
  const alignmentOrdinal = semanticOrdinal || normalizedOrdinal;
  return [type || 'section', alignmentOrdinal, normalizedBody || compact].join(':');
};

export const getComparisonSectionTitleIssue = (title?: string, type = ''): SectionTitleIssue | null => {
  const rawTitle = String(title || '').trim();
  if (!rawTitle) return null;

  const { ordinal, body } = getTitleParts(rawTitle);
  const normalizedBody = normalizeTitleBody(body, type);
  const standardTitle = getStandardSectionTitle(normalizedBody, type);
  if (!standardTitle) return null;

  const hasDirtyPrefix = /^[|｜丨lLiI1]+\s*[一二三四五六七八九十]/.test(rawTitle.normalize('NFKC'));
  const hasOrdinalMismatch = Boolean(ordinal) && ordinal !== standardTitle.expectedOrdinal;
  if (!hasDirtyPrefix && !hasOrdinalMismatch) return null;

  return {
    title: rawTitle,
    normalizedTitle: standardTitle.normalizedTitle,
    expectedOrdinal: standardTitle.expectedOrdinal,
    actualOrdinal: ordinal || '',
    reason: '原报告章节标题序号或前缀异常，系统已按标准章节语义归位。',
  };
};

const getRuleValue = (rule: SectionAlignmentRule, camelKey: keyof SectionAlignmentRule, snakeKey: keyof SectionAlignmentRule): string =>
  String(rule[camelKey] || rule[snakeKey] || '').trim();

const applySectionAlignmentRules = (key: string, type = '', rules: SectionAlignmentRule[] = []): string => {
  if (!Array.isArray(rules) || rules.length === 0) return key;

  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    const sectionType = getRuleValue(rule, 'sectionType', 'section_type');
    if (sectionType && sectionType !== type) continue;

    const leftKey = getRuleValue(rule, 'leftKey', 'left_key');
    const rightKey = getRuleValue(rule, 'rightKey', 'right_key');
    const canonicalKey = getRuleValue(rule, 'canonicalKey', 'canonical_key');
    if (!canonicalKey) continue;

    if (key === leftKey || key === rightKey || key === canonicalKey) {
      return canonicalKey;
    }
  }

  return key;
};

export const getComparisonSectionAlignmentKey = (
  title?: string,
  type = '',
  rules: SectionAlignmentRule[] = []
): string => applySectionAlignmentRules(normalizeComparisonSectionTitle(title, type), type, rules);

const getDisplaySectionTitle = (title?: string, type = ''): string =>
  getComparisonSectionTitleIssue(title, type)?.normalizedTitle || title || type || '未命名章节';

const getSectionOrder = (title?: string): number => {
  const { compact, ordinal, body } = getTitleParts(title);
  if (compact === '标题' || compact.includes('年度报告')) return -1;
  const normalizedBody = normalizeTitleBody(body);
  const normalizedOrdinal = ordinal || (normalizedBody === '总体情况' ? '一' : normalizedBody === '其他需要报告的事项' ? '六' : '');
  const index = CHINESE_NUMERAL_ORDER.indexOf(normalizedOrdinal);
  return index >= 0 ? index + 1 : 99;
};

const isExpandableTextSection = (section?: SectionLike): boolean => {
  if (!section || (section.type && section.type !== 'text')) return false;
  const { compact, ordinal } = getTitleParts(section.title);
  return !ordinal || compact === '标题' || compact.includes('年度报告');
};

const findEmbeddedHeadings = (content?: string) => {
  const text = String(content || '');
  const headings: Array<{ title: string; headingStart: number; bodyStart: number }> = [];
  let match: RegExpExecArray | null;
  TOP_LEVEL_HEADING_PATTERN.lastIndex = 0;

  while ((match = TOP_LEVEL_HEADING_PATTERN.exec(text))) {
    const headingStart = match.index + match[1].length;
    headings.push({
      title: `${match[2]}、${match[3].trim()}`,
      headingStart,
      bodyStart: match.index + match[0].length,
    });
  }

  return headings;
};

const expandEmbeddedTextSections = <T extends SectionLike>(sections: T[] = []): T[] => {
  const expanded: T[] = [];

  sections.forEach((section) => {
    const content = String(section?.content || '');
    const headings = isExpandableTextSection(section) ? findEmbeddedHeadings(content) : [];

    if (headings.length === 0) {
      expanded.push(section);
      return;
    }

    const preface = content.slice(0, headings[0].headingStart).trim();
    if (preface) {
      expanded.push({
        ...section,
        content: preface,
      });
    }

    headings.forEach((heading, headingIndex) => {
      const nextHeading = headings[headingIndex + 1];
      const sectionContent = content
        .slice(heading.bodyStart, nextHeading ? nextHeading.headingStart : content.length)
        .trim();

      expanded.push({
        ...section,
        title: heading.title,
        content: sectionContent,
      });
    });
  });

  return expanded;
};

export const alignComparisonSections = <T extends SectionLike>(
  leftSections: T[] = [],
  rightSections: T[] = [],
  rules: SectionAlignmentRule[] = []
): Array<AlignedSection<T>> => {
  type InternalRow = AlignedSection<T> & {
    __leftIndex: number;
    __rightIndex: number;
  };

  const normalizedLeftSections = expandEmbeddedTextSections(leftSections);
  const normalizedRightSections = expandEmbeddedTextSections(rightSections);
  const rows: InternalRow[] = [];
  const rowsByKey = new Map<string, InternalRow[]>();

  const rememberRow = (key: string, row: InternalRow) => {
    const existingRows = rowsByKey.get(key) || [];
    existingRows.push(row);
    rowsByKey.set(key, existingRows);
  };

  normalizedLeftSections.forEach((section, index) => {
    const key = getComparisonSectionAlignmentKey(section?.title, section?.type, rules);
    const row: InternalRow = {
      title: getDisplaySectionTitle(section?.title, section?.type),
      type: section?.type,
      oldSec: section,
      __leftIndex: index,
      __rightIndex: Number.POSITIVE_INFINITY,
    };
    rows.push(row);
    rememberRow(key, row);
  });

  normalizedRightSections.forEach((section, index) => {
    const key = getComparisonSectionAlignmentKey(section?.title, section?.type, rules);
    const matchingRow = (rowsByKey.get(key) || []).find((row) => !row.newSec);

    if (matchingRow) {
      matchingRow.newSec = section;
      matchingRow.type = matchingRow.type || section?.type;
      matchingRow.__rightIndex = index;
      return;
    }

    const row: InternalRow = {
      title: getDisplaySectionTitle(section?.title, section?.type),
      type: section?.type,
      newSec: section,
      __leftIndex: Number.POSITIVE_INFINITY,
      __rightIndex: index,
    };
    rows.push(row);
    rememberRow(key, row);
  });

  return rows
    .sort((left, right) => {
      const leftOrder = getSectionOrder(left.title);
      const rightOrder = getSectionOrder(right.title);
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return Math.min(left.__leftIndex, left.__rightIndex) - Math.min(right.__leftIndex, right.__rightIndex);
    })
    .map(({ __leftIndex, __rightIndex, ...row }) => row);
};
