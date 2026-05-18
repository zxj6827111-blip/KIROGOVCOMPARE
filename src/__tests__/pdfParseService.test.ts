import PdfParseService from '../services/PdfParseService';

describe('PdfParseService extracted text fallback', () => {
  it('falls back to raw lines when section reconstruction is empty', () => {
    const service: any = PdfParseService;
    const document = {
      metadata: { totalPages: 1 },
      sections: [],
      extracted_text: '二、主动公开政府信息情况\n三、收到和处理政府信息公开申请情况',
    };

    expect(service.buildMarkdownFromDocument(document)).toBe(
      '二、主动公开政府信息情况\n三、收到和处理政府信息公开申请情况'
    );
  });
});
