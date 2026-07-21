import { hasParsedContent } from '../utils/parsedContent';

/**
 * Mirrors LlmJobRunner fingerprint-reuse gate without DB.
 * Reuse only when output has real parsed content.
 */
function shouldReuseAcceptedFingerprintOutput(outputJson: unknown): boolean {
  return hasParsedContent(outputJson);
}

describe('fingerprint reuse gate', () => {
  it('allows reuse for full table payload', () => {
    expect(
      shouldReuseAcceptedFingerprintOutput({
        sections: [{ type: 'table_3', tableData: { total: { newReceived: 1 } } }],
      })
    ).toBe(true);
  });

  it('rejects metadata-only shells that must re-parse', () => {
    expect(shouldReuseAcceptedFingerprintOutput({ basic_info: { unit: 'x' } })).toBe(false);
    expect(shouldReuseAcceptedFingerprintOutput({ sections: [] })).toBe(false);
    expect(shouldReuseAcceptedFingerprintOutput(null)).toBe(false);
  });
});
