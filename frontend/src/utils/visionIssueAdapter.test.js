import { normalizeVisionReviewGroups, normalizeVisionReviewItem } from './visionIssueAdapter';

describe('visionIssueAdapter', () => {
  test('maps parse mismatch reviews and pending corrections for 4837-like data', () => {
    const result = normalizeVisionReviewGroups({
      reviews: [
        {
          id: 4837,
          tableId: 'table_3',
          status: 'completed',
          conclusion: 'parse_mapping_anomaly',
          comparison: {
            differences: [
              { path: 'tableData.total.results.totalProcessed', parsedValue: 12, ocrValue: 21 },
            ],
            unreadableCells: [],
          },
        },
      ],
      corrections: Array.from({ length: 15 }, (_, index) => ({
        id: 600 + index,
        tableId: 'table_3',
        fieldPath: `tableData.total.results.totalProcessed.${index}`,
        parsedValue: index,
        ocrValue: index + 1,
        status: 'pending',
      })),
    });

    expect(result.issues).toHaveLength(16);
    expect(result.issues.filter((issue) => issue.source === 'vision')).toHaveLength(1);
    expect(result.issues.filter((issue) => issue.source === 'ocr')).toHaveLength(15);
    expect(result.issues[0].issueType).toBe('ocr_review');
    expect(result.issues.some((issue) => issue.issueType === 'ocr_correction')).toBe(true);
    expect(result.issues.every((issue) => issue.displayNo === null)).toBe(true);
    expect(result.markerIndexByPath['tableData.total.results.totalProcessed'].every((issue) => issue.source !== 'checks')).toBe(true);
  });

  test('maps source anomaly and confirmed correction with success tone for 4839-like data', () => {
    const sourceAnomaly = normalizeVisionReviewItem(
      {
        id: 4839,
        tableId: 'table_4',
        status: 'completed',
        conclusion: 'source_table_anomaly',
        comparison: {
          differences: [],
          unreadableCells: [],
        },
      }
    );

    const confirmedCorrection = normalizeVisionReviewItem(
      {
        id: 4840,
        tableId: 'table_4',
        status: 'completed',
        conclusion: 'source_table_matches_parse',
        comparison: {
          differences: [],
          unreadableCells: [],
        },
      },
      {
        id: 701,
        tableId: 'table_4',
        fieldPath: 'reviewLitigationData.review.total',
        status: 'confirmed',
      }
    );

    expect(sourceAnomaly.issueType).toBe('source_anomaly');
    expect(sourceAnomaly.tone).toBe('ocr');
    expect(sourceAnomaly.displayNo).toBeNull();

    expect(confirmedCorrection.issueType).toBe('ocr_correction');
    expect(confirmedCorrection.tone).toBe('success');
    expect(confirmedCorrection.severity).toBe('success');
    expect(confirmedCorrection.markers[0].path).toBe('reviewLitigationData.review.total');
    expect(confirmedCorrection.displayNo).toBeNull();
  });
});
