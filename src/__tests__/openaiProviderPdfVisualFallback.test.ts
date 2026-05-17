import { OpenAILlmProvider } from '../services/OpenAILlmProvider';

describe('OpenAILlmProvider PDF visual table parsing', () => {
  function createProvider(): any {
    return new OpenAILlmProvider('test-key', 'gpt-5.5', {
      baseURL: 'http://127.0.0.1:8787',
      apiMode: 'responses',
    }) as any;
  }

  it('uses the next image page when a table title is below a previous table image', () => {
    const provider = createProvider();
    const pages = [
      { pageNumber: 1, text: '', imageCount: 0, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: null },
      { pageNumber: 2, text: '三、收到和处理政府信息公开申请情况', imageCount: 1, viewportHeight: 841.9, table2TitleY: null, table3TitleY: 382.49, table4TitleY: null },
      { pageNumber: 3, text: '', imageCount: 1, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: null },
      { pageNumber: 4, text: '四、政府信息公开行政复议、行政诉讼情况', imageCount: 1, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: 760.61 },
    ];

    expect(provider.pickVisualTablePage(pages, 'table_3')).toBe(3);
    expect(provider.pickVisualTablePage(pages, 'table_4')).toBe(4);
  });

  it('uses the title page when the title is near the top of a page that contains the table image', () => {
    const provider = createProvider();
    const pages = [
      { pageNumber: 1, text: '', imageCount: 0, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: null },
      { pageNumber: 2, text: '四、政府信息公开行政复议、行政诉讼情况', imageCount: 1, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: 760.61 },
      { pageNumber: 3, text: '五、存在的主要问题及改进情况', imageCount: 0, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: null },
    ];

    expect(provider.pickVisualTablePage(pages, 'table_4')).toBe(2);
  });

  it('uses rendered text-layer pages when PDF tables have no image objects', async () => {
    const provider = createProvider();
    const pages = [
      { pageNumber: 1, text: 'intro', imageCount: 0, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: null },
      { pageNumber: 2, text: 'table2 title only', imageCount: 0, viewportHeight: 841.9, table2TitleY: 685, table3TitleY: null, table4TitleY: null },
      { pageNumber: 3, text: 'table2 end and table3 start', imageCount: 0, viewportHeight: 841.9, table2TitleY: 716, table3TitleY: 283, table4TitleY: null },
      { pageNumber: 4, text: 'table3 continuation', imageCount: 0, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: null },
      { pageNumber: 5, text: 'table4 start', imageCount: 0, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: 716 },
    ];
    const split = {
      canUseSegmentedParse: true,
      missingSections: [],
      segments: {
        overallSituation: 'body',
        problemsAndImprovements: 'problems',
      },
    };

    jest.spyOn(provider, 'locatePdfVisualTablePages').mockResolvedValue(pages);

    await expect(provider.shouldUsePdfVisualTablesParse(
      'sample.pdf',
      split,
      { visual_border_missing: true, format: 'pdf' }
    )).resolves.toBe(true);
    expect(provider.pickVisualTablePage(pages, 'table_2')).toBe(3);
    expect(provider.pickVisualTablePages(pages, 'table_3')).toEqual([3, 4]);
    expect(provider.pickVisualTablePage(pages, 'table_4')).toBe(5);
  });

  it('builds a PDF parse from local text and visual table pages without full document parsing', async () => {
    const provider = createProvider();
    const sourceText = [
      '江苏淮安工业园区2025年政府信息公开工作年度报告',
      '一、总体情况',
      '总体文字',
      '二、主动公开政府信息情况',
      '三、收到和处理政府信息公开申请情况',
      '四、政府信息公开行政复议、行政诉讼情况',
      '五、存在的主要问题及改进情况',
      '问题文字',
      '六、其他需要报告的事项',
      '其他文字',
    ].join('\n');

    const parseFullDocumentSpy = jest.spyOn(provider, 'parseFullDocument');
    jest.spyOn(provider, 'locatePdfVisualTablePages').mockResolvedValue([
      { pageNumber: 1, text: '二、主动公开政府信息情况', imageCount: 1, viewportHeight: 841.9, table2TitleY: 760, table3TitleY: null, table4TitleY: null },
      { pageNumber: 2, text: '三、收到和处理政府信息公开申请情况', imageCount: 1, viewportHeight: 841.9, table2TitleY: null, table3TitleY: 360, table4TitleY: null },
      { pageNumber: 3, text: '', imageCount: 1, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: null },
      { pageNumber: 4, text: '四、政府信息公开行政复议、行政诉讼情况', imageCount: 1, viewportHeight: 841.9, table2TitleY: null, table3TitleY: null, table4TitleY: 760 },
    ]);
    jest.spyOn(provider, 'parseVisualTablesFromPdf').mockResolvedValue({
      table2: { regulations: { made: 0, repealed: 0, valid: 0 } },
      table3: { total: { newReceived: 3, carriedOver: 0, results: { totalProcessed: 3, carriedForward: 0 } } },
      table4: {
        review: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
        litigationDirect: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
        litigationPostReview: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
      },
      repairs: ['pdf_visual_table_2_page_1', 'pdf_visual_table_3_page_3', 'pdf_visual_table_4_page_4'],
    });

    const parsed = await provider.parsePdfWithLocalTextAndVisualTables('sample.pdf', sourceText);

    expect(parseFullDocumentSpy).not.toHaveBeenCalled();
    expect(parsed.visual_audit.pdf_visual_table_parse).toBe(true);
    expect(parsed.sections.find((section: any) => section.type === 'text')?.content).toBe('总体文字');
    expect(parsed.sections.find((section: any) => section.type === 'table_2')?.activeDisclosureData).toBeTruthy();
    expect(parsed.sections.find((section: any) => section.type === 'table_3')?.tableData).toBeTruthy();
    expect(parsed.sections.find((section: any) => section.type === 'table_4')?.reviewLitigationData).toBeTruthy();
  });
});
