import { stabilizeParsedOutput, summarizeTable3NullBackfill } from '../services/ParsedOutputStabilityService';

/**
 * 表三丢值反推的三重门：勾稽唯一解 + 原文数字佐证 + 显式开关。
 * 这些用例锁住的是"不许猜"的那一侧——任何一条门不过都必须保持 null，
 * 因为填进去的 0 会被统计层当成真实数据（鄂尔多斯表三事故）。
 */

const FIELDS = [
  'newReceived',
  'carriedOver',
  'results.granted',
  'results.partialGrant',
  'results.denied.stateSecret',
  'results.denied.lawForbidden',
  'results.denied.safetyStability',
  'results.denied.thirdPartyRights',
  'results.denied.internalAffairs',
  'results.denied.processInfo',
  'results.denied.enforcementCase',
  'results.denied.adminQuery',
  'results.unableToProvide.noInfo',
  'results.unableToProvide.needCreation',
  'results.unableToProvide.unclear',
  'results.notProcessed.complaint',
  'results.notProcessed.repeat',
  'results.notProcessed.publication',
  'results.notProcessed.massiveRequests',
  'results.notProcessed.confirmInfo',
  'results.other.overdueCorrection',
  'results.other.overdueFee',
  'results.other.otherReasons',
  'results.totalProcessed',
  'results.carriedForward',
];

function makeEntity(overrides: Record<string, number | null> = {}): Record<string, any> {
  const entity: Record<string, any> = {};
  for (const field of FIELDS) {
    const segments = field.split('.');
    let cursor = entity;
    for (const segment of segments.slice(0, -1)) {
      if (!cursor[segment] || typeof cursor[segment] !== 'object') cursor[segment] = {};
      cursor = cursor[segment];
    }
    cursor[segments[segments.length - 1]] = field in overrides ? overrides[field] : 0;
  }
  return entity;
}

function makeOutput(tableData: Record<string, any>) {
  return { sections: [{ type: 'table_3', title: '三、收到和处理政府信息公开申请情况', tableData }] };
}

/**
 * 自然人：新收 10、办理结果总计 5、予以公开 3 → 部分公开只能是 2；
 * 总计行给出 2，两条等式解得一致。
 */
function makePartialGrantLostTableData(totalPartialGrant = 2) {
  const naturalPerson = makeEntity({
    newReceived: 10,
    'results.granted': 3,
    'results.partialGrant': null,
    'results.totalProcessed': 5,
    'results.carriedForward': 5,
  });
  return {
    naturalPerson,
    legalPerson: {
      commercial: makeEntity(),
      research: makeEntity(),
      social: makeEntity(),
      legal: makeEntity(),
      other: makeEntity(),
    },
    total: makeEntity({
      newReceived: 10,
      'results.granted': 3,
      'results.partialGrant': totalPartialGrant,
      'results.totalProcessed': 5,
      'results.carriedForward': 5,
    }),
  };
}

const SOURCE_WITH_PARTIAL_GRANT_2 =
  '三、本年度办理结果 （一）予以公开 3 0 0 0 0 0 3 （二）部分公开 2 0 0 0 0 0 2 （三）不予公开 1.属于国家秘密 0';

const backfillOptions = {
  table3: true,
  table4: false,
  table3NullBackfill: true,
  sourceText: SOURCE_WITH_PARTIAL_GRANT_2,
};

describe('stabilizeParsedOutput table3 null backfill', () => {
  it('fills the single unknown of a reconciliation identity and logs the repair', () => {
    const output = makeOutput(makePartialGrantLostTableData());

    const { repairs } = stabilizeParsedOutput(output, backfillOptions);

    expect(output.sections[0].tableData.naturalPerson.results.partialGrant).toBe(2);
    expect(repairs).toContain('table_3_null_backfill:naturalPerson.results.partialGrant=2');
  });

  it('keeps null when two addends are unknown (no unique solution)', () => {
    // 同一行差两个分项，总计列又差同样两格：行内等式和各列求和都解不出唯一值。
    const tableData = makePartialGrantLostTableData();
    tableData.naturalPerson.results.granted = null;
    tableData.naturalPerson.results.partialGrant = null;
    tableData.total.results.granted = null;
    tableData.total.results.partialGrant = null;
    const output = makeOutput(tableData);

    const { repairs } = stabilizeParsedOutput(output, backfillOptions);

    const naturalPerson = output.sections[0].tableData.naturalPerson;
    expect(naturalPerson.results.granted).toBeNull();
    expect(naturalPerson.results.partialGrant).toBeNull();
    expect(repairs.filter((r) => r.startsWith('table_3_null_backfill'))).toHaveLength(0);
  });

  it('keeps null when the source text has no matching number', () => {
    const output = makeOutput(makePartialGrantLostTableData());

    const { repairs } = stabilizeParsedOutput(output, {
      ...backfillOptions,
      sourceText: '（二）部分公开 0 0 0 0 0 0 0',
    });

    expect(output.sections[0].tableData.naturalPerson.results.partialGrant).toBeNull();
    expect(repairs.filter((r) => r.startsWith('table_3_null_backfill'))).toHaveLength(0);
  });

  it('keeps null when the source text is missing entirely', () => {
    const output = makeOutput(makePartialGrantLostTableData());

    stabilizeParsedOutput(output, { ...backfillOptions, sourceText: '' });

    expect(output.sections[0].tableData.naturalPerson.results.partialGrant).toBeNull();
  });

  it('refuses to pick a side when two equations disagree', () => {
    // 列求和说部分公开是 9，办理结果总计那行说是 2 —— 数据自相矛盾，不能挑一个填。
    const output = makeOutput(makePartialGrantLostTableData(9));

    stabilizeParsedOutput(output, backfillOptions);

    expect(output.sections[0].tableData.naturalPerson.results.partialGrant).toBeNull();
  });

  it('does not invent applicant rows the report never had', () => {
    const tableData = makePartialGrantLostTableData();
    delete (tableData.legalPerson as any).research;
    tableData.total = makeEntity({
      newReceived: 10,
      'results.granted': 3,
      'results.partialGrant': 2,
      'results.totalProcessed': 5,
      'results.carriedForward': 5,
    });
    const output = makeOutput(tableData);

    stabilizeParsedOutput(output, backfillOptions);

    expect((output.sections[0].tableData.legalPerson as any).research).toBeUndefined();
  });

  it('changes nothing while the flag is off', () => {
    const output = makeOutput(makePartialGrantLostTableData());

    const { repairs } = stabilizeParsedOutput(output, {
      table3: true,
      table4: false,
      sourceText: SOURCE_WITH_PARTIAL_GRANT_2,
    });

    expect(output.sections[0].tableData.naturalPerson.results.partialGrant).toBeNull();
    expect(repairs.filter((r) => r.startsWith('table_3_null_backfill'))).toHaveLength(0);
  });

  it('derives a 0 only when the row totals force it and the source shows it', () => {
    // 与"一律把空白填 0"的区别在这里：其余 21 个分项与总计都是 0，勾稽只剩这一格，
    // 原文该格也确实写着 0 —— 两个条件缺一个就保持 null。
    const tableData = makePartialGrantLostTableData();
    tableData.legalPerson.commercial['results']['denied']['stateSecret'] = null;
    const output = makeOutput(tableData);

    const { repairs } = stabilizeParsedOutput(output, backfillOptions);

    const commercial = output.sections[0].tableData.legalPerson.commercial;
    expect(commercial.results.denied.stateSecret).toBe(0);
    expect(repairs).toContain('table_3_null_backfill:legalPerson.commercial.results.denied.stateSecret=0');
    expect(repairs.filter((r) => r.startsWith('table_3_null_backfill'))).toHaveLength(2);
  });

  it('summarizes which null cells the identities can solve (audit buckets)', () => {
    const summary = summarizeTable3NullBackfill(makePartialGrantLostTableData());

    expect(summary.nullPaths).toEqual(['naturalPerson.results.partialGrant']);
    expect(summary.uniquelySolvablePaths).toEqual(['naturalPerson.results.partialGrant']);

    // 予以公开在自然人行里差两个未知数（granted + partialGrant）解不出，但总计行只剩
    // granted 一个未知数、列求和也能定它，所以它仍在"可自动反推"桶里。
    const ambiguous = makePartialGrantLostTableData();
    ambiguous.naturalPerson.results.granted = null;
    ambiguous.total.results.granted = null;
    const second = summarizeTable3NullBackfill(ambiguous);
    expect(second.nullPaths.sort()).toEqual([
      'naturalPerson.results.granted',
      'naturalPerson.results.partialGrant',
      'total.results.granted',
    ]);
    expect(second.uniquelySolvablePaths).toEqual([
      'naturalPerson.results.partialGrant',
      'total.results.granted',
    ]);
  });

  it('leaves a forced 0 alone when the source row shows no zero', () => {
    const tableData = makePartialGrantLostTableData();
    tableData.legalPerson.commercial['results']['denied']['stateSecret'] = null;
    const output = makeOutput(tableData);

    const { repairs } = stabilizeParsedOutput(output, {
      ...backfillOptions,
      sourceText: SOURCE_WITH_PARTIAL_GRANT_2.replace('属于国家秘密 0', '属于国家秘密'),
    });

    expect(output.sections[0].tableData.legalPerson.commercial.results.denied.stateSecret).toBeNull();
    expect(repairs.some((r) => r.includes('stateSecret'))).toBe(false);
  });
});
