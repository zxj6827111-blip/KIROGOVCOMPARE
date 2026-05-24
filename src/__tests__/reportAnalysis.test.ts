import { calculateReportMetrics } from '../utils/reportAnalysis';

describe('calculateReportMetrics', () => {
  test('returns text section metrics and simple average similarity', () => {
    const left = {
      sections: [
        { title: '标题', type: 'text', content: '年度报告标题' },
        { title: '一、总体情况', type: 'text', content: '主动公开政府信息公开申请' },
        { title: '五、存在的主要问题及改进情况', type: 'text', content: '监督保障整改落实' },
        { title: '六、其他需要报告的事项', type: 'text', content: '无其他事项' },
      ],
    };
    const right = {
      sections: [
        { title: '标题', type: 'text', content: '年度报告标题' },
        { title: '一、总体情况', type: 'text', content: '主动公开政府信息公开申请' },
        { title: '五、存在的主要问题及改进情况', type: 'text', content: '监督保障新增措施' },
        { title: '六、其他需要报告的事项', type: 'text', content: '完全不同' },
      ],
    };

    const metrics = calculateReportMetrics(left, right);
    const expectedAverage = Math.round(
      metrics.textSectionMetrics.reduce((total, item) => total + item.similarity, 0) /
        metrics.textSectionMetrics.length
    );

    expect(metrics.method).toBe('simple_average_text_sections');
    expect(metrics.textSectionMetrics).toHaveLength(3);
    expect(metrics.textSectionMetrics.map((item) => item.title)).toEqual([
      '一、总体情况',
      '五、存在的主要问题及改进情况',
      '六、其他需要报告的事项',
    ]);
    expect(metrics.similarity).toBe(expectedAverage);
    expect(metrics.textSectionMetrics[0]).toEqual(
      expect.objectContaining({
        title: '一、总体情况',
        similarity: 100,
      })
    );
  });
});
