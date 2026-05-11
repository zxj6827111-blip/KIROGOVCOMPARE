import pool from '../config/database-llm';

export type SourceValueSemantic = 'ZERO' | 'EMPTY' | 'NA' | 'TEXT' | 'NUMERIC';
export type SourceGateStatus = 'passed' | 'warning' | 'blocked' | 'not_assessable';

export interface SourceGateConfig {
  strategy: 'permissive' | 'standard' | 'conservative';
  uncertainThreshold: number;
  warningThreshold: number;
  highConfidenceBlocking: boolean;
}

export interface SourceGateIssue {
  path: string;
  expected: number | null;
  sourceValue: number | null;
  sourceRaw: string | null;
  semantic: SourceValueSemantic;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

export interface SourceGateResult {
  status: SourceGateStatus;
  passed: boolean;
  uncertainCount: number;
  warningCount: number;
  blockerCount: number;
  issues: SourceGateIssue[];
}

export interface SourceSnapshotDraft {
  source_type: string;
  source_path?: string | null;
  page_number?: number | null;
  table_index?: number | null;
  table_id: string;
  row_index?: number | null;
  col_index?: number | null;
  row_span?: number;
  col_span?: number;
  row_header?: string | null;
  col_header?: string | null;
  cell_text?: string | null;
  normalized_text?: string | null;
  bbox_json?: unknown;
  metadata_json?: unknown;
}

const DEFAULT_CONFIGS: Record<SourceGateConfig['strategy'], SourceGateConfig> = {
  permissive: {
    strategy: 'permissive',
    uncertainThreshold: 20,
    warningThreshold: 10,
    highConfidenceBlocking: false,
  },
  standard: {
    strategy: 'standard',
    uncertainThreshold: 10,
    warningThreshold: 5,
    highConfidenceBlocking: true,
  },
  conservative: {
    strategy: 'conservative',
    uncertainThreshold: 5,
    warningThreshold: 3,
    highConfidenceBlocking: true,
  },
};

const TABLE3_PATHS = [
  'newReceived',
  'carriedOver',
  'results.granted',
  'results.partialGrant',
  'results.denied.stateSecret',
  'results.denied.lawForbidden',
  'results.denied.safetyStability',
  'results.denied.thirdPartyRights',
  'results.denied.internalAffairs',
  'results.denied.processInfo',
  'results.denied.enforcementCase',
  'results.denied.adminQuery',
  'results.unableToProvide.noInfo',
  'results.unableToProvide.needCreation',
  'results.unableToProvide.unclear',
  'results.notProcessed.complaint',
  'results.notProcessed.repeat',
  'results.notProcessed.publication',
  'results.notProcessed.massiveRequests',
  'results.notProcessed.confirmInfo',
  'results.other.overdueCorrection',
  'results.other.overdueFee',
  'results.other.otherReasons',
  'results.totalProcessed',
  'results.carriedForward',
];

const TABLE3_PATH_LABELS: Record<string, string> = {
  newReceived: 'newReceived',
  carriedOver: 'carriedOver',
  'results.granted': 'results.granted',
  'results.partialGrant': 'results.partialGrant',
  'results.denied.stateSecret': 'results.denied.stateSecret',
  'results.denied.lawForbidden': 'results.denied.lawForbidden',
  'results.denied.safetyStability': 'results.denied.safetyStability',
  'results.denied.thirdPartyRights': 'results.denied.thirdPartyRights',
  'results.denied.internalAffairs': 'results.denied.internalAffairs',
  'results.denied.processInfo': 'results.denied.processInfo',
  'results.denied.enforcementCase': 'results.denied.enforcementCase',
  'results.denied.adminQuery': 'results.denied.adminQuery',
  'results.unableToProvide.noInfo': 'results.unableToProvide.noInfo',
  'results.unableToProvide.needCreation': 'results.unableToProvide.needCreation',
  'results.unableToProvide.unclear': 'results.unableToProvide.unclear',
  'results.notProcessed.complaint': 'results.notProcessed.complaint',
  'results.notProcessed.repeat': 'results.notProcessed.repeat',
  'results.notProcessed.publication': 'results.notProcessed.publication',
  'results.notProcessed.massiveRequests': 'results.notProcessed.massiveRequests',
  'results.notProcessed.confirmInfo': 'results.notProcessed.confirmInfo',
  'results.other.overdueCorrection': 'results.other.overdueCorrection',
  'results.other.overdueFee': 'results.other.overdueFee',
  'results.other.otherReasons': 'results.other.otherReasons',
  'results.totalProcessed': 'results.totalProcessed',
  'results.carriedForward': 'results.carriedForward',
};

const TABLE3_ENTITIES: Array<{ key: string; label: string; nodePath: string[] }> = [
  { key: 'naturalPerson', label: '自然人', nodePath: ['naturalPerson'] },
  { key: 'legalPerson.commercial', label: '商业企业', nodePath: ['legalPerson', 'commercial'] },
  { key: 'legalPerson.research', label: '科研机构', nodePath: ['legalPerson', 'research'] },
  { key: 'legalPerson.social', label: '社会公益组织', nodePath: ['legalPerson', 'social'] },
  { key: 'legalPerson.legal', label: '法律服务机构', nodePath: ['legalPerson', 'legal'] },
  { key: 'legalPerson.other', label: '其他', nodePath: ['legalPerson', 'other'] },
  { key: 'total', label: '总计', nodePath: ['total'] },
];

function normalizeSourceText(sourceText: string): string {
  return sourceText.replace(/\s+/g, ' ').trim();
}

export function parseSourceNumber(value: unknown): { value: number | null; semantic: SourceValueSemantic; raw: string | null } {
  if (value === null || value === undefined) {
    return { value: null, semantic: 'EMPTY', raw: null };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { value: null, semantic: 'TEXT', raw: String(value) };
    return { value, semantic: value === 0 ? 'ZERO' : 'NUMERIC', raw: String(value) };
  }

  const raw = String(value).trim();
  if (!raw) return { value: null, semantic: 'EMPTY', raw };
  if (/^(\/|-|--|—|无|不涉及|不适用|n\/a|na)$/i.test(raw)) {
    return { value: null, semantic: 'NA', raw };
  }

  const normalized = raw.replace(/[,，\s]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    const num = Number(normalized);
    return { value: num, semantic: num === 0 ? 'ZERO' : 'NUMERIC', raw };
  }

  return { value: null, semantic: 'TEXT', raw };
}

function readPath(source: any, path: string): unknown {
  let current = source;
  for (const key of path.split('.')) {
    current = current?.[key];
  }
  return current;
}

function readNode(source: any, path: string[]): any {
  let current = source;
  for (const key of path) {
    current = current?.[key];
  }
  return current;
}

function extractTable3(output: any): any {
  const sections = Array.isArray(output?.sections) ? output.sections : [];
  const section = sections.find((item: any) => item?.type === 'table_3');
  return section?.tableData ?? output?.tableData ?? null;
}

function findSourceRaw(sourceText: string, expected: number | null, entityLabel: string): { raw: string | null; confidence: 'high' | 'medium' | 'low' } {
  if (!sourceText.trim() || expected === null) return { raw: null, confidence: 'low' };
  const normalized = normalizeSourceText(sourceText);
  const entityIndex = normalized.indexOf(entityLabel);
  const expectedText = String(expected);
  if (entityIndex >= 0) {
    const windowText = normalized.slice(entityIndex, Math.min(normalized.length, entityIndex + 600));
    const match = windowText.match(new RegExp(`(^|[^0-9])(${expectedText})([^0-9]|$)`));
    if (match) return { raw: match[2], confidence: 'high' };
  }

  const globalMatch = normalized.match(new RegExp(`(^|[^0-9])(${expectedText})([^0-9]|$)`));
  if (globalMatch) return { raw: globalMatch[2], confidence: 'medium' };

  return { raw: null, confidence: 'low' };
}

function stringifyCellValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function sourceExcerpt(sourceText: string, sourceRaw: string | null): string | null {
  if (!sourceText.trim() || !sourceRaw) return null;
  const normalized = normalizeSourceText(sourceText);
  const index = normalized.indexOf(sourceRaw);
  if (index < 0) return null;
  const start = Math.max(0, index - 80);
  const end = Math.min(normalized.length, index + sourceRaw.length + 80);
  return normalized.slice(start, end);
}

export function buildSourceGateConfig(overrides?: Partial<SourceGateConfig>): SourceGateConfig {
  const strategy = overrides?.strategy ?? (process.env.SOURCE_GATE_STRATEGY as SourceGateConfig['strategy']) ?? 'standard';
  const base = DEFAULT_CONFIGS[strategy] ?? DEFAULT_CONFIGS.standard;
  return {
    ...base,
    ...overrides,
    strategy: base.strategy,
  };
}

export class SourceGateService {
  buildSourceSnapshots(
    output: any,
    sourceText: string,
    options: { sourcePath?: string | null; sourceType?: string } = {}
  ): SourceSnapshotDraft[] {
    const table3 = extractTable3(output);
    if (!table3 || typeof table3 !== 'object') {
      return [];
    }

    const snapshots: SourceSnapshotDraft[] = [];
    for (const [colIndex, entity] of TABLE3_ENTITIES.entries()) {
      const node = readNode(table3, entity.nodePath);
      if (!node || typeof node !== 'object') continue;

      for (const [rowIndex, fieldPath] of TABLE3_PATHS.entries()) {
        const rawValue = readPath(node, fieldPath);
        if (rawValue === undefined) continue;

        const parsed = parseSourceNumber(rawValue);
        const candidate = parsed.value === null
          ? { raw: parsed.raw, confidence: 'low' as const }
          : findSourceRaw(sourceText, parsed.value, entity.label);

        snapshots.push({
          source_type: options.sourceType ?? 'parsed_table3',
          source_path: options.sourcePath ?? null,
          table_index: 3,
          table_id: 'table_3',
          row_index: rowIndex,
          col_index: colIndex,
          row_span: 1,
          col_span: 1,
          row_header: TABLE3_PATH_LABELS[fieldPath] ?? fieldPath,
          col_header: entity.key,
          cell_text: stringifyCellValue(rawValue),
          normalized_text: parsed.value === null ? parsed.raw : String(parsed.value),
          metadata_json: {
            path: `table3.${entity.key}.${fieldPath}`,
            entityLabel: entity.label,
            semantic: parsed.semantic,
            sourceRaw: candidate.raw,
            sourceConfidence: candidate.confidence,
            sourceExcerpt: sourceExcerpt(sourceText, candidate.raw),
          },
        });
      }
    }

    return snapshots;
  }

  evaluate(output: any, sourceText: string, config: SourceGateConfig = buildSourceGateConfig()): SourceGateResult {
    const table3 = extractTable3(output);
    if (!table3 || typeof table3 !== 'object') {
      return {
        status: 'not_assessable',
        passed: true,
        uncertainCount: 0,
        warningCount: 0,
        blockerCount: 0,
        issues: [],
      };
    }

    const issues: SourceGateIssue[] = [];
    let uncertainCount = 0;
    let warningCount = 0;
    let blockerCount = 0;

    for (const entity of TABLE3_ENTITIES) {
      const node = readNode(table3, entity.nodePath);
      if (!node || typeof node !== 'object') continue;

      for (const path of TABLE3_PATHS) {
        const parsedValue = parseSourceNumber(readPath(node, path));
        if (parsedValue.semantic === 'EMPTY' || parsedValue.semantic === 'NA') continue;
        if (parsedValue.value === null) {
          uncertainCount += 1;
          issues.push({
            path: `table3.${entity.key}.${path}`,
            expected: null,
            sourceValue: null,
            sourceRaw: parsedValue.raw,
            semantic: parsedValue.semantic,
            confidence: 'low',
            reason: 'parsed_value_not_numeric',
          });
          continue;
        }

        const candidate = findSourceRaw(sourceText, parsedValue.value, entity.label);
        if (!candidate.raw) {
          uncertainCount += 1;
          issues.push({
            path: `table3.${entity.key}.${path}`,
            expected: parsedValue.value,
            sourceValue: null,
            sourceRaw: null,
            semantic: parsedValue.semantic,
            confidence: 'low',
            reason: 'source_value_not_found',
          });
          continue;
        }

        const sourceParsed = parseSourceNumber(candidate.raw);
        if (sourceParsed.value !== parsedValue.value) {
          const highConfidence = candidate.confidence === 'high';
          if (highConfidence && config.highConfidenceBlocking) {
            blockerCount += 1;
          } else {
            warningCount += 1;
          }
          issues.push({
            path: `table3.${entity.key}.${path}`,
            expected: parsedValue.value,
            sourceValue: sourceParsed.value,
            sourceRaw: candidate.raw,
            semantic: sourceParsed.semantic,
            confidence: candidate.confidence,
            reason: 'source_value_mismatch',
          });
        }
      }
    }

    let status: SourceGateStatus = 'passed';
    if (blockerCount > 0) status = 'blocked';
    else if (warningCount >= config.warningThreshold || uncertainCount >= config.uncertainThreshold) status = 'warning';

    if (config.strategy === 'permissive' && status === 'blocked') {
      status = 'warning';
    }

    return {
      status,
      passed: status !== 'blocked',
      uncertainCount,
      warningCount,
      blockerCount,
      issues,
    };
  }

  async persist(parseRunId: number, reportVersionId: number, result: SourceGateResult, config: SourceGateConfig): Promise<void> {
    await pool.query(
      `INSERT INTO source_gate_results (
         parse_run_id, report_version_id, gate_version, strategy,
         status, uncertain_count, warning_count, blocker_count, result_json
       )
       VALUES ($1, $2, 'v1', $3, $4, $5, $6, $7, $8)`,
      [
        parseRunId,
        reportVersionId,
        config.strategy,
        result.status,
        result.uncertainCount,
        result.warningCount,
        result.blockerCount,
        JSON.stringify(result),
      ]
    );
  }
}

export const sourceGateService = new SourceGateService();

export const __sourceGateInternals = {
  extractTable3,
  findSourceRaw,
  normalizeSourceText,
  stringifyCellValue,
};
