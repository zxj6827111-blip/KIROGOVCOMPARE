/**
 * 表三丢值影响面审计（只读，不写任何表）。
 *
 * 回答的问题是「table3-null-backfill 打开后能自动救回多少格」：把每个有 EMPTY 单元格的
 * 版本按三种处置分桶——勾稽可唯一反推（机器能补）、需要视觉重抽（图形通道才有解）、
 * 只能人工（勾稽本身也欠定，或这份版本是人工修正过的）。
 *
 *   npx ts-node --transpile-only src/scripts/audit-table3-null-backfill-buckets.ts --limit=800
 *   加 --active-only 只看各报告当前生效版本，加 --csv=out.csv 落逐版本明细。
 */
import fs from 'fs';
import path from 'path';
import pool from '../config/database-llm';
import { summarizeTable3NullBackfill } from '../services/ParsedOutputStabilityService';
import { splitTable3EntityPath } from '../utils/table3FieldTaxonomy';
import { rebuildTableDataFromCells } from '../utils/table3CellKeys';

type Bucket = 'auto_backfill' | 'needs_visual_review' | 'needs_manual';

type VersionRow = {
  version_id: number;
  report_id: number | null;
  year: number | null;
  region_name: string | null;
  version_type: string | null;
  is_active: boolean;
  empty_cells: number;
  parsed_json: string | object | null;
};

type ResultRow = VersionRow & {
  null_paths: number;
  auto_backfill: number;
  needs_visual_review: number;
  needs_manual: number;
  field_breakdown: Record<string, number>;
};

function parseArgs(argv: string[]) {
  const get = (name: string, fallback: string) => {
    const hit = argv.find((arg) => arg.startsWith(`--${name}=`));
    return hit ? hit.split('=').slice(1).join('=') : fallback;
  };
  return {
    limit: Math.max(1, Number(get('limit', '800')) || 800),
    activeOnly: argv.includes('--active-only'),
    csvPath: get('csv', ''),
    cellsCsv: get('cells-csv', ''),
    metaCsv: get('meta-csv', ''),
  };
}

/** 极简 CSV 行解析：只处理生产 \copy 产生的引号与转义双引号。 */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else current += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(current); current = ''; }
    else current += ch;
  }
  out.push(current);
  return out;
}

function readCsv(filePath: string): Array<Record<string, string>> {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(header.map((key, idx) => [key, cells[idx] ?? '']));
  });
}

/**
 * --cells-csv 模式：直接吃生产导出的 cells（只读 SELECT 的结果），本地还原 tableData
 * 后跑同一套勾稽判断。这样分析代码不用上生产机，生产也只需要一条 SELECT。
 */
function classifyFromCellsDump(cellsCsv: string, metaCsv: string): ResultRow[] {
  const cellRows = readCsv(cellsCsv);
  const metaById = new Map<string, Record<string, string>>();
  if (metaCsv) {
    for (const meta of readCsv(metaCsv)) metaById.set(meta.version_id, meta);
  }

  const grouped = new Map<string, Array<{ colKey: string; rowKey: string; semantic: any; num: number | null }>>();
  for (const row of cellRows) {
    if (row.table_id && row.table_id !== 'application') continue;
    const list = grouped.get(row.version_id) || [];
    list.push({
      colKey: row.col_key,
      rowKey: row.row_key,
      semantic: row.value_semantic,
      num: row.value_num === '' || row.value_num === null ? null : Number(row.value_num),
    });
    grouped.set(row.version_id, list);
  }

  const results: ResultRow[] = [];
  grouped.forEach((cells, versionId) => {
    const meta = metaById.get(versionId) || {};
    const tableData = rebuildTableDataFromCells(cells);
    const emptyCells = Number(meta.empty_cells || 0) || cells.filter((c) => c.semantic === 'EMPTY').length;
    const row: VersionRow = {
      version_id: Number(versionId),
      report_id: meta.report_id ? Number(meta.report_id) : null,
      year: meta.year ? Number(meta.year) : null,
      region_name: meta.region_name || null,
      version_type: meta.version_type || null,
      is_active: String(meta.is_active || '').toLowerCase() === 't',
      empty_cells: emptyCells,
      parsed_json: tableData,
    };
    results.push(classify(row, tableData));
  });
  return results;
}

function parseJson(value: string | object | null): any {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getTable3Data(parsed: any): any {
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const section = sections.find((item: any) => item?.type === 'table_3');
  return section?.tableData ?? parsed?.tableData ?? null;
}

async function loadVersions(limit: number, activeOnly: boolean): Promise<VersionRow[]> {
  const sql = `
    WITH empty_versions AS (
      SELECT version_id, COUNT(*)::int AS empty_cells
      FROM cells
      WHERE table_id = 'application' AND value_semantic = 'EMPTY'
      GROUP BY version_id
    )
    SELECT ev.version_id,
           rv.report_id,
           r.year,
           rg.name AS region_name,
           rv.version_type,
           (r.active_version_id = rv.id) AS is_active,
           ev.empty_cells,
           rv.parsed_json
    FROM empty_versions ev
    JOIN report_versions rv ON rv.id = ev.version_id
    LEFT JOIN reports r ON r.id = rv.report_id
    LEFT JOIN regions rg ON rg.id = r.region_id
    ${activeOnly ? 'WHERE r.active_version_id = rv.id' : ''}
    ORDER BY ev.empty_cells DESC, ev.version_id ASC
    LIMIT $1
  `;
  const result = await pool.query(sql, [limit]);
  return result.rows as VersionRow[];
}

function classify(row: VersionRow, tableDataOverride?: any): ResultRow {
  const tableData = tableDataOverride ?? getTable3Data(parseJson(row.parsed_json));

  if (!tableData) {
    // cells 里有 EMPTY 但解析结果取不到 table_3：无法反推，只能重抽或人工。
    return {
      ...row,
      null_paths: row.empty_cells,
      auto_backfill: 0,
      needs_visual_review: 0,
      needs_manual: row.empty_cells,
      field_breakdown: {},
    };
  }

  const { nullPaths, uniquelySolvablePaths } = summarizeTable3NullBackfill(tableData);
  const solvable = new Set(uniquelySolvablePaths);

  const fieldBreakdown: Record<string, number> = {};
  let auto = 0;
  let visual = 0;
  let manual = 0;
  for (const nullPath of nullPaths) {
    const field = splitTable3EntityPath(nullPath)?.field ?? nullPath;
    fieldBreakdown[field] = (fieldBreakdown[field] || 0) + 1;
    if (solvable.has(nullPath)) auto += 1;
    else visual += 1;
  }
  // 勾稽之外、cells 也没记录的差额留给人工核对（例如申请人行本身缺失）。
  manual = Math.max(0, row.empty_cells - nullPaths.length);

  return {
    ...row,
    null_paths: nullPaths.length,
    auto_backfill: auto,
    needs_visual_review: visual,
    needs_manual: manual,
    field_breakdown: fieldBreakdown,
  };
}

function totals(rows: ResultRow[]) {
  const sum = (pick: (row: ResultRow) => number) => rows.reduce((acc, row) => acc + pick(row), 0);
  const byField: Record<string, number> = {};
  for (const row of rows) {
    for (const [field, count] of Object.entries(row.field_breakdown)) {
      byField[field] = (byField[field] || 0) + count;
    }
  }
  return {
    versions: rows.length,
    auto_backfill: sum((r) => r.auto_backfill),
    needs_visual_review: sum((r) => r.needs_visual_review),
    needs_manual: sum((r) => r.needs_manual),
    empty_cells: sum((r) => r.empty_cells),
    by_field: byField,
  };
}

function toCsv(rows: ResultRow[]): string {
  const header = [
    'version_id',
    'report_id',
    'year',
    'region_name',
    'version_type',
    'is_active',
    'empty_cells',
    'auto_backfill',
    'needs_visual_review',
    'needs_manual',
  ].join(',');
  const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = rows.map((row) =>
    [
      row.version_id,
      row.report_id,
      row.year,
      escape(row.region_name),
      escape(row.version_type),
      row.is_active,
      row.empty_cells,
      row.auto_backfill,
      row.needs_visual_review,
      row.needs_manual,
    ].join(',')
  );
  return [header, ...lines].join('\n');
}

async function main() {
  const { limit, activeOnly, csvPath, cellsCsv, metaCsv } = parseArgs(process.argv.slice(2));
  let rows: ResultRow[];
  let scope: string;

  if (cellsCsv) {
    rows = classifyFromCellsDump(cellsCsv, metaCsv);
    scope = `cells dump ${cellsCsv}`;
  } else {
    const versions = await loadVersions(limit, activeOnly);
    rows = versions.map((row) => classify(row));
    scope = activeOnly ? 'active versions' : 'all versions';
  }
  const summary = totals(rows);

  const known = summary.auto_backfill + summary.needs_visual_review + summary.needs_manual;
  const share = (count: number) => (known > 0 ? `${((count / known) * 100).toFixed(1)}%` : '-');

  console.log(`表三 EMPTY 反推影响面（scope=${scope}, limit=${limit}）`);
  console.log(`有 EMPTY 单元格的版本数: ${summary.versions}，EMPTY 合计: ${summary.empty_cells}`);
  console.log(`  可自动反推（勾稽唯一解，上限，未计原文佐证门）: ${summary.auto_backfill} ${share(summary.auto_backfill)}`);
  console.log(`  需视觉重抽（等式里未知数不止一个）:             ${summary.needs_visual_review} ${share(summary.needs_visual_review)}`);
  console.log(`  需人工（申请人行缺失或版本无可解析表三）:        ${summary.needs_manual} ${share(summary.needs_manual)}`);
  console.log('按字段分布:', JSON.stringify(summary.by_field));

  const manualCorrected = rows.filter((row) => String(row.version_type || '') === 'manual_correct').length;
  if (manualCorrected > 0) {
    console.log(`其中人工修正版本 ${manualCorrected} 个：反推开关对它们也不应写入，跑批前先排除。`);
  }

  if (csvPath) {
    const target = path.isAbsolute(csvPath) ? csvPath : path.join(process.cwd(), csvPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, toCsv(rows), 'utf8');
    console.log(`逐版本明细已写入 ${target}`);
  }
}

main()
  .catch((error) => {
    console.error('审计失败:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
