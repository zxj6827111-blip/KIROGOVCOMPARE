import { __materializeInternals } from '../services/MaterializeService';

describe('MaterializeService normalizeParsedPayload', () => {
  const {
    normalizeParsedPayload,
    normalizeValue,
    coerceActiveDisclosureFactValue,
    buildActiveDisclosure,
  } = __materializeInternals;

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

  it('preserves table2 raw and semantic while nulling unsafe typed count facts', () => {
    const parsed = {
      sections: [
        {
          type: 'table_2',
          activeDisclosureData: {
            regulations: { valid: -1 },
            licensing: { processed: 1.5 },
            punishment: { processed: 'abc' },
            fees: { amount: -10 },
            coercion: { processed: '/' },
            normativeDocuments: { valid: 0 },
          },
        },
      ],
    };

    const { facts, cells } = buildActiveDisclosure(parsed);
    const factByCategory = Object.fromEntries(facts.map((fact: any) => [fact.category, fact]));
    const cellByRef = Object.fromEntries(cells.map((cell: any) => [cell.cell_ref, cell]));

    expect(factByCategory.regulations.valid_count).toBe(-1);
    expect(factByCategory.licensing.processed_count).toBeNull();
    expect(factByCategory.punishment.processed_count).toBeNull();
    expect(factByCategory.coercion.processed_count).toBeNull();
    expect(factByCategory.normative_documents.valid_count).toBe(0);
    expect(factByCategory.fees.amount).toBe(-10);

    expect(cellByRef['active_disclosure:regulations:valid']).toMatchObject({
      value_raw: '-1',
      value_num: -1,
      value_semantic: 'NUMERIC',
      normalized_value: '-1',
    });
    expect(cellByRef['active_disclosure:licensing:processed']).toMatchObject({
      value_raw: '1.5',
      value_num: 1.5,
      value_semantic: 'NUMERIC',
      normalized_value: '1.5',
    });
    expect(cellByRef['active_disclosure:punishment:processed']).toMatchObject({
      value_raw: 'abc',
      value_num: null,
      value_semantic: 'TEXT',
      normalized_value: 'abc',
    });
    expect(cellByRef['active_disclosure:coercion:processed']).toMatchObject({
      value_raw: '/',
      value_num: null,
      value_semantic: 'NA',
      normalized_value: '/',
    });
    expect(cellByRef['active_disclosure:normative_documents:valid']).toMatchObject({
      value_raw: '0',
      value_num: 0,
      value_semantic: 'ZERO',
      normalized_value: '0',
    });
  });

  it('treats em dash and 不适用 as NA while keeping zero and decimals meaningful', () => {
    expect(normalizeValue('—')).toMatchObject({ semantic: 'NA', num: null, normalized: '—' });
    expect(normalizeValue('不适用')).toMatchObject({ semantic: 'NA', num: null, normalized: '不适用' });
    expect(normalizeValue('0')).toMatchObject({ semantic: 'ZERO', num: 0, normalized: '0' });
    expect(normalizeValue('3415.74')).toMatchObject({ semantic: 'NUMERIC', num: 3415.74, normalized: '3415.74' });
  });

  it('only writes active disclosure typed counts when values are safe integers', () => {
    expect(coerceActiveDisclosureFactValue('processed_count', 1.5)).toBeNull();
    expect(coerceActiveDisclosureFactValue('processed_count', 'abc')).toBeNull();
    expect(coerceActiveDisclosureFactValue('processed_count', '/')).toBeNull();
    expect(coerceActiveDisclosureFactValue('processed_count', 0)).toBe(0);
    expect(coerceActiveDisclosureFactValue('valid_count', -1)).toBe(-1);
    expect(coerceActiveDisclosureFactValue('amount', 3415.74)).toBe(3415.74);
    expect(coerceActiveDisclosureFactValue('amount', -10)).toBe(-10);
  });
});
