import { __materializeInternals } from '../services/MaterializeService';

describe('MaterializeService normalizeParsedPayload', () => {
  const { normalizeParsedPayload } = __materializeInternals;

  it('should parse valid raw_text JSON into sections', () => {
    const payload = {
      raw_text: JSON.stringify({
        sections: [
          { type: 'table_2', activeDisclosureData: { regulations: { made: 1, repealed: 0, valid: 1 } } },
          { type: 'table_3', tableData: { naturalPerson: { newReceived: 2, carriedOver: 0, results: { granted: 1 } } } },
          { type: 'table_4', reviewLitigationData: { review: { maintain: 1, correct: 0, other: 0, unfinished: 0, total: 1 } } },
        ],
      }),
    };

    const normalized = normalizeParsedPayload(payload);
    expect(Array.isArray(normalized.sections)).toBe(true);
    expect(normalized.sections.find((section: any) => section.type === 'table_2')).toBeTruthy();
    expect(normalized.sections.find((section: any) => section.type === 'table_3')).toBeTruthy();
    expect(normalized.sections.find((section: any) => section.type === 'table_4')).toBeTruthy();
  });

  it('should recover table payloads from invalid raw_text JSON', () => {
    const table2 = { regulations: { made: 1, repealed: 0, valid: 1 } };
    const table3 = { naturalPerson: { newReceived: 2, carriedOver: 0, results: { granted: 1 } } };
    const table4 = { review: { maintain: 1, correct: 0, other: 0, unfinished: 0, total: 1 } };

    const rawText = `{
      "sections": [
        {"type":"text","content":"broken tail example"},
        {"type":"table_2","activeDisclosureData":${JSON.stringify(table2)}},
        {"type":"table_3","tableData":${JSON.stringify(table3)}},
        {"type":"table_4","reviewLitigationData":${JSON.stringify(table4)}}
      ],
      "tail": "unterminated"
    `;

    const normalized = normalizeParsedPayload({ raw_text: rawText });
    const section2 = normalized.sections.find((section: any) => section.type === 'table_2');
    const section3 = normalized.sections.find((section: any) => section.type === 'table_3');
    const section4 = normalized.sections.find((section: any) => section.type === 'table_4');

    expect(section2?.activeDisclosureData).toEqual(table2);
    expect(section3?.tableData).toEqual(table3);
    expect(section4?.reviewLitigationData).toEqual(table4);
  });
});
