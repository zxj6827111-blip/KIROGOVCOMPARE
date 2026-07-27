import { evaluateFilingGate } from '../services/filing/FilingGateService';
import type { ConsistencyItem } from '../services/ConsistencyCheckService';

function item(partial: Partial<ConsistencyItem> & Pick<ConsistencyItem, 'groupKey' | 'checkKey' | 'autoStatus'>): ConsistencyItem {
  return {
    fingerprint: partial.fingerprint || `${partial.groupKey}:${partial.checkKey}`,
    title: partial.title || partial.checkKey,
    expr: partial.expr || '',
    leftValue: partial.leftValue ?? null,
    rightValue: partial.rightValue ?? null,
    delta: partial.delta ?? null,
    tolerance: partial.tolerance ?? 0,
    evidenceJson: partial.evidenceJson || { paths: [], values: {} },
    ...partial,
  };
}

describe('FilingGateService', () => {
  it('passes when no table FAIL', () => {
    const result = evaluateFilingGate([
      item({ groupKey: 'table3', checkKey: 'ok', autoStatus: 'PASS' }),
      item({ groupKey: 'hierarchy', checkKey: 'missing_child', autoStatus: 'FAIL', title: '下级缺报' }),
      item({ groupKey: 'text', checkKey: 'year', autoStatus: 'UNCERTAIN' }),
    ]);
    expect(result.passed).toBe(true);
    expect(result.failCount).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('blocks when table3 has FAIL', () => {
    const result = evaluateFilingGate([
      item({
        groupKey: 'table3',
        checkKey: 'balance',
        autoStatus: 'FAIL',
        title: '表三平衡',
        leftValue: 1,
        rightValue: 2,
      }),
      item({ groupKey: 'table2', checkKey: 'ok', autoStatus: 'PASS' }),
    ]);
    expect(result.passed).toBe(false);
    expect(result.failCount).toBe(1);
    expect(result.fails[0].checkKey).toBe('balance');
  });
});
