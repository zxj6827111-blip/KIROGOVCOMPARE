import {
  collectPendingConsistencyItemIds,
  normalizeConsistencyGroups,
  summarizeConsistencyGroups,
} from './consistencyDisplay';
import { aggregateIssuesFromChecks, aggregateQualityIssuesFromChecks } from './issueAggregation';
import { aggregateExternalIssueSources } from './issueAggregation';

const makeGroup = (groupKey, items) => ({
  group_key: groupKey,
  groupKey,
  items,
});

const makeIssue = (overrides = {}) => ({
  id: overrides.id,
  group_key: overrides.group_key,
  check_key: overrides.check_key,
  issueType: overrides.issueType,
  title: overrides.title,
  expr: overrides.expr,
  auto_status: overrides.auto_status,
  human_status: overrides.human_status,
  displayNo: overrides.displayNo,
  evidence: overrides.evidence,
  left_value: overrides.left_value,
  right_value: overrides.right_value,
  delta: overrides.delta,
  tolerance: overrides.tolerance,
});

const buildTable3Fixture = () => [
  makeGroup('table3', [
    makeIssue({
      id: 1,
      group_key: 'table3',
      check_key: 't3_identity_naturalPerson',
      issueType: 'consistency_table3_identity',
      title: 'identity 1',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        leftPaths: ['tableData.naturalPerson.newReceived'],
        rightPaths: ['tableData.naturalPerson.results.totalProcessed'],
      },
    }),
    makeIssue({
      id: 2,
      group_key: 'table3',
      check_key: 't3_identity_legalPerson',
      issueType: 'consistency_table3_identity',
      title: 'identity 2',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        leftPaths: ['tableData.legalPerson.newReceived'],
        rightPaths: ['tableData.legalPerson.results.totalProcessed'],
      },
    }),
    makeIssue({
      id: 3,
      group_key: 'table3',
      check_key: 't3_result_total_totalProcessed',
      issueType: 'consistency_table3_result_total',
      title: 'result total 1',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        paths: ['tableData.total.results.totalProcessed'],
      },
    }),
    makeIssue({
      id: 4,
      group_key: 'table3',
      check_key: 't3_result_total_carryForward',
      issueType: 'consistency_table3_result_total',
      title: 'result total 2',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        paths: ['tableData.total.results.totalProcessed'],
      },
    }),
    makeIssue({
      id: 5,
      group_key: 'table3',
      check_key: 't3_column_sum_total',
      issueType: 'consistency_table3_column_sum',
      title: '各列求和=总计（办理结果总计）',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        paths: ['tableData.total.total'],
      },
    }),
    ...Array.from({ length: 34 }, (_, index) =>
      makeIssue({
        id: 100 + index,
        group_key: 'table3',
        check_key: `t3_pass_${index + 1}`,
        auto_status: 'PASS',
        human_status: 'pending',
        title: `pass ${index + 1}`,
        evidence: {
          paths: [`tableData.total.meta.pass${index + 1}`],
        },
      })
    ),
  ]),
];

const buildTable4Fixture = () => [
  makeGroup('table4', [
    makeIssue({
      id: 11,
      group_key: 'table4',
      check_key: 't4_sum_review_1',
      issueType: 'consistency_table4_row_sum',
      title: 'table4 row sum 1',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        paths: ['reviewLitigationData.review.total'],
      },
    }),
    makeIssue({
      id: 12,
      group_key: 'table4',
      check_key: 't4_sum_review_2',
      issueType: 'consistency_table4_row_sum',
      title: 'table4 row sum 2',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        paths: ['reviewLitigationData.review.total2'],
      },
    }),
    makeIssue({
      id: 13,
      group_key: 'table4',
      check_key: 't4_sum_review_3',
      issueType: 'consistency_table4_row_sum',
      title: 'table4 row sum 3',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        paths: ['reviewLitigationData.review.total3'],
      },
    }),
  ]),
];

const buildTable2Fixture = () => [
  makeGroup('table2', [
    makeIssue({
      id: 21,
      group_key: 'table2',
      check_key: 't2_non_negative_counts_regulations_valid',
      issueType: 'consistency_table2',
      title: 'table2 fail 1',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        values: {
          fieldPath: 'activeDisclosureData.regulations.valid',
        },
        paths: ['activeDisclosureData.regulations.valid'],
      },
    }),
    makeIssue({
      id: 22,
      group_key: 'table2',
      check_key: 't2_non_negative_counts_fees_amount',
      issueType: 'consistency_table2',
      title: 'table2 fail 2',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        values: {
          fieldPath: 'activeDisclosureData.fees.amount',
        },
        paths: ['activeDisclosureData.fees.amount'],
      },
    }),
    makeIssue({
      id: 23,
      group_key: 'table2',
      check_key: 't2_uncertain_licensing',
      issueType: 'consistency_table2',
      title: 'table2 uncertain 1',
      auto_status: 'UNCERTAIN',
      human_status: 'pending',
      evidence: {
        values: {
          fieldPath: 'activeDisclosureData.licensing.processed',
        },
        paths: ['activeDisclosureData.licensing.processed'],
      },
    }),
    makeIssue({
      id: 24,
      group_key: 'table2',
      check_key: 't2_uncertain_punishment',
      issueType: 'consistency_table2',
      title: 'table2 uncertain 2',
      auto_status: 'UNCERTAIN',
      human_status: 'pending',
      evidence: {
        values: {
          fieldPath: 'activeDisclosureData.punishment.processed',
        },
        paths: ['activeDisclosureData.punishment.processed'],
      },
    }),
    makeIssue({
      id: 25,
      group_key: 'table2',
      check_key: 't2_uncertain_coercion',
      issueType: 'consistency_table2',
      title: 'table2 uncertain 3',
      auto_status: 'UNCERTAIN',
      human_status: 'pending',
      evidence: {
        values: {
          fieldPath: 'activeDisclosureData.coercion.processed',
        },
        paths: ['activeDisclosureData.coercion.processed'],
      },
    }),
  ]),
];

const buildFallbackTable2Fixture = () => [
  makeGroup('table2', [
    makeIssue({
      id: 31,
      group_key: 'table2',
      check_key: 't2_no_rules',
      auto_status: 'NOT_ASSESSABLE',
      human_status: 'pending',
      issueType: 'unsupported_not_assessable',
      evidence: {
        paths: ['activeDisclosureData.table2.placeholder'],
      },
    }),
  ]),
];

const findGroup = (groups, groupKey) => groups.find((group) => group.group_key === groupKey);

describe('issueAggregation', () => {
  test('3670 table3 aggregation matches old normalize/summarize output', () => {
    const groups = buildTable3Fixture();
    const oldGroups = normalizeConsistencyGroups(groups);
    const oldSummary = summarizeConsistencyGroups(oldGroups);
    const oldTable3 = findGroup(oldGroups, 'table3');
    const oldDisplayNoMap = Object.fromEntries(
      oldTable3.items
        .filter((item) => item.displayNo !== null && item.displayNo !== undefined)
        .map((item) => [item.stableIssueId, item.displayNo])
    );

    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.summary).toMatchObject(oldSummary);
    expect(aggregate.groupSummaries.table3).toMatchObject(oldTable3.stats);
    expect(aggregate.issuesByGroupKey.table3.map((issue) => issue.displayNo).filter(Boolean)).toEqual(
      oldTable3.items.map((item) => item.displayNo).filter(Boolean)
    );
    expect(aggregate.displayNoMap).toMatchObject(oldDisplayNoMap);
    expect(aggregate.pendingItemIds).toEqual(collectPendingConsistencyItemIds(oldGroups));
    expect(aggregate.locatePayloadMap['id:1'].leftPaths).toEqual(['tableData.naturalPerson.newReceived']);
    expect(aggregate.locatePayloadMap['id:3'].fallbackPaths).toEqual(['tableData.total.results.totalProcessed']);
    expect(aggregate.locatePayloadMap['id:4'].fallbackPaths).toEqual(['tableData.total.results.totalProcessed']);
    expect(aggregate.markerIndexByPath['tableData.total.results.totalProcessed'].map((issue) => issue.issueId)).toEqual([
      'id:3',
      'id:4',
    ]);
    expect(aggregate.locatePayloadMap['id:5'].fallbackPaths).toEqual(['tableData.total.total']);
  });

  test('4304 table4 aggregation matches old normalize/summarize output', () => {
    const groups = buildTable4Fixture();
    const oldGroups = normalizeConsistencyGroups(groups);
    const oldSummary = summarizeConsistencyGroups(oldGroups);
    const oldTable4 = findGroup(oldGroups, 'table4');
    const oldDisplayNoMap = Object.fromEntries(
      oldTable4.items
        .filter((item) => item.displayNo !== null && item.displayNo !== undefined)
        .map((item) => [item.stableIssueId, item.displayNo])
    );

    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.summary).toMatchObject(oldSummary);
    expect(aggregate.groupSummaries.table4).toMatchObject(oldTable4.stats);
    expect(aggregate.issuesByGroupKey.table4.map((issue) => issue.displayNo).filter(Boolean)).toEqual(
      oldTable4.items.map((item) => item.displayNo).filter(Boolean)
    );
    expect(aggregate.displayNoMap).toMatchObject(oldDisplayNoMap);
    expect(aggregate.locatePayloadMap['id:11'].fallbackPaths).toEqual(['reviewLitigationData.review.total']);
    expect(aggregate.markerIndexByPath['reviewLitigationData.review.total'].map((issue) => issue.issueId)).toEqual([
      'id:11',
    ]);
    expect(aggregate.issuesByGroupKey.table4.every((issue) => issue.markers[0]?.tone === 'table4')).toBe(true);
  });

  test('table2 low-risk fixture keeps FAIL/UNCERTAIN split and pending ids consistent', () => {
    const groups = buildTable2Fixture();
    const oldGroups = normalizeConsistencyGroups(groups);
    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.groupSummaries.table2).toMatchObject({
      ruleCount: 5,
      problemCount: 2,
      pendingCount: 5,
    });
    expect(aggregate.summary).toMatchObject({
      ruleCount: 5,
      problemCount: 2,
      pendingCount: 5,
    });
    expect(aggregate.issuesByGroupKey.table2.filter((issue) => issue.displayNo !== null)).toHaveLength(2);
    expect(aggregate.pendingItemIds).toHaveLength(5);
    expect(aggregate.locatePayloadMap['id:21'].fallbackPaths).toContain('activeDisclosureData.regulations.valid');
    expect(aggregate.locatePayloadMap['id:22'].fallbackPaths).toContain('activeDisclosureData.fees.amount');
    expect(aggregate.locatePayloadMap['id:23'].fallbackPaths).toContain('activeDisclosureData.licensing.processed');
    expect(aggregate.locatePayloadMap['id:24'].fallbackPaths).toContain('activeDisclosureData.punishment.processed');
    expect(aggregate.locatePayloadMap['id:25'].fallbackPaths).toContain('activeDisclosureData.coercion.processed');
    expect(oldGroups[0].items.filter((item) => item.displayNo !== null)).toHaveLength(2);
  });

  test('t2_no_rules fallback stays not assessable without pending or display numbers', () => {
    const groups = buildFallbackTable2Fixture();
    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.summary).toMatchObject({
      ruleCount: 0,
      problemCount: 0,
      pendingCount: 0,
      notAssessableCount: 1,
    });
    expect(aggregate.groupSummaries.table2).toMatchObject({
      ruleCount: 0,
      problemCount: 0,
      pendingCount: 0,
      notAssessableCount: 1,
    });
    expect(aggregate.displayNoMap).toEqual({});
    expect(aggregate.pendingItemIds).toEqual([]);
    expect(aggregate.issuesByGroupKey.table2[0].issueType).toBe('unsupported_not_assessable');
  });

  test('legacy PASS pending is treated as system-confirmed and excluded from pending review ids', () => {
    const groups = [
      makeGroup('table3', [
        makeIssue({
          id: 51,
          group_key: 'table3',
          check_key: 't3_pass_legacy_pending',
          auto_status: 'PASS',
          human_status: 'pending',
          evidence: { paths: ['tableData.total.meta.pass'] },
        }),
        makeIssue({
          id: 52,
          group_key: 'table3',
          check_key: 't3_uncertain_pending',
          auto_status: 'UNCERTAIN',
          human_status: 'pending',
          evidence: { paths: ['tableData.total.meta.uncertain'] },
        }),
      ]),
    ];

    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.summary).toMatchObject({
      ruleCount: 2,
      problemCount: 0,
      pendingCount: 1,
      confirmedCount: 0,
    });
    expect(aggregate.pendingItemIds).toEqual([52]);
    expect(aggregate.reviewIssues.map((issue) => issue.issueId)).toEqual(['id:52']);
    expect(aggregate.confirmedIssues.map((issue) => issue.issueId)).toEqual([]);
    expect(aggregate.activeIssues).toHaveLength(0);
  });

  test('raw PASS humanStatus stays visible on the normalized issue item', () => {
    const groups = [
      makeGroup('table3', [
        makeIssue({
          id: 53,
          group_key: 'table3',
          check_key: 't3_pass_confirmed',
          auto_status: 'PASS',
          human_status: 'confirmed',
          evidence: { paths: ['tableData.total.meta.pass'] },
        }),
      ]),
    ];

    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.issuesByGroupKey.table3[0]).toMatchObject({
      issueId: 'id:53',
      autoStatus: 'PASS',
      humanStatus: 'confirmed',
    });
    expect(aggregate.summary.confirmedCount).toBe(0);
    expect(aggregate.confirmedIssues).toEqual([]);
  });

  test('confirmed FAIL stays active and keeps display number', () => {
    const groups = [
      makeGroup('table3', [
        makeIssue({
          id: 41,
          group_key: 'table3',
          check_key: 't3_identity_confirmed',
          issueType: 'consistency_table3_identity',
          auto_status: 'FAIL',
          human_status: 'confirmed',
          evidence: {
            paths: ['tableData.confirmed.row'],
          },
        }),
      ]),
    ];

    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.summary).toMatchObject({
      ruleCount: 1,
      problemCount: 1,
      confirmedCount: 1,
      pendingCount: 0,
    });
    expect(aggregate.activeIssues.map((issue) => issue.issueId)).toContain('id:41');
    expect(aggregate.displayNoMap['id:41']).toBe(1);
  });

  test('batch confirmed FAIL items stay in activeIssues with displayNo preserved and not in pendingItemIds', () => {
    const groups = [
      makeGroup('table3', [
        makeIssue({
          id: 81,
          group_key: 'table3',
          check_key: 't3_identity_1',
          issueType: 'consistency_table3_identity',
          auto_status: 'FAIL',
          human_status: 'confirmed',
          evidence: { leftPaths: ['tableData.naturalPerson.newReceived'], rightPaths: ['tableData.naturalPerson.results.totalProcessed'] },
        }),
        makeIssue({
          id: 82,
          group_key: 'table3',
          check_key: 't3_result_total_1',
          issueType: 'consistency_table3_result_total',
          auto_status: 'FAIL',
          human_status: 'confirmed',
          evidence: { paths: ['tableData.total.results.totalProcessed'] },
        }),
        makeIssue({
          id: 83,
          group_key: 'table3',
          check_key: 't3_col_sum_1',
          issueType: 'consistency_table3_column_sum',
          auto_status: 'FAIL',
          human_status: 'confirmed',
          evidence: { paths: ['tableData.total.total'] },
        }),
        makeIssue({
          id: 84,
          group_key: 'table3',
          check_key: 't3_pass_1',
          auto_status: 'PASS',
          human_status: 'confirmed',
          evidence: { paths: ['tableData.total.meta.pass1'] },
        }),
        makeIssue({
          id: 86,
          group_key: 'table3',
          check_key: 't3_uncertain_1',
          auto_status: 'UNCERTAIN',
          human_status: 'confirmed',
          evidence: { paths: ['tableData.total.meta.uncertain1'] },
        }),
        makeIssue({
          id: 85,
          group_key: 'table3',
          check_key: 't3_na_1',
          auto_status: 'NOT_ASSESSABLE',
          human_status: 'pending',
          evidence: { paths: ['tableData.total.meta.na1'] },
        }),
      ]),
    ];

    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.summary).toMatchObject({
      ruleCount: 5,
      problemCount: 3,
      confirmedCount: 4,
      pendingCount: 0,
      notAssessableCount: 1,
    });
    expect(aggregate.activeIssues).toHaveLength(3);
    expect(aggregate.activeIssues.map((i) => i.issueId)).toEqual(['id:81', 'id:82', 'id:83']);
    expect(aggregate.confirmedIssues).toHaveLength(4);
    expect(aggregate.confirmedIssues.map((i) => i.issueId)).toEqual(['id:81', 'id:82', 'id:83', 'id:86']);
    expect(aggregate.displayNoMap['id:81']).toBe(1);
    expect(aggregate.displayNoMap['id:82']).toBe(2);
    expect(aggregate.displayNoMap['id:83']).toBe(3);
    expect(aggregate.pendingItemIds).toEqual([]);
  });

  test('bulk-confirm target ids exclude NOT_ASSESSABLE and keep FAIL or UNCERTAIN items available to content view', () => {
    const groups = [
      makeGroup('table2', [
        makeIssue({
          id: 71,
          group_key: 'table2',
          check_key: 't2_fail_confirmed',
          auto_status: 'FAIL',
          human_status: 'confirmed',
          evidence: { paths: ['activeDisclosureData.regulations.valid'] },
        }),
        makeIssue({
          id: 72,
          group_key: 'table2',
          check_key: 't2_uncertain_pending',
          auto_status: 'UNCERTAIN',
          human_status: 'pending',
          evidence: { paths: ['activeDisclosureData.licensing.processed'] },
        }),
        makeIssue({
          id: 73,
          group_key: 'table2',
          check_key: 't2_no_rules',
          auto_status: 'NOT_ASSESSABLE',
          human_status: 'pending',
          issueType: 'unsupported_not_assessable',
          evidence: { paths: ['sections[type=table_2]'] },
        }),
      ]),
    ];

    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.pendingItemIds).toEqual([72]);
    expect(aggregate.activeIssues.map((issue) => issue.issueId)).toContain('id:71');
    expect(aggregate.reviewIssues.map((issue) => issue.issueId)).toContain('id:72');
    expect(aggregate.reviewIssues.map((issue) => issue.issueId)).not.toContain('id:73');
  });

  test('dismissed FAIL is excluded from active counts and numbering', () => {
    const groups = [
      makeGroup('table3', [
        makeIssue({
          id: 51,
          group_key: 'table3',
          check_key: 't3_identity_dismissed',
          issueType: 'consistency_table3_identity',
          auto_status: 'FAIL',
          human_status: 'dismissed',
          evidence: {
            paths: ['tableData.dismissed.row'],
          },
        }),
      ]),
    ];

    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.summary).toMatchObject({
      ruleCount: 1,
      problemCount: 0,
      dismissedCount: 1,
    });
    expect(aggregate.activeIssues).toHaveLength(0);
    expect(aggregate.displayNoMap).toEqual({});
    expect(aggregate.dismissedIssues.map((issue) => issue.issueId)).toContain('id:51');
  });

  test('UNCERTAIN and NOT_ASSESSABLE remain outside problemCount with correct review semantics', () => {
    const groups = [
      makeGroup('table2', [
        makeIssue({
          id: 61,
          group_key: 'table2',
          check_key: 't2_uncertain',
          auto_status: 'UNCERTAIN',
          human_status: 'pending',
          evidence: { paths: ['activeDisclosureData.x'] },
        }),
        makeIssue({
          id: 62,
          group_key: 'table2',
          check_key: 't2_na',
          auto_status: 'NOT_ASSESSABLE',
          human_status: 'pending',
          issueType: 'unsupported_not_assessable',
          evidence: { paths: ['activeDisclosureData.na'] },
        }),
      ]),
    ];

    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.summary).toMatchObject({
      ruleCount: 1,
      problemCount: 0,
      pendingCount: 1,
      notAssessableCount: 1,
    });
    expect(aggregate.reviewIssues.map((issue) => issue.issueId)).toEqual(['id:61']);
    expect(aggregate.displayNoMap).toEqual({});
  });

  test('hierarchy completeness prompts stay visible but do not inflate review counts or bulk ids', () => {
    const groups = [
      makeGroup('hierarchy', [
        makeIssue({
          id: 91,
          group_key: 'hierarchy',
          check_key: 'hierarchy_sum_v2_application__total__new_received',
          auto_status: 'FAIL',
          human_status: 'pending',
          evidence: { paths: ['hierarchy.parent.metric'] },
        }),
        makeIssue({
          id: 92,
          group_key: 'hierarchy',
          check_key: 'hierarchy_missing_child_reports',
          auto_status: 'UNCERTAIN',
          human_status: 'pending',
          evidence: { paths: ['hierarchy.parent.missingReports'] },
        }),
        makeIssue({
          id: 93,
          group_key: 'hierarchy',
          check_key: 'hierarchy_missing_child_metrics',
          auto_status: 'UNCERTAIN',
          human_status: 'pending',
          evidence: { paths: ['hierarchy.parent.missingMetrics'] },
        }),
      ]),
    ];

    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.issuesByGroupKey.hierarchy).toHaveLength(3);
    expect(aggregate.summary).toMatchObject({
      ruleCount: 3,
      problemCount: 1,
      pendingCount: 1,
      reviewCount: 1,
    });
    expect(aggregate.reviewIssues.map((issue) => issue.issueId)).toEqual(['id:91']);
    expect(aggregate.pendingItemIds).toEqual([91]);
  });

  test('new displayNo map matches old normalizeConsistencyGroups output exactly', () => {
    const groups = [...buildTable3Fixture(), ...buildTable4Fixture(), ...buildTable2Fixture()];
    const oldGroups = normalizeConsistencyGroups(groups);
    const oldDisplayNoMap = Object.fromEntries(
      oldGroups.flatMap((group) =>
        group.items
          .filter((item) => item.displayNo !== null && item.displayNo !== undefined)
          .map((item) => [item.stableIssueId, item.displayNo])
      )
    );
    const aggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(aggregate.displayNoMap).toEqual(oldDisplayNoMap);
  });

  test('quality adapter maps visual structure quality issues without affecting reconciliation stats', () => {
    const groups = [
      makeGroup('visual', [
        makeIssue({
          id: 201,
          group_key: 'visual',
          check_key: 'visual_table3_empty_cells',
          title: 'visual table3 empty',
          auto_status: 'UNCERTAIN',
          human_status: 'pending',
          evidence: { paths: ['tableData.total.total'] },
        }),
      ]),
      makeGroup('structure', [
        makeIssue({
          id: 202,
          group_key: 'structure',
          check_key: 'structure_table_missing',
          title: 'structure missing',
          auto_status: 'FAIL',
          human_status: 'pending',
          evidence: { paths: ['tableData.total.total'] },
        }),
      ]),
      makeGroup('quality', [
        makeIssue({
          id: 203,
          group_key: 'quality',
          check_key: 'narrative_sec5_gap',
          title: 'narrative gap',
          auto_status: 'UNCERTAIN',
          human_status: 'pending',
          evidence: { paths: ['activeDisclosureData.regulations.valid'] },
        }),
      ]),
    ];

    const qualityAggregate = aggregateQualityIssuesFromChecks(groups, {
      domain: 'quality',
    });

    expect(qualityAggregate.issues).toHaveLength(3);
    expect(qualityAggregate.issues.every((issue) => issue.source === 'quality')).toBe(true);
    expect(qualityAggregate.issues.map((issue) => issue.issueType)).toEqual([
      'quality_empty',
      'quality_structure',
      'quality_text_extraction',
    ]);
    expect(qualityAggregate.issues.every((issue) => issue.displayNo === null)).toBe(true);
    expect(qualityAggregate.markerIndexByPath['tableData.total.total'].map((issue) => issue.issueId)).toEqual([
      'quality:structure:id:202',
      'quality:visual:id:201',
    ]);
    expect(qualityAggregate.summary).toMatchObject({
      itemCount: 3,
      riskCount: 3,
      reviewCount: 3,
    });

    const consistencyAggregate = aggregateIssuesFromChecks(groups, {
      domain: 'consistency',
      displayMode: 'management',
      displayNoScope: 'group',
    });

    expect(consistencyAggregate.summary).toMatchObject({
      ruleCount: 0,
      problemCount: 0,
    });
  });

  test('external adapters keep OCR, quality and diagnostics outside reconciliation counts', () => {
    const external = aggregateExternalIssueSources({
      qualityIssues: [
        makeGroup('visual', [
          makeIssue({
            id: 301,
            group_key: 'visual',
            check_key: 'visual_table3_empty_cells',
            auto_status: 'UNCERTAIN',
            human_status: 'pending',
            evidence: { paths: ['tableData.total.total'] },
          }),
        ]),
      ],
      visionReviews: [
        {
          id: 401,
          tableId: 'table_3',
          status: 'completed',
          conclusion: 'parse_mapping_anomaly',
          comparison: {
            differences: [{ path: 'tableData.total.results.totalProcessed', parsedValue: 12, ocrValue: 21 }],
            unreadableCells: [],
          },
        },
        {
          id: 402,
          tableId: 'table_4',
          status: 'completed',
          conclusion: 'source_table_anomaly',
          comparison: {
            differences: [],
            unreadableCells: [],
          },
        },
      ],
      ocrCorrections: [
        {
          id: 501,
          tableId: 'table_3',
          fieldPath: 'tableData.total.results.totalProcessed',
          parsedValue: 12,
          ocrValue: 21,
          status: 'pending',
        },
        {
          id: 502,
          tableId: 'table_4',
          fieldPath: 'reviewLitigationData.review.total',
          parsedValue: 3,
          ocrValue: 4,
          status: 'confirmed',
        },
      ],
      diagnostics: {
        suspiciousRows: [
          {
            key: 'split_1',
            title: 'split hint',
            message: 'split hint',
            candidates: [
              { leftPath: 'tableData.total.total', rightPath: 'tableData.total.results.totalProcessed' },
            ],
          },
        ],
        suspiciousByPath: new Map([
          ['tableData.total.total', { title: 'split hint', marker: 'split', type: 'split' }],
        ]),
      },
    });

    expect(external.issuesByDomain.quality).toHaveLength(1);
    expect(external.issuesByDomain.vision.some((issue) => issue.issueType === 'ocr_review')).toBe(true);
    expect(external.issuesByDomain.ocr.some((issue) => issue.issueType === 'ocr_correction')).toBe(true);
    expect(external.issuesByDomain.diagnostics.every((issue) => issue.issueType === 'table_split_hint')).toBe(true);
    expect(external.markerIndexByPath['tableData.total.total'][0].source).toBe('quality');
    expect(external.markerPriorityIndex['tableData.total.total'][0].priority).toBeGreaterThanOrEqual(
      external.markerPriorityIndex['tableData.total.total'][external.markerPriorityIndex['tableData.total.total'].length - 1].priority
    );
    expect(external.sourceSummaries.quality.issueCount).toBe(1);
    expect(external.sourceSummaries.diagnostics.issueCount).toBeGreaterThan(0);
  });
});
