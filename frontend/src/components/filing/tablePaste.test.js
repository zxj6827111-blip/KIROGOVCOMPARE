import { parsePastedNumbers } from './tablePaste';

describe('parsePastedNumbers', () => {
  it('parses tab-separated row with leading label', () => {
    const text = '一、本年新收政府信息公开申请数量\t55817\t1015\t6\t71\t235\t193\t57337';
    expect(parsePastedNumbers(text, 7)).toEqual([55817, 1015, 6, 71, 235, 193, 57337]);
  });

  it('parses multi-space separated numbers', () => {
    const text = '55817  1015  6  71  235  193  57337';
    expect(parsePastedNumbers(text, 7)).toEqual([55817, 1015, 6, 71, 235, 193, 57337]);
  });

  it('parses decimals and empty placeholders', () => {
    const text = '1.5\t-\t3';
    expect(parsePastedNumbers(text, 3)).toEqual([1.5, '', 3]);
  });

  it('parses one number per line (web page vertical paste)', () => {
    const text = '20551\n\n389\n\n0\n\n52\n\n34\n\n98\n\n21124';
    expect(parsePastedNumbers(text, 7)).toEqual([20551, 389, 0, 52, 34, 98, 21124]);
  });

  it('parses one number per line with leading label line', () => {
    const text = '一、本年新收政府信息公开申请数量\n20551\n389\n0\n52\n34\n98\n21124';
    expect(parsePastedNumbers(text, 7)).toEqual([20551, 389, 0, 52, 34, 98, 21124]);
  });
});
