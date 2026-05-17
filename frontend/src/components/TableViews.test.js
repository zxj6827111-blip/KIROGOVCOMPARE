import React from 'react';
import { render, screen } from '@testing-library/react';
import { Table2View } from './TableViews';

const baseData = {
  regulations: { made: 0, repealed: 0, valid: -1 },
  normativeDocuments: { made: 0, repealed: 0, valid: 0 },
  licensing: { processed: 1.5 },
  punishment: { processed: 'abc' },
  coercion: { processed: '/' },
  fees: { amount: -10 },
};

const tableIssues = [
  {
    id: 1,
    stableIssueId: 'id:1',
    displayNo: 1,
    title: '表二：规章-现行有效件数应为非负数',
    check_key: 't2_non_negative_counts_regulations_valid',
    auto_status: 'FAIL',
    human_status: 'confirmed',
    fieldPath: 'activeDisclosureData.regulations.valid',
    evidence: {
      paths: ['activeDisclosureData.regulations.valid'],
    },
  },
  {
    id: 2,
    stableIssueId: 'id:2',
    displayNo: 2,
    title: '表二：行政许可-处理决定数量应为整数',
    check_key: 't2_integer_counts_licensing_processed',
    auto_status: 'UNCERTAIN',
    human_status: 'pending',
    fieldPath: 'activeDisclosureData.licensing.processed',
    evidence: {
      paths: ['activeDisclosureData.licensing.processed'],
    },
  },
];

describe('Table2View', () => {
  test('keeps confirmed and uncertain issues visible in content view', () => {
    render(
      <Table2View
        data={baseData}
        tableIssues={tableIssues}
        highlightCells={[
          { path: 'activeDisclosureData.regulations.valid', type: 'diff', confirmed: true },
          { path: 'activeDisclosureData.licensing.processed', type: 'diff', confirmed: false },
        ]}
      />
    );

    expect(screen.getByText('表二发现 2 条需处理提示')).toBeInTheDocument();
    expect(screen.getByText('表二：规章-现行有效件数应为非负数')).toBeInTheDocument();
    expect(screen.getByText('表二：行政许可-处理决定数量应为整数')).toBeInTheDocument();
    expect(screen.getByText('已确认')).toBeInTheDocument();
    expect(screen.getByText('问题项：仍计入问题数。')).toBeInTheDocument();
    expect(screen.getByText('待复核项：不计入问题数。')).toBeInTheDocument();
  });

  test('keeps badge and confirmed highlight metadata on matched table2 cell', () => {
    const { container } = render(
      <Table2View
        data={baseData}
        tableIssues={tableIssues}
        highlightCells={[
          { path: 'activeDisclosureData.regulations.valid', type: 'diff', confirmed: true },
        ]}
      />
    );

    const regulationsCell = container.querySelector('[data-cell-path="activeDisclosureData.regulations.valid"]');
    expect(regulationsCell).not.toBeNull();
    expect(regulationsCell.className).toContain('cell-issue-confirmed');
    expect(regulationsCell.querySelector('.issue-badge')).not.toBeNull();
  });
});
