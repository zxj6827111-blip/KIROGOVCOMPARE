interface ParseResult {
  success: boolean;
  document?: Record<string, unknown>;
}

export class PdfParseService {
  async parsePDF(_path: string, _assetId?: string): Promise<ParseResult> {
    return { success: true, document: {} };
  }
}

const pdfParseService = new PdfParseService();

export default pdfParseService;
