/**
 * Unit tests for resolveStabilizeOptions via re-exporting the pure logic.
 * LlmJobRunner keeps resolveStabilizeOptions private; mirror rules here for safety
 * and also exercise stabilizeParsedOutput defaults.
 */
import { stabilizeParsedOutput } from '../services/ParsedOutputStabilityService';

function resolveStabilizeOptions(modeRaw: string): { table3: boolean; table4: boolean } {
  const mode = modeRaw.trim().toLowerCase();
  if (!mode || mode === 'none' || mode === 'off' || mode === '0' || mode === 'false') {
    return { table3: false, table4: false };
  }
  if (mode === 'all' || mode === 'full' || mode === 'true' || mode === '1' || mode === 'on') {
    return { table3: true, table4: true };
  }
  if (mode === 'table4' || mode === 'table4-only') {
    return { table3: false, table4: true };
  }
  if (mode === 'table3' || mode === 'table3-only') {
    return { table3: true, table4: false };
  }
  const tokens = mode.split(/[,+|\s]+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length > 0) {
    const table3 = tokens.some((t) => t === 'table3' || t === 't3' || t === 'all' || t === 'full');
    const table4 = tokens.some((t) => t === 'table4' || t === 't4' || t === 'all' || t === 'full');
    if (table3 || table4) {
      return { table3, table4 };
    }
  }
  return { table3: false, table4: false };
}

describe('parse stabilize mode defaults', () => {
  it('enables table3+table4 for default mode string table3,table4', () => {
    expect(resolveStabilizeOptions('table3,table4')).toEqual({ table3: true, table4: true });
    expect(resolveStabilizeOptions('all')).toEqual({ table3: true, table4: true });
    expect(resolveStabilizeOptions('none')).toEqual({ table3: false, table4: false });
    expect(resolveStabilizeOptions('table4-only')).toEqual({ table3: false, table4: true });
  });

  it('repairs table4 block totals when stabilize options enable table4', () => {
    const output = {
      sections: [
        {
          type: 'table_4',
          reviewLitigationData: {
            review: { maintain: 1, correct: 2, other: 3, unfinished: 0, total: 99 },
          },
        },
      ],
    };
    const { repairs } = stabilizeParsedOutput(output, { table3: false, table4: true });
    expect(repairs.some((r) => r.includes('table_4'))).toBe(true);
    expect(output.sections[0].reviewLitigationData.review.total).toBe(6);
  });
});
