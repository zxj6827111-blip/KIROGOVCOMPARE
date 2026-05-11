import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import pool from '../config/database-llm';
import { createLlmProvider } from '../services/LlmProviderFactory';
import { LlmProvider } from '../services/LlmProvider';
import { materializeService } from '../services/data-center/MaterializeService';
import { stabilizeParsedOutput } from '../services/ParsedOutputStabilityService';
import { resolveAbsoluteStoragePath } from '../services/SourceFileGuardService';
import { loadUserText } from '../services/LlmCommon';

type SummaryRow = {
  report_id: number;
  version_id: number;
};

type TargetVersionRow = {
  version_id: number;
  report_id: number;
  storage_path: string;
  file_hash: string | null;
  file_name: string | null;
};

type VersionState = {
  parsed_json: string | object | null;
  provider: string | null;
  model: string | null;
  prompt_version: string | null;
  raw_text: string | null;
};

type FieldKey = 'new_received' | 'carried_over' | 'total_processed' | 'carried_forward';
type Table3RowKey =
  | 'new_received'
  | 'carried_over'
  | 'granted'
  | 'partial_grant'
  | 'denied_state_secret'
  | 'denied_law_forbidden'
  | 'denied_safety_stability'
  | 'denied_third_party_rights'
  | 'denied_internal_affairs'
  | 'denied_process_info'
  | 'denied_enforcement_case'
  | 'denied_admin_query'
  | 'unable_no_info'
  | 'unable_need_creation'
  | 'unable_unclear'
  | 'not_processed_complaint'
  | 'not_processed_repeat'
  | 'not_processed_publication'
  | 'not_processed_massive_requests'
  | 'not_processed_confirm_info'
  | 'other_overdue_correction'
  | 'other_overdue_fee'
  | 'other_other_reasons'
  | 'total_processed'
  | 'carried_forward';

type Totals = Record<FieldKey, number | null>;
type Table3RowTotals = Record<Table3RowKey, number | null>;
type Table3ApplicantVector = [number, number, number, number, number, number, number];
type Table3RowVectors = Partial<Record<Table3RowKey, Table3ApplicantVector>>;

type SourceExtraction = {
  totals: Totals;
  methods: Record<FieldKey, 'narrative' | 'table' | null>;
  extractedCount: number;
  rowTotals: Table3RowTotals;
  rowExtractedKeys: Table3RowKey[];
  rowExtractedCount: number;
  rowVectors: Table3RowVectors;
  rowVectorKeys: Table3RowKey[];
  sourceLength: number;
};

type GateMode = 'legacy' | 'ai-source-json' | 'parse-only';
type StabilizeMode = 'none' | 'table4-only' | 'all';

type CompareResult = {
  passed: boolean;
  reason?: string;
  extractedFields: FieldKey[];
  comparedFields: FieldKey[];
  missingParsedFields: FieldKey[];
  mismatches: Array<{ field: string; source: number; parsed: number }>;
  rowComparedFields: Table3RowKey[];
  rowMissingParsedFields: Table3RowKey[];
  rowMismatches: Array<{ field: Table3RowKey; source: number; parsed: number }>;
};

type RepairDetail = {
  report_id: number;
  version_id: number;
  storage_path: string;
  status:
  | 'ok'
  | 'dry_run_ok'
  | 'skipped_file_missing'
  | 'skipped_file_zero_bytes'
  | 'parse_failed'
  | 'source_gate_failed'
  | 'materialize_failed'
  | 'version_not_found';
  attempt?: number;
  provider?: string;
  model?: string;
  source_extracted_fields?: number;
  source_row_extracted_fields?: number;
  compared_fields?: number;
  mismatched_fields?: number;
  row_compared_fields?: number;
  row_mismatched_fields?: number;
  reason?: string;
  mismatches?: Array<{ field: string; source: number; parsed: number }>;
  source_totals?: Totals;
  parsed_totals?: Totals;
  source_row_totals?: Table3RowTotals;
  parsed_row_totals?: Table3RowTotals;
  repairs_applied?: number;
  facts_created?: number;
  cells_created?: number;
};

type RunCounters = {
  skipped_missing_file: number;
  skipped_zero_file: number;
  parse_failed: number;
  source_gate_failed: number;
  materialize_failed: number;
  success: number;
  dry_run_pass: number;
  version_not_found: number;
  processed_files: number;
};

type CheckpointState = {
  version: number;
  signature: string;
  created_at: string;
  updated_at: string;
  completed: boolean;
  next_index: number;
  total_targets: number;
  counters: RunCounters;
  details: RepairDetail[];
};

const FIELD_KEYS: FieldKey[] = ['new_received', 'carried_over', 'total_processed', 'carried_forward'];
const TABLE3_ROW_KEYS: Table3RowKey[] = [
  'new_received',
  'carried_over',
  'granted',
  'partial_grant',
  'denied_state_secret',
  'denied_law_forbidden',
  'denied_safety_stability',
  'denied_third_party_rights',
  'denied_internal_affairs',
  'denied_process_info',
  'denied_enforcement_case',
  'denied_admin_query',
  'unable_no_info',
  'unable_need_creation',
  'unable_unclear',
  'not_processed_complaint',
  'not_processed_repeat',
  'not_processed_publication',
  'not_processed_massive_requests',
  'not_processed_confirm_info',
  'other_overdue_correction',
  'other_overdue_fee',
  'other_other_reasons',
  'total_processed',
  'carried_forward',
];
const CHECKPOINT_VERSION = 1;

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function toInt(value: string | undefined, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
}

function toNonNegativeInt(value: string | undefined, fallback: number): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  return Math.floor(num);
}

function parseIdList(value: string | undefined): number[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function resolveStabilizeOptions(mode: StabilizeMode): { table3: boolean; table4: boolean } {
  if (mode === 'all') {
    return { table3: true, table4: true };
  }
  if (mode === 'table4-only') {
    return { table3: false, table4: true };
  }
  return { table3: false, table4: false };
}

function emptyTable3RowTotals(): Table3RowTotals {
  return {
    new_received: null,
    carried_over: null,
    granted: null,
    partial_grant: null,
    denied_state_secret: null,
    denied_law_forbidden: null,
    denied_safety_stability: null,
    denied_third_party_rights: null,
    denied_internal_affairs: null,
    denied_process_info: null,
    denied_enforcement_case: null,
    denied_admin_query: null,
    unable_no_info: null,
    unable_need_creation: null,
    unable_unclear: null,
    not_processed_complaint: null,
    not_processed_repeat: null,
    not_processed_publication: null,
    not_processed_massive_requests: null,
    not_processed_confirm_info: null,
    other_overdue_correction: null,
    other_overdue_fee: null,
    other_other_reasons: null,
    total_processed: null,
    carried_forward: null,
  };
}

function emptySourceExtraction(sourceLength = 0): SourceExtraction {
  return {
    totals: {
      new_received: null,
      carried_over: null,
      total_processed: null,
      carried_forward: null,
    },
    methods: {
      new_received: null,
      carried_over: null,
      total_processed: null,
      carried_forward: null,
    },
    extractedCount: 0,
    rowTotals: emptyTable3RowTotals(),
    rowExtractedKeys: [],
    rowExtractedCount: 0,
    rowVectors: {},
    rowVectorKeys: [],
    sourceLength,
  };
}

function buildCheckpointSignature(input: {
  summaryPath: string;
  providerName: string;
  modelName: string;
  gateMode: GateMode;
  stabilizeMode: StabilizeMode;
  apply: boolean;
  shardCount: number;
  shardIndex: number;
  limit: number;
  maxAttempts: number;
  minSourceFields: number;
  minRowSourceFields: number;
  reportIds: number[];
}): string {
  const stable = {
    summary_path: path.resolve(input.summaryPath).toLowerCase(),
    provider: input.providerName,
    model: input.modelName,
    gate_mode: input.gateMode,
    stabilize_mode: input.stabilizeMode,
    apply: input.apply,
    shard_count: input.shardCount,
    shard_index: input.shardIndex,
    limit: input.limit,
    max_attempts: input.maxAttempts,
    min_source_fields: input.minSourceFields,
    min_row_source_fields: input.minRowSourceFields,
    report_ids: [...input.reportIds].sort((a, b) => a - b),
  };
  return JSON.stringify(stable);
}

function buildDefaultCheckpointPath(outDir: string, shardCount: number, shardIndex: number): string {
  return path.join(outDir, `reparse_table3_source_gate_checkpoint_sh${shardIndex}_of_${shardCount}.json`);
}

function emptyCounters(): RunCounters {
  return {
    skipped_missing_file: 0,
    skipped_zero_file: 0,
    parse_failed: 0,
    source_gate_failed: 0,
    materialize_failed: 0,
    success: 0,
    dry_run_pass: 0,
    version_not_found: 0,
    processed_files: 0,
  };
}

async function loadCheckpointState(checkpointPath: string): Promise<CheckpointState | null> {
  if (!fs.existsSync(checkpointPath)) {
    return null;
  }

  let parsed: any;
  try {
    const raw = await fsp.readFile(checkpointPath, 'utf8');
    parsed = JSON.parse(raw);
  } catch (error) {
    console.warn(`[checkpoint] read/parse failed: ${checkpointPath}`, error);
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  if (Number((parsed as any).version) !== CHECKPOINT_VERSION) {
    return null;
  }

  return parsed as CheckpointState;
}

async function saveCheckpointState(checkpointPath: string, state: CheckpointState): Promise<void> {
  const tempPath = `${checkpointPath}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8');
  await fsp.rename(tempPath, checkpointPath);
}

function buildTimestamp(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function resolveOutputPath(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function sleep(ms: number): Promise<void> {
  if (!Number.isFinite(ms) || ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitErrorMessage(message: string): boolean {
  const normalized = String(message || '').toLowerCase();
  return (
    normalized.includes('429') ||
    normalized.includes('too many requests') ||
    normalized.includes('quota_exceeded') ||
    normalized.includes('rate limit') ||
    normalized.includes('rate_limit') ||
    normalized.includes('quota exceeded')
  );
}

function computeRetryDelayMs(message: string, retryDelayMs: number, rateLimitDelayMs: number, attempt: number): number {
  const baseDelay = isRateLimitErrorMessage(message) ? rateLimitDelayMs : retryDelayMs;
  if (!Number.isFinite(baseDelay) || baseDelay <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(baseDelay * Math.max(1, attempt)));
}

function normalizeFullWidthDigits(input: string): string {
  return input.replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248));
}

function normalizeText(input: string): string {
  return normalizeFullWidthDigits(input || '')
    .replace(/\u3000/g, ' ')
    .replace(/，/g, ',')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')');
}

function coerceNumber(value: any): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/' || trimmed === '-' || trimmed === '--') return null;
  const normalized = trimmed.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractBalancedJsonObject(source: string, startIndex: number): string | null {
  if (startIndex < 0 || startIndex >= source.length || source[startIndex] !== '{') {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIndex; i < source.length; i += 1) {
    const ch = source[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') {
      depth += 1;
      continue;
    }

    if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  return null;
}

function recoverJsonObjectFromText(rawText: string): Record<string, any> | null {
  const text = String(rawText || '').trim();
  if (!text) return null;

  const tryDirect = () => {
    try {
      const parsed = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, any>) : null;
    } catch {
      return null;
    }
  };

  const direct = tryDirect();
  if (direct) return direct;

  const stripped = text
    .replace(/```json/gi, '```')
    .replace(/```/g, '')
    .trim();
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, any>;
    }
  } catch {
    // noop
  }

  let cursor = 0;
  while (cursor < stripped.length) {
    const start = stripped.indexOf('{', cursor);
    if (start < 0) break;
    const objectText = extractBalancedJsonObject(stripped, start);
    if (objectText) {
      try {
        const parsed = JSON.parse(objectText);
        if (parsed && typeof parsed === 'object') {
          return parsed as Record<string, any>;
        }
      } catch {
        // noop
      }
      cursor = start + 1;
      continue;
    }
    break;
  }

  return null;
}

function recoverOutputFromRawText(output: any): any {
  if (!output || typeof output !== 'object') return output;
  if (!output.raw_text || typeof output.raw_text !== 'string') return output;

  const recovered = recoverJsonObjectFromText(output.raw_text);
  if (!recovered) return output;

  return {
    ...output,
    ...recovered,
  };
}

function getSection(parsed: any, type: string): any {
  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  return sections.find((item: any) => item?.type === type);
}

function extractParsedTotals(output: any): Totals {
  const table3Section = getSection(output, 'table_3');
  const tableData = table3Section?.tableData ?? output?.tableData;
  return {
    new_received: coerceNumber(tableData?.total?.newReceived),
    carried_over: coerceNumber(tableData?.total?.carriedOver),
    total_processed: coerceNumber(tableData?.total?.results?.totalProcessed),
    carried_forward: coerceNumber(tableData?.total?.results?.carriedForward),
  };
}

function extractParsedRowTotals(output: any): Table3RowTotals {
  const table3Section = getSection(output, 'table_3');
  const totalRow = table3Section?.tableData?.total ?? output?.tableData?.total ?? {};
  return {
    new_received: coerceNumber(totalRow?.newReceived),
    carried_over: coerceNumber(totalRow?.carriedOver),
    granted: coerceNumber(totalRow?.results?.granted),
    partial_grant: coerceNumber(totalRow?.results?.partialGrant),
    denied_state_secret: coerceNumber(totalRow?.results?.denied?.stateSecret),
    denied_law_forbidden: coerceNumber(totalRow?.results?.denied?.lawForbidden),
    denied_safety_stability: coerceNumber(totalRow?.results?.denied?.safetyStability),
    denied_third_party_rights: coerceNumber(totalRow?.results?.denied?.thirdPartyRights),
    denied_internal_affairs: coerceNumber(totalRow?.results?.denied?.internalAffairs),
    denied_process_info: coerceNumber(totalRow?.results?.denied?.processInfo),
    denied_enforcement_case: coerceNumber(totalRow?.results?.denied?.enforcementCase),
    denied_admin_query: coerceNumber(totalRow?.results?.denied?.adminQuery),
    unable_no_info: coerceNumber(totalRow?.results?.unableToProvide?.noInfo),
    unable_need_creation: coerceNumber(totalRow?.results?.unableToProvide?.needCreation),
    unable_unclear: coerceNumber(totalRow?.results?.unableToProvide?.unclear),
    not_processed_complaint: coerceNumber(totalRow?.results?.notProcessed?.complaint),
    not_processed_repeat: coerceNumber(totalRow?.results?.notProcessed?.repeat),
    not_processed_publication: coerceNumber(totalRow?.results?.notProcessed?.publication),
    not_processed_massive_requests: coerceNumber(totalRow?.results?.notProcessed?.massiveRequests),
    not_processed_confirm_info: coerceNumber(totalRow?.results?.notProcessed?.confirmInfo),
    other_overdue_correction: coerceNumber(totalRow?.results?.other?.overdueCorrection),
    other_overdue_fee: coerceNumber(totalRow?.results?.other?.overdueFee),
    other_other_reasons: coerceNumber(totalRow?.results?.other?.otherReasons),
    total_processed: coerceNumber(totalRow?.results?.totalProcessed),
    carried_forward: coerceNumber(totalRow?.results?.carriedForward),
  };
}

const TABLE3_APPLICANT_VECTOR_PATHS: Array<{ path: string; label: string }> = [
  { path: 'naturalPerson', label: 'natural_person' },
  { path: 'legalPerson.commercial', label: 'legal_person_commercial' },
  { path: 'legalPerson.research', label: 'legal_person_research' },
  { path: 'legalPerson.social', label: 'legal_person_social' },
  { path: 'legalPerson.legal', label: 'legal_person_legal' },
  { path: 'legalPerson.other', label: 'legal_person_other' },
  { path: 'total', label: 'total' },
];

const TABLE3_ROW_VALUE_PATHS: Record<Table3RowKey, string> = {
  new_received: 'newReceived',
  carried_over: 'carriedOver',
  granted: 'results.granted',
  partial_grant: 'results.partialGrant',
  denied_state_secret: 'results.denied.stateSecret',
  denied_law_forbidden: 'results.denied.lawForbidden',
  denied_safety_stability: 'results.denied.safetyStability',
  denied_third_party_rights: 'results.denied.thirdPartyRights',
  denied_internal_affairs: 'results.denied.internalAffairs',
  denied_process_info: 'results.denied.processInfo',
  denied_enforcement_case: 'results.denied.enforcementCase',
  denied_admin_query: 'results.denied.adminQuery',
  unable_no_info: 'results.unableToProvide.noInfo',
  unable_need_creation: 'results.unableToProvide.needCreation',
  unable_unclear: 'results.unableToProvide.unclear',
  not_processed_complaint: 'results.notProcessed.complaint',
  not_processed_repeat: 'results.notProcessed.repeat',
  not_processed_publication: 'results.notProcessed.publication',
  not_processed_massive_requests: 'results.notProcessed.massiveRequests',
  not_processed_confirm_info: 'results.notProcessed.confirmInfo',
  other_overdue_correction: 'results.other.overdueCorrection',
  other_overdue_fee: 'results.other.overdueFee',
  other_other_reasons: 'results.other.otherReasons',
  total_processed: 'results.totalProcessed',
  carried_forward: 'results.carriedForward',
};

function getParsedTable3TableData(output: any): any {
  const table3Section = getSection(output, 'table_3');
  return table3Section?.tableData ?? output?.tableData ?? null;
}

function setByPath(target: any, dottedPath: string, value: number): void {
  const segments = dottedPath.split('.');
  let current = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i];
    if (!current[segment] || typeof current[segment] !== 'object') {
      current[segment] = {};
    }
    current = current[segment];
  }
  current[segments[segments.length - 1]] = value;
}

function extractParsedRowVector(output: any, key: Table3RowKey): Table3ApplicantVector | null {
  const tableData = getParsedTable3TableData(output);
  const valuePath = TABLE3_ROW_VALUE_PATHS[key];
  if (!tableData || typeof tableData !== 'object' || !valuePath) {
    return null;
  }

  const values: number[] = [];
  for (const applicant of TABLE3_APPLICANT_VECTOR_PATHS) {
    const node = readByPath(tableData, applicant.path);
    const numeric = coerceNumber(readByPath(node, valuePath));
    if (numeric === null) {
      return null;
    }
    values.push(numeric);
  }

  if (values.length !== 7) {
    return null;
  }
  return values as Table3ApplicantVector;
}

function applySourceRowVectorRepairs(output: any, source: SourceExtraction): string[] {
  const repairedKeys: string[] = [];
  const tableData = getParsedTable3TableData(output);
  if (!tableData || typeof tableData !== 'object') {
    return repairedKeys;
  }

  for (const key of source.rowVectorKeys || []) {
    const sourceVector = source.rowVectors[key];
    const valuePath = TABLE3_ROW_VALUE_PATHS[key];
    if (!sourceVector || sourceVector.length !== 7 || !valuePath) {
      continue;
    }

    const parsedVector = extractParsedRowVector(output, key);
    if (parsedVector && parsedVector.every((value, index) => value === sourceVector[index])) {
      continue;
    }

    for (let index = 0; index < TABLE3_APPLICANT_VECTOR_PATHS.length; index += 1) {
      const applicant = TABLE3_APPLICANT_VECTOR_PATHS[index];
      const node = readByPath(tableData, applicant.path);
      if (!node || typeof node !== 'object') {
        continue;
      }
      setByPath(node, valuePath, sourceVector[index]);
    }
    repairedKeys.push(`table_3.source_row.${key}`);
  }

  return repairedKeys;
}

const TABLE3_ROW_MATCHERS: Array<{ key: Table3RowKey; matches: (compact: string) => boolean }> = [
  { key: 'new_received', matches: (compact) => compact.includes('本年新收') },
  { key: 'carried_over', matches: (compact) => compact.includes('上年结转') },
  { key: 'granted', matches: (compact) => compact.includes('予以公开') },
  { key: 'partial_grant', matches: (compact) => compact.includes('部分公开') },
  { key: 'denied_state_secret', matches: (compact) => compact.includes('属于国家秘密') },
  {
    key: 'denied_law_forbidden',
    matches: (compact) =>
      compact.includes('其他法律行政法规禁止公开') || compact.includes('法律行政法规禁止公开'),
  },
  {
    key: 'denied_safety_stability',
    matches: (compact) => compact.includes('三安全一稳定') || compact.includes('三安全') && compact.includes('稳定'),
  },
  { key: 'denied_third_party_rights', matches: (compact) => compact.includes('保护第三方合法权益') },
  { key: 'denied_internal_affairs', matches: (compact) => compact.includes('属于三类内部事务信息') },
  { key: 'denied_process_info', matches: (compact) => compact.includes('属于四类过程性信息') },
  { key: 'denied_enforcement_case', matches: (compact) => compact.includes('属于行政执法案卷') },
  { key: 'denied_admin_query', matches: (compact) => compact.includes('属于行政查询事项') },
  { key: 'unable_no_info', matches: (compact) => compact.includes('本机关不掌握相关政府信息') },
  { key: 'unable_need_creation', matches: (compact) => compact.includes('没有现成信息需要另行制作') },
  { key: 'unable_unclear', matches: (compact) => compact.includes('补正后申请内容仍不明确') },
  { key: 'not_processed_complaint', matches: (compact) => compact.includes('信访举报投诉类申请') },
  { key: 'not_processed_repeat', matches: (compact) => compact.includes('重复申请') },
  { key: 'not_processed_publication', matches: (compact) => compact.includes('要求提供公开出版物') },
  {
    key: 'not_processed_massive_requests',
    matches: (compact) => compact.includes('无正当理由大量反复申请'),
  },
  {
    key: 'not_processed_confirm_info',
    matches: (compact) => compact.includes('要求行政机关确认或重新出具已获取信息'),
  },
  { key: 'other_overdue_correction', matches: (compact) => compact.includes('无正当理由逾期不补正') },
  { key: 'other_overdue_fee', matches: (compact) => compact.includes('逾期未按收费通知要求缴纳费用') },
  {
    key: 'other_other_reasons',
    matches: (compact) => compact.includes('其他处理') && (compact.includes('3.其他') || compact.includes('3其他')),
  },
  {
    key: 'total_processed',
    matches: (compact) =>
      compact.includes('总计') &&
      (compact.includes('(七)') || compact.includes('（七）') || compact.includes('(7)') || compact.includes('（7）') || compact.includes('七')),
  },
  {
    key: 'carried_forward',
    matches: (compact) =>
      compact.includes('结转下年度继续办理') ||
      compact.includes('结转下一年继续办理') ||
      compact.includes('结转下年度') && compact.includes('继续办理'),
  },
];

function firstRegexNumber(text: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const matched = pattern.exec(text);
    if (!matched?.[1]) continue;
    const value = coerceNumber(matched[1]);
    if (value !== null) return value;
  }
  return null;
}

function extractNarrativeTotals(text: string): Partial<Totals> {
  const normalized = normalizeText(text);
  const output: Partial<Totals> = {};

  const newReceived = firstRegexNumber(normalized, [
    /新收[^0-9]{0,40}(\d{1,9})\s*件/,
    /本年新收[^0-9]{0,40}(\d{1,9})\s*件/,
  ]);
  if (newReceived !== null) output.new_received = newReceived;
  if (output.new_received === null || output.new_received === undefined) {
    const acceptedReceived = firstRegexNumber(normalized, [
      /受理[^0-9]{0,20}政府信息公开申请[^0-9]{0,20}(\d{1,9})\s*件?/,
    ]);
    if (acceptedReceived !== null) {
      output.new_received = acceptedReceived;
    }
  }

  const carriedOver = firstRegexNumber(normalized, [
    /上年结转[^0-9]{0,40}(\d{1,9})\s*件/,
    /结转政府信息公开申请数量[^0-9]{0,30}(\d{1,9})\s*件/,
  ]);
  if (carriedOver !== null) output.carried_over = carriedOver;

  const totalProcessed = firstRegexNumber(normalized, [
    /答复量[^0-9]{0,30}(\d{1,9})\s*件/,
    /办理结果[^0-9]{0,30}(\d{1,9})\s*件/,
    /办理总数[^0-9]{0,30}(\d{1,9})\s*件/,
    /本年度办理[^0-9]{0,30}(\d{1,9})\s*件/,
  ]);
  if (totalProcessed !== null) output.total_processed = totalProcessed;

  const carriedForward = firstRegexNumber(normalized, [
    /结转下一年继续办理件[^0-9]{0,10}(\d{1,9})/,
    /结转下(?:一|明)?年度(?:继续办理)?[^0-9]{0,30}(\d{1,9})\s*件/,
  ]);
  if (carriedForward !== null) output.carried_forward = carriedForward;

  const narrativeAcceptedReceived = firstRegexNumber(normalized, [
    /\u53d7\u7406[^0-9]{0,20}\u653f\u5e9c\u4fe1\u606f\u516c\u5f00\u7533\u8bf7[^0-9]{0,20}(\d{1,9})\s*\u4ef6?/,
  ]);
  if (
    narrativeAcceptedReceived !== null &&
    (output.new_received === null ||
      output.new_received === undefined ||
      narrativeAcceptedReceived > output.new_received)
  ) {
    output.new_received = narrativeAcceptedReceived;
  }

  return output;
}

function isSingleDigitInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 9;
}

function extractStrictPipeIntegers(line: string): number[] {
  const normalized = normalizeText(line).replace(/,/g, '');
  if (!normalized.includes('|')) {
    return [];
  }

  return normalized
    .split('|')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== '---')
    .map((cell) => (/^-?\d+$/.test(cell) ? Number(cell) : null))
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}

function repairFragmentedTable3ApplicantRow(rowNumbers: number[]): number[] | null {
  const expectedGroups = 7;
  if (rowNumbers.length <= expectedGroups || rowNumbers.length > expectedGroups + 4) {
    return null;
  }

  const candidates: Array<{ values: number[]; mergedCount: number }> = [];

  function backtrack(index: number, groups: number[], mergedCount: number): void {
    const groupsRemaining = expectedGroups - groups.length;
    const valuesRemaining = rowNumbers.length - index;
    if (groupsRemaining === 0) {
      if (valuesRemaining === 0) {
        const subtotal = groups.slice(0, -1).reduce((sum, num) => sum + num, 0);
        const total = groups[groups.length - 1];
        if (total === subtotal) {
          candidates.push({ values: [...groups], mergedCount });
        }
      }
      return;
    }

    if (valuesRemaining < groupsRemaining || valuesRemaining > groupsRemaining * 3) {
      return;
    }

    for (let take = 1; take <= Math.min(3, valuesRemaining); take += 1) {
      const chunk = rowNumbers.slice(index, index + take);
      if (take > 1 && !chunk.every(isSingleDigitInteger)) {
        continue;
      }

      const value = take === 1 ? chunk[0] : Number(chunk.join(''));
      groups.push(value);
      backtrack(index + take, groups, mergedCount + (take - 1));
      groups.pop();
    }
  }

  backtrack(0, [], 0);

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => left.mergedCount - right.mergedCount);
  const best = candidates[0];
  const bestCandidates = candidates.filter((candidate) => candidate.mergedCount === best.mergedCount);
  const totalValues = new Set(bestCandidates.map((candidate) => candidate.values[candidate.values.length - 1]));

  if (totalValues.size === 1) {
    return bestCandidates[0].values;
  }

  return null;
}

function extractExactTable3ApplicantVector(rowNumbers: number[]): Table3ApplicantVector | null {
  if (rowNumbers.length !== 7) {
    return null;
  }

  const subtotal = rowNumbers.slice(0, -1).reduce((sum, num) => sum + num, 0);
  const total = rowNumbers[rowNumbers.length - 1];
  if (total === subtotal) {
    return [...rowNumbers] as Table3ApplicantVector;
  }
  if (total === 0 && subtotal > 0) {
    return [...rowNumbers.slice(0, -1), subtotal] as Table3ApplicantVector;
  }
  return null;
}

function extractUniqueFragmentedTable3ApplicantVector(rowNumbers: number[]): Table3ApplicantVector | null {
  const expectedGroups = 7;
  if (rowNumbers.length <= expectedGroups || rowNumbers.length > expectedGroups + 4) {
    return null;
  }

  const candidates: Array<{ values: number[]; mergedCount: number }> = [];

  function backtrack(index: number, groups: number[], mergedCount: number): void {
    const groupsRemaining = expectedGroups - groups.length;
    const valuesRemaining = rowNumbers.length - index;
    if (groupsRemaining === 0) {
      if (valuesRemaining === 0) {
        const subtotal = groups.slice(0, -1).reduce((sum, num) => sum + num, 0);
        const total = groups[groups.length - 1];
        if (total === subtotal) {
          candidates.push({ values: [...groups], mergedCount });
        }
      }
      return;
    }

    if (valuesRemaining < groupsRemaining || valuesRemaining > groupsRemaining * 3) {
      return;
    }

    for (let take = 1; take <= Math.min(3, valuesRemaining); take += 1) {
      const chunk = rowNumbers.slice(index, index + take);
      if (take > 1 && !chunk.every(isSingleDigitInteger)) {
        continue;
      }

      const value = take === 1 ? chunk[0] : Number(chunk.join(''));
      groups.push(value);
      backtrack(index + take, groups, mergedCount + (take - 1));
      groups.pop();
    }
  }

  backtrack(0, [], 0);
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => left.mergedCount - right.mergedCount);
  const bestMergedCount = candidates[0].mergedCount;
  const bestCandidates = candidates.filter((candidate) => candidate.mergedCount === bestMergedCount);
  const nonZeroApplicantCounts = bestCandidates.map((candidate) =>
    candidate.values.slice(0, -1).filter((value) => value !== 0).length
  );
  const minNonZeroApplicantCount = Math.min(...nonZeroApplicantCounts);
  const narrowedCandidates = bestCandidates.filter(
    (candidate) => candidate.values.slice(0, -1).filter((value) => value !== 0).length === minNonZeroApplicantCount
  );
  const uniqueVectors = Array.from(new Set(narrowedCandidates.map((candidate) => candidate.values.join(','))));
  if (uniqueVectors.length !== 1) {
    return null;
  }

  return uniqueVectors[0].split(',').map((item) => Number(item)) as Table3ApplicantVector;
}

function extractTable3ApplicantVector(line: string): Table3ApplicantVector | null {
  const rowNumbers = extractStrictPipeIntegers(line);
  if (rowNumbers.length === 0) {
    return null;
  }
  return (
    extractExactTable3ApplicantVector(rowNumbers) ||
    extractUniqueFragmentedTable3ApplicantVector(rowNumbers)
  );
}

function extractTable3RowLastTotal(line: string): number | null {
  const vector = extractTable3ApplicantVector(line);
  if (vector) {
    return vector[vector.length - 1];
  }

  const rowNumbers = extractStrictPipeIntegers(line);
  if (rowNumbers.length === 0) {
    return extractLastIntegerFromLine(line);
  }

  const repaired = repairFragmentedTable3ApplicantRow(rowNumbers);
  if (repaired) {
    return repaired[repaired.length - 1];
  }

  if (rowNumbers.length >= 2) {
    const last = rowNumbers[rowNumbers.length - 1];
    const subtotal = rowNumbers.slice(0, -1).reduce((sum, num) => sum + num, 0);
    if (last === subtotal) return last;
    if (last === 0 && subtotal > 0) return subtotal;

    for (let tailLength = 2; tailLength <= Math.min(3, rowNumbers.length - 1); tailLength += 1) {
      const tail = rowNumbers.slice(-tailLength);
      if (!tail.every(isSingleDigitInteger)) {
        continue;
      }
      const merged = Number(tail.join(''));
      const repairedSubtotal = rowNumbers.slice(0, -tailLength).reduce((sum, num) => sum + num, 0);
      if (merged === repairedSubtotal) {
        return merged;
      }
    }

    return last;
  }

  return rowNumbers[0] ?? null;
}

function extractLastIntegerFromLine(line: string): number | null {
  const normalized = normalizeText(line).replace(/,/g, '');

  if (normalized.includes('|')) {
    const rowNumbers = extractStrictPipeIntegers(normalized);

    if (rowNumbers.length >= 2) {
      const last = rowNumbers[rowNumbers.length - 1];
      const subtotal = rowNumbers.slice(0, -1).reduce((sum, num) => sum + num, 0);
      if (last === subtotal) return last;
      if (last === 0 && subtotal > 0) return subtotal;
      return last;
    }
    if (rowNumbers.length === 1) {
      return rowNumbers[0];
    }
  }

  const matches = normalized.match(/-?\d+/g);
  if (!matches || matches.length === 0) return null;
  const value = Number(matches[matches.length - 1]);
  return Number.isFinite(value) ? value : null;
}

function isTable3Heading(line: string): boolean {
  const normalized = normalizeText(line);
  return (
    normalized.includes('表三') ||
    normalized.includes('收到和处理政府信息公开申请情况') ||
    normalized.includes('政府信息公开申请情况')
  );
}

function isTable4Heading(line: string): boolean {
  const normalized = normalizeText(line);
  return normalized.includes('表四') || normalized.includes('行政复议') || normalized.includes('行政诉讼');
}

function pickTable3Window(text: string): string {
  const lines = String(text || '').split(/\r?\n/);
  let start = -1;
  let end = -1;

  for (let i = 0; i < lines.length; i += 1) {
    if (isTable3Heading(lines[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return text;
  }

  for (let i = start + 1; i < lines.length; i += 1) {
    if (isTable4Heading(lines[i])) {
      end = i;
      break;
    }
  }

  const selected = end > start ? lines.slice(start, end) : lines.slice(start);
  return selected.join('\n');
}

function extractTableTotals(table3WindowText: string): Partial<Totals> {
  const output: Partial<Totals> = {};
  const lines = String(table3WindowText || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = normalizeText(rawLine);
    const compact = line.replace(/\s+/g, '');
    if (!compact) continue;
    if (compact.startsWith('|---') || compact.includes('结果维持') || compact.includes('结果纠正') || compact.includes('尚未审结')) {
      continue;
    }

    const value = extractTable3RowLastTotal(line);
    if (value === null) continue;

    if (!output.new_received && compact.includes('本年新收')) {
      output.new_received = value;
      continue;
    }

    if (!output.carried_over && compact.includes('上年结转')) {
      output.carried_over = value;
      continue;
    }

    if (!output.total_processed && compact.includes('总计') && (compact.includes('七') || compact.includes('(7)'))) {
      output.total_processed = value;
      continue;
    }

    if (!output.carried_forward && (compact.includes('结转下年度') || compact.includes('结转下一年'))) {
      output.carried_forward = value;
      continue;
    }
  }

  return output;
}

function extractTableRowTotals(table3WindowText: string): {
  rowTotals: Table3RowTotals;
  extractedKeys: Table3RowKey[];
  rowVectors: Table3RowVectors;
  rowVectorKeys: Table3RowKey[];
} {
  const rowTotals = emptyTable3RowTotals();
  const extractedKeys = new Set<Table3RowKey>();
  const rowVectors: Table3RowVectors = {};
  const rowVectorKeys = new Set<Table3RowKey>();
  const lines = String(table3WindowText || '').split(/\r?\n/);

  for (const rawLine of lines) {
    const line = normalizeText(rawLine);
    const compact = line.replace(/\s+/g, '');
    if (!compact) continue;
    if (compact.startsWith('|---') || compact.includes('申请人情况') || compact.includes('勾稽关系')) {
      continue;
    }

    if (!line.includes('|')) continue;
    if (extractStrictPipeIntegers(line).length < 2) continue;

    const vector = extractTable3ApplicantVector(line);
    const value = extractTable3RowLastTotal(line);
    if (value === null) continue;

    for (const matcher of TABLE3_ROW_MATCHERS) {
      if (rowTotals[matcher.key] !== null) {
        continue;
      }
      if (!matcher.matches(compact)) {
        continue;
      }
      rowTotals[matcher.key] = value;
      extractedKeys.add(matcher.key);
      if (vector) {
        rowVectors[matcher.key] = vector;
        rowVectorKeys.add(matcher.key);
      }
      break;
    }
  }

  return {
    rowTotals,
    extractedKeys: TABLE3_ROW_KEYS.filter((key) => extractedKeys.has(key)),
    rowVectors,
    rowVectorKeys: TABLE3_ROW_KEYS.filter((key) => rowVectorKeys.has(key)),
  };
}

function buildSourceExtraction(text: string): SourceExtraction {
  const narrative = extractNarrativeTotals(text);
  const tableWindow = pickTable3Window(text);
  const table = extractTableTotals(tableWindow);
  const rowExtraction = extractTableRowTotals(tableWindow);

  const totals: Totals = {
    new_received: null,
    carried_over: null,
    total_processed: null,
    carried_forward: null,
  };
  const methods: Record<FieldKey, 'narrative' | 'table' | null> = {
    new_received: null,
    carried_over: null,
    total_processed: null,
    carried_forward: null,
  };

  for (const key of FIELD_KEYS) {
    const narrativeValue = (narrative as any)[key];
    if (typeof narrativeValue === 'number') {
      totals[key] = narrativeValue;
      methods[key] = 'narrative';
      continue;
    }

    const tableValue = (table as any)[key];
    if (typeof tableValue === 'number') {
      totals[key] = tableValue;
      methods[key] = 'table';
    }
  }

  const extractedCount = FIELD_KEYS.filter((key) => typeof totals[key] === 'number').length;
  return {
    totals,
    methods,
    extractedCount,
    rowTotals: rowExtraction.rowTotals,
    rowExtractedKeys: rowExtraction.extractedKeys,
    rowExtractedCount: rowExtraction.extractedKeys.length,
    rowVectors: rowExtraction.rowVectors,
    rowVectorKeys: rowExtraction.rowVectorKeys,
    sourceLength: text.length,
  };
}

function buildSourceExtractionFromTotals(
  totals: Totals,
  method: 'narrative' | 'table',
  sourceLength: number
): SourceExtraction {
  const methods: Record<FieldKey, 'narrative' | 'table' | null> = {
    new_received: null,
    carried_over: null,
    total_processed: null,
    carried_forward: null,
  };

  for (const key of FIELD_KEYS) {
    if (typeof totals[key] === 'number') {
      methods[key] = method;
    }
  }

  const extractedCount = FIELD_KEYS.filter((key) => typeof totals[key] === 'number').length;
  return {
    totals,
    methods,
    extractedCount,
    rowTotals: emptyTable3RowTotals(),
    rowExtractedKeys: [],
    rowExtractedCount: 0,
    rowVectors: {},
    rowVectorKeys: [],
    sourceLength,
  };
}

function readByPath(input: any, dottedPath: string): any {
  const keys = dottedPath.split('.');
  let cur = input;
  for (const key of keys) {
    cur = cur?.[key];
  }
  return cur;
}

function firstNumericFromPaths(input: any, paths: string[]): number | null {
  for (const p of paths) {
    const value = readByPath(input, p);
    const numeric = coerceNumber(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function normalizeAiReviewTotals(reviewObj: any): Totals {
  const candidateRoots = [
    reviewObj,
    reviewObj?.source_totals,
    reviewObj?.sourceTotals,
    reviewObj?.extracted_source_totals,
    reviewObj?.extractedTotals,
    reviewObj?.source_table3_json?.tableData?.total,
    reviewObj?.source_table3_json?.total,
  ];

  const totals: Totals = {
    new_received: null,
    carried_over: null,
    total_processed: null,
    carried_forward: null,
  };

  for (const root of candidateRoots) {
    if (!root || typeof root !== 'object') continue;

    if (totals.new_received === null) {
      totals.new_received = firstNumericFromPaths(root, [
        'new_received',
        'newReceived',
        'new',
      ]);
    }

    if (totals.carried_over === null) {
      totals.carried_over = firstNumericFromPaths(root, [
        'carried_over',
        'carriedOver',
      ]);
    }

    if (totals.total_processed === null) {
      totals.total_processed = firstNumericFromPaths(root, [
        'total_processed',
        'totalProcessed',
        'results.totalProcessed',
      ]);
    }

    if (totals.carried_forward === null) {
      totals.carried_forward = firstNumericFromPaths(root, [
        'carried_forward',
        'carriedForward',
        'results.carriedForward',
      ]);
    }
  }

  return totals;
}

async function compareWithAiSourceJsonReview(
  provider: LlmProvider,
  sourceText: string,
  parsedTotals: Totals,
  parsedRowTotals: Table3RowTotals,
  minSourceFields: number,
  minRowSourceFields: number
): Promise<{ sourceExtraction: SourceExtraction; compare: CompareResult }> {
  const fallbackSource = buildSourceExtraction(sourceText);
  const fallbackCompare = compareSourceAndParsed(
    fallbackSource,
    parsedTotals,
    parsedRowTotals,
    minSourceFields,
    minRowSourceFields
  );
  const generate = (provider as any)?.generate;
  if (typeof generate !== 'function') {
    return { sourceExtraction: fallbackSource, compare: fallbackCompare };
  }

  const table3Window = pickTable3Window(sourceText || '');
  const reviewWindow = table3Window.length > 40000 ? table3Window.slice(0, 40000) : table3Window;
  const parsedForPrompt = {
    new_received: parsedTotals.new_received,
    carried_over: parsedTotals.carried_over,
    total_processed: parsedTotals.total_processed,
    carried_forward: parsedTotals.carried_forward,
  };

  const systemInstruction = [
    'You are a strict consistency reviewer for Chinese government annual report table_3.',
    'Task 1: Extract source table_3 total values from SOURCE_TEXT into source_totals.',
    'Task 2: Compare source_totals and parsed_totals.',
    'Rules:',
    '- source_totals keys must be: new_received, carried_over, total_processed, carried_forward.',
    '- Unknown/missing value must be null.',
    '- Compare only fields with numeric source value.',
    '- If source numeric fields < min_source_fields => pass=false and reason=source_extract_insufficient:x<min.',
    '- If any compared field differs => pass=false and reason starts with source_mismatch.',
    '- Else pass=true.',
    'Return JSON only.',
  ].join('\n');

  const prompt = JSON.stringify(
    {
      min_source_fields: minSourceFields,
      parsed_totals: parsedForPrompt,
      source_text: reviewWindow,
      output_schema: {
        source_totals: {
          new_received: 'number|null',
          carried_over: 'number|null',
          total_processed: 'number|null',
          carried_forward: 'number|null',
        },
        pass: 'boolean',
        reason: 'string',
        compared_fields: ['new_received|carried_over|total_processed|carried_forward'],
        mismatches: [{ field: 'field_name', source: 0, parsed: 0 }],
      },
    },
    null,
    2
  );

  try {
    const reviewed = await generate(prompt, systemInstruction, {
      responseMimeType: 'application/json',
      temperature: 0,
      maxOutputTokens: 1200,
    });
    const reviewRawText = typeof reviewed?.text === 'string' ? reviewed.text : JSON.stringify(reviewed || {});
    const reviewObj = recoverJsonObjectFromText(reviewRawText);
    if (!reviewObj || typeof reviewObj !== 'object') {
      return { sourceExtraction: fallbackSource, compare: fallbackCompare };
    }

    const aiTotals = normalizeAiReviewTotals(reviewObj);
    const aiSourceExtraction = buildSourceExtractionFromTotals(aiTotals, 'table', sourceText.length);
    aiSourceExtraction.rowTotals = fallbackSource.rowTotals;
    aiSourceExtraction.rowExtractedKeys = fallbackSource.rowExtractedKeys;
    aiSourceExtraction.rowExtractedCount = fallbackSource.rowExtractedCount;
    aiSourceExtraction.rowVectors = fallbackSource.rowVectors;
    aiSourceExtraction.rowVectorKeys = fallbackSource.rowVectorKeys;
    const aiCompare = compareSourceAndParsed(
      aiSourceExtraction,
      parsedTotals,
      parsedRowTotals,
      minSourceFields,
      minRowSourceFields
    );
    return { sourceExtraction: aiSourceExtraction, compare: aiCompare };
  } catch {
    return { sourceExtraction: fallbackSource, compare: fallbackCompare };
  }
}

function compareSourceAndParsed(
  source: SourceExtraction,
  parsedTotals: Totals,
  parsedRowTotals: Table3RowTotals,
  minSourceFields: number,
  minRowSourceFields: number
): CompareResult {
  const extractedFields = FIELD_KEYS.filter((field) => source.totals[field] !== null);
  if (extractedFields.length < minSourceFields) {
    return {
      passed: false,
      reason: `source_extract_insufficient:${extractedFields.length}<${minSourceFields}`,
      extractedFields,
      comparedFields: [],
      missingParsedFields: [],
      mismatches: [],
      rowComparedFields: [],
      rowMissingParsedFields: [],
      rowMismatches: [],
    };
  }

  const comparedFields: FieldKey[] = [];
  const missingParsedFields: FieldKey[] = [];
  const mismatches: Array<{ field: string; source: number; parsed: number }> = [];

  for (const field of extractedFields) {
    const sourceValue = source.totals[field];
    const parsedValue = parsedTotals[field];
    if (sourceValue === null) continue;
    if (parsedValue === null) {
      missingParsedFields.push(field);
      continue;
    }
    comparedFields.push(field);
    if (sourceValue !== parsedValue) {
      mismatches.push({ field, source: sourceValue, parsed: parsedValue });
    }
  }

  if (missingParsedFields.length > 0) {
    return {
      passed: false,
      reason: `parsed_missing_fields:${missingParsedFields.join('|')}`,
      extractedFields,
      comparedFields,
      missingParsedFields,
      mismatches,
      rowComparedFields: [],
      rowMissingParsedFields: [],
      rowMismatches: [],
    };
  }

  if (mismatches.length > 0) {
    // Heuristic guardrail:
    // Some source-table extractions frequently read total_processed as 0 even when
    // new_received / carried_over / carried_forward are correct. If parsed total
    // satisfies the table identity, accept it as source-consistent.
    const onlyTotalProcessedMismatch = mismatches.length === 1 && mismatches[0].field === 'total_processed';
    if (onlyTotalProcessedMismatch) {
      const srcNew = source.totals.new_received;
      const srcCarryOver = source.totals.carried_over;
      const srcCarryForward = source.totals.carried_forward;
      const parsedTotal = parsedTotals.total_processed;
      if (
        typeof srcNew === 'number' &&
        typeof srcCarryOver === 'number' &&
        typeof srcCarryForward === 'number' &&
        typeof parsedTotal === 'number'
      ) {
        const identityTotal = srcNew + srcCarryOver - srcCarryForward;
        if (identityTotal >= 0 && parsedTotal === identityTotal) {
          return {
            passed: true,
            extractedFields,
            comparedFields,
            missingParsedFields,
            mismatches: [],
            rowComparedFields: [],
            rowMissingParsedFields: [],
            rowMismatches: [],
          };
        }
      }
    }

    return {
      passed: false,
      reason: `source_mismatch:${mismatches.map((m) => `${m.field}:${m.source}!=${m.parsed}`).join('|')}`,
      extractedFields,
      comparedFields,
      missingParsedFields,
      mismatches,
      rowComparedFields: [],
      rowMissingParsedFields: [],
      rowMismatches: [],
    };
  }

  const rowExtractedKeys = source.rowExtractedKeys || [];
  if (minRowSourceFields > 0 && rowExtractedKeys.length >= minRowSourceFields) {
    const rowComparedFields: Table3RowKey[] = [];
    const rowMissingParsedFields: Table3RowKey[] = [];
    const rowMismatches: Array<{ field: Table3RowKey; source: number; parsed: number }> = [];

    for (const field of rowExtractedKeys) {
      const sourceValue = source.rowTotals[field];
      const parsedValue = parsedRowTotals[field];
      if (sourceValue === null) continue;
      if (parsedValue === null) {
        rowMissingParsedFields.push(field);
        continue;
      }
      rowComparedFields.push(field);
      if (sourceValue !== parsedValue) {
        rowMismatches.push({ field, source: sourceValue, parsed: parsedValue });
      }
    }

    if (rowMissingParsedFields.length > 0) {
      return {
        passed: false,
        reason: `parsed_missing_row_fields:${rowMissingParsedFields.join('|')}`,
        extractedFields,
        comparedFields,
        missingParsedFields,
        mismatches,
        rowComparedFields,
        rowMissingParsedFields,
        rowMismatches,
      };
    }

    if (rowMismatches.length > 0) {
      return {
        passed: false,
        reason: `source_row_mismatch:${rowMismatches.map((m) => `${m.field}:${m.source}!=${m.parsed}`).join('|')}`,
        extractedFields,
        comparedFields,
        missingParsedFields,
        mismatches,
        rowComparedFields,
        rowMissingParsedFields,
        rowMismatches,
      };
    }

    return {
      passed: true,
      extractedFields,
      comparedFields,
      missingParsedFields,
      mismatches,
      rowComparedFields,
      rowMissingParsedFields,
      rowMismatches,
    };
  }

  return {
    passed: true,
    extractedFields,
    comparedFields,
    missingParsedFields,
    mismatches,
    rowComparedFields: [],
    rowMissingParsedFields: [],
    rowMismatches: [],
  };
}

async function loadTargets(summaryPath: string, limit: number, reportFilter: number[]): Promise<SummaryRow[]> {
  const raw = await fsp.readFile(summaryPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('summary_json_invalid: expected array');
  }

  const rows = parsed
    .map((item: any) => ({
      report_id: Number(item?.report_id),
      version_id: Number(item?.version_id),
    }))
    .filter((item: SummaryRow) => Number.isInteger(item.report_id) && item.report_id > 0 && Number.isInteger(item.version_id) && item.version_id > 0);

  const dedup = new Map<number, SummaryRow>();
  for (const row of rows) {
    if (!dedup.has(row.version_id)) {
      dedup.set(row.version_id, row);
    }
  }

  let list = Array.from(dedup.values());
  if (reportFilter.length > 0) {
    const allow = new Set(reportFilter);
    list = list.filter((item) => allow.has(item.report_id));
  }

  if (limit > 0) {
    list = list.slice(0, limit);
  }
  return list;
}

async function loadVersionRows(versionIds: number[]): Promise<Map<number, TargetVersionRow>> {
  const mapping = new Map<number, TargetVersionRow>();
  if (versionIds.length === 0) return mapping;

  const result = await pool.query(
    `SELECT rv.id::int AS version_id,
            rv.report_id::int AS report_id,
            rv.storage_path,
            rv.file_hash,
            rv.file_name
     FROM report_versions rv
     WHERE rv.id = ANY($1::int[])`,
    [versionIds]
  );

  for (const row of result.rows) {
    mapping.set(Number(row.version_id), {
      version_id: Number(row.version_id),
      report_id: Number(row.report_id),
      storage_path: String(row.storage_path || ''),
      file_hash: row.file_hash ?? null,
      file_name: row.file_name ?? null,
    });
  }
  return mapping;
}

async function hasRawTextColumn(): Promise<boolean> {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'report_versions' AND column_name = 'raw_text'
     LIMIT 1`
  );
  return result.rows.length > 0;
}

async function loadVersionState(versionId: number, includeRawText: boolean): Promise<VersionState | null> {
  const selectRawText = includeRawText ? ', raw_text' : ', NULL::text AS raw_text';
  const result = await pool.query(
    `SELECT parsed_json, provider, model, prompt_version ${selectRawText}
     FROM report_versions
     WHERE id = $1
     LIMIT 1`,
    [versionId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    parsed_json: row.parsed_json ?? null,
    provider: row.provider ?? null,
    model: row.model ?? null,
    prompt_version: row.prompt_version ?? null,
    raw_text: row.raw_text ?? null,
  };
}

async function saveParseOutput(
  versionId: number,
  provider: string,
  model: string,
  output: any,
  rawText: string | undefined,
  includeRawText: boolean
): Promise<void> {
  const outputJson = typeof output === 'string' ? output : JSON.stringify(output, null, 2);

  await pool.query(
    `INSERT INTO report_version_parses (report_version_id, provider, model, output_json, created_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [versionId, provider, model, outputJson]
  );

  if (includeRawText) {
    await pool.query(
      `UPDATE report_versions
       SET parsed_json = $1,
           provider = $2,
           model = $3,
           prompt_version = 'v1',
           raw_text = $4,
           updated_at = NOW()
       WHERE id = $5`,
      [outputJson, provider, model, rawText ?? null, versionId]
    );
    return;
  }

  await pool.query(
    `UPDATE report_versions
     SET parsed_json = $1,
         provider = $2,
         model = $3,
         prompt_version = 'v1',
         updated_at = NOW()
     WHERE id = $4`,
    [outputJson, provider, model, versionId]
  );
}

async function restoreVersionState(versionId: number, state: VersionState, includeRawText: boolean): Promise<void> {
  const parsedJson = state.parsed_json === null ? null : typeof state.parsed_json === 'string' ? state.parsed_json : JSON.stringify(state.parsed_json);
  if (includeRawText) {
    await pool.query(
      `UPDATE report_versions
       SET parsed_json = $1,
           provider = $2,
           model = $3,
           prompt_version = $4,
           raw_text = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [parsedJson, state.provider, state.model, state.prompt_version, state.raw_text, versionId]
    );
    return;
  }

  await pool.query(
    `UPDATE report_versions
     SET parsed_json = $1,
         provider = $2,
         model = $3,
         prompt_version = $4,
         updated_at = NOW()
     WHERE id = $5`,
    [parsedJson, state.provider, state.model, state.prompt_version, versionId]
  );
}

async function main(): Promise<void> {
  const summaryArg = parseArg('summary-json') || path.resolve(process.cwd(), 'tmp/table3_report_summary_20260304_132923.json');
  const summaryPath = path.isAbsolute(summaryArg) ? summaryArg : path.resolve(process.cwd(), summaryArg);
  const outDirArg = parseArg('out-dir') || path.resolve(process.cwd(), 'tmp');
  const outDir = path.isAbsolute(outDirArg) ? outDirArg : path.resolve(process.cwd(), outDirArg);

  const limit = toInt(parseArg('limit'), Number.MAX_SAFE_INTEGER);
  const maxAttempts = toInt(parseArg('max-attempts'), 2);
  const minSourceFields = toInt(parseArg('min-source-fields'), 3);
  const minRowSourceFields = toNonNegativeInt(parseArg('min-row-source-fields'), 4);
  const providerName = (parseArg('provider') || process.env.LLM_PARSE_PROVIDER || process.env.LLM_PROVIDER || 'stub').trim().toLowerCase();
  const modelName = (parseArg('model') || process.env.LLM_PARSE_MODEL || process.env.LLM_MODEL || '').trim();
  const gateModeRaw = (parseArg('gate-mode') || 'parse-only').trim().toLowerCase();
  const gateMode: GateMode =
    gateModeRaw === 'ai-source-json'
      ? 'ai-source-json'
      : gateModeRaw === 'parse-only'
        ? 'parse-only'
        : 'legacy';
  const stabilizeModeRaw = (parseArg('stabilize-mode') || 'none').trim().toLowerCase();
  const stabilizeMode: StabilizeMode =
    stabilizeModeRaw === 'all'
      ? 'all'
      : stabilizeModeRaw === 'table4-only'
        ? 'table4-only'
        : 'none';
  const retryDelayMs = toNonNegativeInt(parseArg('retry-delay-ms'), 0);
  const rateLimitDelayMs = toNonNegativeInt(parseArg('rate-limit-delay-ms'), 15000);
  const stabilizeOptions = resolveStabilizeOptions(stabilizeMode);
  const reportIds = parseIdList(parseArg('reports'));
  const shardCount = toInt(parseArg('shard-count'), 1);
  const shardIndex = toNonNegativeInt(parseArg('shard-index'), 0);
  const resumeEnabled = !hasFlag('no-resume');
  const resetCheckpoint = hasFlag('reset-checkpoint');
  const apply = hasFlag('apply');

  if (shardCount <= 0) {
    throw new Error('invalid_shard_count');
  }
  if (shardIndex < 0 || shardIndex >= shardCount) {
    throw new Error(`invalid_shard_index:${shardIndex} (shard_count=${shardCount})`);
  }

  const allTargets = await loadTargets(summaryPath, limit, reportIds);
  const targets = shardCount > 1
    ? allTargets.filter((_, idx) => idx % shardCount === shardIndex)
    : allTargets;
  const versionMap = await loadVersionRows(targets.map((item) => item.version_id));
  const includeRawText = await hasRawTextColumn();
  const provider = createLlmProvider(providerName, modelName);

  await fsp.mkdir(outDir, { recursive: true });

  const checkpointArg = parseArg('checkpoint-file');
  const checkpointPath = checkpointArg
    ? (path.isAbsolute(checkpointArg) ? checkpointArg : path.resolve(process.cwd(), checkpointArg))
    : buildDefaultCheckpointPath(outDir, shardCount, shardIndex);
  const signature = buildCheckpointSignature({
    summaryPath,
    providerName,
    modelName,
    gateMode,
    stabilizeMode,
    apply,
    shardCount,
    shardIndex,
    limit,
    maxAttempts,
    minSourceFields,
    minRowSourceFields,
    reportIds,
  });

  if (resetCheckpoint && fs.existsSync(checkpointPath)) {
    await fsp.unlink(checkpointPath);
    console.log(`[checkpoint] reset: ${checkpointPath}`);
  }

  const details: RepairDetail[] = [];
  let counters = emptyCounters();
  let startIndex = 0;
  let resumedFromCheckpoint = false;
  let checkpointCreatedAt = new Date().toISOString();
  let needCheckpointInit = resumeEnabled;

  if (resumeEnabled) {
    const checkpoint = await loadCheckpointState(checkpointPath);
    if (checkpoint) {
      if (checkpoint.signature === signature) {
        startIndex = Math.max(0, Math.min(Number(checkpoint.next_index || 0), targets.length));
        counters = checkpoint.counters || counters;
        details.push(...(Array.isArray(checkpoint.details) ? checkpoint.details : []));
        checkpointCreatedAt = checkpoint.created_at || checkpointCreatedAt;
        resumedFromCheckpoint = startIndex > 0 || !!checkpoint.completed;
        needCheckpointInit = false;
        console.log(
          `[checkpoint] resume shard ${shardIndex}/${shardCount} from index ${startIndex}/${targets.length} (completed=${Boolean(checkpoint.completed)})`
        );
      } else {
        console.log(`[checkpoint] signature mismatch, starting fresh. file=${checkpointPath}`);
      }
    }
  }

  const persistCheckpoint = async (nextIndex: number, completed: boolean): Promise<void> => {
    if (!resumeEnabled) return;
    const state: CheckpointState = {
      version: CHECKPOINT_VERSION,
      signature,
      created_at: checkpointCreatedAt,
      updated_at: new Date().toISOString(),
      completed,
      next_index: Math.max(0, Math.min(nextIndex, targets.length)),
      total_targets: targets.length,
      counters: { ...counters },
      details,
    };
    await saveCheckpointState(checkpointPath, state);
  };

  if (needCheckpointInit) {
    await persistCheckpoint(startIndex, false);
  }

  for (let index = startIndex; index < targets.length; index += 1) {
    const target = targets[index];
    const versionRow = versionMap.get(target.version_id);
    if (!versionRow) {
      counters.version_not_found += 1;
      details.push({
        report_id: target.report_id,
        version_id: target.version_id,
        storage_path: '',
        status: 'version_not_found',
        reason: 'version_not_found_in_db',
      });
      await persistCheckpoint(index + 1, false);
      continue;
    }

    const resolvedPath = resolveAbsoluteStoragePath(versionRow.storage_path);
    if (!fs.existsSync(resolvedPath)) {
      counters.skipped_missing_file += 1;
      details.push({
        report_id: versionRow.report_id,
        version_id: versionRow.version_id,
        storage_path: versionRow.storage_path,
        status: 'skipped_file_missing',
        reason: `source_file_missing:${resolvedPath}`,
      });
      await persistCheckpoint(index + 1, false);
      continue;
    }

    const fileStats = fs.statSync(resolvedPath);
    if (fileStats.size <= 0) {
      counters.skipped_zero_file += 1;
      details.push({
        report_id: versionRow.report_id,
        version_id: versionRow.version_id,
        storage_path: versionRow.storage_path,
        status: 'skipped_file_zero_bytes',
        reason: 'source_file_zero_bytes',
      });
      await persistCheckpoint(index + 1, false);
      continue;
    }

    counters.processed_files += 1;
    console.log(`[reparse-table3] ${index + 1}/${targets.length} report=${versionRow.report_id} version=${versionRow.version_id}`);

    let finished = false;
    let lastFailureDetail: RepairDetail | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const parseResult = await provider.parse({
          reportId: versionRow.report_id,
          versionId: versionRow.version_id,
          storagePath: resolvedPath,
          fileHash: versionRow.file_hash || undefined,
        });

        const recoveredOutput = recoverOutputFromRawText(parseResult.output);
        let sourceText = parseResult.sourceText || '';
        const loaded = await loadUserText(resolvedPath, {
          reportId: versionRow.report_id,
          versionId: versionRow.version_id,
          storagePath: resolvedPath,
          fileHash: versionRow.file_hash || undefined,
        });
        if (loaded.text && loaded.text.length > sourceText.length) {
          sourceText = loaded.text;
        }

        const fallbackSourceExtraction = buildSourceExtraction(sourceText);
        const sourceRepairTags = applySourceRowVectorRepairs(recoveredOutput, fallbackSourceExtraction);
        const stabilized = stabilizeParsedOutput(recoveredOutput, stabilizeOptions);
        const output = stabilized.output;
        const totalRepairCount = sourceRepairTags.length + stabilized.repairs.length;
        const parsedTotals = extractParsedTotals(output);
        const parsedRowTotals = extractParsedRowTotals(output);

        let sourceExtraction: SourceExtraction = fallbackSourceExtraction;
        let compare: CompareResult = {
          passed: true,
          extractedFields: [],
          comparedFields: [],
          missingParsedFields: [],
          mismatches: [],
          rowComparedFields: [],
          rowMissingParsedFields: [],
          rowMismatches: [],
        };
        if (gateMode === 'ai-source-json') {
          const aiReviewed = await compareWithAiSourceJsonReview(
            provider,
            sourceText,
            parsedTotals,
            parsedRowTotals,
            minSourceFields,
            minRowSourceFields
          );
          sourceExtraction = aiReviewed.sourceExtraction;
          compare = aiReviewed.compare;
        } else if (gateMode === 'legacy') {
          compare = compareSourceAndParsed(
            sourceExtraction,
            parsedTotals,
            parsedRowTotals,
            minSourceFields,
            minRowSourceFields
          );
        }
        if (!compare.passed) {
          const failure: RepairDetail = {
            report_id: versionRow.report_id,
            version_id: versionRow.version_id,
            storage_path: versionRow.storage_path,
            status: 'source_gate_failed',
            attempt,
            provider: parseResult.provider,
            model: parseResult.model,
            source_extracted_fields: sourceExtraction.extractedCount,
            source_row_extracted_fields: sourceExtraction.rowExtractedCount,
            compared_fields: compare.comparedFields.length,
            mismatched_fields: compare.mismatches.length,
            row_compared_fields: compare.rowComparedFields.length,
            row_mismatched_fields: compare.rowMismatches.length,
            reason: compare.reason,
            mismatches: [...compare.mismatches, ...compare.rowMismatches],
            source_totals: sourceExtraction.totals,
            parsed_totals: parsedTotals,
            source_row_totals: sourceExtraction.rowTotals,
            parsed_row_totals: parsedRowTotals,
            repairs_applied: totalRepairCount,
          };
          lastFailureDetail = failure;
          if (attempt < maxAttempts) {
            continue;
          }
          counters.source_gate_failed += 1;
          details.push(failure);
          finished = true;
          break;
        }

        if (!apply) {
          counters.dry_run_pass += 1;
          details.push({
            report_id: versionRow.report_id,
            version_id: versionRow.version_id,
            storage_path: versionRow.storage_path,
            status: 'dry_run_ok',
            attempt,
            provider: parseResult.provider,
            model: parseResult.model,
            source_extracted_fields: sourceExtraction.extractedCount,
            source_row_extracted_fields: sourceExtraction.rowExtractedCount,
            compared_fields: compare.comparedFields.length,
            mismatched_fields: 0,
            row_compared_fields: compare.rowComparedFields.length,
            row_mismatched_fields: 0,
            source_totals: sourceExtraction.totals,
            parsed_totals: parsedTotals,
            source_row_totals: sourceExtraction.rowTotals,
            parsed_row_totals: parsedRowTotals,
            repairs_applied: totalRepairCount,
          });
          finished = true;
          break;
        }

        const previousState = await loadVersionState(versionRow.version_id, includeRawText);
        if (!previousState) {
          throw new Error('version_state_not_found_before_update');
        }

        await saveParseOutput(
          versionRow.version_id,
          parseResult.provider,
          parseResult.model,
          output,
          sourceText,
          includeRawText
        );

        const materialize = await materializeService.materializeVersion(versionRow.version_id);
        if (!materialize.success || (materialize.factsCreated ?? 0) <= 0) {
          await restoreVersionState(versionRow.version_id, previousState, includeRawText);
          const failure: RepairDetail = {
            report_id: versionRow.report_id,
            version_id: versionRow.version_id,
            storage_path: versionRow.storage_path,
            status: 'materialize_failed',
            attempt,
            provider: parseResult.provider,
            model: parseResult.model,
            source_extracted_fields: sourceExtraction.extractedCount,
            source_row_extracted_fields: sourceExtraction.rowExtractedCount,
            compared_fields: compare.comparedFields.length,
            mismatched_fields: compare.mismatches.length,
            row_compared_fields: compare.rowComparedFields.length,
            row_mismatched_fields: compare.rowMismatches.length,
            reason: materialize.error || 'materialize_empty_facts',
            source_totals: sourceExtraction.totals,
            parsed_totals: parsedTotals,
            source_row_totals: sourceExtraction.rowTotals,
            parsed_row_totals: parsedRowTotals,
            repairs_applied: totalRepairCount,
            facts_created: materialize.factsCreated,
            cells_created: materialize.cellsCreated,
          };
          lastFailureDetail = failure;
          if (attempt < maxAttempts) {
            continue;
          }
          counters.materialize_failed += 1;
          details.push(failure);
          finished = true;
          break;
        }

        counters.success += 1;
        details.push({
          report_id: versionRow.report_id,
          version_id: versionRow.version_id,
          storage_path: versionRow.storage_path,
          status: 'ok',
          attempt,
          provider: parseResult.provider,
          model: parseResult.model,
          source_extracted_fields: sourceExtraction.extractedCount,
          source_row_extracted_fields: sourceExtraction.rowExtractedCount,
          compared_fields: compare.comparedFields.length,
          mismatched_fields: compare.mismatches.length,
          row_compared_fields: compare.rowComparedFields.length,
          row_mismatched_fields: compare.rowMismatches.length,
          source_totals: sourceExtraction.totals,
          parsed_totals: parsedTotals,
          source_row_totals: sourceExtraction.rowTotals,
          parsed_row_totals: parsedRowTotals,
          repairs_applied: totalRepairCount,
          facts_created: materialize.factsCreated,
          cells_created: materialize.cellsCreated,
        });
        finished = true;
        break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          lastFailureDetail = {
            report_id: versionRow.report_id,
            version_id: versionRow.version_id,
          storage_path: versionRow.storage_path,
            status: 'parse_failed',
            attempt,
            reason: message,
          };
          if (attempt < maxAttempts) {
            const waitMs = computeRetryDelayMs(message, retryDelayMs, rateLimitDelayMs, attempt);
            if (waitMs > 0) {
              console.warn(
                `[reparse-table3] retrying report=${versionRow.report_id} version=${versionRow.version_id} after ${waitMs}ms (attempt ${attempt}/${maxAttempts}, reason=${message})`
              );
              await sleep(waitMs);
            }
            continue;
          }
          counters.parse_failed += 1;
          details.push(lastFailureDetail);
          finished = true;
        break;
      }
    }

    if (!finished && lastFailureDetail) {
      details.push(lastFailureDetail);
    }

    await persistCheckpoint(index + 1, false);
  }

  await persistCheckpoint(targets.length, true);

  const timestamp = buildTimestamp();
  const summaryOutputPath = resolveOutputPath(
    parseArg('summary-output'),
    path.join(outDir, `reparse_table3_source_gate_summary_${timestamp}.json`)
  );
  const detailOutputPath = resolveOutputPath(
    parseArg('details-output'),
    path.join(outDir, `reparse_table3_source_gate_details_${timestamp}.json`)
  );
  const csvOutputPath = resolveOutputPath(
    parseArg('csv-output'),
    path.join(outDir, `reparse_table3_source_gate_details_${timestamp}.csv`)
  );

  await fsp.mkdir(path.dirname(summaryOutputPath), { recursive: true });
  await fsp.mkdir(path.dirname(detailOutputPath), { recursive: true });
  await fsp.mkdir(path.dirname(csvOutputPath), { recursive: true });

  const summary = {
    scanned_at: new Date().toISOString(),
    summary_input: summaryPath,
    apply,
    provider: providerName,
    model: modelName,
    gate_mode: gateMode,
    stabilize_mode: stabilizeMode,
    shard_count: shardCount,
    shard_index: shardIndex,
    checkpoint_file: checkpointPath,
    resume_enabled: resumeEnabled,
    resumed_from_checkpoint: resumedFromCheckpoint,
    start_index: startIndex,
    limit,
    max_attempts: maxAttempts,
    min_source_fields: minSourceFields,
    min_row_source_fields: minRowSourceFields,
    retry_delay_ms: retryDelayMs,
    rate_limit_delay_ms: rateLimitDelayMs,
    total_from_summary: targets.length,
    processed_files: counters.processed_files,
    success: counters.success,
    dry_run_pass: counters.dry_run_pass,
    parse_failed: counters.parse_failed,
    source_gate_failed: counters.source_gate_failed,
    materialize_failed: counters.materialize_failed,
    skipped_file_missing: counters.skipped_missing_file,
    skipped_file_zero_bytes: counters.skipped_zero_file,
    version_not_found: counters.version_not_found,
  };

  const csvRows = details.map((item) => ({
    report_id: item.report_id,
    version_id: item.version_id,
    status: item.status,
    attempt: item.attempt ?? null,
    provider: item.provider ?? null,
    model: item.model ?? null,
    source_extracted_fields: item.source_extracted_fields ?? null,
    source_row_extracted_fields: item.source_row_extracted_fields ?? null,
    compared_fields: item.compared_fields ?? null,
    mismatched_fields: item.mismatched_fields ?? null,
    row_compared_fields: item.row_compared_fields ?? null,
    row_mismatched_fields: item.row_mismatched_fields ?? null,
    repairs_applied: item.repairs_applied ?? null,
    facts_created: item.facts_created ?? null,
    cells_created: item.cells_created ?? null,
    reason: item.reason ?? null,
    storage_path: item.storage_path,
  }));

  await fsp.writeFile(summaryOutputPath, JSON.stringify(summary, null, 2), 'utf8');
  await fsp.writeFile(detailOutputPath, JSON.stringify(details, null, 2), 'utf8');
  await fsp.writeFile(
    csvOutputPath,
    toCsv(csvRows, [
      'report_id',
      'version_id',
      'status',
      'attempt',
      'provider',
      'model',
      'source_extracted_fields',
      'source_row_extracted_fields',
      'compared_fields',
      'mismatched_fields',
      'row_compared_fields',
      'row_mismatched_fields',
      'repairs_applied',
      'facts_created',
      'cells_created',
      'reason',
      'storage_path',
    ]),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        summary,
        artifacts: {
          summary_json: summaryOutputPath,
          details_json: detailOutputPath,
          details_csv: csvOutputPath,
          checkpoint_json: checkpointPath,
        },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error('[reparse-table3-mismatches-with-source-gate] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
