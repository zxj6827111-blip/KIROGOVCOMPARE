import {
  alignComparisonSections,
  getComparisonSectionAlignmentKey,
  normalizeComparisonSectionTitle,
  SectionAlignmentRule,
} from './sectionAlignment';

export interface SectionAlignmentSuggestion {
  id: string;
  sectionType: string;
  leftKey: string;
  rightKey: string;
  canonicalKey: string;
  leftTitle: string;
  rightTitle: string;
  leftContentLength: number;
  rightContentLength: number;
  confidence: number;
  reason: string;
}

const getSectionContentLength = (section: any): number => {
  if (!section) return 0;
  if (typeof section.content === 'string') return section.content.length;
  if (section.tableData || section.activeDisclosureData || section.reviewLitigationData) {
    return JSON.stringify(section.tableData || section.activeDisclosureData || section.reviewLitigationData).length;
  }
  return 0;
};

const normalizeLooseTitleBody = (title?: string, type = ''): string => {
  const key = normalizeComparisonSectionTitle(title, type);
  const body = key.split(':').slice(/^table_[234]$/.test(type || '') ? 1 : 2).join(':') || key;
  return body
    .replace(/^(?:政府信息公开工作|政务公开工作|政务信息工作|信息公开工作|行政机关|本年度|本年)/g, '')
    .replace(/(?:统计表|情况表)$/g, '情况')
    .replace(/的/g, '')
    .replace(/(?:及|和|与)/g, '')
    .replace(/落实情况$/g, '情况')
    .replace(/(?:改进措施|改进方向|改进思路)$/g, '改进情况');
};

const getOrdinalFromNormalizedKey = (key: string): string => {
  const parts = key.split(':');
  return parts.length >= 3 ? parts[1] || '' : '';
};

const buildAlignmentSuggestion = (leftSec: any, rightSec: any): SectionAlignmentSuggestion | null => {
  const sectionType = leftSec?.type || rightSec?.type || 'section';
  if ((leftSec?.type || '') !== (rightSec?.type || '')) return null;

  const leftKey = normalizeComparisonSectionTitle(leftSec?.title, sectionType);
  const rightKey = normalizeComparisonSectionTitle(rightSec?.title, sectionType);
  if (!leftKey || !rightKey || leftKey === rightKey) return null;
  if (leftKey.startsWith('title:') || rightKey.startsWith('title:')) return null;

  const leftLoose = normalizeLooseTitleBody(leftSec?.title, sectionType);
  const rightLoose = normalizeLooseTitleBody(rightSec?.title, sectionType);
  if (!leftLoose || !rightLoose) return null;

  let confidence = 0;
  let reason = '';
  if (/^table_[234]$/.test(sectionType) && leftLoose === rightLoose) {
    confidence = 92;
    reason = '同类型表格章节标题仅存在前缀或后缀差异';
  } else if (sectionType === 'text' && leftLoose === rightLoose) {
    const leftOrdinal = getOrdinalFromNormalizedKey(leftKey);
    const rightOrdinal = getOrdinalFromNormalizedKey(rightKey);
    if (!leftOrdinal || !rightOrdinal || leftOrdinal === rightOrdinal) {
      confidence = 90;
      reason = '正文标题语义一致，仅存在序号或写法差异';
    }
  }

  if (confidence < 80) return null;

  const canonicalKey = `custom:${sectionType}:${leftLoose}`;
  return {
    id: Buffer.from(`${sectionType}|${leftKey}|${rightKey}`).toString('base64url'),
    sectionType,
    leftKey,
    rightKey,
    canonicalKey,
    leftTitle: leftSec?.title || sectionType,
    rightTitle: rightSec?.title || sectionType,
    leftContentLength: getSectionContentLength(leftSec),
    rightContentLength: getSectionContentLength(rightSec),
    confidence,
    reason,
  };
};

export function buildSectionAlignmentSuggestions(
  leftSections: any[] = [],
  rightSections: any[] = [],
  rules: SectionAlignmentRule[] = []
): SectionAlignmentSuggestion[] {
  const rows = alignComparisonSections(leftSections, rightSections, rules);
  const leftOnly = rows.filter((row: any) => row.oldSec && !row.newSec).map((row: any) => row.oldSec);
  const rightOnly = rows.filter((row: any) => !row.oldSec && row.newSec).map((row: any) => row.newSec);
  const suggestions: SectionAlignmentSuggestion[] = [];
  const seen = new Set<string>();

  leftOnly.forEach((leftSec: any) => {
    rightOnly.forEach((rightSec: any) => {
      const suggestion = buildAlignmentSuggestion(leftSec, rightSec);
      if (!suggestion) return;
      if (
        getComparisonSectionAlignmentKey(leftSec?.title, leftSec?.type, rules) ===
        getComparisonSectionAlignmentKey(rightSec?.title, rightSec?.type, rules)
      ) {
        return;
      }

      const pairKey = [suggestion.sectionType, suggestion.leftKey, suggestion.rightKey].join('|');
      if (seen.has(pairKey)) return;
      seen.add(pairKey);
      suggestions.push(suggestion);
    });
  });

  return suggestions.sort((left, right) => right.confidence - left.confidence);
}
