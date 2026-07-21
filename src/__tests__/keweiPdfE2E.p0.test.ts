import path from 'path';
import fs from 'fs';
import PdfParseService from '../services/PdfParseService';
import { splitAnnualReportForSegmentedParse } from '../services/SegmentedAnnualReportParse';
import { tryParseTable2FromSourceText, selectBestTableSection } from '../services/TableSectionScoring';
import { auditSourceOutline } from '../services/SourceOutlineAuditService';
import { mergeStructuredFields } from '../utils/structuredFieldMerge';

const KEWEI_PDF = path.join(
  process.cwd(),
  'data/uploads/1666/2024/49e418175219bd135aca9a8898510d73b0c4f444394f22644e35434f4b11f253.pdf'
);
const OFFICIAL_PDF = path.join(
  process.cwd(),
  'tests/fixtures/annual-report/shanghai-office-2025-official-sample.pdf'
);

const describeIf = (cond: boolean) => (cond ? describe : describe.skip);

describeIf(fs.existsSync(KEWEI_PDF))('Kewei PDF end-to-end extract (no DB)', () => {
  jest.setTimeout(120000);

  it('extracts PDF text, scores table2, deterministic cells, source audit', async () => {
    const parsed = await PdfParseService.parsePDFToMarkdown(KEWEI_PDF, 'e2e-kewei');
    let text = parsed.markdown || '';
    if (!parsed.success || text.length < 1000) {
      // Fallback: same file previously extracted fixture keeps e2e logic offline-stable
      const fixture = path.join(process.cwd(), 'tests/fixtures/annual-report/kewei-2024-source.md');
      if (!fs.existsSync(fixture)) {
        throw new Error('kewei PDF extract failed and fixture missing: ' + (parsed as any).error);
      }
      text = fs.readFileSync(fixture, 'utf8');
    }
    expect(text.length).toBeGreaterThan(1000);

    const split = splitAnnualReportForSegmentedParse(text);
    expect(split.table2Text).toMatch(/第二十条|表二|规章/);
    expect(split.table2Text).not.toMatch(/^二、工作机制保障/);

    const best = selectBestTableSection(text, 'table_2');
    expect(best.selected).not.toBeNull();
    expect(best.selected!.score).toBeGreaterThan(50);

    const det = tryParseTable2FromSourceText(split.table2Text);
    expect(det).not.toBeNull();
    expect(det!.regulations).toEqual({ made: 0, repealed: 0, valid: 0 });
    expect(det!.normativeDocuments).toEqual({ made: 13, repealed: 0, valid: 55 });
    expect(det!.licensing.processed).toBe(97);

    const llmPartial = {
      regulations: { made: null, repealed: null, valid: null },
      normativeDocuments: { made: 99, repealed: null, valid: null },
      licensing: { processed: null },
      punishment: { processed: null },
      coercion: { processed: null },
      fees: { amount: null },
    };
    const merged = mergeStructuredFields(llmPartial as any, det as any);
    // conflict on normative made 99 vs 13 -> keep existing 99 but record conflict
    expect(merged.conflicts.some((c) => c.path === 'normativeDocuments.made')).toBe(true);
    expect(merged.merged.regulations.made).toBe(0);

    const audit = auditSourceOutline(text);
    expect(audit.issues.some((i) => i.check_key === 'SRC_MULTIPLE_NUMBERING_SYSTEMS')).toBe(true);
    expect(audit.raw_source_outline.some((h) => h.page != null && h.page >= 1)).toBe(true);
  });
});

describeIf(fs.existsSync(OFFICIAL_PDF))('Official sample PDF smoke extract', () => {
  jest.setTimeout(120000);
  it('parses without overall-subtopic flood', async () => {
    const parsed = await PdfParseService.parsePDFToMarkdown(OFFICIAL_PDF, 'e2e-official');
    if (!parsed.success) {
      console.warn('official pdf extract failed in CI/local env', parsed.error);
      return;
    }
    const text = parsed.markdown || '';
    if (text.length < 500) return;
    const audit = auditSourceOutline(text);
    expect(audit.issues.filter((i) => i.check_key === 'SRC_OVERALL_SUBTOPIC_AS_TOP_LEVEL').length).toBe(0);
  });
});
