import { buildComparisonFindingItems } from './comparisonFindings';

describe('comparison findings', () => {
  test('includes section title issues in finding items', () => {
    const items = buildComparisonFindingItems({
      summaryItems: [],
      textSectionMetrics: [],
      titleIssues: [
        {
          title: '|六、存在的主要问题及改进情况',
          normalizedTitle: '五、存在的主要问题及改进情况',
        },
        {
          title: '七、其他需要报告的事项',
          normalizedTitle: '六、其他需要报告的事项',
        },
      ],
    });

    expect(items).toEqual(expect.arrayContaining([
      '原报告章节标题疑似有误：“|六、存在的主要问题及改进情况”已按“五、存在的主要问题及改进情况”参与比对。',
      '原报告章节标题疑似有误：“七、其他需要报告的事项”已按“六、其他需要报告的事项”参与比对。',
    ]));
  });
});
