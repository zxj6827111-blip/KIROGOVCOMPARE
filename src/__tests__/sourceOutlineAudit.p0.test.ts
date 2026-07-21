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
});
