import React from 'react';
import { render } from '@testing-library/react';
import { Table3View } from './TableViews';

/**
 * 表三空格的三态显示：原文的横杠（cells 里 NA）继续显示「-」，解析没取到值（EMPTY）
 * 显示「缺失」灰标，整行没解析出来的申请人保持「-」—— 三种情况以前长得一模一样，
 * 复核人员无法判断该去复核还是原文本来就没有。
 */

const RESULT_FIELDS = ['granted', 'partialGrant', 'totalProcessed', 'carriedForward'];
const RESULT_GROUPS = {
  denied: ['stateSecret', 'lawForbidden', 'safetyStability', 'thirdPartyRights', 'internalAffairs', 'processInfo', 'enforcementCase', 'adminQuery'],
  unableToProvide: ['noInfo', 'needCreation', 'unclear'],
  notProcessed: ['complaint', 'repeat', 'publication', 'massiveRequests', 'confirmInfo'],
  other: ['overdueCorrection', 'overdueFee', 'otherReasons'],
};

function makeEntity(overrides = {}) {
  const results = {};
  RESULT_FIELDS.forEach((field) => { results[field] = 0; });
  Object.entries(RESULT_GROUPS).forEach(([group, keys]) => {
    results[group] = {};
    keys.forEach((key) => { results[group][key] = 0; });
  });
  const entity = { newReceived: 0, carriedOver: 0, results };

  for (const [path, value] of Object.entries(overrides)) {
    const segments = path.split('.');
    let cursor = entity;
    for (const segment of segments.slice(0, -1)) cursor = cursor[segment];
    cursor[segments[segments.length - 1]] = value;
  }
  return entity;
}

const tableData = {
  naturalPerson: makeEntity({
    'results.partialGrant': null,
    'results.denied.stateSecret': '-',
  }),
  legalPerson: {
    commercial: makeEntity(),
    social: makeEntity(),
    legal: makeEntity(),
    other: makeEntity(),
  },
  total: makeEntity(),
};

const cellOf = (container, path) => container.querySelector(`[data-cell-path="${path}"]`);

describe('Table3View 空值三态', () => {
  it('marks a parsed-null cell as 缺失 with a review tooltip', () => {
    const { container } = render(<Table3View data={tableData} />);
    const cell = cellOf(container, 'tableData.naturalPerson.results.partialGrant');

    expect(cell.textContent).toContain('缺失');
    expect(cell.getAttribute('title')).toContain('解析未取到值，待复核');
    expect(cell.querySelector('.cell-value-missing')).not.toBeNull();
  });

  it('keeps the source dash for NA cells instead of calling them missing', () => {
    const { container } = render(<Table3View data={tableData} />);
    const cell = cellOf(container, 'tableData.naturalPerson.results.denied.stateSecret');

    expect(cell.textContent).toBe('-');
    expect(cell.querySelector('.cell-value-missing')).toBeNull();
  });

  it('leaves cells of an applicant row the report never had as -', () => {
    const { container } = render(<Table3View data={tableData} />);

    expect(cellOf(container, 'tableData.legalPerson.research.newReceived').textContent).toBe('-');
    expect(cellOf(container, 'tableData.legalPerson.research.results.granted').textContent).toBe('-');
  });

  it('still renders real zeros untouched', () => {
    const { container } = render(<Table3View data={tableData} />);

    expect(cellOf(container, 'tableData.total.results.totalProcessed').textContent).toBe('0');
  });
});
