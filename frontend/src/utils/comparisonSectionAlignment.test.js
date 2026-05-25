import {
  alignComparisonSections,
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

  test('ignores parenthetical title annotations when aligning sections', () => {
    expect(normalizeComparisonSectionTitle('三、收到和处理政府信息公开申请情况（数据准确、要素齐全）', 'table_3')).toBe(
      normalizeComparisonSectionTitle('三、收到和处理政府信息公开申请情况', 'table_3')
    );
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
