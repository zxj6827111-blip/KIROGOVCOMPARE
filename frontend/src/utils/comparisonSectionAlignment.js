const CHINESE_NUMERAL_ORDER = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const normalizeTitleText = (title) =>
  String(title || '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, '')
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

export const normalizeComparisonSectionTitle = (title, type = '') => {
  const { compact, ordinal, body } = getTitleParts(title);
  if (!compact) return `${type || 'section'}:empty`;
  if (compact === '标题' || compact.includes('年度报告')) return `title:${compact}`;

  const normalizedBody = body
    .replace(/存在的主要问题[及和]改进情况/g, '存在的主要问题改进情况');

  return [type || 'section', ordinal, normalizedBody || compact].join(':');
};

const getSectionOrder = (title) => {
  const { compact, ordinal } = getTitleParts(title);
  if (compact === '标题' || compact.includes('年度报告')) return -1;
  const index = CHINESE_NUMERAL_ORDER.indexOf(ordinal);
  return index >= 0 ? index + 1 : 99;
};

const createRow = (section, side, index) => {
  const fallbackTitle = section?.title || section?.type || '未命名章节';
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

export const alignComparisonSections = (leftSections = [], rightSections = []) => {
  const rows = [];
  const rowsByKey = new Map();

  const rememberRow = (key, row) => {
    const existingRows = rowsByKey.get(key) || [];
    existingRows.push(row);
    rowsByKey.set(key, existingRows);
  };

  leftSections.forEach((section, index) => {
    const key = normalizeComparisonSectionTitle(section?.title, section?.type);
    const row = createRow(section, 'left', index);
    rows.push(row);
    rememberRow(key, row);
  });

  rightSections.forEach((section, index) => {
    const key = normalizeComparisonSectionTitle(section?.title, section?.type);
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
