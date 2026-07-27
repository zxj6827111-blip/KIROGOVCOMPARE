import { formatAnnualReportText, formatAllTextSections } from '../services/filing/textFormat';

describe('filing textFormat', () => {
  it('formats body text with sentence breaks and section markers', () => {
    const raw = '总体情况如下。工作扎实推进。（一）完善制度  二、强化落实';
    const out = formatAnnualReportText(raw);
    expect(out).toContain('。\n');
    expect(out).toMatch(/（一）/);
    expect(out).toMatch(/\n\n二、/);
  });

  it('formats only text sections in form_json', () => {
    const form = {
      sections: [
        { type: 'text', content: '第一句。第二句。' },
        { type: 'table_2', activeDisclosureData: { x: 1 } },
      ],
    };
    const out = formatAllTextSections(form);
    expect(out.sections[0].content).toContain('。\n');
    expect(out.sections[1].activeDisclosureData).toEqual({ x: 1 });
  });
});
