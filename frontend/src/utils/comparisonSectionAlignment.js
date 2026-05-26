const CHINESE_NUMERAL_ORDER = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const TOP_LEVEL_HEADING_PATTERN = /(^|\r?\n)\s*([一二三四五六七八九十]+)[、.．]\s*([^\r\n]{2,80})\s*(?=\r?\n|$)/g;

const stripParentheticalAnnotations = (title) =>
  String(title || '').replace(/[（(][^）)]*[）)]/g, '');

const normalizeTitleText = (title) =>
  stripParentheticalAnnotations(title)
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, '')
    .replace(/^[|｜丨lLiI1]+(?=[一二三四五六七八九十])/g, '')
    .replace(/[，,。、.．：:；;！!？?（）()【】\[\]《》<>“”"‘’'·]/g, '');

const getTitleParts = (title) => {
  const compact = normalizeTitleText(title);
  const match = compact.match(/^(?:第)?([一二三四五六七八九十]+)(?:章节|章|节|部分|条)?/);
  const ordinal = match?.[1] || '';
  const body = ordinal
    ? compact.replace(/^(?:第)?[一二三四五六七八九十]+(?:章节|章|节|部分|条)?/, '')
    : compact;

  return { compact, ordinal, body };
};

const normalizeProblemSectionBody = (body) =>
  [body, body.replace(/^(?:政府信息公开工作|政务公开工作|政务信息工作|信息公开工作)/g, '')]
    .map((value) =>
      value.replace(
        /^(?:存在的主要问题|存在的?问题|存在主要问题|存在问题)(?:及|和|与)?(?:改进情况|改进措施|改进方向|改进思路)$/g,
        '存在的主要问题改进情况'
      )
    )
    .find((value) => value === '存在的主要问题改进情况') || body;

const normalizeTableTitleBody = (body, type = '') => {
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

const normalizeTitleBody = (body, type = '') => {
  const withoutReportWorkPrefix = normalizeProblemSectionBody(String(body || ''))
    .replace(/^(?:\d{4}年)?(?:(?:政府信息公开|政务公开|信息公开)(?:工作)?)?(?:工作)?总体(?:工作|落实)?情况$/g, '总体情况');

  return normalizeTableTitleBody(withoutReportWorkPrefix, type);
};

export const normalizeComparisonSectionTitle = (title, type = '') => {
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

export const getComparisonSectionTitleIssue = (title, type = '') => {
  if ((type || 'text') !== 'text') return null;
  const rawTitle = String(title || '').trim();
  if (!rawTitle) return null;

  const { ordinal, body } = getTitleParts(rawTitle);
  const normalizedBody = normalizeTitleBody(body, type);
  const expectedOrdinal = normalizedBody === '存在的主要问题改进情况'
    ? '五'
    : normalizedBody === '其他需要报告的事项'
      ? '六'
      : '';
  if (!expectedOrdinal) return null;

  const normalizedTitle = `${expectedOrdinal}、${
    normalizedBody === '存在的主要问题改进情况' ? '存在的主要问题及改进情况' : normalizedBody
  }`;
  const hasDirtyPrefix = /^[|｜丨lLiI1]+\s*[一二三四五六七八九十]/.test(rawTitle.normalize('NFKC'));
  const hasOrdinalMismatch = Boolean(ordinal) && ordinal !== expectedOrdinal;
  if (!hasDirtyPrefix && !hasOrdinalMismatch) return null;

  return {
    title: rawTitle,
    normalizedTitle,
    expectedOrdinal,
    actualOrdinal: ordinal || '',
    reason: '原报告章节标题序号或前缀异常，系统已按标准章节语义归位。',
  };
};

const getRuleValue = (rule, camelKey, snakeKey) =>
  String(rule?.[camelKey] || rule?.[snakeKey] || '').trim();

const applySectionAlignmentRules = (key, type = '', rules = []) => {
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

export const getComparisonSectionAlignmentKey = (title, type = '', rules = []) =>
  applySectionAlignmentRules(normalizeComparisonSectionTitle(title, type), type, rules);

const getDisplaySectionTitle = (title, type = '') =>
  getComparisonSectionTitleIssue(title, type)?.normalizedTitle || title || type || '未命名章节';

const getSectionOrder = (title) => {
  const { compact, ordinal, body } = getTitleParts(title);
  if (compact === '标题' || compact.includes('年度报告')) return -1;
  const normalizedBody = normalizeTitleBody(body);
  const normalizedOrdinal = ordinal || (normalizedBody === '总体情况' ? '一' : normalizedBody === '其他需要报告的事项' ? '六' : '');
  const index = CHINESE_NUMERAL_ORDER.indexOf(normalizedOrdinal);
  return index >= 0 ? index + 1 : 99;
};

const isExpandableTextSection = (section) => {
  if (!section || (section.type && section.type !== 'text')) return false;
  const { compact, ordinal } = getTitleParts(section.title);
  return !ordinal || compact === '标题' || compact.includes('年度报告');
};

const findEmbeddedHeadings = (content) => {
  const text = String(content || '');
  const headings = [];
  let match;
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

const expandEmbeddedTextSections = (sections = []) => {
  const expanded = [];

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

const createRow = (section, side, index) => {
  const fallbackTitle = getDisplaySectionTitle(section?.title, section?.type);
  const row = {
    title: fallbackTitle,
    type: section?.type,
    __leftIndex: side === 'left' ? index : Number.POSITIVE_INFINITY,
    __rightIndex: side === 'right' ? index : Number.POSITIVE_INFINITY,
  };

  if (side === 'left') {
    row.oldSec = section;
    row.left = section;
  } else {
    row.newSec = section;
    row.right = section;
  }

  return row;
};

export const alignComparisonSections = (leftSections = [], rightSections = [], rules = []) => {
  const normalizedLeftSections = expandEmbeddedTextSections(leftSections);
  const normalizedRightSections = expandEmbeddedTextSections(rightSections);
  const rows = [];
  const rowsByKey = new Map();

  const rememberRow = (key, row) => {
    const existingRows = rowsByKey.get(key) || [];
    existingRows.push(row);
    rowsByKey.set(key, existingRows);
  };

  normalizedLeftSections.forEach((section, index) => {
    const key = getComparisonSectionAlignmentKey(section?.title, section?.type, rules);
    const row = createRow(section, 'left', index);
    rows.push(row);
    rememberRow(key, row);
  });

  normalizedRightSections.forEach((section, index) => {
    const key = getComparisonSectionAlignmentKey(section?.title, section?.type, rules);
    const matchingRow = (rowsByKey.get(key) || []).find((row) => !row.newSec);

    if (matchingRow) {
      matchingRow.newSec = section;
      matchingRow.right = section;
      matchingRow.type = matchingRow.type || section?.type;
      matchingRow.__rightIndex = index;
      return;
    }

    const row = createRow(section, 'right', index);
    rows.push(row);
    rememberRow(key, row);
  });

  return rows.sort((left, right) => {
    const leftOrder = getSectionOrder(left.title);
    const rightOrder = getSectionOrder(right.title);
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return Math.min(left.__leftIndex, left.__rightIndex) - Math.min(right.__leftIndex, right.__rightIndex);
  });
};
