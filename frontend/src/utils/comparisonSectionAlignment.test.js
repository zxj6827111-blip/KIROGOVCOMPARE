import {
  alignComparisonSections,
  normalizeComparisonSectionTitle,
} from './comparisonSectionAlignment';

describe('comparison section alignment', () => {
  test('normalizes fifth-section title variants that use 及 or 和', () => {
    expect(normalizeComparisonSectionTitle('五、存在的主要问题及改进情况', 'text')).toBe(
      normalizeComparisonSectionTitle('五、存在的主要问题和改进情况', 'text')
    );
  });

  test('aligns fifth-section variants into one row', () => {
    const rows = alignComparisonSections(
      [{ type: 'text', title: '五、存在的主要问题及改进情况', content: '旧正文' }],
      [{ type: 'text', title: '五、存在的主要问题和改进情况', content: '新正文' }]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(expect.objectContaining({
      title: '五、存在的主要问题及改进情况',
      oldSec: expect.objectContaining({ content: '旧正文' }),
      newSec: expect.objectContaining({ content: '新正文' }),
    }));
  });
});
