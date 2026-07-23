import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { splitAnnualReportForSegmentedParse } from '../services/SegmentedAnnualReportParse';
import { tryParseTable2FromSourceText, selectBestTableSection } from '../services/TableSectionScoring';
import { auditSourceOutline } from '../services/SourceOutlineAuditService';
import { mergeTable2Fields } from '../utils/structuredFieldMerge';

const FIXTURE_DIR = path.join(process.cwd(), 'tests/fixtures/annual-report');
const KEWEI_PDF = path.join(FIXTURE_DIR, 'kewei-2024-official-sample.pdf');
const OFFICIAL_PDF = path.join(FIXTURE_DIR, 'shanghai-office-2025-official-sample.pdf');
const EXTRACT_CLI = path.join(process.cwd(), 'tests/helpers/pdfExtractCli.ts');

function sha256File(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Extract PDF text via forked Node process (ts-node).
 * Real PDF path only — no markdown fixture fallback, no silent skip.
 */
function extractPdfOrThrow(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`[${label}] fixture PDF missing: ${filePath}`);
  }
  if (!fs.existsSync(EXTRACT_CLI)) {
    throw new Error(`[${label}] extract helper missing: ${EXTRACT_CLI}`);
  }

  let stdout: string;
  try {
    stdout = execFileSync(
      process.execPath,
      ['-r', 'ts-node/register/transpile-only', EXTRACT_CLI, filePath, `e2e-${label}`],
      {
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
        windowsHide: true,
      }
    );
  } catch (err: any) {
    const out = String(err?.stdout || err?.message || err);
    throw new Error(`[${label}] PDF extract process failed: ${out.slice(0, 500)}`);
  }

  const jsonLine = String(stdout)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{') && l.includes('"success"'))
    .pop();
  if (!jsonLine) {
    throw new Error(`[${label}] PDF extract returned no JSON payload: ${stdout.slice(0, 200)}`);
  }
  let parsed: { success?: boolean; markdown?: string; error?: string | null };
  try {
    parsed = JSON.parse(jsonLine);
  } catch {
    throw new Error(`[${label}] PDF extract returned non-JSON: ${jsonLine.slice(0, 200)}`);
  }
  if (!parsed.success) {
    throw new Error(`[${label}] PDF extract failed: ${String(parsed.error || 'unknown')}`);
  }
  const text = parsed.markdown || '';
  if (text.length < 1000) {
    throw new Error(`[${label}] extracted text too short: len=${text.length}`);
  }
  return text;
}

function problemsStartLine(fullText: string): number {
  const lines = fullText.split(/\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i].trim();
    if (
      /^[（(][一二三四五六][）)].{0,40}(工作中存在问题|存在的主要问题|改进情况)/.test(l) ||
      /^[一二三四五六]、.{0,40}(主要问题|改进情况)/.test(l) ||
      /工作中存在问题的改进情况|工作中存在的主要问题/.test(l)
    ) {
      // skip preface mentions
      if (i < 20 && /全文包括|等六部分/.test(fullText.slice(Math.max(0, fullText.indexOf(l) - 40), fullText.indexOf(l) + 40))) {
        continue;
      }
      if (l.length < 80) return i + 1;
    }
  }
  return -1;
}

describe('Kewei PDF end-to-end extract (controlled fixture, no DB)', () => {
  jest.setTimeout(180000);

  it('extracts PDF text, table2 exact cells, merge det-over-AI, source audit', () => {
    expect(fs.existsSync(KEWEI_PDF)).toBe(true);
    const hash = sha256File(KEWEI_PDF);
    // eslint-disable-next-line no-console
    console.log('[kewei-pdf] sha256=', hash, 'path=', KEWEI_PDF);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe('49e418175219bd135aca9a8898510d73b0c4f444394f22644e35434f4b11f253');

    const text = extractPdfOrThrow(KEWEI_PDF, 'kewei');
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
    expect(det!.punishment.processed).toBe(0);
    expect(det!.coercion.processed).toBe(0);
    expect(det!.fees.amount).toBe(0);

    const llmPartial = {
      regulations: { made: 9, repealed: null, valid: 1 },
      normativeDocuments: { made: 99, repealed: null, valid: null },
      licensing: { processed: 1 },
      punishment: { processed: 8 },
      coercion: { processed: null },
      fees: { amount: null },
    };
    const merged = mergeTable2Fields(llmPartial as any, det as any);
    expect(merged.merged.regulations).toEqual({ made: 0, repealed: 0, valid: 0 });
    expect(merged.merged.normativeDocuments.made).toBe(13);
    expect(merged.merged.licensing.processed).toBe(97);
    expect(merged.merged.punishment.processed).toBe(0);
    expect(merged.conflicts.some((c) => c.path === 'regulations.made')).toBe(true);
    expect(merged.conflicts.some((c) => c.path === 'normativeDocuments.made')).toBe(true);

    const audit = auditSourceOutline(text);
    const keys = audit.issues.map((i) => i.check_key);
    expect(keys).toEqual(expect.arrayContaining(['SRC_MULTIPLE_NUMBERING_SYSTEMS']));
    expect(keys).toEqual(expect.arrayContaining(['SRC_OVERALL_SUBTOPIC_AS_TOP_LEVEL']));
    expect(audit.issues.some((i) => i.check_key.startsWith('SRC_'))).toBe(true);
    expect(audit.raw_source_outline.some((h) => h.page != null && h.page >= 1)).toBe(true);

    const fundIssues = audit.issues.filter(
      (i) => i.check_key === 'SRC_TEXT_DUPLICATED_WORD' && String((i.evidence_json as any)?.core || i.source_excerpt || '').includes('资金资金')
    );
    const guanIssues = audit.issues.filter(
      (i) => i.check_key === 'SRC_TEXT_INCOMPLETE_SENTENCE' && String((i.evidence_json as any)?.core || i.source_excerpt || '').includes('审查管')
    );
    expect(fundIssues).toHaveLength(1);
    expect(guanIssues).toHaveLength(1);
  });
});

describe('Official sample PDF regression (controlled fixture)', () => {
  jest.setTimeout(180000);

  it('table2 exact, section split, table3/4 bounds, no flood of false SRC structure', () => {
    expect(fs.existsSync(OFFICIAL_PDF)).toBe(true);
    const hash = sha256File(OFFICIAL_PDF);
    // eslint-disable-next-line no-console
    console.log('[official-pdf] sha256=', hash, 'path=', OFFICIAL_PDF);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe('b7951e7475ec7e44274a2bf20c6e0fe838571f3a872dee0708b0a4d2be41d887');

    const text = extractPdfOrThrow(OFFICIAL_PDF, 'official');
    const lines = text.split(/\n/);

    const split = splitAnnualReportForSegmentedParse(text);
    expect(split.segments.reviewLitigation).toBeTruthy();
    expect(split.segments.problemsAndImprovements).toBeTruthy();
    expect(split.canUseSegmentedParse).toBe(true);

    const det = tryParseTable2FromSourceText(split.table2Text);
    expect(det).not.toBeNull();
    // 正确范本 PDF 第 4 页人工核对精确值
    expect(det!.regulations).toEqual({ made: 22, repealed: 22, valid: 235 });
    expect(det!.normativeDocuments).toEqual({ made: 34, repealed: 55, valid: 189 });
    expect(det!.licensing.processed).toBe(0);
    expect(det!.punishment.processed).toBe(0);
    expect(det!.coercion.processed).toBe(0);
    expect(det!.fees.amount).toBe(0);

    const t3 = selectBestTableSection(text, 'table_3');
    const t4 = selectBestTableSection(text, 'table_4');
    expect(t3.selected).not.toBeNull();
    expect(t4.selected).not.toBeNull();

    expect(t3.selected!.startLine).toBeLessThan(t3.selected!.endLine);
    expect(t3.selected!.endLine).toBeLessThanOrEqual(t4.selected!.startLine);
    expect(t4.selected!.startLine).toBeLessThan(t4.selected!.endLine);

    const problemsLine = problemsStartLine(text);
    expect(problemsLine).toBeGreaterThan(0);
    expect(t4.selected!.endLine).toBeLessThanOrEqual(problemsLine);

    expect(t4.selected!.titleLine).not.toMatch(/表[三3]|收到和处理政府信息公开申请/);
    expect(
      /表[四4]|行政复议|行政诉讼|未经复议/.test(t4.selected!.titleLine) ||
        /表[四4]|行政复议|行政诉讼|未经复议/.test(t4.selected!.text.slice(0, 200))
    ).toBe(true);

    expect(split.table4Text).toMatch(/行政复议|行政诉讼|未经复议/);
    expect(split.table4Text).not.toMatch(/工作中存在问题的改进情况/);
    expect(split.table4Text).not.toMatch(/工作中存在的主要问题/);
    expect(t4.selected!.text).not.toMatch(/工作中存在问题的改进情况/);
    expect(t4.selected!.text).not.toMatch(/工作中存在的主要问题/);

    // eslint-disable-next-line no-console
    console.log(
      '[official-bounds]',
      JSON.stringify({
        t3: { start: t3.selected!.startLine, end: t3.selected!.endLine, title: t3.selected!.titleLine },
        t4: { start: t4.selected!.startLine, end: t4.selected!.endLine, title: t4.selected!.titleLine },
        problemsLine,
        linesTotal: lines.length,
      })
    );

    const audit = auditSourceOutline(text);
    const overallFlood = audit.issues.filter((i) => i.check_key === 'SRC_OVERALL_SUBTOPIC_AS_TOP_LEVEL');
    expect(overallFlood.length).toBe(0);
    const srcStructure = audit.issues.filter((i) => i.check_key.startsWith('SRC_') && !i.check_key.startsWith('SRC_TEXT_'));
    expect(srcStructure.length).toBeLessThan(8);
  });
});
