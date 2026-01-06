import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import ejs from 'ejs';

// Define the interface for the data passed to the view
export interface ComparisonReportData {
  older: any;
  newer: any;
  summary: any;
  sections: any[];
}

export interface ComparisonPdfOptions {
  comparisonId: number | string;
  data: ComparisonReportData;
  regionName?: string;
  watermarkText?: string;
  watermarkOpacity?: number;
}

class PdfExportService {
  private readonly outputDir: string;
  private readonly viewsDir: string;

  constructor() {
    this.outputDir = path.join(process.cwd(), 'data', 'exports');
    this.viewsDir = path.join(process.cwd(), 'src', 'views');

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  /**
   * Generate comparison PDF using Puppeteer and EJS rendering
   * Returns the path to the generated PDF file
   */
  async generateComparisonPdf(options: ComparisonPdfOptions): Promise<string> {
    const { comparisonId, data } = options;
    const fileName = `comparison_${comparisonId}_${Date.now()}.pdf`;
    const outputPath = path.join(this.outputDir, fileName);

    let browser;
    try {
      console.log(`[PdfExportService] Rendering HTML for comparison ${comparisonId}...`);

      // 1. Render EJS to HTML String
      const templatePath = path.join(this.viewsDir, 'comparison_report.ejs');
      const htmlContent = await ejs.renderFile(templatePath, data, {
        views: [this.viewsDir], // Enables finding partials in src/views
      });

      console.log(`[PdfExportService] Launching Puppeteer...`);
      browser = await puppeteer.launch({
        headless: 'new' as any,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      const page = await browser.newPage();

      // 2. Set Content
      await page.setContent(htmlContent, {
        waitUntil: 'networkidle0',
        timeout: 60000
      });

      // 3. Generate PDF
      await page.pdf({
        path: outputPath,
        format: 'A4',
        printBackground: true,
        margin: {
          top: '20mm',
          right: '15mm',
          bottom: '20mm',
          left: '15mm'
        },
        displayHeaderFooter: true,
        headerTemplate: '<div></div>',
        footerTemplate: `
                <div style="font-size: 8px; color: #9ca3af; text-align: center; width: 100%; font-family: sans-serif;">
                    Page <span class="pageNumber"></span> of <span class="totalPages"></span>
                </div>
            `
      });

      console.log(`[PdfExportService] PDF generated at ${outputPath}`);
      return outputPath;

    } catch (error) {
      console.error('[PdfExportService] Error generating PDF:', error);
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  }
}

export default new PdfExportService();
