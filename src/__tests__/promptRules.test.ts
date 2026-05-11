import { buildStrictParseSystemInstruction, buildSystemInstruction } from '../services/LlmCommon';
import {
  buildTable3ParseSystemInstruction,
  buildTable4ParseSystemInstruction,
} from '../services/SegmentedAnnualReportParse';
import { injectCommonRules } from '../services/PromptRules';

describe('PromptRules injection', () => {
  it('injects common parse rules into full-document builders', () => {
    const system = buildSystemInstruction();
    const strict = buildStrictParseSystemInstruction();

    expect(system).toContain('=== COMMON PARSE RULES ===');
    expect(system).toContain('Never split one table cell number');
    expect(strict.match(/=== COMMON PARSE RULES ===/g)?.length).toBe(1);
  });

  it('injects common rules into segmented table builders', () => {
    expect(buildTable3ParseSystemInstruction()).toContain('PROMPT_RULES_VERSION=');
    expect(buildTable3ParseSystemInstruction()).toContain('For table_3');
    expect(buildTable4ParseSystemInstruction()).toContain('Table_4 flattened row rule');
  });

  it('does not duplicate injected rules', () => {
    const once = injectCommonRules('base');
    const twice = injectCommonRules(once);
    expect(twice.match(/=== COMMON PARSE RULES ===/g)?.length).toBe(1);
  });
});
