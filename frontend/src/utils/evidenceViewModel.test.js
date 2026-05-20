import {
  buildComparisonEvidenceSummary,
  buildEvidenceViewModel,
  shouldShowEvidenceViewModel,
} from './evidenceViewModel';

describe('evidenceViewModel', () => {
  test('maps missing table evidence to conservative review copy', () => {
    const model = buildEvidenceViewModel({
      auto_status: 'NOT_ASSESSABLE',
      check_key: 't3_missing',
      title: '表三缺失',
      evidence: {
        paths: ['sections[type=table_3].tableData'],
      },
    });

    expect(model.reasonLabel).toBe('缺少关键表格');
    expect(model.severity).toBe('low');
    expect(model.fieldPath).toBe('tableData');
    expect(model.summary).toContain('人工回看原 PDF');
  });

  test('keeps zero and empty value warning separate from deterministic failure', () => {
    const model = buildEvidenceViewModel({
      auto_status: 'UNCERTAIN',
      title: '空值占位需复核',
      evidence: {
        paths: ['activeDisclosureData.licensing.processed'],
        values: {
          originalValue: '',
          parsedValue: '',
          comparedValue: 0,
        },
      },
    });

    expect(model.reasonLabel).toBe('0 与空值需区分');
    expect(model.severity).toBe('medium');
    expect(model.originalValue).toBe('N/A');
    expect(model.comparedValue).toBe('0');
  });

  test('does not require detailed source refs and returns explicit fallback notice', () => {
    const model = buildEvidenceViewModel({
      auto_status: 'UNCERTAIN',
      title: '来源不足',
      evidence: { values: { reason: 'header' } },
    });

    expect(model.reasonLabel).toBe('表头识别不足');
    expect(model.hasDetailedSource).toBe(false);
    expect(model.fallbackNotice).toBe('暂无更详细来源，仅保留结构化字段路径');
  });

  test('only review statuses need evidence presentation', () => {
    expect(shouldShowEvidenceViewModel({ auto_status: 'FAIL' })).toBe(true);
    expect(shouldShowEvidenceViewModel({ auto_status: 'PASS' })).toBe(false);
  });

  test('builds comparison source explanation without page-level evidence claims', () => {
    const model = buildComparisonEvidenceSummary({
      sectionType: 'table_3',
      yearA: 2024,
      yearB: 2025,
    });

    expect(model.summary).toContain('表三差异来自两侧报告的已解析结构化结果');
    expect(model.fieldPath).toBe('暂无更详细来源，仅保留结构化字段路径');
  });
});
