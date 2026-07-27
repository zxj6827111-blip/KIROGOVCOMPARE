import { formatAnnualReportText } from './textFormat';

describe('formatAnnualReportText', () => {
  it('normalizes spaces and sentence newlines', () => {
    const out = formatAnnualReportText('测试内容。  下一句！再一句？');
    expect(out.split('\n').length).toBeGreaterThan(1);
    expect(out).not.toMatch(/  +/);
  });
});
