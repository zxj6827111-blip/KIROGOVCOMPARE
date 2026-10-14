/**
 * Unit tests for shipped resolveStabilizeOptions / env default path.
 */
import { stabilizeParsedOutput } from '../services/ParsedOutputStabilityService';
import {
  DEFAULT_PARSE_STABILIZE_MODE,
  resolveParseStabilizeModeFromEnv,
  resolveStabilizeOptions,
} from '../utils/parseStabilizeMode';

describe('parse stabilize mode (shipped util)', () => {
  it('defaults env mode to table3,table4', () => {
    expect(DEFAULT_PARSE_STABILIZE_MODE).toBe('table3,table4');
    expect(resolveParseStabilizeModeFromEnv({} as NodeJS.ProcessEnv)).toBe('table3,table4');
    expect(resolveParseStabilizeModeFromEnv({ LLM_PARSE_STABILIZE_MODE: 'none' } as NodeJS.ProcessEnv)).toBe(
      'none'
    );
  });

  it('enables table3+table4 for default mode string table3,table4', () => {
    expect(resolveStabilizeOptions(DEFAULT_PARSE_STABILIZE_MODE)).toEqual({
      table3: true,
      table4: true,
      table3NullBackfill: false,
    });
    expect(resolveStabilizeOptions('table3,table4')).toEqual({
      table3: true,
      table4: true,
      table3NullBackfill: false,
    });
    expect(resolveStabilizeOptions('all')).toEqual({ table3: true, table4: true, table3NullBackfill: false });
    expect(resolveStabilizeOptions('none')).toEqual({ table3: false, table4: false, table3NullBackfill: false });
    expect(resolveStabilizeOptions('table4-only')).toEqual({ table3: false, table4: true, table3NullBackfill: false });
  });

  /** 反推开关只能显式打开：生产上它是"会写数据"的那一层，'all' 也不例外。 */
  it('only turns null backfill on for the explicit token', () => {
    expect(resolveStabilizeOptions('table3,table4,table3-null-backfill')).toEqual({
      table3: true,
      table4: true,
      table3NullBackfill: true,
    });
    expect(resolveStabilizeOptions('table3+null-backfill').table3NullBackfill).toBe(true);
    expect(resolveStabilizeOptions('all').table3NullBackfill).toBe(false);
  });

  it('repairs table4 block totals when stabilize options enable table4', () => {
    const mode = resolveStabilizeOptions(DEFAULT_PARSE_STABILIZE_MODE);
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
    const { repairs } = stabilizeParsedOutput(output, mode);
    expect(mode.table4).toBe(true);
    expect(repairs.some((r) => r.includes('table_4'))).toBe(true);
    expect(output.sections[0].reviewLitigationData.review.total).toBe(6);
  });
});
