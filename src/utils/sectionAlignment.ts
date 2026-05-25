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

const CHINESE_NUMERAL_ORDER = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

const normalizeTitleText = (title?: string): string =>
  String(title || '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, '')
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

export const normalizeComparisonSectionTitle = (title?: string, type = ''): string => {
  const { compact, ordinal, body } = getTitleParts(title);
  if (!compact) return `${type || 'section'}:empty`;
  if (compact === '标题' || compact.includes('年度报告')) return `title:${compact}`;

  const normalizedBody = body.replace(/存在的主要问题[及和]改进情况/g, '存在的主要问题改进情况');

  return [type || 'section', ordinal, normalizedBody || compact].join(':');
};

const getSectionOrder = (title?: string): number => {
  const { compact, ordinal } = getTitleParts(title);
  if (compact === '标题' || compact.includes('年度报告')) return -1;
  const index = CHINESE_NUMERAL_ORDER.indexOf(ordinal);
  return index >= 0 ? index + 1 : 99;
};

export const alignComparisonSections = <T extends SectionLike>(
  leftSections: T[] = [],
  rightSections: T[] = []
): Array<AlignedSection<T>> => {
  type InternalRow = AlignedSection<T> & {
    __leftIndex: number;
    __rightIndex: number;
  };

  const rows: InternalRow[] = [];
  const rowsByKey = new Map<string, InternalRow[]>();

  const rememberRow = (key: string, row: InternalRow) => {
    const existingRows = rowsByKey.get(key) || [];
    existingRows.push(row);
    rowsByKey.set(key, existingRows);
  };

  leftSections.forEach((section, index) => {
    const key = normalizeComparisonSectionTitle(section?.title, section?.type);
    const row: InternalRow = {
      title: section?.title || section?.type || '未命名章节',
      type: section?.type,
      oldSec: section,
      __leftIndex: index,
      __rightIndex: Number.POSITIVE_INFINITY,
    };
    rows.push(row);
    rememberRow(key, row);
  });

  rightSections.forEach((section, index) => {
    const key = normalizeComparisonSectionTitle(section?.title, section?.type);
    const matchingRow = (rowsByKey.get(key) || []).find((row) => !row.newSec);

    if (matchingRow) {
      matchingRow.newSec = section;
      matchingRow.type = matchingRow.type || section?.type;
      matchingRow.__rightIndex = index;
      return;
    }

    const row: InternalRow = {
      title: section?.title || section?.type || '未命名章节',
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
