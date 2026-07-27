import {
  buildBlankAnnualReportForm,
  ensureSixSectionForm,
  validateFilingFormStructure,
} from '../services/filing/BlankTemplateService';

describe('BlankTemplateService', () => {
  it('builds fixed six sections for 国办 template', () => {
    const form = buildBlankAnnualReportForm({ year: 2025, unitName: '测试局', regionId: 1 });
    expect(form.sections).toHaveLength(6);
    expect(form.sections.map((s: any) => s.type)).toEqual([
      'text',
      'table_2',
      'table_3',
      'table_4',
      'text',
      'text',
    ]);
    expect(form.sections[1].activeDisclosureData.regulations).toEqual({
      made: 0,
      repealed: 0,
      valid: 0,
    });
    expect(form.sections[2].tableData.naturalPerson).toBeDefined();
    expect(form.sections[3].reviewLitigationData.review).toBeDefined();
    expect(validateFilingFormStructure(form).ok).toBe(true);
  });

  it('normalizes partial form back to six sections', () => {
    const partial = {
      sections: [{ type: 'text', title: '一、总体情况', content: 'hello' }],
    };
    const fixed = ensureSixSectionForm(partial, { year: 2024 });
    expect(fixed.sections).toHaveLength(6);
    expect(fixed.sections[0].content).toBe('hello');
    expect(fixed.sections[2].type).toBe('table_3');
    expect(validateFilingFormStructure(fixed).ok).toBe(true);
  });

  it('rejects invalid structure', () => {
    expect(validateFilingFormStructure({ sections: [] }).ok).toBe(false);
  });
});
