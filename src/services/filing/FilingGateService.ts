/**
 * Filing effectiveness gate: only table2/table3/table4 FAIL items block生效.
 * hierarchy / text / UNCERTAIN do not block by default.
 */
import type { ConsistencyItem } from '../ConsistencyCheckService';
import { buildConsistencyRunSummary } from '../ConsistencyCheckService';

const GATE_GROUPS = new Set(['table2', 'table3', 'table4']);

export type FilingGateResult = {
  passed: boolean;
  failCount: number;
  fails: Array<{
    groupKey: string;
    checkKey: string;
    title: string;
    expr: string;
    leftValue: number | null;
    rightValue: number | null;
    delta: number | null;
    autoStatus: string;
  }>;
  warnings: Array<{
    groupKey: string;
    checkKey: string;
    title: string;
    autoStatus: string;
  }>;
  summary: ReturnType<typeof buildConsistencyRunSummary>;
};

export function evaluateFilingGate(items: ConsistencyItem[]): FilingGateResult {
  const summary = buildConsistencyRunSummary(items);

  const fails = items
    .filter((item) => GATE_GROUPS.has(item.groupKey) && item.autoStatus === 'FAIL')
    .map((item) => ({
      groupKey: item.groupKey,
      checkKey: item.checkKey,
      title: item.title,
      expr: item.expr,
      leftValue: item.leftValue,
      rightValue: item.rightValue,
      delta: item.delta,
      autoStatus: item.autoStatus,
    }));

  const warnings = items
    .filter(
      (item) =>
        item.autoStatus === 'UNCERTAIN' ||
        (item.groupKey === 'hierarchy' && item.autoStatus === 'FAIL') ||
        (item.groupKey === 'text' && item.autoStatus === 'FAIL')
    )
    .map((item) => ({
      groupKey: item.groupKey,
      checkKey: item.checkKey,
      title: item.title,
      autoStatus: item.autoStatus,
    }));

  return {
    passed: fails.length === 0,
    failCount: fails.length,
    fails,
    warnings,
    summary,
  };
}
