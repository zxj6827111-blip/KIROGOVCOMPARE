/**
 * Test-only helper: extract PDF to markdown via PdfParseService.
 * Not a product CLI. Invoked by e2e tests in a forked Node process to avoid
 * Jest CJS/ESM friction with pdfjs-dist.
 *
 * Usage (tests only):
 *   node -r ts-node/register/transpile-only tests/helpers/pdfExtractCli.ts <pdfPath> [assetId]
 */
import PdfParseService from '../../src/services/PdfParseService';

async function main(): Promise<void> {
  const filePath = process.argv[2];
  const assetId = process.argv[3] || 'cli-extract';
  if (!filePath) {
    process.stdout.write(JSON.stringify({ success: false, error: 'missing pdf path' }));
    process.exit(2);
  }
  try {
    const result = await PdfParseService.parsePDFToMarkdown(filePath, assetId);
    process.stdout.write(
      JSON.stringify({
        success: !!result.success,
        markdown: result.markdown || '',
        error: (result as any).error || null,
      })
    );
    process.exit(result.success ? 0 : 1);
  } catch (e: any) {
    process.stdout.write(JSON.stringify({ success: false, error: String(e?.message || e) }));
    process.exit(1);
  }
}

main();
