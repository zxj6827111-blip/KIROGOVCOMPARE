import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

dotenv.config();

function resolveProjectRoot(): string {
  // 在 src/ 与编译后的 dist/ 下运行都能定位到仓库根目录。
  const candidate = path.resolve(__dirname, '..', '..');
  if (fs.existsSync(path.join(candidate, 'package.json'))) {
    return candidate;
  }
  const candidate2 = path.resolve(__dirname, '..', '..', '..');
  if (fs.existsSync(path.join(candidate2, 'package.json'))) {
    return candidate2;
  }
  return process.cwd();
}

export const PROJECT_ROOT = resolveProjectRoot();
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const UPLOADS_TMP_DIR = path.join(UPLOADS_DIR, 'tmp');

export const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH || path.join(DATA_DIR, 'llm_ingestion.db');

let sqlite3Command = process.env.SQLITE3_BIN || 'sqlite3';

const SQLITE_CMD_TIMEOUT_MS = Number(process.env.SQLITE_CMD_TIMEOUT_MS || 8000);

function bundledSqlite3Path(): string {
  // 在源码目录与编译后 dist 目录都可定位到仓库根目录下的 tools/sqlite/sqlite3.exe
  return path.resolve(PROJECT_ROOT, 'tools', 'sqlite', 'sqlite3.exe');
}

function resolveSqlite3Command(): string {
  if (process.env.SQLITE3_BIN) {
    return process.env.SQLITE3_BIN;
  }

  // 若 PATH 中没有 sqlite3，则回退到项目自带的 sqlite3.exe
  // 注意：不在这里主动探测 PATH（探测会产生额外开销），在执行时按需回退。
  return sqlite3Command;
}

let migrationsRan = false;
let loggedDbPath = false;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function runSqlStatements(sql: string): any[] {
  ensureDataDir();
  const cmd = resolveSqlite3Command();

  // Run pragmas first in a separate call (no -json flag) to avoid corrupting JSON output
  try {
    execFileSync(cmd, [SQLITE_DB_PATH], {
      encoding: 'utf-8',
      input: 'PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;',
      timeout: SQLITE_CMD_TIMEOUT_MS,
    });
  } catch (pragmaError: any) {
    // Pragma errors are non-fatal, just log and continue
    if (pragmaError?.code !== 'ENOENT') {
      console.warn('[sqlite] Pragma setup warning:', pragmaError?.message || pragmaError);
    }
  }

  let output = '';
  try {
    output = execFileSync(cmd, ['-json', SQLITE_DB_PATH], {
      encoding: 'utf-8',
      input: sql,
      timeout: SQLITE_CMD_TIMEOUT_MS,
    }).trim();
  } catch (error: any) {
    // Windows 环境常见：sqlite3 不在 PATH。优先回退到仓库自带的 sqlite3.exe
    if (error?.code === 'ENOENT' && cmd === 'sqlite3') {
      const fallback = bundledSqlite3Path();
      if (fs.existsSync(fallback)) {
        sqlite3Command = fallback;
        output = execFileSync(sqlite3Command, ['-json', SQLITE_DB_PATH], {
          encoding: 'utf-8',
          input: sql,
          timeout: SQLITE_CMD_TIMEOUT_MS,
        }).trim();
      } else {
        throw error;
      }
    } else {
      throw error;
    }
  }
  if (!output) {
    return [];
  }

  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (error) {
    return output
      .split(/\n+/)
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .flatMap((chunk) => {
        try {
          const value = JSON.parse(chunk);
          return Array.isArray(value) ? value : [value];
        } catch {
          // Skip non-JSON lines (like pragma output remnants)
          return [];
        }
      });
  }
}

export function ensureSqliteMigrations(): void {
  if (!loggedDbPath) {
    console.log(`[sqlite] Using database at ${SQLITE_DB_PATH}`);
    loggedDbPath = true;
  }

  if (migrationsRan) {
    return;
  }

  const migrationsDir = path.join(PROJECT_ROOT, 'migrations', 'sqlite');
  if (!fs.existsSync(migrationsDir)) {
    migrationsRan = true;
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const file of files) {
    try {
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
      runSqlStatements(sql);
    } catch (error: any) {
      const errMsg = (error.message || '') + (error.stderr || '');
      if (errMsg.includes('duplicate column name') || errMsg.includes('already exists')) {
        console.log(`[sqlite] Migration file ${file} already partially applied (checked by error message), skipping.`);
      } else {
        console.warn(`[sqlite] Migration file ${file} had issues: ${errMsg}`);
      }
    }
  }

  const columns = runSqlStatements('PRAGMA table_info(jobs);') as Array<{ name?: string }>;

  // Check and add comparison_id if missing
  const hasComparisonId = columns.some((column) => column.name === 'comparison_id');
  if (!hasComparisonId) {
    try {
      runSqlStatements('ALTER TABLE jobs ADD COLUMN comparison_id INTEGER REFERENCES comparisons(id) ON DELETE SET NULL;');
    } catch (e) { }
  }
  runSqlStatements('CREATE INDEX IF NOT EXISTS idx_jobs_comparison ON jobs(comparison_id);');

  const regionColumns = runSqlStatements('PRAGMA table_info(regions);') as Array<{ name?: string }>;
  const hasParentId = regionColumns.some((column) => column.name === 'parent_id');
  if (!hasParentId) {
    runSqlStatements('ALTER TABLE regions ADD COLUMN parent_id INTEGER;');
  }

  let levelColumns = hasParentId ? regionColumns : runSqlStatements('PRAGMA table_info(regions);');
  let hasLevel = levelColumns.some((column) => column.name === 'level');
  if (!hasLevel) {
    runSqlStatements('ALTER TABLE regions ADD COLUMN level INTEGER NOT NULL DEFAULT 1;');
    levelColumns = runSqlStatements('PRAGMA table_info(regions);');
    hasLevel = true;
  }
  if (hasLevel) {
    runSqlStatements('UPDATE regions SET level = 1 WHERE level IS NULL OR level < 1;');
  }
  runSqlStatements('CREATE INDEX IF NOT EXISTS idx_regions_parent ON regions(parent_id);');

  // 兼容新增字段：reports.unit_name
  const reportColumns = runSqlStatements('PRAGMA table_info(reports);') as Array<{ name?: string }>;
  const hasUnitName = reportColumns.some((column) => column.name === 'unit_name');
  if (!hasUnitName) {
    runSqlStatements('ALTER TABLE reports ADD COLUMN unit_name TEXT;');
  }
  const hasActiveVersionId = reportColumns.some((column) => column.name === 'active_version_id');
  if (!hasActiveVersionId) {
    runSqlStatements('ALTER TABLE reports ADD COLUMN active_version_id INTEGER;');
  }

  // 以前版本曾引入 deleted_at 软删除字段；当前版本使用硬删除。
  // 不强制新增该字段，保持旧库兼容即可。

  // 兼容新增字段：report_versions.raw_text
  const versionColumns = runSqlStatements('PRAGMA table_info(report_versions);') as Array<{ name?: string }>;
  const hasRawText = versionColumns.some((column) => column.name === 'raw_text');
  if (!hasRawText) {
    runSqlStatements('ALTER TABLE report_versions ADD COLUMN raw_text TEXT;');
  }

  if (!hasRawText) {
    runSqlStatements('ALTER TABLE report_versions ADD COLUMN raw_text TEXT;');
  }

  const hasParentVersionId = versionColumns.some((column) => column.name === 'parent_version_id');
  if (!hasParentVersionId) {
    runSqlStatements('ALTER TABLE report_versions ADD COLUMN parent_version_id INTEGER;');
  }

  const hasVersionType = versionColumns.some((column) => column.name === 'version_type');
  if (!hasVersionType) {
    runSqlStatements("ALTER TABLE report_versions ADD COLUMN version_type TEXT DEFAULT 'original_parse';");
    runSqlStatements("UPDATE report_versions SET version_type = 'original_parse' WHERE version_type IS NULL;");
  }

  const hasChangeReason = versionColumns.some((column) => column.name === 'change_reason');
  if (!hasChangeReason) {
    runSqlStatements('ALTER TABLE report_versions ADD COLUMN change_reason TEXT;');
  }

  const hasChangedFieldsSummary = versionColumns.some((column) => column.name === 'changed_fields_summary');
  if (!hasChangedFieldsSummary) {
    runSqlStatements('ALTER TABLE report_versions ADD COLUMN changed_fields_summary TEXT;');
  }

  const hasState = versionColumns.some((column) => column.name === 'state');
  if (!hasState) {
    runSqlStatements("ALTER TABLE report_versions ADD COLUMN state TEXT DEFAULT 'parsed';");
    runSqlStatements("UPDATE report_versions SET state = 'parsed' WHERE state IS NULL;");
  }

  const hasCreatedBy = versionColumns.some((column) => column.name === 'created_by');
  if (!hasCreatedBy) {
    runSqlStatements('ALTER TABLE report_versions ADD COLUMN created_by INTEGER;');
  }

  const hasIngestionBatchId = versionColumns.some((column) => column.name === 'ingestion_batch_id');
  if (!hasIngestionBatchId) {
    runSqlStatements('ALTER TABLE report_versions ADD COLUMN ingestion_batch_id INTEGER;');
  }

  // 兼容修复：确保 report_versions 有 updated_at 字段
  const hasUpdatedAt = versionColumns.some((column) => column.name === 'updated_at');
  if (!hasUpdatedAt) {
    try {
      console.log('[sqlite] Auto-migrating: Adding updated_at to report_versions');
      runSqlStatements('ALTER TABLE report_versions ADD COLUMN updated_at TEXT;');
      runSqlStatements("UPDATE report_versions SET updated_at = datetime('now');");
    } catch (e: any) {
      console.warn('[sqlite] Failed to add updated_at column:', e.message);
    }
  }

  // 兼容新增字段：jobs 表 PDF 导出相关字段
  const jobColumns = runSqlStatements('PRAGMA table_info(jobs);') as Array<{ name?: string }>;
  const hasStepCode = jobColumns.some((column) => column.name === 'step_code');
  if (!hasStepCode) {
    try {
      runSqlStatements("ALTER TABLE jobs ADD COLUMN step_code TEXT DEFAULT 'QUEUED';");
      runSqlStatements("UPDATE jobs SET step_code = 'QUEUED' WHERE step_code IS NULL;");
    } catch (e) { }
  }

  const hasStepName = jobColumns.some((column) => column.name === 'step_name');
  if (!hasStepName) {
    try {
      runSqlStatements("ALTER TABLE jobs ADD COLUMN step_name TEXT DEFAULT '等待处理';");
      runSqlStatements("UPDATE jobs SET step_name = '等待处理' WHERE step_name IS NULL;");
    } catch (e) { }
  }

  const hasAttempt = jobColumns.some((column) => column.name === 'attempt');
  if (!hasAttempt) {
    try {
      runSqlStatements('ALTER TABLE jobs ADD COLUMN attempt INTEGER DEFAULT 1;');
      runSqlStatements('UPDATE jobs SET attempt = 1 WHERE attempt IS NULL;');
    } catch (e) { }
  }

  const hasProvider = jobColumns.some((column) => column.name === 'provider');
  if (!hasProvider) {
    try {
      runSqlStatements('ALTER TABLE jobs ADD COLUMN provider TEXT;');
    } catch (e) { }
  }

  const hasModel = jobColumns.some((column) => column.name === 'model');
  if (!hasModel) {
    try {
      runSqlStatements('ALTER TABLE jobs ADD COLUMN model TEXT;');
    } catch (e) { }
  }

  const hasCreatedByJob = jobColumns.some((column) => column.name === 'created_by');
  if (!hasCreatedByJob) {
    try {
      runSqlStatements('ALTER TABLE jobs ADD COLUMN created_by INTEGER;');
    } catch (e) { }
  }

  const hasIngestionBatchJob = jobColumns.some((column) => column.name === 'ingestion_batch_id');
  if (!hasIngestionBatchJob) {
    try {
      runSqlStatements('ALTER TABLE jobs ADD COLUMN ingestion_batch_id INTEGER;');
    } catch (e) { }
  }

  // file_path: 生成的 PDF 文件路径
  const hasFilePath = jobColumns.some((column) => column.name === 'file_path');
  if (!hasFilePath) {
    try {
      runSqlStatements('ALTER TABLE jobs ADD COLUMN file_path TEXT;');
    } catch (e) { }
  }

  // file_name: 文件显示名称
  const hasFileName = jobColumns.some((column) => column.name === 'file_name');
  if (!hasFileName) {
    try {
      runSqlStatements('ALTER TABLE jobs ADD COLUMN file_name TEXT;');
    } catch (e) { }
  }

  // file_size: 文件大小 (bytes)
  const hasFileSize = jobColumns.some((column) => column.name === 'file_size');
  if (!hasFileSize) {
    try {
      runSqlStatements('ALTER TABLE jobs ADD COLUMN file_size INTEGER;');
    } catch (e) { }
  }

  // export_title: 导出任务标题 (用于显示)
  const hasExportTitle = jobColumns.some((column) => column.name === 'export_title');
  if (!hasExportTitle) {
    try {
      runSqlStatements('ALTER TABLE jobs ADD COLUMN export_title TEXT;');
    } catch (e) { }
  }

  try {
    runSqlStatements(`
      UPDATE reports
      SET active_version_id = (
        SELECT id
        FROM report_versions rv
        WHERE rv.report_id = reports.id AND rv.is_active = 1
        ORDER BY rv.created_at DESC
        LIMIT 1
      )
      WHERE active_version_id IS NULL;
    `);
  } catch (e) { }

  migrationsRan = true;
}

function escapeValue(value: string | number | boolean | null | Date | Record<string, unknown> | undefined): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }

  if (value instanceof Date) {
    return `'${value.toISOString().replace(/'/g, "''")}'`;
  }

  if (typeof value === 'number') {
    return value.toString();
  }

  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  if (typeof value === 'string') {
    return `'${value.replace(/'/g, "''")}'`;
  }

  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}

export function querySqlite(sql: string): any[] {
  return runSqlStatements(sql);
}

export function executeSqlite(sql: string): void {
  runSqlStatements(sql);
}

export function sqlValue(value: string | number | boolean | null | Date | Record<string, unknown> | undefined): string {
  return escapeValue(value);
}
