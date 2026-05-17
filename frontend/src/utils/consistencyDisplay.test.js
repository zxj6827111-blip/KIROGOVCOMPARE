import {
  buildQualityAuditGroups,
  buildTable3CategoryStats,
  normalizeConsistencyGroup,
  summarizeQualityAuditGroups,
  summarizeConsistencyGroups,
} from './consistencyDisplay';

const makeItem = ({
  checkKey = 't3_result_total_total',
  autoStatus = 'FAIL',
  humanStatus = 'pending',
  title = '表三：办理结果明细合计=办理结果总计（总计列）',
} = {}) => ({
  check_key: checkKey,
  auto_status: autoStatus,
  human_status: humanStatus,
  title,
});

const getBucket = (items, key = 'result_total') =>
  buildTable3CategoryStats(items).find((bucket) => bucket.key === key);

describe('buildTable3CategoryStats', () => {
  test('uses strict pending semantics for 其余待复核', () => {
    const bucket = getBucket([
      makeItem({ autoStatus: 'FAIL', humanStatus: 'pending' }),
      makeItem({ checkKey: 't3_result_total_pass_1', autoStatus: 'PASS', humanStatus: 'pending' }),
      makeItem({ checkKey: 't3_result_total_pass_2', autoStatus: 'PASS', humanStatus: 'confirmed' }),
      makeItem({ checkKey: 't3_result_total_na', autoStatus: 'NOT_ASSESSABLE', humanStatus: 'pending' }),
    ]);

    expect(bucket).toMatchObject({
      ruleCount: 3,
      problemCount: 1,
      pendingCount: 1,
    });
  });

  test('confirmed fail does not inflate pending remainder', () => {
    const bucket = getBucket([
      makeItem({ autoStatus: 'FAIL', humanStatus: 'confirmed' }),
      makeItem({ checkKey: 't3_result_total_pass', autoStatus: 'PASS', humanStatus: 'pending' }),
    ]);

    expect(bucket).toMatchObject({
      ruleCount: 2,
      problemCount: 1,
      pendingCount: 1,
    });
  });

  test('dismissed fail keeps rule/problem counts but not pending remainder', () => {
    const bucket = getBucket([
      makeItem({ autoStatus: 'FAIL', humanStatus: 'dismissed' }),
      makeItem({ checkKey: 't3_result_total_pass', autoStatus: 'PASS', humanStatus: 'pending' }),
    ]);

    expect(bucket).toMatchObject({
      ruleCount: 2,
      problemCount: 0,
      pendingCount: 1,
    });
  });

  test('reset back to pending restores the pending remainder', () => {
    const bucket = getBucket([
      makeItem({ autoStatus: 'FAIL', humanStatus: 'pending' }),
      makeItem({ checkKey: 't3_result_total_pass', autoStatus: 'PASS', humanStatus: 'pending' }),
    ]);

    expect(bucket).toMatchObject({
      ruleCount: 2,
      problemCount: 1,
      pendingCount: 1,
    });
  });

  test('dismissed fail is removed from group problemCount but keeps ruleCount', () => {
    const group = normalizeConsistencyGroup({
      group_key: 'table3',
      items: [
        makeItem({ autoStatus: 'FAIL', humanStatus: 'dismissed' }),
        makeItem({ checkKey: 't3_result_total_pass', autoStatus: 'PASS', humanStatus: 'pending' }),
      ],
    });

    expect(group.stats).toMatchObject({
      ruleCount: 2,
      problemCount: 0,
      pendingCount: 1,
      dismissedCount: 1,
    });
  });
});

describe('consistency summary semantics', () => {
  const makeGroup = (items) =>
    normalizeConsistencyGroup({
      group_key: 'table3',
      items,
    });

  test('5 FAIL pending => group and top summary both show problemCount 5 pendingCount 5', () => {
    const group = makeGroup(new Array(5).fill(null).map(() => makeItem()));
    const summary = summarizeConsistencyGroups([group]);

    expect(group.stats).toMatchObject({
      ruleCount: 5,
      problemCount: 5,
      pendingCount: 5,
      confirmedCount: 0,
      dismissedCount: 0,
    });
    expect(summary).toMatchObject({
      ruleCount: 5,
      problemCount: 5,
      pendingCount: 5,
      confirmedCount: 0,
      dismissedCount: 0,
    });
  });

  test('1 confirmed FAIL => problemCount stays 5, pendingCount 4, confirmedCount 1', () => {
    const items = [
      makeItem({ humanStatus: 'confirmed' }),
      ...new Array(4).fill(null).map(() => makeItem()),
    ];
    const group = makeGroup(items);
    const summary = summarizeConsistencyGroups([group]);

    expect(group.stats).toMatchObject({
      ruleCount: 5,
      problemCount: 5,
      pendingCount: 4,
      confirmedCount: 1,
      dismissedCount: 0,
    });
    expect(summary).toMatchObject({
      ruleCount: 5,
      problemCount: 5,
      pendingCount: 4,
      confirmedCount: 1,
      dismissedCount: 0,
    });
  });

  test('1 dismissed FAIL => problemCount 4, pendingCount 4, dismissedCount 1', () => {
    const items = [
      makeItem({ humanStatus: 'dismissed' }),
      ...new Array(4).fill(null).map(() => makeItem()),
    ];
    const group = makeGroup(items);
    const summary = summarizeConsistencyGroups([group]);

    expect(group.stats).toMatchObject({
      ruleCount: 5,
      problemCount: 4,
      pendingCount: 4,
      confirmedCount: 0,
      dismissedCount: 1,
    });
    expect(summary).toMatchObject({
      ruleCount: 5,
      problemCount: 4,
      pendingCount: 4,
      confirmedCount: 0,
      dismissedCount: 1,
    });
  });

  test('reset back to pending restores problemCount 5 and pendingCount 5', () => {
    const group = makeGroup(new Array(5).fill(null).map(() => makeItem({ humanStatus: 'pending' })));
    const summary = summarizeConsistencyGroups([group]);

    expect(group.stats).toMatchObject({
      ruleCount: 5,
      problemCount: 5,
      pendingCount: 5,
      confirmedCount: 0,
      dismissedCount: 0,
    });
    expect(summary).toMatchObject({
      ruleCount: 5,
      problemCount: 5,
      pendingCount: 5,
      confirmedCount: 0,
      dismissedCount: 0,
    });
  });
});

describe('quality audit summary semantics', () => {
  const makeQualityItem = ({
    groupKey = 'quality',
    checkKey = 'narrative_sec5_gap',
    autoStatus = 'FAIL',
    humanStatus = 'pending',
    title = '语义审计：第五部分存在问题及改进情况空缺',
  } = {}) => ({
    group_key: groupKey,
    check_key: checkKey,
    auto_status: autoStatus,
    human_status: humanStatus,
    title,
  });

  test('quality audit uses independent amber counts and numbering', () => {
    const groups = [
      normalizeConsistencyGroup({
        group_key: 'quality',
        items: [
          makeQualityItem(),
          makeQualityItem({
            checkKey: 'year_mismatch_2024',
            title: '年份不一致：报告年份为2025年，但正文中发现2024年的表述',
          }),
          makeQualityItem({
            autoStatus: 'NOT_ASSESSABLE',
            title: '无法判断的质量提示',
          }),
        ],
      }),
      normalizeConsistencyGroup({
        group_key: 'visual',
        items: [
          makeQualityItem({
            groupKey: 'visual',
            checkKey: 'visual_table3_empty_cells',
            autoStatus: 'UNCERTAIN',
            title: '表格审计：表三存在3个空白或"/"单元格',
          }),
        ],
      }),
      normalizeConsistencyGroup({
        group_key: 'table3',
        items: [
          makeQualityItem({
            groupKey: 'table3',
            checkKey: 't3_result_total_total',
            title: '表三勾稽问题',
          }),
        ],
      }),
    ];

    const qualityGroups = buildQualityAuditGroups(groups);
    const summary = summarizeQualityAuditGroups(qualityGroups);

    expect(summary).toMatchObject({
      riskCount: 3,
      reviewCount: 3,
      resolvedCount: 0,
      notAssessableCount: 1,
    });

    const numbered = qualityGroups
      .flatMap((group) => group.items)
      .filter((item) => item.qualityDisplayNo)
      .map((item) => item.qualityDisplayNo)
      .sort((a, b) => a - b);
    expect(numbered).toEqual([1, 2, 3]);
  });

  test('quality audit excludes dismissed risks from riskCount but keeps ignored bucket', () => {
    const groups = [
      normalizeConsistencyGroup({
        group_key: 'quality',
        items: [
          makeQualityItem({ humanStatus: 'dismissed' }),
          makeQualityItem({ autoStatus: 'UNCERTAIN' }),
          makeQualityItem({ humanStatus: 'confirmed' }),
        ],
      }),
    ];

    const summary = summarizeQualityAuditGroups(buildQualityAuditGroups(groups));
    expect(summary).toMatchObject({
      riskCount: 2,
      reviewCount: 1,
      resolvedCount: 1,
      dismissedCount: 1,
    });
  });
});
