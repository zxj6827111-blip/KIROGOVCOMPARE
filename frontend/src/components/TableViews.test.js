import React from 'react';
import { render, screen } from '@testing-library/react';
import { Table2View, Table3View } from './TableViews';

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

  test('does not count confirmed UNCERTAIN rows as pending review in table2 summary', () => {
    render(
      <Table2View
        data={baseData}
        tableIssues={[
          {
            ...tableIssues[1],
            id: 3,
            stableIssueId: 'id:3',
            displayNo: null,
            human_status: 'confirmed',
          },
        ]}
      />
    );

    expect(screen.getByText('待复核 0')).toBeInTheDocument();
    expect(screen.getByText('已确认提示：不计入问题数。')).toBeInTheDocument();
  });
});

describe('Table3View', () => {
  test('highlights carried-over cells as primary for identity issues', () => {
    const table3Data = {
      naturalPerson: {
        newReceived: 100,
        carriedOver: 5,
        results: {
          granted: 0,
          partialGrant: 0,
          denied: {
            stateSecret: 0,
            lawForbidden: 0,
            safetyStability: 0,
            thirdPartyRights: 0,
            internalAffairs: 0,
            processInfo: 0,
            enforcementCase: 0,
            adminQuery: 0,
          },
          unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
          notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
          other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
          totalProcessed: 97,
          carriedForward: 2,
        },
      },
      legalPerson: {
        commercial: {
          newReceived: 0,
          carriedOver: 0,
          results: {
            granted: 0,
            partialGrant: 0,
            denied: {
              stateSecret: 0,
              lawForbidden: 0,
              safetyStability: 0,
              thirdPartyRights: 0,
              internalAffairs: 0,
              processInfo: 0,
              enforcementCase: 0,
              adminQuery: 0,
            },
            unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
            notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
            other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
            totalProcessed: 0,
            carriedForward: 0,
          },
        },
        research: {
          newReceived: 0,
          carriedOver: 0,
          results: {
            granted: 0,
            partialGrant: 0,
            denied: {
              stateSecret: 0,
              lawForbidden: 0,
              safetyStability: 0,
              thirdPartyRights: 0,
              internalAffairs: 0,
              processInfo: 0,
              enforcementCase: 0,
              adminQuery: 0,
            },
            unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
            notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
            other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
            totalProcessed: 0,
            carriedForward: 0,
          },
        },
        social: {
          newReceived: 0,
          carriedOver: 0,
          results: {
            granted: 0,
            partialGrant: 0,
            denied: {
              stateSecret: 0,
              lawForbidden: 0,
              safetyStability: 0,
              thirdPartyRights: 0,
              internalAffairs: 0,
              processInfo: 0,
              enforcementCase: 0,
              adminQuery: 0,
            },
            unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
            notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
            other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
            totalProcessed: 0,
            carriedForward: 0,
          },
        },
        legal: {
          newReceived: 0,
          carriedOver: 0,
          results: {
            granted: 0,
            partialGrant: 0,
            denied: {
              stateSecret: 0,
              lawForbidden: 0,
              safetyStability: 0,
              thirdPartyRights: 0,
              internalAffairs: 0,
              processInfo: 0,
              enforcementCase: 0,
              adminQuery: 0,
            },
            unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
            notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
            other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
            totalProcessed: 0,
            carriedForward: 0,
          },
        },
        other: {
          newReceived: 0,
          carriedOver: 0,
          results: {
            granted: 0,
            partialGrant: 0,
            denied: {
              stateSecret: 0,
              lawForbidden: 0,
              safetyStability: 0,
              thirdPartyRights: 0,
              internalAffairs: 0,
              processInfo: 0,
              enforcementCase: 0,
              adminQuery: 0,
            },
            unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
            notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
            other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
            totalProcessed: 0,
            carriedForward: 0,
          },
        },
      },
      total: {
        newReceived: 100,
        carriedOver: 5,
        results: {
          granted: 0,
          partialGrant: 0,
          denied: {
            stateSecret: 0,
            lawForbidden: 0,
            safetyStability: 0,
            thirdPartyRights: 0,
            internalAffairs: 0,
            processInfo: 0,
            enforcementCase: 0,
            adminQuery: 0,
          },
          unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
          notProcessed: { complaint: 0, repeat: 0, publication: 0, massiveRequests: 0, confirmInfo: 0 },
          other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
          totalProcessed: 97,
          carriedForward: 2,
        },
      },
    };

    const identityIssue = {
      id: 101,
      stableIssueId: 'id:101',
      displayNo: 1,
      title: '收办平衡（自然人列）',
      check_key: 't3_identity_naturalPerson',
      auto_status: 'FAIL',
      human_status: 'pending',
      evidence: {
        leftPaths: ['tableData.naturalPerson.newReceived', 'tableData.naturalPerson.carriedOver'],
        rightPaths: ['tableData.naturalPerson.results.totalProcessed', 'tableData.naturalPerson.results.carriedForward'],
      },
    };

    const { container } = render(
      <Table3View
        data={table3Data}
        tableIssues={[identityIssue]}
      />
    );

    const carriedOverCell = container.querySelector('[data-cell-path="tableData.naturalPerson.carriedOver"]');
    expect(carriedOverCell).not.toBeNull();
    expect(carriedOverCell.className).toContain('cell-issue-primary');
    expect(carriedOverCell.className).toContain('cell-issue-tone--identity');
    expect(carriedOverCell.querySelector('.issue-badge')).not.toBeNull();
  });
});
