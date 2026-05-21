import {
  buildIssueMarkers,
  classifyIssueTypeFallback,
  normalizeIssueGroups,
  normalizeIssueItem,
} from './issueViewModelAdapter';

describe('issueViewModelAdapter', () => {
  test('normalizes table3 identity issue into IssueViewModel', () => {
    const issue = normalizeIssueItem({
      id: 101,
      group_key: 'table3',
      check_key: 't3_identity_naturalPerson',
      issueType: 'consistency_table3_identity',
      title: '表三：收办平衡异常',
      expr: 'a+b=c+d',
      auto_status: 'FAIL',
      human_status: 'pending',
      displayNo: 3,
      evidence: {
        leftPaths: ['tableData.naturalPerson.newReceived'],
        rightPaths: ['tableData.naturalPerson.results.totalProcessed'],
      },
    });

    expect(issue.source).toBe('checks');
    expect(issue.tableId).toBe('table_3');
    expect(issue.shortTitle).toBe('收办平衡');
    expect(issue.markers.map((marker) => marker.path)).toEqual([
      'tableData.naturalPerson.newReceived',
      'tableData.naturalPerson.results.totalProcessed',
    ]);
    expect(issue.markers.every((marker) => marker.tone === 'identity')).toBe(true);
  });

  test('keeps table3 column_sum priority ahead of result_total', () => {
    const issue = normalizeIssueItem({
      group_key: 'table3',
      check_key: 't3_result_total_column_sum_total',
      title: '各列求和=总计（办理结果总计）',
      auto_status: 'FAIL',
    });

    expect(issue.issueType).toBe('consistency_table3_column_sum');
  });

  test('normalizes table2 low-risk FAIL with fieldPath marker and locate ability', () => {
    const issue = normalizeIssueItem({
      group_key: 'table2',
      check_key: 't2_non_negative_counts_regulations_valid',
      issueType: 'consistency_table2',
      auto_status: 'FAIL',
      evidence: {
        values: {
          fieldPath: 'activeDisclosureData.regulations.valid',
          cell_ref: 'active_disclosure:regulations:valid',
        },
      },
    });

    expect(issue.tableId).toBe('table_2');
    expect(issue.fieldPath).toBe('activeDisclosureData.regulations.valid');
    expect(issue.markers[0]).toMatchObject({
      path: 'activeDisclosureData.regulations.valid',
      role: 'primary',
    });
    expect(issue.actions.canLocate).toBe(true);
    expect(issue.severity).toBe('error');
  });

  test('normalizes t2_no_rules as unsupported_not_assessable without forced displayNo', () => {
    const issue = normalizeIssueItem({
      group_key: 'table2',
      check_key: 't2_no_rules',
      auto_status: 'NOT_ASSESSABLE',
      evidence: { paths: ['sections[type=table_2]'] },
    });

    expect(issue.issueType).toBe('unsupported_not_assessable');
    expect(issue.severity).toBe('neutral');
    expect(issue.displayNo).toBeNull();
    expect(issue.actions.canConfirm).toBe(false);
    expect(issue.actions.canDismiss).toBe(false);
  });

  test('normalizes table4 row sum markers and tone', () => {
    const issue = normalizeIssueItem({
      group_key: 'table4',
      check_key: 't4_sum_review',
      issueType: 'consistency_table4_row_sum',
      auto_status: 'FAIL',
      evidence: {
        paths: ['reviewLitigationData.review.total'],
      },
    });

    expect(issue.tableId).toBe('table_4');
    expect(issue.markers[0].tone).toBe('table4');
    expect(issue.markers[0].path).toBe('reviewLitigationData.review.total');
  });

  test('normalizes hierarchy aggregation issue as a consistency problem', () => {
    const issue = normalizeIssueItem({
      group_key: 'hierarchy',
      check_key: 'hierarchy_sum_application__total__new_received',
      auto_status: 'FAIL',
      human_status: 'pending',
      displayNo: 1,
      evidence: {
        leftPaths: ['hierarchy.parent.10.application__total__new_received'],
        rightPaths: ['hierarchy.child.11.application__total__new_received'],
      },
    });

    expect(issue.issueType).toBe('consistency_hierarchy_sum');
    expect(issue.tableId).toBe('hierarchy');
    expect(issue.shortTitle).toBe('层级汇总');
    expect(issue.markers.every((marker) => marker.tone === 'hierarchy')).toBe(true);
    expect(issue.severity).toBe('error');
  });

  test('normalizes quality issue with quality tone and warning severity', () => {
    const issue = normalizeIssueItem({
      group_key: 'quality',
      check_key: 'table_empty_cells',
      issueType: 'quality_empty',
      auto_status: 'UNCERTAIN',
      evidence: {
        paths: ['sections[5].content'],
      },
    });

    expect(issue.source).toBe('checks');
    expect(issue.markers[0].tone).toBe('quality');
    expect(issue.severity).toBe('warning');
  });

  test('supports external source tone, priority and marker shell overrides', () => {
    const issue = normalizeIssueItem(
      {
        group_key: 'quality',
        check_key: 'visual_table3_empty_cells',
        title: 'visual empty',
        auto_status: 'UNCERTAIN',
        evidence: { paths: ['tableData.total.total'] },
      },
      {
        source: 'quality',
        tone: 'quality',
        issueId: 'quality:1',
        displayNo: null,
        severity: 'warning',
        markers: [
          {
            path: 'tableData.total.total',
            role: 'primary',
            issueType: 'quality_empty',
            source: 'quality',
            tone: 'quality',
            lineStyle: 'solid',
            displayNo: null,
            priority: 50,
            issueId: 'quality:1',
          },
        ],
      }
    );

    expect(issue.source).toBe('quality');
    expect(issue.tone).toBe('quality');
    expect(issue.issueId).toBe('quality:1');
    expect(issue.displayNo).toBeNull();
    expect(issue.markers[0]).toMatchObject({
      source: 'quality',
      tone: 'quality',
      priority: 50,
    });
  });

  test('defaults missing humanStatus to pending', () => {
    const issue = normalizeIssueItem({
      group_key: 'text',
      check_key: 'text_vs_table3_totalProcessed',
      auto_status: 'FAIL',
    });

    expect(issue.humanStatus).toBe('pending');
  });

  test('builds actions from autoStatus only as capability metadata', () => {
    expect(normalizeIssueItem({ group_key: 'text', check_key: 'a', auto_status: 'FAIL' }).actions).toMatchObject({
      canConfirm: true,
      canDismiss: true,
    });
    expect(normalizeIssueItem({ group_key: 'text', check_key: 'a', auto_status: 'UNCERTAIN' }).actions).toMatchObject({
      canConfirm: true,
      canDismiss: true,
    });
    expect(normalizeIssueItem({ group_key: 'text', check_key: 'a', auto_status: 'NOT_ASSESSABLE' }).actions).toMatchObject({
      canConfirm: false,
      canDismiss: false,
    });
    expect(normalizeIssueItem({ group_key: 'text', check_key: 'a', auto_status: 'PASS' }).actions).toMatchObject({
      canConfirm: false,
      canDismiss: false,
    });
  });

  test('builds markerIndexByPath without dropping order when multiple issues hit one path', () => {
    const normalized = normalizeIssueGroups([
      {
        group_key: 'table3',
        items: [
          {
            id: 1,
            check_key: 't3_identity_total',
            auto_status: 'FAIL',
            evidence: { paths: ['tableData.total.results.totalProcessed'] },
          },
          {
            id: 2,
            check_key: 't3_result_total_total',
            auto_status: 'FAIL',
            evidence: { paths: ['tableData.total.results.totalProcessed'] },
          },
        ],
      },
    ]);

    expect(normalized.markerIndexByPath['tableData.total.results.totalProcessed'].map((issue) => issue.issueId)).toEqual([
      'id:1',
      'id:2',
    ]);
  });

  test('fallback issueType classification works for old data without issueType', () => {
    expect(classifyIssueTypeFallback({
      group_key: 'table2',
      check_key: 't2_non_negative_counts_regulations_valid',
      auto_status: 'FAIL',
    })).toBe('consistency_table2');

    expect(classifyIssueTypeFallback({
      group_key: 'table4',
      check_key: 't4_sum_review',
      auto_status: 'FAIL',
    })).toBe('consistency_table4_row_sum');
  });

  test('buildIssueMarkers generates neutral/context markers for unsupported items', () => {
    const markers = buildIssueMarkers(
      {
        evidence: {
          paths: ['sections[type=table_2]'],
        },
      },
      'unsupported_not_assessable',
      null
    );

    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      path: 'sections[type=table_2]',
      role: 'context',
      tone: 'neutral',
      lineStyle: 'dashed',
    });
  });

  test('SHORT_TITLE_BY_TYPE values are proper Chinese strings without encoding corruption', () => {
    const expectedShortTitles = {
      consistency_table3_identity: '收办平衡',
      consistency_table3_result_total: '明细合计',
      consistency_table3_column_sum: '横向总计',
      consistency_table3_other: '表三其他',
      consistency_table4_row_sum: '行内合计',
      consistency_table2: '表二低风险规则',
      consistency_text: '正文一致性',
      unsupported_not_assessable: '暂无可评估规则',
      quality_empty: '空值风险',
      quality_format: '格式风险',
      quality_structure: '结构风险',
      quality_text_extraction: '文本抽取',
      quality_other: '数据质量',
      source_anomaly: '源表异常',
      ocr_review: 'OCR 复核',
      ocr_review_success: 'OCR 完成复核',
      ocr_correction: 'OCR 修正',
      table_split_hint: '疑似拆格提示',
      unknown: '未知问题',
    };

    for (const [issueType, expectedTitle] of Object.entries(expectedShortTitles)) {
      const issue = normalizeIssueItem({
        group_key: issueType.startsWith('consistency_table2') ? 'table2'
          : issueType.startsWith('consistency_table3') ? 'table3'
          : issueType.startsWith('consistency_table4') ? 'table4'
          : issueType.startsWith('consistency_text') ? 'text'
          : issueType.startsWith('quality_') ? 'quality'
          : 'visual',
        check_key: issueType,
        issueType,
        auto_status: 'FAIL',
      });
      expect(issue.shortTitle).toBe(expectedTitle);
    }
  });
});
