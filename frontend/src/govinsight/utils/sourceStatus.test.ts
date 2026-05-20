import { buildGovInsightSourceStatus } from './sourceStatus';

describe('buildGovInsightSourceStatus', () => {
  test('summarizes stored payload source and quality warnings', () => {
    const model = buildGovInsightSourceStatus(
      {
        materializeStatus: 'preview',
        dataQuality: {
          hasAnomaly: true,
          warnings: ['样本不足'],
        },
      },
      {
        payloadSource: 'stored',
        sourceJobId: 12,
        sourceReportVersionId: 34,
      }
    );

    expect(model.sourceLabel).toBe('已保存正式 payload');
    expect(model.materializeLabel).toBe('预览/辅助口径');
    expect(model.sourceJobLabel).toBe('任务 12');
    expect(model.sourceVersionLabel).toBe('版本 34');
    expect(model.dataQualitySummary).toContain('存在数据质量提示');
    expect(model.warnings).toEqual(['样本不足']);
  });

  test('falls back without inventing source job or report version', () => {
    const model = buildGovInsightSourceStatus(null, null);

    expect(model.sourceLabel).toBe('未返回来源类型');
    expect(model.materializeLabel).toBe('未返回物化状态');
    expect(model.sourceJobLabel).toBe('暂无来源任务');
    expect(model.sourceVersionLabel).toBe('暂无来源版本');
    expect(model.hasAnomaly).toBe(false);
  });
});
