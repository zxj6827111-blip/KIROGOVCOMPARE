import fs from 'fs';
import path from 'path';
import {
  selectBestTableSection,
  tryParseTable2FromSourceText,
} from '../services/TableSectionScoring';
import {
  auditSourceOutline,
  reconcileTable2SourceVsParsed,
} from '../services/SourceOutlineAuditService';
import { splitAnnualReportForSegmentedParse } from '../services/SegmentedAnnualReportParse';

const keweiPath = path.join(__dirname, '../../tests/fixtures/annual-report/kewei-2024-source.md');
const officialPath = path.join(
  __dirname,
  '../../tests/fixtures/annual-report/shanghai-office-sample-source.md'
);

describe('TableSectionScoring + SourceOutlineAudit (P0)', () => {
  const kewei = fs.readFileSync(keweiPath, 'utf8');

  it('selects real table_2 anchors for kewei-style text (not 工作机制保障)', () => {
    const { selected, candidates } = selectBestTableSection(kewei, 'table_2');
    expect(selected).not.toBeNull();
    expect(selected!.score).toBeGreaterThan(100);
    expect(selected!.text).toMatch(/第二十条/);
    expect(selected!.text).toMatch(/规章/);
    expect(selected!.titleLine).not.toMatch(/工作机制保障/);
    expect(candidates.length).toBeGreaterThan(1);
  });

  it('deterministically parses kewei table_2 including zeros', () => {
    const split = splitAnnualReportForSegmentedParse(kewei);
    expect(split.table2Text).toMatch(/第二十条/);
    const det = tryParseTable2FromSourceText(split.table2Text);
    expect(det).not.toBeNull();
    expect(det!.regulations).toEqual({ made: 0, repealed: 0, valid: 0 });
    expect(det!.normativeDocuments).toEqual({ made: 13, repealed: 0, valid: 55 });
    expect(det!.licensing.processed).toBe(97);
    expect(det!.punishment.processed).toBe(0);
    expect(det!.coercion.processed).toBe(0);
    expect(det!.fees.amount).toBe(0);
  });

  it('flags source structure issues for kewei without inventing table3 formula fails', () => {
    const audit = auditSourceOutline(kewei);
    const keys = audit.issues.map((i) => i.check_key);
    expect(keys).toContain('SRC_MULTIPLE_NUMBERING_SYSTEMS');
    expect(keys).toContain('SRC_OVERALL_SUBTOPIC_AS_TOP_LEVEL');
    expect(keys).toContain('SRC_SECTION_ORDINAL_MISMATCH');
    expect(keys).toContain('SRC_TEXT_INTERNAL_CONTRADICTION');
    expect(keys).toContain('SRC_TEXT_DUPLICATED_WORD');
    expect(audit.issues.every((i) => i.issue_class === 'source_format' || i.issue_class === 'source_content')).toBe(
      true
    );
    expect(audit.raw_source_outline.length).toBeGreaterThan(5);
  });

  it('reconcile marks empty parsed table2 fields as extraction (system), not source blank', () => {
    const split = splitAnnualReportForSegmentedParse(kewei);
    const bad = {
      regulations: { made: null, repealed: null, valid: null },
      normativeDocuments: { made: 13, repealed: null, valid: null },
      licensing: { processed: null },
      punishment: { processed: null },
      coercion: { processed: null },
      fees: { amount: null },
    };
    const issues = reconcileTable2SourceVsParsed(split.table2Text, bad);
    expect(issues.length).toBeGreaterThanOrEqual(5);
    expect(issues.every((i) => i.issue_class === 'extraction')).toBe(true);
    expect(issues.every((i) => i.responsibility === 'system')).toBe(true);
    expect(issues.some((i) => /源文件有值但结构化结果为空/.test(i.title))).toBe(true);
  });

  it('official sample is mostly clean on structure audit (no overall-subtopic flood)', () => {
    if (!fs.existsSync(officialPath)) return;
    const official = fs.readFileSync(officialPath, 'utf8');
    const audit = auditSourceOutline(official);
    const sub = audit.issues.filter((i) => i.check_key === 'SRC_OVERALL_SUBTOPIC_AS_TOP_LEVEL');
    expect(sub.length).toBe(0);
    const split = splitAnnualReportForSegmentedParse(official);
    const det = tryParseTable2FromSourceText(split.table2Text);
    // sample should at least produce some table2 structure or anchors
    expect(split.table2Text.length + split.table3Text.length).toBeGreaterThan(100);
    if (det) {
      expect(typeof det).toBe('object');
    }
  });

  it('keeps distinct line positions for same text quality core', () => {
    // Two independent positions for 资金资金 (lines 1 and 3) and 审查管 (lines 4 and 5)
    const synthetic = [
      '第1行科技计划资金资金分配结果。',
      '第2行正常内容无重复词。',
      '第3行再次出现资金资金独立问题。',
      '第4行信息发布审查管，根据要求。',
      '第5行再次出现审查管独立问题。',
    ].join('\n');
    const audit = auditSourceOutline(synthetic);
    const fund = audit.issues.filter(
      (i) =>
        i.check_key === 'SRC_TEXT_DUPLICATED_WORD' &&
        String((i.evidence_json as any)?.core || i.source_excerpt || '').includes('资金资金')
    );
    const guan = audit.issues.filter(
      (i) =>
        i.check_key === 'SRC_TEXT_INCOMPLETE_SENTENCE' &&
        String((i.evidence_json as any)?.core || i.source_excerpt || '').includes('审查管')
    );
    expect(fund).toHaveLength(2);
    expect(guan).toHaveLength(2);
    const fundLines = fund.map((i) => (i.evidence_json as any)?.line).sort((a, b) => a - b);
    const guanLines = guan.map((i) => (i.evidence_json as any)?.line).sort((a, b) => a - b);
    expect(fundLines).toEqual([1, 3]);
    expect(guanLines).toEqual([4, 5]);
  });

  it('reports single-position 资金资金 and 审查管 once each', () => {
    const synthetic = '一行内资金资金与审查管各一次。';
    const audit = auditSourceOutline(synthetic);
    const fund = audit.issues.filter(
      (i) =>
        i.check_key === 'SRC_TEXT_DUPLICATED_WORD' &&
        String((i.evidence_json as any)?.core || '').includes('资金资金')
    );
    const guan = audit.issues.filter(
      (i) =>
        i.check_key === 'SRC_TEXT_INCOMPLETE_SENTENCE' &&
        String((i.evidence_json as any)?.core || '').includes('审查管')
    );
    expect(fund).toHaveLength(1);
    expect(guan).toHaveLength(1);
  })

  it('two identical ordinal-mismatch titles at different lines remain two issues', () => {
    const synthetic = [
      '正文开头。',
      '四、收到和处理政府信息公开申请情况',
      '中间无关段落。',
      '四、收到和处理政府信息公开申请情况',
      '结尾。',
    ].join('\n');
    const audit = auditSourceOutline(synthetic);
    const ordinals = audit.issues.filter(
      (i) =>
        i.check_key === 'SRC_SECTION_ORDINAL_MISMATCH' &&
        String(i.source_excerpt || i.raw_title || '').includes('四、') &&
        String(i.source_excerpt || i.raw_title || '').includes('申请')
    );
    expect(ordinals).toHaveLength(2);
    const lines = ordinals
      .map((i) => (i.evidence_json as any)?.line)
      .filter((x) => typeof x === 'number')
      .sort((a, b) => a - b);
    expect(lines).toEqual([2, 4]);
  });
});
