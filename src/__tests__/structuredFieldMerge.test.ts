import { mergeStructuredFields, mergeTable2Fields, applyTable2DeterministicOverlay } from '../utils/structuredFieldMerge';

describe('mergeStructuredFields / mergeTable2Fields', () => {
  it('mergeTable2Fields prefers deterministic non-empty over conflicting AI and keeps AI when det empty', () => {
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
    const { merged, usedDeterministicPaths, conflicts } = mergeTable2Fields(existing as any, det as any);
    expect(merged.regulations.made).toBe(0);
    expect(merged.regulations).toEqual({ made: 0, repealed: 0, valid: 0 });
    expect(conflicts.some((c) => c.path === 'regulations.made')).toBe(true);
    expect(conflicts.some((c) => c.path === 'regulations.valid')).toBe(true);
    expect(merged.normativeDocuments).toEqual({ made: 13, repealed: 0, valid: 55 });
    expect(merged.licensing.processed).toBe(3);
    expect(usedDeterministicPaths).toEqual(
      expect.arrayContaining(['regulations.made', 'regulations.repealed', 'normativeDocuments.made'])
    );
  });

  it('uses deterministic when existing empty including zero', () => {
    const existing = { regulations: { made: null, repealed: null, valid: null } };
    const det = { regulations: { made: 0, repealed: 0, valid: 0 } };
    const { merged } = mergeTable2Fields(existing as any, det as any);
    expect(merged.regulations).toEqual({ made: 0, repealed: 0, valid: 0 });
  });

  it('records conflict but still applies deterministic when AI has other number', () => {
    const existing = { licensing: { processed: 100 } };
    const det = { licensing: { processed: 97 } };
    const { merged, conflicts } = mergeTable2Fields(existing as any, det as any);
    expect(merged.licensing.processed).toBe(97);
    expect(conflicts).toEqual([
      expect.objectContaining({ path: 'licensing.processed', deterministic: 97, existing: 100 }),
    ]);
  });

  it('existing_wins_on_conflict policy keeps AI value when requested', () => {
    const existing = { licensing: { processed: 100 } };
    const det = { licensing: { processed: 97 } };
    const { merged, conflicts } = mergeStructuredFields(existing as any, det as any, '', 'existing_wins_on_conflict');
    expect(merged.licensing.processed).toBe(100);
    expect(conflicts).toHaveLength(1);
  });

  it('applyTable2DeterministicOverlay keeps AI fill-ins and records conflicts (shared serial/parallel path)', () => {
    const ai = {
      activeDisclosureData: {
        regulations: { made: 9, repealed: null, valid: 1 },
        normativeDocuments: { made: null, repealed: null, valid: null },
        licensing: { processed: 3 },
        punishment: { processed: null },
        coercion: { processed: null },
        fees: { amount: null },
      },
    };
    const det = {
      regulations: { made: 0, repealed: 0, valid: 0 },
      normativeDocuments: { made: 13, repealed: 0, valid: 55 },
      licensing: { processed: null },
      punishment: { processed: 0 },
      coercion: { processed: 0 },
      fees: { amount: 0 },
    };
    const overlay = applyTable2DeterministicOverlay(ai as any, det as any);
    expect(overlay.activeDisclosureData.regulations).toEqual({ made: 0, repealed: 0, valid: 0 });
    expect(overlay.activeDisclosureData.normativeDocuments).toEqual({ made: 13, repealed: 0, valid: 55 });
    // det empty on licensing -> keep AI 3
    expect(overlay.activeDisclosureData.licensing.processed).toBe(3);
    expect(overlay.activeDisclosureData.punishment.processed).toBe(0);
    expect(overlay.merge_conflicts?.some((c) => c.path === 'regulations.made')).toBe(true);
    expect(overlay.merge_conflicts?.some((c) => c.path === 'regulations.valid')).toBe(true);
  });

  it('applyTable2DeterministicOverlay does not drop AI when det is partial (serial path regression)', () => {
    // OPENAI_SEGMENTED_PARALLEL_TABLES=false: AI first, then overlay det
    const aiOnly = {
      activeDisclosureData: {
        regulations: { made: null, repealed: null, valid: null },
        licensing: { processed: 97 },
        fees: { amount: 1.5 },
      },
    };
    const detPartial = {
      regulations: { made: 0, repealed: 0, valid: 0 },
      licensing: { processed: null },
      fees: { amount: null },
    };
    const overlay = applyTable2DeterministicOverlay(aiOnly as any, detPartial as any);
    expect(overlay.activeDisclosureData.regulations).toEqual({ made: 0, repealed: 0, valid: 0 });
    expect(overlay.activeDisclosureData.licensing.processed).toBe(97);
    expect(overlay.activeDisclosureData.fees.amount).toBe(1.5);
  });
});
