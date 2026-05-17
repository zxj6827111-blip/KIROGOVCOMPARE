import { normalizeDiagnosticsIssueGroups } from './diagnosticsIssueAdapter';

describe('diagnosticsIssueAdapter', () => {
  test('maps suspicious rows and suspiciousByPath as low priority hints', () => {
    const diagnostics = {
      suspiciousRows: [
        {
          key: 'split_1',
          title: 'split hint',
          message: 'split hint',
          candidates: [
            {
              leftPath: 'tableData.total.total',
              rightPath: 'tableData.total.results.totalProcessed',
            },
          ],
        },
      ],
      suspiciousByPath: new Map([
        ['tableData.total.total', { title: 'split hint', marker: 'split', type: 'split' }],
      ]),
    };

    const result = normalizeDiagnosticsIssueGroups(diagnostics);

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.every((issue) => issue.source === 'diagnostics')).toBe(true);
    expect(result.issues.every((issue) => issue.issueType === 'table_split_hint')).toBe(true);
    expect(result.issues.every((issue) => issue.priority === 10)).toBe(true);
    expect(result.markerIndexByPath['tableData.total.total'].every((issue) => issue.source === 'diagnostics')).toBe(true);
  });
});
