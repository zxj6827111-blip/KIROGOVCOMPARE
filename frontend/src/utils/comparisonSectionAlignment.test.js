import {
  alignComparisonSections,
  getComparisonSectionTitleIssue,
  normalizeComparisonSectionTitle,
} from './comparisonSectionAlignment';

describe('comparison section alignment', () => {
  test('normalizes fifth-section title variants that use 及 or 和', () => {
    expect(normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('五、存在的主要问题和改进情况', 'text')
    );
  });

  test('aligns fifth-section variants into one row', () => {
    const rows = alignComparisonSections(
      [{ type: 'text', title: '五、存在的主要问题及改进情况', content: '旧正文' }],
      [{ type: 'text', title: '五、存在的主要问题和改进情况', content: '新正文' }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      title: '五、存在的主要问题及改进情况',
      oldSec: expect.objectContaining({ content: '旧正文' }),
      newSec: expect.objectContaining({ content: '新正文' }),
    }));
  });

  test('normalizes overall-summary title aliases', () => {
    expect(normalizeComparisonSectionTitle('一、总体情况', 'text')).toBe(
      normalizeComparisonSectionTitle('一、总体工作情况', 'text')
    );
    expect(normalizeComparisonSectionTitle('一、总体情况', 'text')).toBe(
      normalizeComparisonSectionTitle('总体情况', 'text')
    );
    expect(normalizeComparisonSectionTitle('一、总体情况', 'text')).toBe(
      normalizeComparisonSectionTitle('政府信息公开工作总体情况', 'text')
    );
    expect(normalizeComparisonSectionTitle('一、总体情况', 'text')).toBe(
      normalizeComparisonSectionTitle('一、2025年政务公开工作总体情况', 'text')
    );
  });

  test('aligns overall-summary aliases into one row', () => {
    const rows = alignComparisonSections(
      [{ type: 'text', title: '一、总体情况', content: '2024 总体情况' }],
      [{ type: 'text', title: '一、总体工作情况', content: '2025 总体工作情况' }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      oldSec: expect.objectContaining({ content: '2024 总体情况' }),
      newSec: expect.objectContaining({ content: '2025 总体工作情况' }),
    }));
  });

  test('aligns unnumbered overall-summary sections with numbered first sections', () => {
    const rows = alignComparisonSections(
      [{ type: 'text', title: '总体情况', content: '无序号总体情况' }],
      [{ type: 'text', title: '一、总体情况', content: '有序号总体情况' }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      oldSec: expect.objectContaining({ content: '无序号总体情况' }),
      newSec: expect.objectContaining({ content: '有序号总体情况' }),
    }));
  });

  test('ignores parenthetical title annotations when aligning sections', () => {
    expect(normalizeComparisonSectionTitle('三、收到和处理政府信息公开申请情况（数据准确、要素齐全）', 'table_3')).toBe(
      normalizeComparisonSectionTitle('三、收到和处理政府信息公开申请情况', 'table_3')
    );
  });

  test('normalizes fifth-section report-work title variants', () => {
    expect(normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('五、政府信息公开工作存在的主要问题及改进情况', 'text')
    );
    expect(normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('六、存在的问题及改进情况', 'text')
    );
    expect(normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('五、存在问题与改进方向', 'text')
    );
    expect(normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('五、存在的主要问题及改进思路', 'text')
    );
    expect(normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('五、存在主要问题及改进情况', 'text')
    );
    expect(normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('五、信息公开工作存在的主要问题及改进措施', 'text')
    );
    expect(normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('五、政务信息工作存在主要问题和改进情况', 'text')
    );
  });

  test('normalizes dirty and misnumbered standard text section titles by semantic body', () => {
    expect(normalizeComparisonSectionTitle('|六、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')
    );
    expect(normalizeComparisonSectionTitle('l六、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')
    );
    expect(normalizeComparisonSectionTitle('七、其他需要报告的事项', 'text')).toBe(
      normalizeComparisonSectionTitle('六、其他需要报告的事项', 'text')
    );
  });

  test('reports dirty and misnumbered standard text section titles', () => {
    expect(getComparisonSectionTitleIssue('|六、存在的主要问题及改进情况', 'text')).toEqual(expect.objectContaining({
      title: '|六、存在的主要问题及改进情况',
      normalizedTitle: '五、存在的主要问题及改进情况',
      expectedOrdinal: '五',
      actualOrdinal: '六',
    }));
    expect(getComparisonSectionTitleIssue('l六、存在的主要问题及改进情况', 'text')).toEqual(expect.objectContaining({
      title: 'l六、存在的主要问题及改进情况',
      normalizedTitle: '五、存在的主要问题及改进情况',
      expectedOrdinal: '五',
      actualOrdinal: '六',
    }));
    expect(getComparisonSectionTitleIssue('七、其他需要报告的事项', 'text')).toEqual(expect.objectContaining({
      title: '七、其他需要报告的事项',
      normalizedTitle: '六、其他需要报告的事项',
      expectedOrdinal: '六',
      actualOrdinal: '七',
    }));
    expect(getComparisonSectionTitleIssue('五、存在的主要问题和改进情况', 'text')).toBeNull();
  });

  test('normalizes table title prefixes by table type', () => {
    expect(normalizeComparisonSectionTitle('二、主动公开政府信息情况', 'table_2')).toBe(
      normalizeComparisonSectionTitle('二、行政机关主动公开政府信息情况', 'table_2')
    );
    expect(normalizeComparisonSectionTitle('二、主动公开政府信息情况', 'table_2')).toBe(
      normalizeComparisonSectionTitle('二、本年度主动公开政府信息情况', 'table_2')
    );
    expect(normalizeComparisonSectionTitle('二、主动公开政府信息情况', 'table_2')).toBe(
      normalizeComparisonSectionTitle('二、主动公开政务信息情况', 'table_2')
    );
    expect(normalizeComparisonSectionTitle('二、主动公开政府信息情况', 'table_2')).toBe(
      normalizeComparisonSectionTitle('二、主动公开政府信息的情况', 'table_2')
    );
    expect(normalizeComparisonSectionTitle('三、收到和处理政府信息公开申请情况', 'table_3')).toBe(
      normalizeComparisonSectionTitle('三、行政机关收到和处理信息公开申请情况', 'table_3')
    );
    expect(normalizeComparisonSectionTitle('三、收到和处理政府信息公开申请情况', 'table_3')).toBe(
      normalizeComparisonSectionTitle('三、收到和处理政府信息公开申请情况统计表', 'table_3')
    );
    expect(normalizeComparisonSectionTitle('四、政府信息公开行政复议、行政诉讼情况', 'table_4')).toBe(
      normalizeComparisonSectionTitle('四、因政府信息公开工作被行政复议、提起行政诉讼情况', 'table_4')
    );
    expect(normalizeComparisonSectionTitle('四、政府信息公开行政复议、行政诉讼情况', 'table_4')).toBe(
      normalizeComparisonSectionTitle('四、政府信息公开工作行政复议、行政诉讼情况', 'table_4')
    );
    expect(normalizeComparisonSectionTitle('四、政府信息公开行政复议、行政诉讼情况', 'table_4')).toBe(
      normalizeComparisonSectionTitle('四、被申请行政复议、提起行政诉讼情况', 'table_4')
    );
  });

  test('aligns unnumbered other-report sections with numbered sixth sections', () => {
    const rows = alignComparisonSections(
      [{ type: 'text', title: '其他需要报告的事项', content: '无序号事项' }],
      [{ type: 'text', title: '六、其他需要报告的事项', content: '有序号事项' }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      oldSec: expect.objectContaining({ content: '无序号事项' }),
      newSec: expect.objectContaining({ content: '有序号事项' }),
    }));
  });

  test('aligns misnumbered standard sections by semantic body', () => {
    const rows = alignComparisonSections(
      [{ type: 'text', title: '五、存在的主要问题及改进情况', content: '第五章' }],
      [{ type: 'text', title: '七、存在的主要问题及改进情况', content: '第七章' }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      title: '五、存在的主要问题及改进情况',
      oldSec: expect.objectContaining({ content: '第五章' }),
      newSec: expect.objectContaining({ content: '第七章' }),
    }));
  });

  test('does not align nonstandard same-title-body sections when both sides use different ordinals', () => {
    const rows = alignComparisonSections(
      [{ type: 'text', title: '五、专项整改情况', content: '第五章' }],
      [{ type: 'text', title: '七、专项整改情况', content: '第七章' }]
    );

    expect(rows).toHaveLength(2);
    expect(rows.some((row) => row.oldSec && !row.newSec)).toBe(true);
    expect(rows.some((row) => !row.oldSec && row.newSec)).toBe(true);
  });

  test('applies saved alignment rules without changing base normalization', () => {
    const leftTitle = '七、专项整改落实情况';
    const rightTitle = '五、专项整改情况';
    const leftKey = normalizeComparisonSectionTitle(leftTitle, 'text');
    const rightKey = normalizeComparisonSectionTitle(rightTitle, 'text');
    expect(leftKey).not.toBe(rightKey);

    const rows = alignComparisonSections(
      [{ type: 'text', title: leftTitle, content: '旧专项整改' }],
      [{ type: 'text', title: rightTitle, content: '新专项整改' }],
      [{
        sectionType: 'text',
        leftKey,
        rightKey,
        canonicalKey: 'custom:text:专项整改',
      }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      oldSec: expect.objectContaining({ content: '旧专项整改' }),
      newSec: expect.objectContaining({ content: '新专项整改' }),
    }));
  });

  test('aligns structured tables by table type and title body when numbering differs', () => {
    const rows = alignComparisonSections(
      [{ type: 'table_3', title: '三、收到和处理政府信息公开申请情况（数据准确、要素齐全）', tableData: { old: true } }],
      [{ type: 'table_3', title: '收到和处理政府信息公开申请情况', tableData: { newer: true } }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      oldSec: expect.objectContaining({ tableData: { old: true } }),
      newSec: expect.objectContaining({ tableData: { newer: true } }),
    }));
  });

  test('expands embedded chapter headings before aligning split sections', () => {
    const rows = alignComparisonSections(
      [
        {
          type: 'text',
          title: '宿豫区卫生健康局2024年度政府信息公开工作年度报告',
          content: [
            '根据《中华人民共和国政府信息公开条例》，现编制本报告。',
            '一、总体情况',
            '2024年，宿豫区卫生健康局认真贯彻落实政府信息公开工作要求。',
            '二、主动公开政府信息情况',
            '2024年度主动公开政府信息情况如下。',
          ].join('\n'),
        },
      ],
      [
        {
          type: 'text',
          title: '一、总体情况',
          content: '2025年，我局坚持以公开为常态。',
        },
      ]
    );

    const summaryRow = rows.find((row) => row.title === '一、总体情况');
    expect(summaryRow).toEqual(expect.objectContaining({
      oldSec: expect.objectContaining({
        content: expect.stringContaining('2024年，宿豫区卫生健康局认真贯彻落实政府信息公开工作要求。'),
      }),
      newSec: expect.objectContaining({
        content: '2025年，我局坚持以公开为常态。',
      }),
    }));
  });
});
