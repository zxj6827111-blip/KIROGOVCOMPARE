import {
  getReportContentQuality,
  getReportMaintenanceStatus,
  toRegionKey,
} from '../utils/reportMaintenance';

describe('report maintenance status helpers', () => {
  it('uses stable region keys for Postgres bigint/string ids', () => {
    const reportsByRegion = new Map<string, { report_id: number }>();
    reportsByRegion.set(toRegionKey('775'), { report_id: 12 });

    expect(reportsByRegion.get(toRegionKey(775))?.report_id).toBe(12);
  });

  it('does not classify an uploaded but unparsed report as missing', () => {
    expect(getReportMaintenanceStatus({
      report_id: 12,
      region_id: '775',
      year: 2024,
      effective_version_id: 34,
      parsed_json: {},
      raw_text: null,
    })).toBe('empty');
  });

  it('treats empty narrative plus all-zero table shells as empty content', () => {
    const report = {
      report_id: 12,
      region_id: '775',
      year: 2024,
      effective_version_id: 34,
      parsed_json: {
        sections: [
          { type: 'text', title: '一、总体情况', content: '' },
          {
            type: 'table_2',
            activeDisclosureData: {
              regulations: { made: 0, repealed: 0, valid: 0 },
              fees: { amount: 0 },
            },
          },
          {
            type: 'table_3',
            tableData: {
              total: {
                newReceived: 0,
                carriedOver: 0,
                results: { granted: 0, totalProcessed: 0, carriedForward: 0 },
              },
            },
          },
          {
            type: 'table_4',
            reviewLitigationData: {
              review: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
            },
          },
        ],
      },
      raw_text: '',
    };

    expect(getReportMaintenanceStatus(report)).toBe('empty');
    expect(getReportContentQuality(report)).toMatchObject({
      status: 'empty',
      raw_text_length: 0,
      parsed_text_length: 0,
      source_content_empty: true,
      has_meaningful_table_data: false,
      suppress_display_tables: true,
    });
  });

  it('suppresses display tables whenever source narrative is empty', () => {
    expect(getReportContentQuality({
      report_id: 12,
      region_id: '775',
      year: 2024,
      effective_version_id: 34,
      parsed_json: {
        sections: [
          { type: 'text', title: '涓€銆佹€讳綋鎯呭喌', content: '' },
          {
            type: 'table_2',
            activeDisclosureData: {
              regulations: { made: 3, repealed: 0, valid: 5 },
            },
          },
        ],
      },
      raw_text: '',
    })).toMatchObject({
      source_content_empty: true,
      has_meaningful_table_data: true,
      suppress_display_tables: true,
    });
  });

  it('treats a report with parsed content and source text as complete', () => {
    const rawText = 'a'.repeat(120);

    expect(getReportMaintenanceStatus({
      report_id: 12,
      region_id: '775',
      year: 2024,
      effective_version_id: 34,
      parsed_json: {
        sections: [
          {
            type: 'overview',
            content: rawText,
          },
        ],
      },
      raw_text: rawText,
    })).toBeNull();
  });
});
