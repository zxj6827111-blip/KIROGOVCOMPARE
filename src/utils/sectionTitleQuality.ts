import { getComparisonSectionTitleIssue, SectionTitleIssue } from './sectionAlignment';

const buildSectionPath = (index: number, field = 'title'): string => `sections[${index}].${field}`;

type SectionTitleQualityItem = {
  groupKey: 'quality';
  checkKey: string;
  fingerprint: string;
  title: string;
  expr: string;
  leftValue: number | null;
  rightValue: number | null;
  delta: number | null;
  tolerance: number;
  autoStatus: 'FAIL';
  evidenceJson: {
    paths: string[];
    values: Record<string, any>;
  };
};

export const collectReportSectionTitleIssues = (sections: any[] = []): Array<SectionTitleIssue & { sectionIndex: number; path: string }> => {
  const seen = new Set<string>();
  const issues: Array<SectionTitleIssue & { sectionIndex: number; path: string }> = [];

  sections.forEach((section, index) => {
    const issue = getComparisonSectionTitleIssue(section?.title, section?.type || 'text');
    if (!issue) return;
    const key = `${index}:${issue.title}->${issue.normalizedTitle}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({
      ...issue,
      sectionIndex: index,
      path: buildSectionPath(index),
    });
  });

  return issues;
};

export const buildSectionTitleQualityItems = (
  sections: any[] = [],
  generateFingerprint: (groupKey: string, checkKey: string, expr: string) => string
): SectionTitleQualityItem[] =>
  collectReportSectionTitleIssues(sections).map((issue) => {
    const checkKey = 'section_title_misnumbered';
    const expr = `${issue.title}->${issue.normalizedTitle}`;

    return {
      groupKey: 'quality',
      checkKey,
      fingerprint: generateFingerprint('quality', checkKey, expr),
      title: `章节标题疑似有误：“${issue.title}”应按“${issue.normalizedTitle}”理解`,
      expr: 'section_title_matches_standard_annual_report_order',
      leftValue: null,
      rightValue: null,
      delta: null,
      tolerance: 0,
      autoStatus: 'FAIL',
      evidenceJson: {
        paths: [issue.path],
        values: {
          title: issue.title,
          normalizedTitle: issue.normalizedTitle,
          expectedOrdinal: issue.expectedOrdinal,
          actualOrdinal: issue.actualOrdinal,
          reason: issue.reason,
          sectionIndex: issue.sectionIndex,
          action: 'report_issue_and_use_standard_title_for_comparison',
        },
      },
    };
  });
