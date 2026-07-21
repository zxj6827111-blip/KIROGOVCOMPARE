import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import puppeteer from 'puppeteer';
import type { ElementHandle, Page } from 'puppeteer';
import pool from '../config/database-llm';
import { DATA_DIR, PROJECT_ROOT } from '../config/constants';
import { parseStructuredJsonFromText } from './LlmCommon';
import { parseRunService } from './ParseRunService';
import { resolveFirstNonEmpty, normalizeLlmProviderName } from '../utils/aiEnv';
import { aiModelConfigService } from './AiModelConfigService';
import { ConsistencyItem } from './ConsistencyCheckService';
import { HIERARCHY_COMPLETENESS_SQL_EXCLUSION } from '../utils/consistencyReviewSemantics';

export type VisionReviewTableId = 'table_2' | 'table_3' | 'table_4';
export type VisionReviewStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'source_unavailable'
  | 'channel_unavailable'
  | 'failed';
export type VisionReviewConclusion =
  | 'source_table_anomaly'
  | 'parse_mapping_anomaly'
  | 'source_table_matches_parse'
  | 'inconclusive';
export type VisionReviewApiMode = 'responses' | 'chat_completions' | 'mock';

interface VisionReviewConfig {
  enabled: boolean;
  provider: string;
  model: string;
  apiMode: 'auto' | VisionReviewApiMode;
  timeoutMs: number;
  baseUrl?: string;
  apiKey?: string;
  source?: 'database' | 'env';
}

interface ReportVersionRow {
  id: number;
  report_id: number;
  file_hash: string;
  storage_path: string;
  parsed_json: unknown;
}

interface ScreenshotResult {
  ok: boolean;
  path?: string;
  mode?: string;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

interface VisionReviewFocus {
  paths: string[];
  relativePaths: string[];
  checkKeys: string[];
  descriptors: VisionReviewCellDescriptor[];
  promptHints: string[];
}

interface VisionReviewCellDescriptor {
  path: string;
  relativePath: string;
  rowKeywordGroups: string[][];
  columnKeywordGroups: string[][];
  label: string;
  rowLabel: string;
  columnLabel: string;
}

interface HtmlCropResult {
  clip: { x: number; y: number; width: number; height: number };
  cellCount: number;
  rowIndexes: number[];
  columnIndexes: number[];
  fallbackReason?: string;
}

export interface VisionReviewComparison {
  conclusion: VisionReviewConclusion;
  differences: Array<{
    path: string;
    parsedValue: number | string | null;
    ocrValue: number | string | null;
  }>;
  unreadableCells: string[];
  comparedCellCount: number;
  triggerHadCheckFailure: boolean;
  parsedSource: 'parsed_json';
}

export interface OcrCorrectionRow {
  id: number;
  reportId: number;
  reportVersionId: number;
  reviewId: number;
  tableId: VisionReviewTableId;
  fieldPath: string;
  parsedValue: number | string | null;
  ocrValue: number | string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  appliedAt: string | null;
  resolvedAt: string | null;
  resolvedBy: number | null;
  createdAt: string;
  updatedAt: string;
}

interface VisionOcrResult {
  ocrJson: Record<string, any>;
  apiMode: VisionReviewApiMode;
}

const TABLE_IDS: VisionReviewTableId[] = ['table_2', 'table_3', 'table_4'];
const VISION_REVIEW_VERSION = 'v1';

const TABLE_LABELS: Record<VisionReviewTableId, string> = {
  table_2: '表二：主动公开政府信息情况',
  table_3: '表三：收到和处理政府信息公开申请情况',
  table_4: '表四：行政复议、行政诉讼情况',
};

const TABLE_SECTION_TYPES: Record<string, VisionReviewTableId> = {
  table2: 'table_2',
  table_2: 'table_2',
  active_disclosure: 'table_2',
  activeDisclosure: 'table_2',
  table3: 'table_3',
  table_3: 'table_3',
  application: 'table_3',
  table4: 'table_4',
  table_4: 'table_4',
  legal_proceeding: 'table_4',
};

const TABLE_KEYWORDS: Record<VisionReviewTableId, string[]> = {
  table_2: ['第二十条', '规章', '规范性文件', '行政许可', '行政处罚', '行政强制', '行政事业性收费'],
  table_3: ['申请人情况', '本年新收', '上年结转', '予以公开', '部分公开', '办理结果总计', '结转下年度'],
  table_4: ['行政复议', '行政诉讼', '结果维持', '结果纠正', '尚未审结', '复议后起诉'],
};

const TABLE_PAYLOAD_KEY: Record<VisionReviewTableId, string> = {
  table_2: 'activeDisclosureData',
  table_3: 'tableData',
  table_4: 'reviewLitigationData',
};

type PdfJsModule = {
  getDocument: (options: Record<string, unknown>) => { promise: Promise<any> };
};

let pdfjsPromise: Promise<PdfJsModule> | null = null;

function loadPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod: any) => mod.default || mod);
  }
  return pdfjsPromise;
}

const REVIEW_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['table_id', 'confidence', 'unreadableCells'],
  additionalProperties: true,
  properties: {
    table_id: { type: 'string', enum: TABLE_IDS },
    activeDisclosureData: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    tableData: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    reviewLitigationData: { anyOf: [{ type: 'object', additionalProperties: true }, { type: 'null' }] },
    confidence: { type: 'number' },
    unreadableCells: {
      type: 'array',
      items: { type: 'string' },
    },
    notes: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
};

function parseBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function isLoopbackOrLocalhost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1' || normalized === '[::1]';
}

function assertSecureOpenAiBaseUrl(baseUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    const error = new Error('OPENAI_BASE_URL is invalid for vision review');
    (error as any).code = 'openai_invalid_base_url';
    throw error;
  }

  if (parsed.protocol === 'https:') {
    return;
  }

  if (parsed.protocol === 'http:' && isLoopbackOrLocalhost(parsed.hostname) && process.env.NODE_ENV !== 'production') {
    return;
  }

  const error = new Error('OPENAI_BASE_URL must use HTTPS outside local development for vision review');
  (error as any).code = 'openai_insecure_base_url';
  throw error;
}

function normalizeTableId(value: unknown): VisionReviewTableId | null {
  const key = String(value || '').trim();
  return TABLE_SECTION_TYPES[key] || null;
}

function safeJson(value: unknown): any {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function normalizeJsonValueParam(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/,/g, '');
    if (!normalized || normalized === '/' || normalized === '-' || normalized === '--' || normalized === '—') {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function comparableValue(value: unknown): number | string | null {
  const numeric = toNumberOrNull(value);
  if (numeric !== null) return numeric;
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value.trim() || null;
  return null;
}

function getNestedValue(source: any, dottedPath: string): unknown {
  return dottedPath.split('.').reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), source);
}

function normalizeReviewPath(tableId: VisionReviewTableId, value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const payloadKey = TABLE_PAYLOAD_KEY[tableId];
  let normalized = raw
    .replace(/^sections\[type=table_2\]\./, '')
    .replace(/^sections\[type=table_3\]\./, '')
    .replace(/^sections\[type=table_4\]\./, '')
    .replace(/^sections\[[^\]]+\]\./, '');

  if (normalized === payloadKey) return null;
  if (normalized.startsWith(`${payloadKey}.`)) return normalized;

  if (tableId === 'table_3' && /^(naturalPerson|legalPerson|total)\./.test(normalized)) {
    return `${payloadKey}.${normalized}`;
  }
  if (tableId === 'table_4' && /^(review|litigationDirect|litigationPostReview)\./.test(normalized)) {
    return `${payloadKey}.${normalized}`;
  }
  if (tableId === 'table_2' && /^[A-Za-z0-9_]+\./.test(normalized)) {
    return `${payloadKey}.${normalized}`;
  }
  return null;
}

function toRelativeReviewPath(tableId: VisionReviewTableId, value: unknown): string | null {
  const normalized = normalizeReviewPath(tableId, value);
  if (!normalized) return null;
  const prefix = `${TABLE_PAYLOAD_KEY[tableId]}.`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((item): item is string => Boolean(item))));
}

function flattenLeafValues(source: any, prefix = ''): Record<string, number | string | null> {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }

  const output: Record<string, number | string | null> = {};
  for (const [key, value] of Object.entries(source)) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(output, flattenLeafValues(value, pathKey));
      continue;
    }
    output[pathKey] = comparableValue(value);
  }
  return output;
}

function getParsedTablePayload(parsedJson: any, tableId: VisionReviewTableId): Record<string, any> | null {
  const parsed = safeJson(parsedJson);
  const directKey = TABLE_PAYLOAD_KEY[tableId];
  if (parsed && typeof parsed === 'object' && parsed[directKey] && typeof parsed[directKey] === 'object') {
    return parsed[directKey] as Record<string, any>;
  }

  const sections = Array.isArray(parsed?.sections) ? parsed.sections : [];
  const section = sections.find((item: any) => item?.type === tableId);
  const payload = section?.[directKey];
  return payload && typeof payload === 'object' ? payload : null;
}

function getOcrTablePayload(ocrJson: Record<string, any>, tableId: VisionReviewTableId): Record<string, any> | null {
  const directKey = TABLE_PAYLOAD_KEY[tableId];
  const payload = ocrJson?.[directKey];
  if (payload && typeof payload === 'object') {
    return normalizeOcrTablePayload(tableId, payload as Record<string, any>);
  }

  const alternate = ocrJson?.[tableId];
  if (alternate && typeof alternate === 'object') {
    return normalizeOcrTablePayload(tableId, alternate as Record<string, any>);
  }
  return null;
}

function normalizeOcrTablePayload(tableId: VisionReviewTableId, payload: Record<string, any>): Record<string, any> {
  if (tableId === 'table_2') {
    return normalizeTable2DisclosurePayload(payload) || payload;
  }
  if (tableId === 'table_3') {
    return normalizeTable3MatrixPayload(payload) || payload;
  }
  return payload;
}

function isRecordValue(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMatchText(value: unknown): string {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[()（）［］\[\]【】]/g, '')
    .replace(/[、，,。:：;；/\\|_\-—]/g, '')
    .toLowerCase();
}

function labelMatches(value: unknown, labels: string[]): boolean {
  const normalized = normalizeMatchText(value);
  return labels.some((label) => {
    const target = normalizeMatchText(label);
    return Boolean(target) && normalized.includes(target);
  });
}

function findNestedRecordByLabel(source: unknown, labels: string[], maxDepth = 5): Record<string, any> | null {
  if (!isRecordValue(source) || maxDepth < 0) return null;

  for (const [key, value] of Object.entries(source)) {
    if (labelMatches(key, labels) && isRecordValue(value)) {
      return value;
    }
  }

  for (const value of Object.values(source)) {
    const found = findNestedRecordByLabel(value, labels, maxDepth - 1);
    if (found) return found;
  }
  return null;
}

function pickComparableByLabel(source: unknown, labels: string[], maxDepth = 3): number | string | null {
  if (!isRecordValue(source) || maxDepth < 0) return null;

  for (const [key, value] of Object.entries(source)) {
    if (!labelMatches(key, labels)) continue;
    const comparable = comparableValue(value);
    if (comparable !== null) return comparable;
    const nested = pickComparableByLabel(value, labels, maxDepth - 1);
    if (nested !== null) return nested;
  }

  for (const value of Object.values(source)) {
    const nested = pickComparableByLabel(value, labels, maxDepth - 1);
    if (nested !== null) return nested;
  }
  return null;
}

function setComparableIfPresent(target: Record<string, any>, pathKeys: string[], value: number | string | null): void {
  if (value !== null) {
    setNestedValue(target, pathKeys, value);
  }
}

function normalizeTable2StandardRow(row: Record<string, any>, kind: 'threeCount' | 'processed' | 'fees'): Record<string, any> {
  if (kind === 'threeCount') {
    const made = pickComparableByLabel(row, ['本年制发件数', '本年制发', '本年新制作数量', '本年新公开数量', '制发件数', '新制作数量']);
    const repealed = pickComparableByLabel(row, ['本年废止件数', '本年废止', '废止件数', '废止']);
    const valid = pickComparableByLabel(row, ['现行有效件数', '现行有效', '对外公开总数量', '公开总数量', '有效件数']);
    return { made, repealed: repealed ?? (made !== null && valid !== null ? 0 : null), valid };
  }

  if (kind === 'processed') {
    return {
      processed: pickComparableByLabel(row, ['本年处理决定数量', '处理决定数量', '决定数量']),
    };
  }

  return {
    amount: pickComparableByLabel(row, ['本年收费金额', '收费金额', '收费总金额', '金额', '上一年项目数量']),
  };
}

function normalizeTable2DisclosurePayload(payload: Record<string, any>): Record<string, any> | null {
  const normalized: Record<string, any> = {};
  const sectionOne = findNestedRecordByLabel(payload, ['第二十条第（一）项', '第二十条第一项', '第（一）项', '第一项']) || payload;
  const sectionFive = findNestedRecordByLabel(payload, ['第二十条第（五）项', '第二十条第五项', '第（五）项', '第五项']) || payload;
  const sectionSix = findNestedRecordByLabel(payload, ['第二十条第（六）项', '第二十条第六项', '第（六）项', '第六项']) || payload;
  const sectionEight = findNestedRecordByLabel(payload, ['第二十条第（八）项', '第二十条第八项', '第（八）项', '第八项']) || payload;

  const regulations = findNestedRecordByLabel(sectionOne, ['规章']);
  if (regulations) {
    const row = normalizeTable2StandardRow(regulations, 'threeCount');
    setComparableIfPresent(normalized, ['regulations', 'made'], row.made);
    setComparableIfPresent(normalized, ['regulations', 'repealed'], row.repealed);
    setComparableIfPresent(normalized, ['regulations', 'valid'], row.valid);
  }

  const normativeDocuments = findNestedRecordByLabel(sectionOne, ['行政规范性文件', '规范性文件']);
  if (normativeDocuments) {
    const row = normalizeTable2StandardRow(normativeDocuments, 'threeCount');
    setComparableIfPresent(normalized, ['normativeDocuments', 'made'], row.made);
    setComparableIfPresent(normalized, ['normativeDocuments', 'repealed'], row.repealed);
    setComparableIfPresent(normalized, ['normativeDocuments', 'valid'], row.valid);
  }

  const licensing = findNestedRecordByLabel(sectionFive, ['行政许可']);
  if (licensing) {
    const row = normalizeTable2StandardRow(licensing, 'processed');
    setComparableIfPresent(normalized, ['licensing', 'processed'], row.processed);
  }

  const punishment = findNestedRecordByLabel(sectionSix, ['行政处罚']);
  if (punishment) {
    const row = normalizeTable2StandardRow(punishment, 'processed');
    setComparableIfPresent(normalized, ['punishment', 'processed'], row.processed);
  }

  const coercion = findNestedRecordByLabel(sectionSix, ['行政强制']);
  if (coercion) {
    const row = normalizeTable2StandardRow(coercion, 'processed');
    setComparableIfPresent(normalized, ['coercion', 'processed'], row.processed);
  }

  const fees = findNestedRecordByLabel(sectionEight, ['行政事业性收费']);
  if (fees) {
    const row = normalizeTable2StandardRow(fees, 'fees');
    setComparableIfPresent(normalized, ['fees', 'amount'], row.amount);
  }

  return Object.keys(flattenLeafValues(normalized)).length > 0 ? normalized : null;
}

function normalizeTable3MatrixPayload(payload: Record<string, any>): Record<string, any> | null {
  const rows = payload?.rows;
  const columns = Array.isArray(payload?.columns) ? payload.columns.map((item: unknown) => String(item || '')) : [];
  if (!rows || typeof rows !== 'object' || !columns.length) {
    return null;
  }

  const entityPathByColumn = columns.map((column) => {
    if (column.includes('自然人')) return ['naturalPerson'];
    if (column.includes('商业')) return ['legalPerson', 'commercial'];
    if (column.includes('科研')) return ['legalPerson', 'research'];
    if (column.includes('社会公益')) return ['legalPerson', 'social'];
    if (column.includes('法律服务')) return ['legalPerson', 'legal'];
    if (column.includes('其他')) return ['legalPerson', 'other'];
    if (column.includes('总计')) return ['total'];
    return null;
  });

  const normalized: Record<string, any> = {
    naturalPerson: buildEmptyTable3Entity(),
    legalPerson: {
      commercial: buildEmptyTable3Entity(),
      research: buildEmptyTable3Entity(),
      social: buildEmptyTable3Entity(),
      legal: buildEmptyTable3Entity(),
      other: buildEmptyTable3Entity(),
    },
    total: buildEmptyTable3Entity(),
  };

  const setByColumn = (values: unknown, relativePath: string) => {
    if (!Array.isArray(values)) return;
    values.forEach((value, index) => {
      const entityPath = entityPathByColumn[index];
      if (!entityPath) return;
      setNestedValue(normalized, [...entityPath, ...relativePath.split('.')], comparableValue(value));
    });
  };

  for (const [rowLabel, rowValue] of Object.entries(rows)) {
    const matrixRow = normalizeTable3OcrMatrixRow(rowLabel, rowValue, columns);
    const normalizedLabel = matrixRow.label.replace(/\s+/g, '');
    if (normalizedLabel.includes('本年新收')) {
      setByColumn(matrixRow.values, 'newReceived');
      continue;
    }
    if (normalizedLabel.includes('上年结转')) {
      setByColumn(matrixRow.values, 'carriedOver');
      continue;
    }
    if (normalizedLabel.includes('结转下年度')) {
      setByColumn(matrixRow.values, 'results.carriedForward');
      continue;
    }

    const directResultPath = resolveTable3ResultRowPath(normalizedLabel);
    if (directResultPath) {
      setByColumn(matrixRow.values, directResultPath);
      continue;
    }

    if (normalizedLabel.includes('本年度办理结果') && rowValue && typeof rowValue === 'object' && !Array.isArray(rowValue)) {
      normalizeTable3ResultRows(rowValue as Record<string, any>, setByColumn);
    }
  }

  return normalized;
}

function normalizeTable3OcrMatrixRow(
  rowLabel: string,
  rowValue: unknown,
  columns: string[]
): { label: string; values: unknown } {
  if (Array.isArray(rowValue)) {
    return { label: String(rowLabel || ''), values: rowValue };
  }

  if (rowValue && typeof rowValue === 'object') {
    const record = rowValue as Record<string, any>;
    const pathLabel = typeof record.path === 'string' ? record.path : '';
    const values = record.values && typeof record.values === 'object' && !Array.isArray(record.values)
      ? columns.map((column) => record.values[column])
      : rowValue;
    return { label: pathLabel || String(rowLabel || ''), values };
  }

  return { label: String(rowLabel || ''), values: rowValue };
}

function normalizeTable3ResultRows(rows: Record<string, any>, setByColumn: (values: unknown, relativePath: string) => void): void {
  for (const [rowLabel, rowValue] of Object.entries(rows)) {
    const label = String(rowLabel || '').replace(/\s+/g, '');
    if (Array.isArray(rowValue)) {
      const path = resolveTable3ResultRowPath(label);
      if (path) setByColumn(rowValue, path);
      continue;
    }
    if (rowValue && typeof rowValue === 'object') {
      for (const [childLabel, childValue] of Object.entries(rowValue as Record<string, any>)) {
        const childPath = resolveTable3ResultRowPath(`${label}.${String(childLabel || '').replace(/\s+/g, '')}`);
        if (childPath) setByColumn(childValue, childPath);
      }
    }
  }
}

function resolveTable3ResultRowPath(label: string): string | null {
  if (label.includes('部分公开')) return 'results.partialGrant';
  if (label.includes('予以公开')) return 'results.granted';
  if (label.includes('部分公开')) return 'results.partialGrant';
  if (label.includes('总计')) return 'results.totalProcessed';
  if (label.includes('国家秘密')) return 'results.denied.stateSecret';
  if (label.includes('法律行政法规禁止公开')) return 'results.denied.lawForbidden';
  if (label.includes('三安全一稳定')) return 'results.denied.safetyStability';
  if (label.includes('第三方合法权益')) return 'results.denied.thirdPartyRights';
  if (label.includes('三类内部事务')) return 'results.denied.internalAffairs';
  if (label.includes('四类过程性信息')) return 'results.denied.processInfo';
  if (label.includes('行政执法案卷')) return 'results.denied.enforcementCase';
  if (label.includes('行政查询事项')) return 'results.denied.adminQuery';
  if (label.includes('不掌握相关政府信息')) return 'results.unableToProvide.noInfo';
  if (label.includes('没有现成信息')) return 'results.unableToProvide.needCreation';
  if (label.includes('补正后申请内容仍不明确')) return 'results.unableToProvide.unclear';
  if (label.includes('信访举报投诉')) return 'results.notProcessed.complaint';
  if (label.includes('重复申请')) return 'results.notProcessed.repeat';
  if (label.includes('公开出版物')) return 'results.notProcessed.publication';
  if (label.includes('大量反复申请')) return 'results.notProcessed.massiveRequests';
  if (label.includes('确认或重新出具')) return 'results.notProcessed.confirmInfo';
  if (label.includes('逾期不补正')) return 'results.other.overdueCorrection';
  if (label.includes('逾期未按收费通知')) return 'results.other.overdueFee';
  if (label.includes('其他处理') && label.includes('其他')) return 'results.other.otherReasons';
  if (/(^|[.（(])3[.)、．]?其他/.test(label) || label.endsWith('其他')) return 'results.other.otherReasons';
  return null;
}

function buildEmptyTable3Entity(): Record<string, any> {
  return {
    newReceived: null,
    carriedOver: null,
    results: {
      granted: null,
      partialGrant: null,
      denied: {
        stateSecret: null,
        lawForbidden: null,
        safetyStability: null,
        thirdPartyRights: null,
        internalAffairs: null,
        processInfo: null,
        enforcementCase: null,
        adminQuery: null,
      },
      unableToProvide: {
        noInfo: null,
        needCreation: null,
        unclear: null,
      },
      notProcessed: {
        complaint: null,
        repeat: null,
        publication: null,
        massiveRequests: null,
        confirmInfo: null,
      },
      other: {
        overdueCorrection: null,
        overdueFee: null,
        otherReasons: null,
      },
      totalProcessed: null,
      carriedForward: null,
    },
  };
}

function setNestedValue(target: Record<string, any>, keys: string[], value: unknown): void {
  let current: Record<string, any> = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index];
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = value;
}

function normalizeUnreadableCells(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || '').trim()).filter(Boolean);
}

function hasTableTriggerFailure(items: ConsistencyItem[], tableId: VisionReviewTableId): boolean {
  const groupKey = tableId.replace('_', '') as 'table2' | 'table3' | 'table4';
  return items.some((item) => item.groupKey === groupKey && ['FAIL', 'UNCERTAIN'].includes(item.autoStatus));
}

function collectTriggerPaths(tableId: VisionReviewTableId, triggerItems: ConsistencyItem[]): string[] {
  const groupKey = tableId.replace('_', '');
  const paths: string[] = [];
  for (const item of triggerItems) {
    if (item.groupKey !== groupKey || !['FAIL', 'UNCERTAIN'].includes(item.autoStatus)) {
      continue;
    }

    const evidence = safeJson(item.evidenceJson) || {};
    const pathGroups = [evidence.leftPaths, evidence.rightPaths, evidence.paths];
    for (const group of pathGroups) {
      if (!Array.isArray(group)) continue;
      for (const rawPath of group) {
        const normalized = normalizeReviewPath(tableId, rawPath);
        if (normalized) paths.push(normalized);
      }
    }
  }
  return uniqueStrings(paths);
}

const TABLE3_COLUMN_LABELS: Record<string, string> = {
  naturalPerson: '自然人',
  'legalPerson.commercial': '商业企业',
  'legalPerson.research': '科研机构',
  'legalPerson.social': '社会公益组织',
  'legalPerson.legal': '法律服务机构',
  'legalPerson.other': '其他组织',
  total: '总计',
};

const TABLE3_COLUMN_KEYWORDS: Record<string, string[][]> = {
  naturalPerson: [['自然人']],
  'legalPerson.commercial': [['商业企业']],
  'legalPerson.research': [['科研机构']],
  'legalPerson.social': [['社会公益组织'], ['社会公益']],
  'legalPerson.legal': [['法律服务机构'], ['法律服务']],
  'legalPerson.other': [['其他组织'], ['其他']],
  total: [['总计']],
};

const TABLE3_ROW_LABELS: Record<string, string> = {
  newReceived: '本年新收',
  carriedOver: '上年结转',
  'results.granted': '予以公开',
  'results.partialGrant': '部分公开',
  'results.denied.stateSecret': '属于国家秘密',
  'results.denied.lawForbidden': '法律行政法规禁止公开',
  'results.denied.safetyStability': '危及安全稳定',
  'results.denied.thirdPartyRights': '保护第三方合法权益',
  'results.denied.internalAffairs': '内部事务信息',
  'results.denied.processInfo': '过程性信息',
  'results.denied.enforcementCase': '行政执法案卷',
  'results.denied.adminQuery': '行政查询事项',
  'results.unableToProvide.noInfo': '本机关不掌握相关政府信息',
  'results.unableToProvide.needCreation': '没有现成信息需要另行制作',
  'results.unableToProvide.unclear': '补正后申请内容仍不明确',
  'results.notProcessed.complaint': '信访举报投诉类申请',
  'results.notProcessed.repeat': '重复申请',
  'results.notProcessed.publication': '公开出版物',
  'results.notProcessed.massiveRequests': '大量反复申请',
  'results.notProcessed.confirmInfo': '确认或重新出具',
  'results.other.overdueCorrection': '逾期不补正',
  'results.other.overdueFee': '逾期未缴纳费用',
  'results.other.otherReasons': '其他处理',
  'results.totalProcessed': '办理结果总计',
  'results.carriedForward': '结转下年度',
};

const TABLE4_COLUMN_LABELS: Record<string, string> = {
  maintain: '结果维持',
  correct: '结果纠正',
  other: '其他结果',
  unfinished: '尚未审结',
  total: '总计',
};

const TABLE4_ROW_LABELS: Record<string, string> = {
  review: '行政复议',
  litigationDirect: '未经复议直接起诉',
  litigationPostReview: '复议后起诉',
};

function splitTable3Path(relativePath: string): { entityPath: string; fieldPath: string } | null {
  const parts = relativePath.split('.');
  if (parts[0] === 'naturalPerson' || parts[0] === 'total') {
    return { entityPath: parts[0], fieldPath: parts.slice(1).join('.') };
  }
  if (parts[0] === 'legalPerson' && parts[1]) {
    return { entityPath: `${parts[0]}.${parts[1]}`, fieldPath: parts.slice(2).join('.') };
  }
  return null;
}

function splitTable4Path(relativePath: string): { rowPath: string; columnPath: string } | null {
  const parts = relativePath.split('.');
  if (parts.length !== 2) return null;
  return { rowPath: parts[0], columnPath: parts[1] };
}

function buildTable3Descriptor(fullPath: string, relativePath: string): VisionReviewCellDescriptor | null {
  const split = splitTable3Path(relativePath);
  if (!split) return null;
  const rowLabel = TABLE3_ROW_LABELS[split.fieldPath];
  const columnLabel = TABLE3_COLUMN_LABELS[split.entityPath];
  if (!rowLabel || !columnLabel) return null;

  const rowKeywordGroups =
    split.fieldPath === 'results.totalProcessed'
      ? [['（七）', '总计'], ['(七)', '总计'], ['七', '总计']]
      : split.fieldPath === 'results.carriedForward'
        ? [['结转下年度'], ['结转', '下年度'], ['继续办理']]
        : split.fieldPath === 'carriedOver'
          ? [['上年结转'], ['上年', '结转']]
          : [[rowLabel]];
  const columnKeywordGroups = TABLE3_COLUMN_KEYWORDS[split.entityPath] || [[columnLabel]];

  return {
    path: fullPath,
    relativePath,
    rowKeywordGroups,
    columnKeywordGroups,
    label: `${columnLabel}列的${rowLabel}`,
    rowLabel,
    columnLabel,
  };
}

function buildTable4Descriptor(fullPath: string, relativePath: string): VisionReviewCellDescriptor | null {
  const split = splitTable4Path(relativePath);
  if (!split) return null;
  const rowLabel = TABLE4_ROW_LABELS[split.rowPath];
  const columnLabel = TABLE4_COLUMN_LABELS[split.columnPath];
  if (!rowLabel || !columnLabel) return null;
  return {
    path: fullPath,
    relativePath,
    rowKeywordGroups: [[rowLabel]],
    columnKeywordGroups: [[columnLabel]],
    label: `${rowLabel}的${columnLabel}`,
    rowLabel,
    columnLabel,
  };
}

function buildFocusDescriptor(tableId: VisionReviewTableId, fullPath: string, relativePath: string): VisionReviewCellDescriptor | null {
  if (tableId === 'table_3') return buildTable3Descriptor(fullPath, relativePath);
  if (tableId === 'table_4') return buildTable4Descriptor(fullPath, relativePath);
  return null;
}

export function buildVisionReviewFocus(
  tableId: VisionReviewTableId,
  triggerItems: ConsistencyItem[] = []
): VisionReviewFocus | null {
  const paths = collectTriggerPaths(tableId, triggerItems);
  if (!paths.length) return null;

  const relativePaths = uniqueStrings(paths.map((item) => toRelativeReviewPath(tableId, item)));
  const checkKeys = uniqueStrings(
    triggerItems
      .filter((item) => item.groupKey === tableId.replace('_', '') && ['FAIL', 'UNCERTAIN'].includes(item.autoStatus))
      .map((item) => item.checkKey)
  );
  const descriptors = relativePaths
    .map((relativePath) => buildFocusDescriptor(tableId, `${TABLE_PAYLOAD_KEY[tableId]}.${relativePath}`, relativePath))
    .filter((item): item is VisionReviewCellDescriptor => Boolean(item));
  const descriptorByPath = new Map(descriptors.map((item) => [item.path, item]));
  const promptHints = paths.map((item) => descriptorByPath.get(item)?.label ? `${item}（${descriptorByPath.get(item)?.label}）` : item);

  return {
    paths,
    relativePaths,
    checkKeys,
    descriptors,
    promptHints,
  };
}

export function compareVisionOcrWithParsed(
  tableId: VisionReviewTableId,
  parsedJson: unknown,
  ocrJson: Record<string, any>,
  triggerItems: ConsistencyItem[] = [],
  focusPaths?: string[]
): VisionReviewComparison {
  const parsedPayload = getParsedTablePayload(parsedJson, tableId);
  const ocrPayload = getOcrTablePayload(ocrJson, tableId);
  const unreadableCells = normalizeUnreadableCells(ocrJson?.unreadableCells);
  const triggerHadCheckFailure = hasTableTriggerFailure(triggerItems, tableId);

  if (!parsedPayload || !ocrPayload) {
    return {
      conclusion: 'inconclusive',
      differences: [],
      unreadableCells,
      comparedCellCount: 0,
      triggerHadCheckFailure,
      parsedSource: 'parsed_json',
    };
  }

  const parsedFlat = flattenLeafValues(parsedPayload);
  const ocrFlat = flattenLeafValues(ocrPayload);
  const focusedRelativePaths = uniqueStrings((focusPaths || []).map((item) => toRelativeReviewPath(tableId, item)));
  const allPaths = (focusedRelativePaths.length
    ? focusedRelativePaths
    : Array.from(new Set([...Object.keys(parsedFlat), ...Object.keys(ocrFlat)]))
  ).sort();
  const differences: VisionReviewComparison['differences'] = [];
  const missingOcrCells: string[] = [];
  let comparedCellCount = 0;

  for (const relativePath of allPaths) {
    const parsedValue = parsedFlat[relativePath] ?? null;
    const ocrValue = ocrFlat[relativePath] ?? null;
    if (parsedValue === null && ocrValue === null) {
      continue;
    }
    if (parsedValue !== null && ocrValue === null) {
      missingOcrCells.push(`${TABLE_PAYLOAD_KEY[tableId]}.${relativePath}`);
      continue;
    }
    comparedCellCount += 1;
    if (parsedValue !== ocrValue) {
      differences.push({
        path: `${TABLE_PAYLOAD_KEY[tableId]}.${relativePath}`,
        parsedValue,
        ocrValue,
      });
    }
  }

  const combinedUnreadableCells = uniqueStrings([...unreadableCells, ...missingOcrCells]);
  if (comparedCellCount === 0) {
    return {
      conclusion: 'inconclusive',
      differences: [],
      unreadableCells: combinedUnreadableCells,
      comparedCellCount,
      triggerHadCheckFailure,
      parsedSource: 'parsed_json',
    };
  }

  let conclusion: VisionReviewConclusion = 'source_table_matches_parse';
  if (differences.length > 0) {
      conclusion = 'parse_mapping_anomaly';
  } else if (combinedUnreadableCells.length > 0) {
    conclusion = 'inconclusive';
  } else if (triggerHadCheckFailure) {
    conclusion = 'source_table_anomaly';
  }

  return {
    conclusion,
    differences,
    unreadableCells: combinedUnreadableCells,
    comparedCellCount,
    triggerHadCheckFailure,
    parsedSource: 'parsed_json',
  };
}

export class VisionReviewService {
  async resolveConfig(): Promise<VisionReviewConfig> {
    const apiModeRaw = String(process.env.VISION_REVIEW_API_MODE || 'auto').trim().toLowerCase();
    const timeoutMs = Number(process.env.VISION_REVIEW_TIMEOUT_MS || 120000);
    const enabled = parseBooleanEnv(process.env.VISION_REVIEW_ENABLED, true);

    try {
      const runtime = await aiModelConfigService.resolveRuntime('vision_review');
      return {
        enabled,
        provider: runtime.provider || 'openai',
        model: runtime.model || 'gpt-5.5',
        apiMode:
          apiModeRaw === 'responses' || apiModeRaw === 'chat_completions' || apiModeRaw === 'mock'
            ? apiModeRaw
            : 'auto',
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
        baseUrl: runtime.baseUrl || undefined,
        apiKey: runtime.apiKey || undefined,
        source: runtime.source,
      };
    } catch (error) {
      console.warn('[VisionReview] resolveConfig from DB failed, fallback to env:', error);
      const provider = normalizeLlmProviderName(
        resolveFirstNonEmpty(process.env.VISION_REVIEW_PROVIDER, process.env.LLM_PROVIDER, 'openai'),
        'openai'
      );
      const model = resolveFirstNonEmpty(
        process.env.VISION_REVIEW_MODEL,
        process.env.OPENAI_MODEL,
        process.env.LLM_MODEL,
        'gpt-5.5'
      );
      return {
        enabled,
        provider,
        model,
        apiMode:
          apiModeRaw === 'responses' || apiModeRaw === 'chat_completions' || apiModeRaw === 'mock'
            ? apiModeRaw
            : 'auto',
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 120000,
        source: 'env',
      };
    }
  }

  normalizeTableIds(input: unknown): VisionReviewTableId[] {
    const values = Array.isArray(input) ? input : input ? [input] : TABLE_IDS;
    const normalized = values.map(normalizeTableId).filter((item): item is VisionReviewTableId => !!item);
    return Array.from(new Set(normalized.length ? normalized : TABLE_IDS));
  }

  async enqueueForConsistencyItems(
    reportId: number,
    versionId: number,
    items: ConsistencyItem[],
    forceRerun = false
  ): Promise<number> {
    const config = await this.resolveConfig();
    if (!config.enabled) return 0;

    const tableIds = TABLE_IDS.filter((tableId) => hasTableTriggerFailure(items, tableId));
    if (tableIds.length === 0) return 0;
    return this.enqueueReviewRows(reportId, versionId, tableIds, this.buildTriggerReason(items), forceRerun);
  }

  async enqueueReviewRows(
    reportId: number,
    versionId: number,
    tableIds: VisionReviewTableId[],
    triggerReason: string,
    forceRerun: boolean
  ): Promise<number> {
    const config = await this.resolveConfig();
    if (!config.enabled) return 0;

    const version = await this.loadReportVersion(reportId, versionId);
    if (!version) {
      throw new Error('version_not_found');
    }

    let createdOrUpdated = 0;
    for (const tableId of tableIds) {
      const row = await pool.query(
        `
        INSERT INTO table_visual_reviews (
          report_id,
          report_version_id,
          table_id,
          trigger_reason,
          provider,
          model,
          file_hash,
          api_mode,
          status,
          review_version,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, 'queued', $8, NOW(), NOW())
        ON CONFLICT (report_version_id, table_id, file_hash, provider, model)
        DO UPDATE SET
          trigger_reason = EXCLUDED.trigger_reason,
          status = CASE
            WHEN $9::boolean THEN 'queued'
            WHEN table_visual_reviews.status IN ('failed', 'source_unavailable', 'channel_unavailable') THEN 'queued'
            ELSE table_visual_reviews.status
          END,
          error_code = CASE WHEN $9::boolean THEN NULL ELSE table_visual_reviews.error_code END,
          error_message = CASE WHEN $9::boolean THEN NULL ELSE table_visual_reviews.error_message END,
          updated_at = NOW()
        RETURNING id, status
        `,
        [
          reportId,
          versionId,
          tableId,
          triggerReason || 'manual',
          config.provider,
          config.model,
          version.file_hash,
          VISION_REVIEW_VERSION,
          forceRerun,
        ]
      );
      if (row.rows[0]?.id) createdOrUpdated += 1;
    }

    const pendingJob = await pool.query(
      `SELECT id
       FROM jobs
       WHERE report_id = $1
         AND version_id = $2
         AND kind = 'vision_review'
         AND status IN ('queued', 'running')
       LIMIT 1`,
      [reportId, versionId]
    );
    if (!pendingJob.rows[0]?.id) {
      await pool.query(
        `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, provider, model, max_retries)
         VALUES ($1, $2, 'vision_review', 'queued', 0, 'VISION_REVIEW', '等待视觉复核', $3, $4, 0)`,
        [reportId, versionId, config.provider, config.model]
      );
    }

    return createdOrUpdated;
  }

  async runNow(reportId: number, versionId: number, tableIds: VisionReviewTableId[], forceRerun = true): Promise<any[]> {
    const config = await this.resolveConfig();
    await this.enqueueReviewRows(reportId, versionId, tableIds, 'manual', forceRerun);
    await pool.query(
      `UPDATE table_visual_reviews
       SET status = 'queued',
           error_code = NULL,
           error_message = NULL,
           updated_at = NOW()
       WHERE report_id = $1
         AND report_version_id = $2
         AND table_id = ANY($3::text[])
         AND provider = $4
         AND model = $5`,
      [reportId, versionId, tableIds, config.provider, config.model]
    );
    return this.processQueuedReviewsForVersion(versionId, config.provider, config.model, tableIds);
  }

  async processQueuedReviewsForVersion(
    versionId: number,
    provider?: string,
    model?: string,
    tableIds?: VisionReviewTableId[]
  ): Promise<any[]> {
    const config = await this.resolveConfig();
    const targetProvider = provider || config.provider;
    const targetModel = model || config.model;
    const pendingRes = await pool.query(
      `SELECT *
       FROM table_visual_reviews
       WHERE report_version_id = $1
         AND status IN ('queued', 'running')
         AND provider = $2
         AND model = $3
         AND ($4::text[] IS NULL OR table_id = ANY($4::text[]))
       ORDER BY table_id ASC, id ASC`,
      [versionId, targetProvider, targetModel, tableIds && tableIds.length ? tableIds : null]
    );

    const results: any[] = [];
    for (const review of pendingRes.rows) {
      results.push(await this.processReviewRow(review, config));
    }
    return results;
  }

  async listReviews(reportId: number, versionId: number): Promise<any[]> {
    const accessVersion = await this.loadReportVersion(reportId, versionId);
    if (!accessVersion) return [];

    const result = await pool.query(
      `SELECT *
       FROM table_visual_reviews
       WHERE report_id = $1
         AND report_version_id = $2
       ORDER BY table_id ASC, updated_at DESC, id DESC`,
      [reportId, versionId]
    );
    return result.rows.map((row) => this.serializeReviewRow(row));
  }

  async listCorrections(reportId: number, versionId: number): Promise<OcrCorrectionRow[]> {
    const result = await pool.query(
      `SELECT *
       FROM ocr_corrections
       WHERE report_id = $1
         AND report_version_id = $2
       ORDER BY
         CASE status WHEN 'pending' THEN 0 WHEN 'confirmed' THEN 1 ELSE 2 END,
         updated_at DESC,
         id DESC`,
      [reportId, versionId]
    );
    return result.rows.map((row) => this.serializeCorrectionRow(row));
  }

  private async processReviewRow(review: any, config: VisionReviewConfig): Promise<any> {
    const tableId = normalizeTableId(review.table_id);
    if (!tableId) {
      return review;
    }

    await pool.query(
      `UPDATE table_visual_reviews
       SET status = 'running', started_at = NOW(), updated_at = NOW(), error_code = NULL, error_message = NULL
       WHERE id = $1`,
      [review.id]
    );

    try {
      if (!config.enabled) {
        return await this.markReviewFailure(review.id, 'channel_unavailable', 'vision_review_disabled', '视觉复核未启用');
      }

      const version = await this.loadReportVersion(Number(review.report_id), Number(review.report_version_id));
      if (!version) {
        return await this.markReviewFailure(review.id, 'failed', 'version_not_found', '报告版本不存在');
      }

      const triggers = await this.loadTriggerItems(Number(review.report_version_id), tableId);
      const focus = buildVisionReviewFocus(tableId, triggers);
      const screenshot = await this.captureTableScreenshot(version, tableId, focus || undefined);
      if (!screenshot.ok || !screenshot.path) {
        return await this.markReviewFailure(
          review.id,
          'source_unavailable',
          screenshot.errorCode || 'source_capture_failed',
          screenshot.errorMessage || '无法从原始文件生成对应表格截图',
          screenshot
        );
      }

      let ocr: VisionOcrResult;
      try {
        ocr = await this.runOcr(config, tableId, screenshot.path, focus || undefined);
      } catch (error: any) {
        return await this.markReviewFailure(
          review.id,
          'channel_unavailable',
          error?.code || 'vision_channel_unavailable',
          error?.message || '识图通道不可用',
          { screenshotPath: screenshot.path, screenshotMode: screenshot.mode, focusPaths: focus?.paths || [] }
        );
      }

      const parsedResult = await parseRunService.getCurrentParsedResult(Number(review.report_version_id));
      const parsedJson = parsedResult?.parsedJson || version.parsed_json;
      const comparison = compareVisionOcrWithParsed(tableId, parsedJson, ocr.ocrJson, triggers, focus?.paths);
      const status: VisionReviewStatus = comparison.conclusion === 'inconclusive' ? 'completed' : 'completed';

      const updateRes = await pool.query(
        `UPDATE table_visual_reviews
         SET status = $2,
             api_mode = $3,
             screenshot_path = $4,
             screenshot_meta_json = $5,
             ocr_json = $6,
             comparison_json = $7,
             conclusion = $8,
             error_code = NULL,
             error_message = NULL,
             finished_at = NOW(),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          review.id,
          status,
          ocr.apiMode,
          screenshot.path,
          JSON.stringify({
            mode: screenshot.mode,
            focusPaths: focus?.paths || [],
            focusCheckKeys: focus?.checkKeys || [],
            ...(screenshot.metadata || {}),
          }),
          JSON.stringify(ocr.ocrJson),
          JSON.stringify(comparison),
          comparison.conclusion,
        ]
      );
      if (comparison.conclusion === 'parse_mapping_anomaly') {
        await this.upsertPendingCorrections(updateRes.rows[0], comparison);
      }
      return this.serializeReviewRow(updateRes.rows[0]);
    } catch (error: any) {
      return this.markReviewFailure(review.id, 'failed', error?.code || 'vision_review_failed', error?.message || String(error));
    }
  }

  private async loadReportVersion(reportId: number, versionId: number): Promise<ReportVersionRow | null> {
    const result = await pool.query(
      `SELECT id, report_id, file_hash, storage_path, parsed_json
       FROM report_versions
       WHERE report_id = $1 AND id = $2
       LIMIT 1`,
      [reportId, versionId]
    );
    return (result.rows[0] as ReportVersionRow | undefined) || null;
  }

  private async upsertPendingCorrections(review: any, comparison: VisionReviewComparison): Promise<void> {
    if (!review?.id || comparison.conclusion !== 'parse_mapping_anomaly') return;

    const paths = comparison.differences.map((item) => item.path);
    if (paths.length > 0) {
      await pool.query(
        `UPDATE ocr_corrections
         SET status = 'rejected',
             resolved_at = NOW(),
             updated_at = NOW()
         WHERE report_version_id = $1
           AND table_id = $2
           AND status = 'pending'
           AND NOT (field_path = ANY($3::text[]))`,
        [review.report_version_id, review.table_id, paths]
      );
    }

    for (const diff of comparison.differences) {
      await pool.query(
        `INSERT INTO ocr_corrections (
           report_id, report_version_id, review_id, table_id, field_path,
           parsed_value, ocr_value, status, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, 'pending', NOW(), NOW())
         ON CONFLICT (report_version_id, field_path) WHERE status = 'pending'
         DO UPDATE SET
           review_id = EXCLUDED.review_id,
           table_id = EXCLUDED.table_id,
           parsed_value = EXCLUDED.parsed_value,
           ocr_value = EXCLUDED.ocr_value,
           updated_at = NOW()`,
        [
          review.report_id,
          review.report_version_id,
          review.id,
          review.table_id,
          diff.path,
          normalizeJsonValueParam(diff.parsedValue),
          normalizeJsonValueParam(diff.ocrValue),
        ]
      );
    }
  }

  private buildTriggerReason(items: ConsistencyItem[]): string {
    const relevant = items
      .filter((item) => ['table2', 'table3', 'table4'].includes(item.groupKey) && ['FAIL', 'UNCERTAIN'].includes(item.autoStatus))
      .map((item) => `${item.groupKey}:${item.checkKey}:${item.autoStatus}`);
    return relevant.slice(0, 12).join('; ') || 'consistency_exception';
  }

  private async loadTriggerItems(versionId: number, tableId: VisionReviewTableId): Promise<ConsistencyItem[]> {
    const groupKey = tableId.replace('_', '');
    const result = await pool.query(
      `SELECT group_key, check_key, fingerprint, title, expr, left_value, right_value, delta, tolerance, auto_status, evidence_json
       FROM report_consistency_items
       WHERE report_version_id = $1
         AND group_key = $2
         AND ${HIERARCHY_COMPLETENESS_SQL_EXCLUSION}
         AND auto_status IN ('FAIL', 'UNCERTAIN')`,
      [versionId, groupKey]
    );

    return result.rows.map((row) => ({
      groupKey: row.group_key,
      checkKey: row.check_key,
      fingerprint: row.fingerprint,
      title: row.title,
      expr: row.expr,
      leftValue: row.left_value === null ? null : Number(row.left_value),
      rightValue: row.right_value === null ? null : Number(row.right_value),
      delta: row.delta === null ? null : Number(row.delta),
      tolerance: Number(row.tolerance || 0),
      autoStatus: row.auto_status,
      evidenceJson: safeJson(row.evidence_json) || { paths: [], values: {} },
    })) as ConsistencyItem[];
  }

  private async captureTableScreenshot(
    version: ReportVersionRow,
    tableId: VisionReviewTableId,
    focus?: VisionReviewFocus
  ): Promise<ScreenshotResult> {
    const absolutePath = path.isAbsolute(version.storage_path)
      ? version.storage_path
      : path.resolve(PROJECT_ROOT, version.storage_path);
    if (!fs.existsSync(absolutePath)) {
      return { ok: false, errorCode: 'source_file_missing', errorMessage: '原始文件不存在' };
    }

    const lowerPath = absolutePath.toLowerCase();
    if (lowerPath.endsWith('.html') || lowerPath.endsWith('.htm')) {
      return this.captureHtmlTableScreenshot(absolutePath, version, tableId, focus);
    }

    if (lowerPath.endsWith('.pdf')) {
      return this.capturePdfTableScreenshot(absolutePath, tableId, focus);
    }

    return { ok: false, errorCode: 'source_format_unsupported', errorMessage: '当前文件格式暂不支持视觉复核截图' };
  }

  private async captureHtmlTableScreenshot(
    absolutePath: string,
    version: ReportVersionRow,
    tableId: VisionReviewTableId,
    focus?: VisionReviewFocus
  ): Promise<ScreenshotResult> {
    const outputPath = this.buildScreenshotPath(version, tableId, focus?.descriptors.length ? 'focus' : undefined);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1800, deviceScaleFactor: 2 });
      await page.goto(`file://${absolutePath.replace(/\\/g, '/')}`, { waitUntil: 'networkidle0', timeout: 45000 });

      const handle = await page.evaluateHandle((keywords: string[]) => {
        const doc = (globalThis as any).document;
        const tables = Array.from(doc.querySelectorAll('table')) as any[];
        const scoreTable = (table: any) => {
          const text = (table.innerText || table.textContent || '').replace(/\s+/g, ' ');
          let score = 0;
          for (const keyword of keywords) {
            if (text.includes(keyword)) score += 1;
          }
          const numericCount = (text.match(/\d+/g) || []).length;
          if (numericCount >= 3) score += 1;
          return { table, score, textLength: text.length };
        };
        const ranked = tables.map(scoreTable).sort((a, b) => b.score - a.score || b.textLength - a.textLength);
        return ranked[0]?.score >= 2 ? ranked[0].table : null;
      }, TABLE_KEYWORDS[tableId]);

      const element = handle.asElement();
      if (!element) {
        return { ok: false, errorCode: 'table_not_located', errorMessage: `${TABLE_LABELS[tableId]}未能在 HTML 中可靠定位` };
      }

      if (focus?.descriptors.length) {
        const crop = await this.computeHtmlFocusedCrop(page, element, focus.descriptors);
        if (crop) {
          await page.screenshot({ path: outputPath, clip: crop.clip });
          return {
            ok: true,
            path: outputPath,
            mode: 'html_table_focused_cells',
            metadata: {
              sourcePath: absolutePath,
              focusPaths: focus.paths,
              focusCheckKeys: focus.checkKeys,
              focusedCellCount: crop.cellCount,
              focusedRows: crop.rowIndexes,
              focusedColumns: crop.columnIndexes,
            },
          };
        }

        return {
          ok: false,
          errorCode: 'focused_cells_not_located',
          errorMessage: `${TABLE_LABELS[tableId]}未能可靠定位异常相关行列，已停止整表外发`,
          metadata: {
            sourcePath: absolutePath,
            focusPaths: focus.paths,
            focusCheckKeys: focus.checkKeys,
            focusFallbackBlocked: true,
          },
        };
      }

      await element.screenshot({ path: outputPath });
      return {
        ok: true,
        path: outputPath,
        mode: focus?.descriptors.length ? 'html_table_element_focus_fallback' : 'html_table_element',
        metadata: {
          sourcePath: absolutePath,
          focusPaths: focus?.paths || [],
          focusCheckKeys: focus?.checkKeys || [],
          focusFallbackReason: focus?.descriptors.length ? 'focused_cells_not_located' : undefined,
        },
      };
    } catch (error: any) {
      return { ok: false, errorCode: 'html_capture_failed', errorMessage: error?.message || String(error) };
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  private async computeHtmlFocusedCrop(
    page: Page,
    element: ElementHandle,
    descriptors: VisionReviewCellDescriptor[]
  ): Promise<HtmlCropResult | null> {
    return page.evaluate((table: any, rawDescriptors: VisionReviewCellDescriptor[]) => {
      type BrowserCell = {
        element: any;
        text: string;
        rowIndex: number;
        colIndex: number;
        rowSpan: number;
        colSpan: number;
        rect: { x: number; y: number; width: number; height: number; right: number; bottom: number };
      };

      const normalize = (value: string) => String(value || '').replace(/\s+/g, '');
      const rectOf = (cell: any) => {
        const rect = cell.getBoundingClientRect();
        const win = (globalThis as any).window;
        return {
          x: rect.left + win.scrollX,
          y: rect.top + win.scrollY,
          width: rect.width,
          height: rect.height,
          right: rect.right + win.scrollX,
          bottom: rect.bottom + win.scrollY,
        };
      };
      const matchesGroups = (text: string, groups: string[][]) => {
        const normalizedText = normalize(text);
        return groups.some((group) => group.every((keyword) => normalizedText.includes(normalize(keyword))));
      };
      const isExactHeaderMatch = (text: string, groups: string[][]) => {
        const normalizedText = normalize(text);
        return groups.some((group) => {
          const joined = normalize(group.join(''));
          return normalizedText === joined || group.some((keyword) => normalizedText === normalize(keyword));
        });
      };
      const isMostlyNumeric = (text: string) => /^[-/,.\d]+$/.test(normalize(text));
      const unionRects = (rects: BrowserCell[]) => {
        const minX = Math.min(...rects.map((item) => item.rect.x));
        const minY = Math.min(...rects.map((item) => item.rect.y));
        const maxX = Math.max(...rects.map((item) => item.rect.right));
        const maxY = Math.max(...rects.map((item) => item.rect.bottom));
        const padding = 18;
        const docRef = (globalThis as any).document;
        const doc = docRef.documentElement;
        const pageWidth = Math.max(doc.scrollWidth, docRef.body?.scrollWidth || 0);
        const pageHeight = Math.max(doc.scrollHeight, docRef.body?.scrollHeight || 0);
        const x = Math.max(0, minX - padding);
        const y = Math.max(0, minY - padding);
        return {
          x,
          y,
          width: Math.min(pageWidth - x, maxX - minX + padding * 2),
          height: Math.min(pageHeight - y, maxY - minY + padding * 2),
        };
      };

      const rows = Array.from(table.querySelectorAll('tr')) as any[];
      const grid: Array<Array<BrowserCell | undefined>> = [];
      const cells: BrowserCell[] = [];

      rows.forEach((row, rowIndex) => {
        grid[rowIndex] ||= [];
        let colIndex = 0;
        for (const rawCell of Array.from(row.children)) {
          const cell = rawCell as any;
          if (!['TD', 'TH'].includes(cell.tagName)) continue;
          while (grid[rowIndex][colIndex]) colIndex += 1;
          const rowSpan = Math.max(1, Number(cell.getAttribute('rowspan') || 1));
          const colSpan = Math.max(1, Number(cell.getAttribute('colspan') || 1));
          const browserCell: BrowserCell = {
            element: cell,
            text: normalize(cell.innerText || cell.textContent || ''),
            rowIndex,
            colIndex,
            rowSpan,
            colSpan,
            rect: rectOf(cell),
          };
          cells.push(browserCell);
          for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
            grid[rowIndex + rowOffset] ||= [];
            for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
              grid[rowIndex + rowOffset][colIndex + colOffset] = browserCell;
            }
          }
          colIndex += colSpan;
        }
      });

      const selected = new Map<any, BrowserCell>();
      const selectedRows = new Set<number>();
      const selectedColumns = new Set<number>();
      const selectedHeaderRows = new Set<number>();
      const labelByRow = new Map<number, string>();
      const labelByColumn = new Map<number, string>();
      let matchedTargetCells = 0;

      for (const descriptor of rawDescriptors) {
        const rowIndexes = rows
          .map((row: any, index) => ({ index, text: normalize(row.innerText || row.textContent || '') }))
          .filter((row) => matchesGroups(row.text, descriptor.rowKeywordGroups) && /\d/.test(row.text))
          .map((row) => row.index);
        if (!rowIndexes.length) continue;

        const firstDataRow = Math.min(...rowIndexes);
        const headerCells = cells.filter((cell) => cell.rowIndex < firstDataRow);
        const headerMatches = headerCells.filter((cell) => matchesGroups(cell.text, descriptor.columnKeywordGroups));
        const exactHeaderMatches = headerMatches.filter((cell) => isExactHeaderMatch(cell.text, descriptor.columnKeywordGroups));
        const bestExactColSpan = exactHeaderMatches.length ? Math.min(...exactHeaderMatches.map((cell) => cell.colSpan)) : 0;
        const narrowExactHeaderMatches = exactHeaderMatches.filter((cell) => cell.colSpan === bestExactColSpan);
        const bestExactRow = narrowExactHeaderMatches.length ? Math.max(...narrowExactHeaderMatches.map((cell) => cell.rowIndex)) : 0;
        const exactLeafHeaderMatches = narrowExactHeaderMatches.filter((cell) => cell.rowIndex === bestExactRow);
        const leafHeaderMatches = headerMatches.filter((candidate) =>
          !headerCells.some((other) =>
            other !== candidate &&
            other.rowIndex > candidate.rowIndex &&
            other.colIndex >= candidate.colIndex &&
            other.colIndex < candidate.colIndex + candidate.colSpan
          )
        );
        const usableHeaderMatches = exactLeafHeaderMatches.length ? exactLeafHeaderMatches : leafHeaderMatches.length ? leafHeaderMatches : headerMatches;
        for (const header of usableHeaderMatches) {
          selectedHeaderRows.add(header.rowIndex);
        }
        const columnIndexes = new Set<number>();
        for (const header of usableHeaderMatches) {
          for (let index = header.colIndex; index < header.colIndex + header.colSpan; index += 1) {
            columnIndexes.add(index);
            labelByColumn.set(index, descriptor.columnLabel);
          }
        }
        if (!columnIndexes.size) continue;

        for (const rowIndex of rowIndexes) {
          const rowSlots = grid[rowIndex] || [];
          const effectiveColumns = Array.from(columnIndexes);
          if (!effectiveColumns.length) continue;
          for (const columnIndex of effectiveColumns) {
            const target = rowSlots[columnIndex];
            if (!target) continue;
            selected.set(target.element, target);
            selectedRows.add(rowIndex);
            selectedColumns.add(columnIndex);
            labelByRow.set(rowIndex, descriptor.rowLabel);
            matchedTargetCells += 1;

            for (const rowCell of new Set(rowSlots.filter(Boolean) as BrowserCell[])) {
              if (
                (rowCell.colIndex < columnIndex && !isMostlyNumeric(rowCell.text)) ||
                matchesGroups(rowCell.text, descriptor.rowKeywordGroups)
              ) {
                selected.set(rowCell.element, rowCell);
              }
            }
            for (const header of usableHeaderMatches) {
              selected.set(header.element, header);
            }
          }
        }
      }

      if (!matchedTargetCells || !selected.size) return null;
      const visibleRows = new Set<number>([...Array.from(selectedHeaderRows), ...Array.from(selectedRows)]);
      const selectedColumnList = Array.from(selectedColumns).sort((a, b) => a - b);
      const docRef = (globalThis as any).document;
      const wrapper = docRef.createElement('div');
      wrapper.setAttribute('data-vision-review-crop', 'true');
      wrapper.style.position = 'fixed';
      wrapper.style.left = '0';
      wrapper.style.top = '0';
      wrapper.style.background = 'white';
      wrapper.style.padding = '16px';
      wrapper.style.zIndex = '2147483647';
      wrapper.style.boxShadow = '0 0 0 99999px #fff';
      const cropTable = docRef.createElement('table');
      cropTable.style.borderCollapse = 'collapse';
      cropTable.style.fontSize = '16px';
      cropTable.style.lineHeight = '1.4';

      const appendCell = (targetRow: any, text: string, tagName = 'td') => {
        const cell = docRef.createElement(tagName);
        cell.textContent = text;
        cell.style.border = '1px solid #222';
        cell.style.padding = '8px 12px';
        cell.style.minWidth = tagName === 'th' ? '96px' : '72px';
        cell.style.background = tagName === 'th' ? '#f7f7f7' : 'white';
        targetRow.appendChild(cell);
      };

      const headerRow = docRef.createElement('tr');
      appendCell(headerRow, '字段', 'th');
      for (const columnIndex of selectedColumnList) {
        appendCell(headerRow, labelByColumn.get(columnIndex) || `列${columnIndex + 1}`, 'th');
      }
      cropTable.appendChild(headerRow);

      for (const rowIndex of Array.from(selectedRows).sort((a, b) => a - b)) {
        const rowSlots = grid[rowIndex] || [];
        const dataRow = docRef.createElement('tr');
        appendCell(dataRow, labelByRow.get(rowIndex) || `行${rowIndex + 1}`, 'th');
        for (const columnIndex of selectedColumnList) {
          const target = rowSlots[columnIndex];
          appendCell(dataRow, target?.element?.innerText || target?.text || '');
        }
        cropTable.appendChild(dataRow);
      }

      wrapper.appendChild(cropTable);
      docRef.body.prepend(wrapper);
      const selectedCells = [{
        element: wrapper,
        text: '',
        rowIndex: 0,
        colIndex: 0,
        rowSpan: 1,
        colSpan: 1,
        rect: rectOf(wrapper),
      }];
      return {
        clip: unionRects(selectedCells),
        cellCount: matchedTargetCells,
        rowIndexes: Array.from(selectedRows).sort((a, b) => a - b),
        columnIndexes: Array.from(selectedColumns).sort((a, b) => a - b),
      };
    }, element, descriptors);
  }

  private async capturePdfTableScreenshot(
    absolutePath: string,
    tableId: VisionReviewTableId,
    focus?: VisionReviewFocus
  ): Promise<ScreenshotResult> {
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
      const locatedPage = await this.locatePdfTablePage(absolutePath, tableId, focus);
      if (!locatedPage) {
        return {
          ok: false,
          errorCode: 'pdf_table_not_located',
          errorMessage: `${TABLE_LABELS[tableId]}未能在 PDF 文本层中可靠定位`,
          metadata: { sourcePath: absolutePath, focusPaths: focus?.paths || [] },
        };
      }

      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      await page.setViewport({ width: 1600, height: 2200, deviceScaleFactor: 2 });
      const fileUrl = `${pathToFileURL(absolutePath).href}#page=${locatedPage.pageNumber}&zoom=page-fit`;
      await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 45000 });
      await new Promise((resolve) => setTimeout(resolve, 1800));

      const viewerState = await page.evaluate(() => {
        const doc = (globalThis as any).document;
        const text = doc?.body?.innerText || '';
        const pageInput = doc?.querySelector?.('input[type="number"], #pageNumber, .pageNumber') as any;
        const pageNumberValue = pageInput?.value || pageInput?.textContent || '';
        return { text, pageNumberValue: String(pageNumberValue || '') };
      });
      const visibleText = String(viewerState?.text || '');
      const hasVisibleKeyword = TABLE_KEYWORDS[tableId].some((keyword) => visibleText.includes(keyword));
      const visiblePageNumber = Number(String(viewerState?.pageNumberValue || '').replace(/\D+/g, ''));
      if (visibleText && !hasVisibleKeyword && visiblePageNumber && visiblePageNumber !== locatedPage.pageNumber) {
        return {
          ok: false,
          errorCode: 'pdf_viewer_page_mismatch',
          errorMessage: `${TABLE_LABELS[tableId]}PDF 预览页未跳转到定位页`,
          metadata: {
            sourcePath: absolutePath,
            expectedPage: locatedPage.pageNumber,
            visiblePageNumber,
            focusPaths: focus?.paths || [],
          },
        };
      }

      const outputPath = path.join(
        DATA_DIR,
        'vision-review',
        'screenshots',
        `${crypto.createHash('sha1').update(`${absolutePath}:${tableId}:${Date.now()}`).digest('hex')}.png`
      );
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      await page.screenshot({ path: outputPath, fullPage: false });
      return {
        ok: true,
        path: outputPath,
        mode: 'pdf_page_text_anchor_viewport',
        metadata: {
          sourcePath: absolutePath,
          locatedPage: locatedPage.pageNumber,
          pageScore: locatedPage.score,
          pageKeywordHits: locatedPage.keywordHits,
          focusPaths: focus?.paths || [],
          focusCheckKeys: focus?.checkKeys || [],
          note: 'PDF 先按文本层定位表格页，再截取该页视口；OCR 提示词只要求识别触发异常相关字段。',
        },
      };
    } catch (error: any) {
      return {
        ok: false,
        errorCode: 'pdf_capture_unavailable',
        errorMessage: `PDF 表格页截图暂不可用：${error?.message || String(error)}`,
      };
    } finally {
      if (browser) {
        await browser.close().catch(() => undefined);
      }
    }
  }

  private async locatePdfTablePage(
    absolutePath: string,
    tableId: VisionReviewTableId,
    focus?: VisionReviewFocus
  ): Promise<{ pageNumber: number; score: number; keywordHits: string[] } | null> {
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await fs.promises.readFile(absolutePath));
    const loadingTask = pdfjs.getDocument({
      data,
      disableWorker: true,
      disableFontFace: true,
      isEvalSupported: false,
    });
    const pdf = await loadingTask.promise;

    try {
      const candidates: Array<{ pageNumber: number; score: number; keywordHits: string[] }> = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const pdfPage = await pdf.getPage(pageNumber);
        const textContent = await pdfPage.getTextContent();
        const pageText = (textContent.items || [])
          .map((item: any) => (typeof item?.str === 'string' ? item.str : ''))
          .join('')
          .replace(/\s+/g, '');
        const keywordHits = TABLE_KEYWORDS[tableId].filter((keyword) => pageText.includes(keyword.replace(/\s+/g, '')));
        const focusHits = (focus?.descriptors || []).filter((descriptor) => {
          const rowHit = descriptor.rowKeywordGroups.some((group) =>
            group.every((keyword) => pageText.includes(keyword.replace(/\s+/g, '')))
          );
          const columnHit = descriptor.columnKeywordGroups.some((group) =>
            group.every((keyword) => pageText.includes(keyword.replace(/\s+/g, '')))
          );
          return rowHit || columnHit;
        }).length;
        const numericCount = (pageText.match(/\d+/g) || []).length;
        const score = keywordHits.length * 10 + focusHits * 3 + Math.min(numericCount, 20) / 10;
        if (score > 0) {
          candidates.push({ pageNumber, score, keywordHits });
        }
      }
      const best = candidates.sort((a, b) => b.score - a.score)[0];
      return best && best.score >= 12 ? best : null;
    } finally {
      await pdf.destroy?.();
    }
  }

  private buildScreenshotPath(version: ReportVersionRow, tableId: VisionReviewTableId, suffix?: string): string {
    return path.join(
      DATA_DIR,
      'vision-review',
      'screenshots',
      String(version.report_id),
      String(version.id),
      `${version.file_hash}-${tableId}${suffix ? `-${suffix}` : ''}.png`
    );
  }

  private async runOcr(
    config: VisionReviewConfig,
    tableId: VisionReviewTableId,
    imagePath: string,
    focus?: VisionReviewFocus
  ): Promise<VisionOcrResult> {
    if (config.apiMode === 'mock' || config.provider === 'mock' || config.provider === 'stub') {
      return {
        ocrJson: this.resolveMockOcr(tableId),
        apiMode: 'mock',
      };
    }

    if (config.provider !== 'openai') {
      const error = new Error(`视觉复核当前仅支持 OpenAI 兼容中转，当前 provider=${config.provider}`);
      (error as any).code = 'vision_provider_unsupported';
      throw error;
    }

    const attempts: VisionReviewApiMode[] =
      config.apiMode === 'auto'
        ? ['responses', 'chat_completions']
        : [config.apiMode];
    let lastError: unknown = null;

    for (const apiMode of attempts) {
      try {
        const ocrJson = apiMode === 'responses'
          ? await this.requestResponsesVision(config, tableId, imagePath, focus)
          : await this.requestChatVision(config, tableId, imagePath, focus);
        return { ocrJson, apiMode };
      } catch (error) {
        lastError = error;
      }
    }

    const error = lastError instanceof Error ? lastError : new Error(String(lastError || '识图通道不可用'));
    (error as any).code = (lastError as any)?.code || 'vision_channel_unavailable';
    throw error;
  }

  private resolveMockOcr(tableId: VisionReviewTableId): Record<string, any> {
    const raw = process.env.VISION_REVIEW_MOCK_RESPONSE_JSON;
    if (raw) {
      const parsed = parseStructuredJsonFromText<Record<string, any>>(raw);
      return { table_id: tableId, confidence: 1, unreadableCells: [], ...parsed };
    }
    return {
      table_id: tableId,
      confidence: 0,
      unreadableCells: ['mock_response_missing'],
      [TABLE_PAYLOAD_KEY[tableId]]: null,
      notes: 'VISION_REVIEW_MOCK_RESPONSE_JSON 未配置',
    };
  }

  private buildPrompt(tableId: VisionReviewTableId, focus?: VisionReviewFocus): string {
    const lines = [
      `请只复核图片中的${TABLE_LABELS[tableId]}。`,
      '返回严格 JSON，不要输出 Markdown。',
      '只提取表格单元格中的数字；空白、/、-、— 保持为 null 或原始占位符，不要臆测。',
      '如果单元格看不清，把对应路径写入 unreadableCells。',
      `JSON 顶层必须包含 table_id="${tableId}"、confidence、unreadableCells，以及 ${
        TABLE_PAYLOAD_KEY[tableId]
      }。`,
    ];

    if (focus?.paths.length) {
      lines.push('This is a focused review. Extract only the trigger-related fields below; do not fill unrelated cells.');
      lines.push(...focus.promptHints.slice(0, 80).map((item) => `- ${item}`));
      lines.push('Use the exact field paths above when possible. If a requested cell is not visible or unreadable, put that exact path in unreadableCells.');
    }

    return lines.join('\n');
  }

  private buildSystemInstruction(): string {
    return [
      'You are an OCR reviewer for Chinese government information disclosure annual report tables.',
      'Extract only the visible table numbers into the requested JSON schema.',
      'Never repair arithmetic and never infer a value that is not visible.',
      'Return only valid JSON.',
    ].join('\n');
  }

  private buildDataUrl(imagePath: string): string {
    const buffer = fs.readFileSync(imagePath);
    const base64 = buffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
    return `data:${mime};base64,${base64}`;
  }

  private resolveOpenAiBaseUrl(overrideBaseUrl?: string): string {
    const baseUrl = resolveFirstNonEmpty(
      overrideBaseUrl,
      process.env.VISION_REVIEW_BASE_URL,
      process.env.OPENAI_BASE_URL
    );
    if (!baseUrl) {
      const error = new Error('OPENAI_BASE_URL is required for vision review');
      (error as any).code = 'openai_missing_base_url';
      throw error;
    }
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    assertSecureOpenAiBaseUrl(normalizedBaseUrl);
    return normalizedBaseUrl;
  }

  private resolveOpenAiApiKey(overrideApiKey?: string): string {
    const apiKey = resolveFirstNonEmpty(
      overrideApiKey,
      process.env.VISION_REVIEW_API_KEY,
      process.env.OPENAI_API_KEY
    );
    if (!apiKey) {
      const error = new Error('OPENAI_API_KEY is required for vision review');
      (error as any).code = 'openai_missing_api_key';
      throw error;
    }
    return apiKey;
  }

  private async requestResponsesVision(
    config: VisionReviewConfig,
    tableId: VisionReviewTableId,
    imagePath: string,
    focus?: VisionReviewFocus
  ): Promise<Record<string, any>> {
    const response = await axios.post(
      `${this.resolveOpenAiBaseUrl(config.baseUrl)}/responses`,
      {
        model: config.model,
        input: [
          {
            role: 'system',
            content: this.buildSystemInstruction(),
          },
          {
            role: 'user',
            content: [
              { type: 'input_text', text: this.buildPrompt(tableId, focus) },
              { type: 'input_image', image_url: this.buildDataUrl(imagePath), detail: 'high' },
            ],
          },
        ],
        temperature: 0,
        max_output_tokens: 4096,
        store: false,
        text: {
          format: {
            type: 'json_schema',
            name: 'table_visual_review',
            schema: REVIEW_OUTPUT_SCHEMA,
            strict: false,
          },
        },
      },
      this.buildAxiosOptions(config)
    );

    return this.parseVisionResponse(response.data, 'responses');
  }

  private async requestChatVision(
    config: VisionReviewConfig,
    tableId: VisionReviewTableId,
    imagePath: string,
    focus?: VisionReviewFocus
  ): Promise<Record<string, any>> {
    const response = await axios.post(
      `${this.resolveOpenAiBaseUrl(config.baseUrl)}/chat/completions`,
      {
        model: config.model,
        messages: [
          { role: 'system', content: this.buildSystemInstruction() },
          {
            role: 'user',
            content: [
              { type: 'text', text: this.buildPrompt(tableId, focus) },
              {
                type: 'image_url',
                image_url: {
                  url: this.buildDataUrl(imagePath),
                  detail: 'high',
                },
              },
            ],
          },
        ],
        temperature: 0,
        max_tokens: 4096,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'table_visual_review',
            schema: REVIEW_OUTPUT_SCHEMA,
            strict: false,
          },
        },
      },
      this.buildAxiosOptions(config)
    );

    return this.parseVisionResponse(response.data, 'chat_completions');
  }

  private buildAxiosOptions(config: VisionReviewConfig) {
    return {
      headers: {
        Authorization: `Bearer ${this.resolveOpenAiApiKey(config.apiKey)}`,
        'Content-Type': 'application/json',
      },
      responseType: 'text' as const,
      timeout: config.timeoutMs,
      transformResponse: [(data: unknown) => data],
      validateStatus: (status: number) => status < 400,
    };
  }

  private parseVisionResponse(raw: unknown, apiMode: VisionReviewApiMode): Record<string, any> {
    const text = String(raw || '').trim();
    const parsedEnvelope = safeJson(text);
    let content = '';

    if (apiMode === 'responses') {
      content = String(parsedEnvelope?.output_text || '').trim();
      if (!content && Array.isArray(parsedEnvelope?.output)) {
        content = parsedEnvelope.output
          .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
          .map((item: any) => (item?.type === 'output_text' ? item.text : ''))
          .join('')
          .trim();
      }
    } else {
      const messageContent = parsedEnvelope?.choices?.[0]?.message?.content;
      content = Array.isArray(messageContent)
        ? messageContent.map((item: any) => (typeof item?.text === 'string' ? item.text : '')).join('').trim()
        : String(messageContent || '').trim();
    }

    if (!content && text.startsWith('{')) {
      content = text;
    }
    if (!content) {
      const error = new Error('视觉模型返回为空');
      (error as any).code = 'vision_empty_response';
      throw error;
    }

    const parsed = parseStructuredJsonFromText<Record<string, any>>(content);
    return {
      confidence: 0,
      unreadableCells: [],
      ...parsed,
    };
  }

  private async markReviewFailure(
    reviewId: number,
    status: VisionReviewStatus,
    errorCode: string,
    errorMessage: string,
    metadata?: unknown
  ): Promise<any> {
    const metadataJson = metadata && typeof metadata === 'object' ? metadata as Record<string, any> : {};
    const screenshotPath = typeof metadataJson.screenshotPath === 'string' ? metadataJson.screenshotPath : null;
    const screenshotMode = typeof metadataJson.screenshotMode === 'string' ? metadataJson.screenshotMode : null;
    const updateRes = await pool.query(
      `UPDATE table_visual_reviews
       SET status = $2,
           error_code = $3,
           error_message = $4,
           comparison_json = $5,
           screenshot_path = COALESCE($6, screenshot_path),
           screenshot_meta_json = CASE
             WHEN $7::jsonb IS NULL THEN screenshot_meta_json
             ELSE COALESCE(screenshot_meta_json, '{}'::jsonb) || $7::jsonb
           END,
           finished_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        reviewId,
        status,
        errorCode,
        errorMessage,
        JSON.stringify({
          conclusion: 'inconclusive',
          errorCode,
          errorMessage,
          metadata: metadata || null,
        }),
        screenshotPath,
        screenshotPath || screenshotMode
          ? JSON.stringify({ source: 'failure_metadata', sourcePath: screenshotPath, mode: screenshotMode })
          : null,
      ]
    );
    return this.serializeReviewRow(updateRes.rows[0]);
  }

  private serializeReviewRow(row: any): any {
    if (!row) return null;
    return {
      id: Number(row.id),
      reportId: Number(row.report_id),
      reportVersionId: Number(row.report_version_id),
      tableId: row.table_id,
      triggerReason: row.trigger_reason,
      provider: row.provider,
      model: row.model,
      fileHash: row.file_hash,
      apiMode: row.api_mode,
      status: row.status,
      conclusion: row.conclusion,
      screenshotPath: row.screenshot_path,
      screenshotMeta: safeJson(row.screenshot_meta_json),
      ocrJson: safeJson(row.ocr_json),
      comparison: safeJson(row.comparison_json),
      errorCode: row.error_code,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }

  private serializeCorrectionRow(row: any): OcrCorrectionRow {
    return {
      id: Number(row.id),
      reportId: Number(row.report_id),
      reportVersionId: Number(row.report_version_id),
      reviewId: Number(row.review_id),
      tableId: row.table_id,
      fieldPath: row.field_path,
      parsedValue: safeJson(row.parsed_value),
      ocrValue: safeJson(row.ocr_value),
      status: row.status,
      appliedAt: row.applied_at,
      resolvedAt: row.resolved_at,
      resolvedBy: row.resolved_by === null || row.resolved_by === undefined ? null : Number(row.resolved_by),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const visionReviewService = new VisionReviewService();
