import { buildSourceGateConfig, parseSourceNumber, sourceGateService } from '../services/SourceGateService';

describe('SourceGateService', () => {
  it('preserves numeric semantics for zero, NA and empty values', () => {
    expect(parseSourceNumber('0')).toEqual({ value: 0, semantic: 'ZERO', raw: '0' });
    expect(parseSourceNumber('/')).toEqual({ value: null, semantic: 'NA', raw: '/' });
    expect(parseSourceNumber('')).toEqual({ value: null, semantic: 'EMPTY', raw: '' });
    expect(parseSourceNumber('1,234')).toEqual({ value: 1234, semantic: 'NUMERIC', raw: '1,234' });
  });

  it('marks table3 source checks as warnings when source values cannot be located', () => {
    const output = {
      sections: [
        {
          type: 'table_3',
          tableData: {
            naturalPerson: {
              newReceived: 2,
              carriedOver: 0,
              results: { granted: 1, totalProcessed: 1, carriedForward: 0 },
            },
          },
        },
      ],
    };

    const result = sourceGateService.evaluate(output, '自然人 本年新收 上年结转 0 予以公开 1', {
      ...buildSourceGateConfig({ strategy: 'standard' }),
      uncertainThreshold: 1,
    });

    expect(result.status).toBe('warning');
    expect(result.passed).toBe(true);
    expect(result.uncertainCount).toBeGreaterThan(0);
  });

  it('returns not_assessable when table3 is missing', () => {
    const result = sourceGateService.evaluate({ sections: [] }, 'plain text');
    expect(result.status).toBe('not_assessable');
    expect(result.passed).toBe(true);
  });

  it('builds table3 source snapshots with stable row and column coordinates', () => {
    const output = {
      sections: [
        {
          type: 'table_3',
          tableData: {
            naturalPerson: {
              newReceived: 2,
              carriedOver: 0,
              results: { granted: 1, totalProcessed: 1, carriedForward: 0 },
            },
          },
        },
      ],
    };

    const snapshots = sourceGateService.buildSourceSnapshots(
      output,
      '自然人 本年新收 2 上年结转 0 予以公开 1',
      { sourcePath: 'data/uploads/sample.html', sourceType: 'html' }
    );

    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0]).toMatchObject({
      source_type: 'html',
      source_path: 'data/uploads/sample.html',
      table_id: 'table_3',
      row_index: 0,
      col_index: 0,
      row_span: 1,
      col_span: 1,
      row_header: 'newReceived',
      col_header: 'naturalPerson',
      cell_text: '2',
      normalized_text: '2',
    });
    expect(snapshots[0].metadata_json).toMatchObject({
      path: 'table3.naturalPerson.newReceived',
      semantic: 'NUMERIC',
    });
  });
});
