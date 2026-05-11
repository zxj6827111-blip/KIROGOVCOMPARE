import fs from 'fs';
import path from 'path';
import pool from '../src/config/database-llm';
import { PROJECT_ROOT } from '../src/config/constants';
import { loadUserText } from '../src/services/LlmCommon';

type Ext = 'html' | 'txt' | 'pdf';

interface VersionRow {
  ext: Ext;
  version_id: string;
  report_id: string;
  year: number;
  unit_name: string;
  provider: string | null;
  model: string | null;
  storage_path: string;
  parsed_json: any;
}

const SAMPLE_PER_FORMAT = Number(process.env.AUDIT_PARSE_SAMPLE_PER_FORMAT || 5);
const REQUIRE_NONZERO = process.env.AUDIT_PARSE_REQUIRE_NONZERO === '1';
const OUTPUT_PATH = process.env.AUDIT_PARSE_OUTPUT
  ? path.resolve(PROJECT_ROOT, process.env.AUDIT_PARSE_OUTPUT)
  : '';

function getSections(parsed: any): any[] {
  return Array.isArray(parsed?.sections) ? parsed.sections : [];
}

function getSection(parsed: any, type: string): any {
  return getSections(parsed).find((section) => section?.type === type) || {};
}

function table2(parsed: any): any {
  return getSection(parsed, 'table_2')?.activeDisclosureData || parsed?.activeDisclosureData || {};
}

function table3(parsed: any): any {
  return getSection(parsed, 'table_3')?.tableData || parsed?.tableData || {};
}

function table4(parsed: any): any {
  return getSection(parsed, 'table_4')?.reviewLitigationData || parsed?.reviewLitigationData || {};
}

function isMeaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'number') return true;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.some(isMeaningful);
  if (typeof value === 'object') return Object.values(value as Record<string, unknown>).some(isMeaningful);
  return false;
}

function flattenNumbers(value: unknown, prefix = ''): Array<{ path: string; value: number }> {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [{ path: prefix || '$', value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => flattenNumbers(item, `${prefix}[${index}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
      flattenNumbers(item, prefix ? `${prefix}.${key}` : key)
    );
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return [{ path: prefix || '$', value: Number(value.trim()) }];
  }
  return [];
}

function hasNumberInSource(sourceText: string, value: number): boolean {
  const raw = String(value);
  if (!raw) return false;
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^0-9])${escaped}([^0-9]|$)`).test(sourceText);
}

function addIssue(issues: string[], condition: boolean, issue: string): void {
  if (condition) issues.push(issue);
}

function sum(values: unknown[]): number | null {
  const nums = values
    .map((value) => {
      if (typeof value === 'number') return value;
      if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim());
      return null;
    })
    .filter((value): value is number => value !== null);
  return nums.length === values.length ? nums.reduce((a, b) => a + b, 0) : null;
}

function checkTable4Totals(t4: any): string[] {
  const issues: string[] = [];
  for (const key of ['review', 'litigationDirect', 'litigationPostReview']) {
    const block = t4?.[key] || {};
    const subtotal = sum([block.maintain, block.correct, block.other, block.unfinished]);
    const total = typeof block.total === 'number' ? block.total : typeof block.total === 'string' && /^-?\d+$/.test(block.total.trim()) ? Number(block.total.trim()) : null;
    if (subtotal !== null && total !== null && subtotal !== total) {
      issues.push(`table4_${key}_total_mismatch:${subtotal}!=${total}`);
    }
  }
  return issues;
}

function checkTable3Totals(t3: any): string[] {
  const issues: string[] = [];
  const total = t3?.total;
  if (!total || typeof total !== 'object') {
    issues.push('table3_total_missing');
    return issues;
  }
  const entities = [
    t3.naturalPerson,
    t3.legalPerson?.commercial,
    t3.legalPerson?.research,
    t3.legalPerson?.social,
    t3.legalPerson?.legal,
    t3.legalPerson?.other,
  ];
  const newReceived = sum(entities.map((item) => item?.newReceived));
  if (newReceived !== null && typeof total.newReceived === 'number' && newReceived !== total.newReceived) {
    issues.push(`table3_newReceived_total_mismatch:${newReceived}!=${total.newReceived}`);
  }
  const carriedOver = sum(entities.map((item) => item?.carriedOver));
  if (carriedOver !== null && typeof total.carriedOver === 'number' && carriedOver !== total.carriedOver) {
    issues.push(`table3_carriedOver_total_mismatch:${carriedOver}!=${total.carriedOver}`);
  }
  return issues;
}

function summarize(parsed: any): Record<string, unknown> {
  const t2 = table2(parsed);
  const t3 = table3(parsed);
  const t4 = table4(parsed);
  return {
    sections: getSections(parsed).map((section) => section?.type).filter(Boolean),
    table2: {
      regulationsMade: t2?.regulations?.made ?? null,
      regulationsValid: t2?.regulations?.valid ?? null,
      normativeDocumentsMade: t2?.normativeDocuments?.made ?? null,
      licensingProcessed: t2?.licensing?.processed ?? null,
    },
    table3: {
      totalNewReceived: t3?.total?.newReceived ?? null,
      totalCarriedOver: t3?.total?.carriedOver ?? null,
      totalGranted: t3?.total?.results?.granted ?? null,
      totalProcessed: t3?.total?.results?.totalProcessed ?? null,
      totalCarriedForward: t3?.total?.results?.carriedForward ?? null,
    },
    table4: {
      reviewTotal: t4?.review?.total ?? null,
      litigationDirectTotal: t4?.litigationDirect?.total ?? null,
      litigationPostReviewTotal: t4?.litigationPostReview?.total ?? null,
    },
  };
}

async function loadRows(): Promise<VersionRow[]> {
  const res = await pool.query(
    `
    WITH candidates AS (
      SELECT
        lower(split_part(rv.storage_path, '.', array_length(string_to_array(rv.storage_path, '.'), 1))) AS ext,
        rv.id AS version_id,
        rv.report_id,
        r.year,
        r.unit_name,
        rv.provider,
        rv.model,
        rv.storage_path,
        rv.parsed_json,
        row_number() OVER (
          PARTITION BY lower(split_part(rv.storage_path, '.', array_length(string_to_array(rv.storage_path, '.'), 1)))
          ORDER BY md5(rv.id::text)
        ) AS rn
      FROM report_versions rv
      JOIN reports r ON r.id = rv.report_id
      WHERE rv.storage_path LIKE 'data/uploads/%'
        AND lower(split_part(rv.storage_path, '.', array_length(string_to_array(rv.storage_path, '.'), 1))) IN ('txt','html','pdf')
        AND rv.parsed_json IS NOT NULL
        AND rv.parsed_json::text <> '{}'
        AND rv.parsed_json::text <> 'null'
        AND (
          $2::boolean = FALSE
          OR rv.parsed_json::text ~ '"newReceived"\\s*:\\s*[1-9]'
          OR rv.parsed_json::text ~ '"totalProcessed"\\s*:\\s*[1-9]'
          OR rv.parsed_json::text ~ '"review"\\s*:\\s*\\{[^}]*"total"\\s*:\\s*[1-9]'
          OR rv.parsed_json::text ~ '"litigationDirect"\\s*:\\s*\\{[^}]*"total"\\s*:\\s*[1-9]'
          OR rv.parsed_json::text ~ '"litigationPostReview"\\s*:\\s*\\{[^}]*"total"\\s*:\\s*[1-9]'
        )
    )
    SELECT *
    FROM candidates
    WHERE rn <= $1
    ORDER BY ext, rn
    `,
    [SAMPLE_PER_FORMAT, REQUIRE_NONZERO]
  );
  return res.rows as VersionRow[];
}

async function auditRow(row: VersionRow): Promise<Record<string, unknown>> {
  const absolutePath = path.resolve(PROJECT_ROOT, row.storage_path);
  const exists = fs.existsSync(absolutePath);
  const issues: string[] = [];
  addIssue(issues, !exists, 'source_file_missing');

  const parsed = row.parsed_json;
  const t2 = table2(parsed);
  const t3 = table3(parsed);
  const t4 = table4(parsed);
  addIssue(issues, !isMeaningful(t2), 'table2_empty');
  addIssue(issues, !isMeaningful(t3), 'table3_empty');
  addIssue(issues, !isMeaningful(t4), 'table4_empty');
  issues.push(...checkTable3Totals(t3));
  issues.push(...checkTable4Totals(t4));

  let sourceText = '';
  if (exists) {
    const loaded = await loadUserText(absolutePath, {
      reportId: Number(row.report_id),
      versionId: Number(row.version_id),
      storagePath: row.storage_path,
    });
    sourceText = loaded.text || '';
  }

  const numbers = [
    ...flattenNumbers(t2, 'table2'),
    ...flattenNumbers(t3, 'table3'),
    ...flattenNumbers(t4, 'table4'),
  ];
  const nonZeroNumbers = numbers.filter((item) => item.value !== 0);
  const sourceMatched = nonZeroNumbers.filter((item) => hasNumberInSource(sourceText, item.value));
  const sourceMatchRate = nonZeroNumbers.length ? sourceMatched.length / nonZeroNumbers.length : 0;
  if (nonZeroNumbers.length > 0 && sourceMatchRate < 0.75) {
    issues.push(`low_source_number_match:${sourceMatched.length}/${nonZeroNumbers.length}`);
  }

  return {
    ext: row.ext,
    versionId: Number(row.version_id),
    reportId: Number(row.report_id),
    unitName: row.unit_name,
    year: row.year,
    provider: row.provider,
    model: row.model,
    storagePath: row.storage_path,
    sourceExists: exists,
    tableCompleteness: {
      table2: isMeaningful(t2),
      table3: isMeaningful(t3),
      table4: isMeaningful(t4),
    },
    numberSourceMatch: {
      matched: sourceMatched.length,
      total: nonZeroNumbers.length,
      rate: Number(sourceMatchRate.toFixed(3)),
    },
    issues,
    extracted: summarize(parsed),
  };
}

async function main(): Promise<void> {
  const rows = await loadRows();
  const results = [];
  for (const row of rows) {
    results.push(await auditRow(row));
  }
  const byExt = new Map<string, any[]>();
  for (const result of results) {
    const ext = String(result.ext);
    byExt.set(ext, [...(byExt.get(ext) || []), result]);
  }
  const summary = Object.fromEntries(
    [...byExt.entries()].map(([ext, items]) => [
      ext,
      {
        total: items.length,
        clean: items.filter((item) => item.issues.length === 0).length,
        withIssues: items.filter((item) => item.issues.length > 0).length,
        avgSourceMatchRate: Number(
          (items.reduce((acc, item) => acc + item.numberSourceMatch.rate, 0) / Math.max(1, items.length)).toFixed(3)
        ),
      },
    ])
  );
  const payload = { samplePerFormat: SAMPLE_PER_FORMAT, requireNonzero: REQUIRE_NONZERO, summary, results };
  if (OUTPUT_PATH) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  }
  console.log(JSON.stringify(payload, null, 2));
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
