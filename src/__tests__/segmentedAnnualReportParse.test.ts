import {
  SEGMENTED_ANNUAL_REPORT_TITLES,
  hasMeaningfulTable4Data,
  mergeSegmentedAnnualReportParse,
  normalizeAnnualReportOutputFromSource,
  resolveSegmentedBodyParseResponse,
  splitAnnualReportForSegmentedParse,
  tryParseFlattenedTable4,
} from '../services/SegmentedAnnualReportParse';

const sampleReport = [
  '正文',
  '宿迁市 2025 年政府信息公开工作年度报告',
  '',
  '一、总体情况',
  '2025 年，我市持续推进政务公开工作。',
  '',
  '二、主动公开政府信息情况',
  '## 表二：主动公开政府信息情况',
  '| 信息内容 | 本年制发件数 | 本年废止件数 | 现行有效件数 |',
  '|---|---|---|---|',
  '| 规章 | 3 | 0 | 15 |',
  '| 行政规范性文件 | 61 | 59 | 422 |',
  '',
  '三、收到和处理政府信息公开申请情况',
  '## 表三：收到和处理政府信息公开申请情况',
  '| 一、本年新收政府信息公开申请数量 | 3746 | 63 | 0 | 0 | 19 | 2 | 3830 |',
  '',
  '四、政府信息公开行政复议、行政诉讼情况',
  '行政复议行政诉讼',
  '| 119 | 25 | 91 | 24 | 259 | 7 | 0 | 15 | 6 | 28 | 21 | 1 | 7 | 9 | 38 |',
  '',
  '五、存在的主要问题及改进情况',
  '一是政务公开数智化转型有待进一步加强。',
  '',
  '六、其他需要报告的事项',
  '2025 年有 1 件政府信息公开申请案件收取信息处理费 380 元。',
].join('\n');

describe('SegmentedAnnualReportParse', () => {
  it('should split annual report text into body/table segments', () => {
    const split = splitAnnualReportForSegmentedParse(sampleReport);

    expect(split.canUseSegmentedParse).toBe(true);
    expect(split.missingSections).toEqual([]);
    expect(split.bodyText).toContain(SEGMENTED_ANNUAL_REPORT_TITLES.overallSituation);
    expect(split.bodyText).toContain(SEGMENTED_ANNUAL_REPORT_TITLES.problemsAndImprovements);
    expect(split.bodyText).toContain(SEGMENTED_ANNUAL_REPORT_TITLES.otherMatters);
    expect(split.table2Text).toContain(SEGMENTED_ANNUAL_REPORT_TITLES.table2);
    expect(split.table3Text).toContain(SEGMENTED_ANNUAL_REPORT_TITLES.table3);
    expect(split.table4Text).toContain('| 119 | 25 | 91 | 24 | 259 |');
  });

  it('should deterministically recover flattened table_4 data', () => {
    const split = splitAnnualReportForSegmentedParse(sampleReport);
    const parsed = tryParseFlattenedTable4(split.table4Text);

    expect(parsed).toBeTruthy();
    expect(hasMeaningfulTable4Data(parsed)).toBe(true);
    expect(parsed?.review).toEqual({
      maintain: 119,
      correct: 25,
      other: 91,
      unfinished: 24,
      total: 259,
    });
    expect(parsed?.litigationDirect).toEqual({
      maintain: 7,
      correct: 0,
      other: 15,
      unfinished: 6,
      total: 28,
    });
    expect(parsed?.litigationPostReview).toEqual({
      maintain: 21,
      correct: 1,
      other: 7,
      unfinished: 9,
      total: 38,
    });
  });

  it('should backfill missing body sections from the source split', () => {
    const split = splitAnnualReportForSegmentedParse(sampleReport);
    const resolved = resolveSegmentedBodyParseResponse(
      {
        overallSituation: null,
        problemsAndImprovements: null,
        otherMatters: null,
      },
      split
    );

    expect(resolved.overallSituation).toBe(split.segments.overallSituation);
    expect(resolved.problemsAndImprovements).toBe(split.segments.problemsAndImprovements);
    expect(resolved.otherMatters).toBe(split.segments.otherMatters);
  });

  it('should prefer source body text over rewritten model text', () => {
    const split = splitAnnualReportForSegmentedParse(sampleReport);
    const resolved = resolveSegmentedBodyParseResponse(
      {
        overallSituation: '模型改写的一、总体情况',
        problemsAndImprovements: '模型改写的五、存在的主要问题及改进情况',
        otherMatters: '模型改写的六、其他需要报告的事项',
      },
      split
    );

    expect(resolved.overallSituation).toBe(split.segments.overallSituation);
    expect(resolved.problemsAndImprovements).toBe(split.segments.problemsAndImprovements);
    expect(resolved.otherMatters).toBe(split.segments.otherMatters);
  });

  it('should canonicalize annual report output and replace text sections from source', () => {
    const rawOutput = {
      sections: [
        { title: '一、总体情况', type: 'text', content: null },
        { title: '三、收到和处理政府信息公开申请情况', type: 'table_3', tableData: { total: { newReceived: 3830 } } },
        { title: '二、主动公开政府信息情况', type: 'table_2', activeDisclosureData: { regulations: { made: 3 } } },
        { title: '六、其他需要报告的事项', type: 'text', content: null },
        {
          title: '四、政府信息公开行政复议、行政诉讼情况',
          type: 'table_4',
          reviewLitigationData: {
            review: { maintain: 119, correct: 25, other: 91, unfinished: 24, total: 259 },
            litigationDirect: { maintain: 7, correct: 0, other: 15, unfinished: 6, total: 28 },
            litigationPostReview: { maintain: 21, correct: 1, other: 7, unfinished: 9, total: 38 },
          },
        },
        { title: '五、存在的主要问题及改进情况', type: 'text', content: null },
      ],
    };

    const normalized = normalizeAnnualReportOutputFromSource(rawOutput, sampleReport);

    expect(normalized.applied).toBe(true);
    expect(normalized.validationIssues).toEqual([]);
    expect(normalized.output.sections.map((section: any) => section.type)).toEqual([
      'text',
      'table_2',
      'table_3',
      'table_4',
      'text',
      'text',
    ]);
    expect(normalized.output.sections[0].content).toBe(splitAnnualReportForSegmentedParse(sampleReport).segments.overallSituation);
    expect(normalized.output.sections[4].content).toBe(splitAnnualReportForSegmentedParse(sampleReport).segments.problemsAndImprovements);
    expect(normalized.output.sections[5].content).toBe(splitAnnualReportForSegmentedParse(sampleReport).segments.otherMatters);
  });

  it('should merge segmented results back into canonical sections order', () => {
    const merged = mergeSegmentedAnnualReportParse({
      body: {
        overallSituation: '总体情况正文',
        problemsAndImprovements: '问题与改进正文',
        otherMatters: '其他事项正文',
      },
      table2: {
        activeDisclosureData: {
          regulations: { made: 3, repealed: 0, valid: 15 },
        },
      },
      table3: {
        tableData: {
          total: { newReceived: 3830 },
        },
      },
      table4: {
        reviewLitigationData: {
          review: { maintain: 119, correct: 25, other: 91, unfinished: 24, total: 259 },
          litigationDirect: { maintain: 7, correct: 0, other: 15, unfinished: 6, total: 28 },
          litigationPostReview: { maintain: 21, correct: 1, other: 7, unfinished: 9, total: 38 },
        },
      },
    });

    expect(merged.sections.map((section) => section.type)).toEqual([
      'text',
      'table_2',
      'table_3',
      'table_4',
      'text',
      'text',
    ]);
    expect(merged.sections[0].title).toBe(SEGMENTED_ANNUAL_REPORT_TITLES.overallSituation);
    expect(merged.sections[3].title).toBe(SEGMENTED_ANNUAL_REPORT_TITLES.reviewLitigation);
  });
});
