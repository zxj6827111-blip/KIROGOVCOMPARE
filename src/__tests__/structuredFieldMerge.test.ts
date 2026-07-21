import { mergeStructuredFields } from '../utils/structuredFieldMerge';

describe('mergeStructuredFields', () => {
  it('prefers deterministic non-empty and keeps existing when det empty', () => {
    const existing = {
      regulations: { made: 9, repealed: null, valid: 1 },
      normativeDocuments: { made: null, repealed: null, valid: null },
      licensing: { processed: 3 },
    };
    const det = {
      regulations: { made: 0, repealed: 0, valid: 0 },
      normativeDocuments: { made: 13, repealed: 0, valid: 55 },
      licensing: { processed: null },
    };
    const { merged, usedDeterministicPaths, conflicts } = mergeStructuredFields(existing as any, det as any);
    expect(merged.regulations.made).toBe(9);
    expect(conflicts.some((c) => c.path === 'regulations.made')).toBe(true);
    expect(merged.regulations.repealed).toBe(0);
    expect(merged.normativeDocuments).toEqual({ made: 13, repealed: 0, valid: 55 });
    expect(merged.licensing.processed).toBe(3);
    expect(usedDeterministicPaths).toEqual(expect.arrayContaining(['regulations.repealed', 'normativeDocuments.made']));
  });

  it('uses deterministic when existing empty including zero', () => {
    const existing = { regulations: { made: null, repealed: null, valid: null } };
    const det = { regulations: { made: 0, repealed: 0, valid: 0 } };
    const { merged } = mergeStructuredFields(existing as any, det as any);
    expect(merged.regulations).toEqual({ made: 0, repealed: 0, valid: 0 });
  });
});

