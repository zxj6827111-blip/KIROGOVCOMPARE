import {
  SEGMENTED_ANNUAL_REPORT_TITLES,
  hasMeaningfulTable4Data,
  mergeSegmentedAnnualReportParse,
  normalizeAnnualReportOutputFromSource,
  normalizeTable2ParseResponse,
  normalizeTable3ParseResponse,
  normalizeTable4ParseResponse,
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

function stripLeadingTitleForTest(text: string | null, title: string): string | null {
  if (!text) return null;
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const stripped = text.replace(new RegExp(`^\\s*${escapedTitle}\\s*`, 'u'), '').trim();
  return stripped || text.trim();
}

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

  it('should split annual report text with markdown section headings', () => {
    const markdownReport = [
      '## \u4e00\u3001\u603b\u4f53\u60c5\u51b5',
      '\u603b\u4f53\u60c5\u51b5\u6b63\u6587',
      '## \u4e8c\u3001\u4e3b\u52a8\u516c\u5f00\u653f\u5e9c\u4fe1\u606f\u60c5\u51b5',
      SEGMENTED_ANNUAL_REPORT_TITLES.table2,
      '## \u4e09\u3001\u6536\u5230\u548c\u5904\u7406\u653f\u5e9c\u4fe1\u606f\u516c\u5f00\u7533\u8bf7\u60c5\u51b5',
      SEGMENTED_ANNUAL_REPORT_TITLES.table3,
      '## \u56db\u3001\u653f\u5e9c\u4fe1\u606f\u516c\u5f00\u884c\u653f\u590d\u8bae\u3001\u884c\u653f\u8bc9\u8bbc\u60c5\u51b5',
      '| 1 | 0 | 0 | 0 | 1 |',
      '## \u4e94\u3001\u5b58\u5728\u7684\u4e3b\u8981\u95ee\u9898\u53ca\u6539\u8fdb\u60c5\u51b5',
      '\u95ee\u9898\u4e0e\u6539\u8fdb\u6b63\u6587',
      '## \u516d\u3001\u5176\u4ed6\u9700\u8981\u62a5\u544a\u7684\u4e8b\u9879',
      '\u5176\u4ed6\u4e8b\u9879\u6b63\u6587',
    ].join('\n');

    const split = splitAnnualReportForSegmentedParse(markdownReport);

    expect(split.canUseSegmentedParse).toBe(true);
    expect(split.missingSections).toEqual([]);
    expect(split.table3Text).toContain(SEGMENTED_ANNUAL_REPORT_TITLES.table3);
  });

  it('should recover narrative sections when PDF extraction drops main body headings', () => {
    const extractedText = [
      '正文',
      '2025 年上海市黄浦区人民政府打浦桥街道政府信息',
      '公开工作年度报告',
      '2025 年，打浦桥街道认真贯彻落实《中华人民共和国政府',
      '信息公开条例》，持续推进政府信息公开工作提质增效。',
      '',
      '（一）主动公开',
      '围绕街道中心工作和公众关切，依法、及时、准确地公开政府信息。',
      '',
      '（二）依申请公开',
      '畅通申请渠道，规范办理流程。',
      '',
      '二、主动公开政府信息情况',
      '## 表二：主动公开政府信息情况',
      '| 信息内容 | 本年制发件数 | 本年废止件数 | 现行有效件数 |',
      '|---|---|---|---|',
      '| 规章 | 0 | 0 | 0 |',
      '| 行政规范性文件 | 0 | 0 | 0 |',
      '',
      '三、收到和处理政府信息公开申请情况',
      '## 表三：收到和处理政府信息公开申请情况',
      '| 一、本年新收政府信息公开申请数量 | 19 | 0 | 0 | 0 | 0 | 0 | 19 |',
      '',
      '四、政府信息公开行政复议、行政诉讼情况',
      '| 0 | 1 | 0 | 3 | 4 | 0 | 0 | 0 | 0 | 0 | 1 | 0 | 0 | 1 | 2 |',
      '',
      '1、公开形式的便捷性有待加强',
      '政策解读多以文字形式为主，运用图表、短视频等方式进行解读的能力需提升。',
      '',
      '2、公众参与的互动性有待深化',
      '政民互动渠道和反馈机制可以进一步丰富和完善。',
      '',
      '（二）改进情况',
      '针对政府信息公开工作目前存在的问题，以下是一些具体的改进措施。',
      '',
      '（一）贯彻落实政务公开年度工作要点情况',
      '一是夯实主动公开基础。围绕街道重点工作，动态调整并充实主动公开内容。',
      '',
      '（二）收取信息处理费情况',
      '本年度暂未开展信息处理费收取工作。',
    ].join('\n');

    const split = splitAnnualReportForSegmentedParse(extractedText);

    expect(split.canUseSegmentedParse).toBe(true);
    expect(split.missingSections).toEqual([]);
    expect(split.segments.overallSituation).toContain('2025 年，打浦桥街道');
    expect(split.segments.overallSituation).toContain('（一）主动公开');
    expect(split.segments.problemsAndImprovements).toContain('公开形式的便捷性有待加强');
    expect(split.segments.problemsAndImprovements).toContain('（二）改进情况');
    expect(split.segments.otherMatters).toContain('贯彻落实政务公开年度工作要点情况');
    expect(split.table4Text).not.toContain('公开形式的便捷性有待加强');
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

  it('should ignore markdown separator rows when recovering flattened table_4 data', () => {
    const parsed = tryParseFlattenedTable4('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');

    expect(parsed).toBeNull();
    expect(
      hasMeaningfulTable4Data({
        review: { maintain: '---', correct: null, other: null, unfinished: null, total: null },
        litigationDirect: { maintain: null, correct: null, other: null, unfinished: null, total: null },
        litigationPostReview: { maintain: null, correct: null, other: null, unfinished: null, total: null },
      })
    ).toBe(false);
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

    expect(resolved.overallSituation).toBe(
      stripLeadingTitleForTest(split.segments.overallSituation, SEGMENTED_ANNUAL_REPORT_TITLES.overallSituation)
    );
    expect(resolved.problemsAndImprovements).toBe(
      stripLeadingTitleForTest(
        split.segments.problemsAndImprovements,
        SEGMENTED_ANNUAL_REPORT_TITLES.problemsAndImprovements
      )
    );
    expect(resolved.otherMatters).toBe(
      stripLeadingTitleForTest(split.segments.otherMatters, SEGMENTED_ANNUAL_REPORT_TITLES.otherMatters)
    );
    expect(resolved.overallSituation).not.toMatch(/^一、总体情况/);
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

    expect(resolved.overallSituation).toBe(
      stripLeadingTitleForTest(split.segments.overallSituation, SEGMENTED_ANNUAL_REPORT_TITLES.overallSituation)
    );
    expect(resolved.problemsAndImprovements).toBe(
      stripLeadingTitleForTest(
        split.segments.problemsAndImprovements,
        SEGMENTED_ANNUAL_REPORT_TITLES.problemsAndImprovements
      )
    );
    expect(resolved.otherMatters).toBe(
      stripLeadingTitleForTest(split.segments.otherMatters, SEGMENTED_ANNUAL_REPORT_TITLES.otherMatters)
    );
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
    const split = splitAnnualReportForSegmentedParse(sampleReport);
    expect(normalized.output.sections[0].content).toBe(
      stripLeadingTitleForTest(split.segments.overallSituation, SEGMENTED_ANNUAL_REPORT_TITLES.overallSituation)
    );
    expect(normalized.output.sections[4].content).toBe(
      stripLeadingTitleForTest(
        split.segments.problemsAndImprovements,
        SEGMENTED_ANNUAL_REPORT_TITLES.problemsAndImprovements
      )
    );
    expect(normalized.output.sections[5].content).toBe(
      stripLeadingTitleForTest(split.segments.otherMatters, SEGMENTED_ANNUAL_REPORT_TITLES.otherMatters)
    );
    expect(normalized.output.sections[0].content).not.toMatch(/^一、总体情况/);
    expect(normalized.output.sections[4].content).not.toMatch(/^五、存在的主要问题及改进情况/);
    expect(normalized.output.sections[5].content).not.toMatch(/^六、其他需要报告的事项/);
  });

  it('should accept short other matters content after stripping the section title', () => {
    const shortOtherMattersReport = [
      '\u4e00\u3001\u603b\u4f53\u60c5\u51b5',
      '\u603b\u4f53\u60c5\u51b5\u6b63\u6587',
      '',
      '\u4e8c\u3001\u4e3b\u52a8\u516c\u5f00\u653f\u5e9c\u4fe1\u606f\u60c5\u51b5',
      SEGMENTED_ANNUAL_REPORT_TITLES.table2,
      '| \u4fe1\u606f\u5185\u5bb9 | \u672c\u5e74\u5236\u53d1\u4ef6\u6570 | \u672c\u5e74\u5e9f\u6b62\u4ef6\u6570 | \u73b0\u884c\u6709\u6548\u4ef6\u6570 |',
      '|---|---|---|---|',
      '| \u89c4\u7ae0 | 0 | 0 | 0 |',
      '',
      '\u4e09\u3001\u6536\u5230\u548c\u5904\u7406\u653f\u5e9c\u4fe1\u606f\u516c\u5f00\u7533\u8bf7\u60c5\u51b5',
      SEGMENTED_ANNUAL_REPORT_TITLES.table3,
      '| \u603b\u8ba1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |',
      '',
      '\u56db\u3001\u653f\u5e9c\u4fe1\u606f\u516c\u5f00\u884c\u653f\u590d\u8bae\u3001\u884c\u653f\u8bc9\u8bbc\u60c5\u51b5',
      SEGMENTED_ANNUAL_REPORT_TITLES.table4,
      '| 0 | 0 | 0 | 0 | 0 |',
      '',
      '\u4e94\u3001\u5b58\u5728\u7684\u4e3b\u8981\u95ee\u9898\u53ca\u6539\u8fdb\u60c5\u51b5',
      '\u95ee\u9898\u4e0e\u6539\u8fdb\u6b63\u6587',
      '',
      '\u516d\u3001\u5176\u4ed6\u9700\u8981\u62a5\u544a\u7684\u4e8b\u9879',
      '\u65e0\u6536\u53d6\u4fe1\u606f\u5904\u7406\u8d39\u60c5\u51b5\u3002',
    ].join('\n');
    const rawOutput = {
      sections: [
        { title: SEGMENTED_ANNUAL_REPORT_TITLES.overallSituation, type: 'text', content: null },
        { title: SEGMENTED_ANNUAL_REPORT_TITLES.activeDisclosure, type: 'table_2', activeDisclosureData: {} },
        { title: SEGMENTED_ANNUAL_REPORT_TITLES.applicationRequests, type: 'table_3', tableData: {} },
        { title: SEGMENTED_ANNUAL_REPORT_TITLES.reviewLitigation, type: 'table_4', reviewLitigationData: {} },
        { title: SEGMENTED_ANNUAL_REPORT_TITLES.problemsAndImprovements, type: 'text', content: null },
        { title: SEGMENTED_ANNUAL_REPORT_TITLES.otherMatters, type: 'text', content: null },
      ],
    };

    const normalized = normalizeAnnualReportOutputFromSource(rawOutput, shortOtherMattersReport);

    expect(normalized.applied).toBe(true);
    expect(normalized.validationIssues).toEqual([]);
    expect(normalized.output.sections[5].content).toBe('\u65e0\u6536\u53d6\u4fe1\u606f\u5904\u7406\u8d39\u60c5\u51b5\u3002');
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

  it('should normalize OpenAI-compatible provider table aliases into canonical keys', () => {
    const table2 = normalizeTable2ParseResponse({
      regulations: { created: 1, abolished: 2, effective: 3 },
      normativeDocuments: { created: 4, abolished: 5, effective: 6 },
      licensing: { processed: 7 },
      punishment: { processed: 8 },
      coercion: { processed: 9 },
      fees: { amount: 10 },
    });
    const table3 = normalizeTable3ParseResponse({
      total: { newReceived: 11 },
    });
    const table4 = normalizeTable4ParseResponse({
      table_4: {
        review: { resultMaintained: 12, resultCorrected: 13, otherResults: 14, pending: 15, total: 16 },
        litigationDirect: { '\u7ef4\u6301': 17, '\u7ea0\u6b63': 18, '\u5176\u4ed6': 19, '\u672a\u5ba1\u7ed3': 20, '\u603b\u8ba1': 21 },
        litigationPostReview: { maintain: 22, correct: 23, other: 24, unfinished: 25, total: 26 },
      },
    });

    expect(table2.activeDisclosureData?.regulations).toEqual({ made: 1, repealed: 2, valid: 3 });
    expect(table2.activeDisclosureData?.normativeDocuments).toEqual({ made: 4, repealed: 5, valid: 6 });
    expect(table3.tableData?.total).toEqual({ newReceived: 11 });
    expect(table4.reviewLitigationData?.review).toEqual({
      maintain: 12,
      correct: 13,
      other: 14,
      unfinished: 15,
      total: 16,
    });
    expect(table4.reviewLitigationData?.litigationDirect).toEqual({
      maintain: 17,
      correct: 18,
      other: 19,
      unfinished: 20,
      total: 21,
    });
  });

  it('should normalize Chinese table_4 block labels', () => {
    const table4 = normalizeTable4ParseResponse({
      '\u884c\u653f\u590d\u8bae': { '\u7ed3\u679c\u7ef4\u6301': 1, '\u7ed3\u679c\u7ea0\u6b63': 2, '\u5176\u4ed6\u7ed3\u679c': 3, '\u5c1a\u672a\u5ba1\u7ed3': 4, '\u603b\u8ba1': 5 },
      '\u672a\u7ecf\u590d\u8bae\u76f4\u63a5\u8d77\u8bc9': { '\u7ed3\u679c\u7ef4\u6301': 6, '\u7ed3\u679c\u7ea0\u6b63': 7, '\u5176\u4ed6\u7ed3\u679c': 8, '\u5c1a\u672a\u5ba1\u7ed3': 9, '\u603b\u8ba1': 10 },
      '\u590d\u8bae\u540e\u8d77\u8bc9': { '\u7ed3\u679c\u7ef4\u6301': 11, '\u7ed3\u679c\u7ea0\u6b63': 12, '\u5176\u4ed6\u7ed3\u679c': 13, '\u5c1a\u672a\u5ba1\u7ed3': 14, '\u603b\u8ba1': 15 },
    });

    expect(table4.reviewLitigationData?.review).toEqual({
      maintain: 1,
      correct: 2,
      other: 3,
      unfinished: 4,
      total: 5,
    });
    expect(table4.reviewLitigationData?.litigationDirect?.total).toBe(10);
    expect(table4.reviewLitigationData?.litigationPostReview?.total).toBe(15);
  });

  it('should treat Shanghai-style applications heading as table_3 not table_4', () => {
    const shanghaiStyle = [
      '一、总体情况',
      '总体叙述。',
      '二、工作机制保障',
      '机制叙述。',
      '三、主动公开工作情况',
      '主动公开叙述。',
      '四、政府信息公开申请情况',
      '全年收到政府信息公开申请 34 件。',
      '五、政府信息管理',
      '管理叙述。',
      '三、政府信息公开行政复议、行政诉讼情况',
      '行政复议行政诉讼',
      '| 维持 | 纠正 | 结果 | 审结 | 结果 | 结果 | 其他 | 尚未 | 结果 | 结果 | 其他 | 尚未 |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|',
      '| 1 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |',
      '五、存在的主要问题及改进情况',
      '问题叙述。',
    ].join('\n');

    const split = splitAnnualReportForSegmentedParse(shanghaiStyle);
    expect(split.table3Text).toContain('申请情况');
    expect(split.table3Text).toContain('34');
    expect(split.table4Text).toContain('复议');
    expect(split.table4Text).not.toContain('34 件');
    expect(split.canUseSegmentedParse).toBe(true);
  });

});
