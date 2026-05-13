import {
  __parseRunInternals,
  buildParseConfigSnapshot,
  buildParseFingerprint,
} from '../services/ParseRunService';

describe('ParseRunService foundation helpers', () => {
  it('builds a stable fingerprint independent of object key order', () => {
    const first = buildParseConfigSnapshot({
      provider: 'openai',
      model: 'gpt-5.5',
      promptVersion: 'rules-v1',
      sourceGate: {
        strategy: 'standard',
        uncertainThreshold: 10,
        highConfidenceBlocking: true,
        warningThreshold: 5,
      },
    });

    const second = {
      sourceGate: {
        warningThreshold: 5,
        highConfidenceBlocking: true,
        uncertainThreshold: 10,
        strategy: 'standard',
      },
      promptRulesVersion: first.promptRulesVersion,
      ruleGateEnabled: first.ruleGateEnabled,
      stabilizeMode: first.stabilizeMode,
      schemaVersion: first.schemaVersion,
      sourceExtractorVersion: first.sourceExtractorVersion,
      parserVersion: first.parserVersion,
      promptVersion: first.promptVersion,
      model: first.model,
      provider: first.provider,
    };

    expect(buildParseFingerprint(first)).toBe(buildParseFingerprint(second));
  });

  it('includes source gate warning threshold in fingerprint', () => {
    const base = buildParseConfigSnapshot({
      provider: 'openai',
      model: 'gpt-5.5',
      sourceGate: {
        strategy: 'standard',
        uncertainThreshold: 10,
        highConfidenceBlocking: true,
        warningThreshold: 5,
      },
    });
    const changed = buildParseConfigSnapshot({
      ...base,
      sourceGate: {
        ...base.sourceGate,
        warningThreshold: 8,
      },
    });

    expect(buildParseFingerprint(base)).not.toBe(buildParseFingerprint(changed));
  });

  it('keeps finalize_failed distinct from intended final status', () => {
    expect(__parseRunInternals.inferErrorCode('accepted')).toBeNull();
    expect(__parseRunInternals.inferErrorCode('failed')).toBe('LLM_API_ERROR');
    expect(__parseRunInternals.inferErrorCode('gate_failed')).toBe('PARSE_RULE_GATE_FAILED');

    expect(
      __parseRunInternals.inferErrorMessage('gate_failed', {
        issues: ['table_3.total mismatch', 'source mismatch'],
      })
    ).toContain('table_3.total mismatch');
  });
});
