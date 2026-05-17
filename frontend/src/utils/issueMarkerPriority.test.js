import { buildMarkerShell, sortMarkersByPriority } from './issueMarkerPriority';

describe('issueMarkerPriority', () => {
  test('sorts cross-source markers by the expected priority order', () => {
    const markers = sortMarkersByPriority([
      buildMarkerShell({ path: 'p', role: 'primary', issueType: 'table_split_hint', source: 'diagnostics', priority: 10, issueId: 'd1' }),
      buildMarkerShell({ path: 'p', role: 'primary', issueType: 'quality_empty', source: 'quality', priority: 50, issueId: 'q1' }),
      buildMarkerShell({ path: 'p', role: 'primary', issueType: 'ocr_review', source: 'vision', priority: 40, issueId: 'v1' }),
      buildMarkerShell({ path: 'p', role: 'primary', issueType: 'ocr_correction', source: 'ocr', priority: 35, issueId: 'o1', humanStatus: 'confirmed' }),
      buildMarkerShell({ path: 'p', role: 'primary', issueType: 'consistency_table3_identity', source: 'checks', priority: 100, issueId: 'c1' }),
    ]);

    expect(markers.map((marker) => marker.source)).toEqual(['checks', 'quality', 'vision', 'ocr', 'diagnostics']);
    expect(markers[0].priority).toBe(100);
    expect(markers[4].priority).toBe(10);
  });
});
