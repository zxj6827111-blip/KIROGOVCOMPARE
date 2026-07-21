import { createHash } from 'crypto';
import pool from '../config/database-llm';

export type ParseRunStatus =
  | 'created'
  | 'running'
  | 'accepted'
  | 'superseded'
  | 'failed'
  | 'gate_failed'
  | 'finalize_failed';

export type ParseFinalStatus = 'accepted' | 'failed' | 'gate_failed';

export interface GateConfigSnapshot {
  strategy: string;
  uncertainThreshold: number;
  highConfidenceBlocking: boolean;
  warningThreshold: number;
}

export interface ParseConfigSnapshot {
  provider: string;
  model: string;
  promptVersion: string;
  parserVersion: string;
  sourceExtractorVersion: string;
  schemaVersion: string;
  stabilizeMode: string;
  ruleGateEnabled: boolean;
  sourceGate: GateConfigSnapshot;
  promptRulesVersion: string;
}

export interface CreateParseRunInput {
  reportVersionId: number;
  jobId?: number | null;
  config: ParseConfigSnapshot;
  retryOf?: number | null;
  attempt?: number;
}

export interface CreatedParseRun {
  id: number;
  fingerprint: string;
}

export interface FinalizeParseRunInput {
  parseRunId: number;
  finalStatus: ParseFinalStatus;
  outputJson?: unknown;
  repairsJson?: unknown;
  gateResultJson?: unknown;
  consensusResultJson?: unknown;
  sourceSnapshotsJson?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
  enqueueFollowupJobs?: boolean;
}

export interface CurrentParsedResult {
  reportVersionId: number;
  reportId: number;
  parseRunId: number | null;
  parsedJson: unknown;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  source: 'parse_runs' | 'report_versions';
}

interface SourceSnapshotRow {
  source_type?: string;
  source_path?: string | null;
  page_number?: number | null;
  table_index?: number | null;
  table_id?: string | null;
  row_index?: number | null;
  col_index?: number | null;
  row_span?: number | null;
  col_span?: number | null;
  row_header?: string | null;
  col_header?: string | null;
  cell_text?: string | null;
  normalized_text?: string | null;
  bbox_json?: unknown;
  metadata_json?: unknown;
}

interface QueryResult<T = any> {
  rows: T[];
  rowCount?: number | null;
}

interface Queryable {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

interface DbClient extends Queryable {
  release(): void;
}

interface DbPool extends Queryable {
  connect(): Promise<DbClient>;
}

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function normalizeJsonParam(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function parseDbJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function buildParseFingerprint(config: ParseConfigSnapshot): string {
  return createHash('sha256').update(stableStringify(config)).digest('hex');
}

export function buildParseConfigSnapshot(input: Partial<ParseConfigSnapshot> & {
  provider: string;
  model: string;
}): ParseConfigSnapshot {
  return {
    provider: input.provider,
    model: input.model,
    promptVersion: input.promptVersion ?? process.env.LLM_PARSE_PROMPT_VERSION ?? 'v1',
    parserVersion: input.parserVersion ?? process.env.LLM_PARSER_VERSION ?? 'v1',
    sourceExtractorVersion: input.sourceExtractorVersion ?? process.env.LLM_SOURCE_EXTRACTOR_VERSION ?? 'v1',
    schemaVersion: input.schemaVersion ?? process.env.LLM_PARSE_SCHEMA_VERSION ?? 'v1',
    stabilizeMode: input.stabilizeMode ?? process.env.LLM_PARSE_STABILIZE_MODE ?? 'table3,table4',
    ruleGateEnabled: input.ruleGateEnabled ?? ['1', 'true', 'yes', 'on'].includes(String(process.env.LLM_PARSE_RULE_GATE_ENABLED || '').toLowerCase()),
    promptRulesVersion: input.promptRulesVersion ?? process.env.LLM_PROMPT_RULES_VERSION ?? 'v1',
    sourceGate: {
      strategy: input.sourceGate?.strategy ?? process.env.SOURCE_GATE_STRATEGY ?? 'standard',
      uncertainThreshold: input.sourceGate?.uncertainThreshold ?? Number(process.env.SOURCE_GATE_UNCERTAIN_THRESHOLD || 10),
      highConfidenceBlocking:
        input.sourceGate?.highConfidenceBlocking ??
        !['0', 'false', 'no', 'off'].includes(String(process.env.SOURCE_GATE_HIGH_CONFIDENCE_BLOCKING || 'true').toLowerCase()),
      warningThreshold: input.sourceGate?.warningThreshold ?? Number(process.env.SOURCE_GATE_WARNING_THRESHOLD || 5),
    },
  };
}

function inferErrorCode(finalStatus: ParseFinalStatus): string | null {
  if (finalStatus === 'accepted') return null;
  if (finalStatus === 'gate_failed') return 'PARSE_RULE_GATE_FAILED';
  return 'LLM_API_ERROR';
}

function inferErrorMessage(finalStatus: ParseFinalStatus, gateResultJson?: unknown): string | null {
  if (finalStatus === 'accepted') return null;
  if (finalStatus === 'gate_failed') {
    const gate = typeof gateResultJson === 'object' && gateResultJson !== null ? gateResultJson as Record<string, any> : {};
    const issues = Array.isArray(gate.issues) ? gate.issues.slice(0, 8).join('; ') : '';
    return issues ? `Parse gate failed: ${issues}` : 'Parse gate failed';
  }
  return 'Parse failed';
}

function toJobStatus(finalStatus: ParseFinalStatus): 'succeeded' | 'failed' {
  return finalStatus === 'accepted' ? 'succeeded' : 'failed';
}

function assertFinalStatus(status: string): asserts status is ParseFinalStatus {
  if (!['accepted', 'failed', 'gate_failed'].includes(status)) {
    throw new Error(`invalid_final_status:${status}`);
  }
}

export class ParseRunService {
  constructor(private readonly db: DbPool = pool as unknown as DbPool) {}

  async createParseRun(input: CreateParseRunInput): Promise<CreatedParseRun> {
    const config = input.config;
    const fingerprint = buildParseFingerprint(config);
    const result = await this.db.query<{ id: number }>(
      `INSERT INTO parse_runs (
         report_version_id, job_id, fingerprint,
         provider, model, prompt_version, parser_version, source_extractor_version, schema_version,
         stabilize_mode, rule_gate_enabled,
         source_gate_strategy, source_gate_uncertain_threshold,
         source_gate_high_confidence_blocking, source_gate_warning_threshold,
         config_json, status, is_current, retry_of, attempt
       )
       VALUES (
         $1, $2, $3,
         $4, $5, $6, $7, $8, $9,
         $10, $11,
         $12, $13, $14, $15,
         $16, 'created', FALSE, $17, $18
       )
       RETURNING id`,
      [
        input.reportVersionId,
        input.jobId ?? null,
        fingerprint,
        config.provider,
        config.model,
        config.promptVersion,
        config.parserVersion,
        config.sourceExtractorVersion,
        config.schemaVersion,
        config.stabilizeMode,
        config.ruleGateEnabled,
        config.sourceGate.strategy,
        config.sourceGate.uncertainThreshold,
        config.sourceGate.highConfidenceBlocking,
        config.sourceGate.warningThreshold,
        normalizeJsonParam(config),
        input.retryOf ?? null,
        input.attempt ?? 1,
      ]
    );

    return { id: Number(result.rows[0].id), fingerprint };
  }

  /**
   * If an accepted parse_run already exists for this version+fingerprint with usable output,
   * return it so the worker can skip a redundant LLM call.
   */
  async findReusableAcceptedParseRun(
    reportVersionId: number,
    fingerprint: string
  ): Promise<{ parseRunId: number; outputJson: unknown } | null> {
    const result = await this.db.query<{ id: number; output_json: unknown }>(
      `SELECT id, output_json
       FROM parse_runs
       WHERE report_version_id = $1
         AND fingerprint = $2
         AND status = 'accepted'
         AND output_json IS NOT NULL
       ORDER BY COALESCE(accepted_at, finished_at, created_at) DESC, id DESC
       LIMIT 1`,
      [reportVersionId, fingerprint]
    );
    const row = result.rows[0];
    if (!row?.id) return null;
    const outputJson = parseDbJson(row.output_json);
    return { parseRunId: Number(row.id), outputJson };
  }

  async markRunning(parseRunId: number): Promise<void> {
    await this.db.query(
      `UPDATE parse_runs
       SET status = 'running',
           started_at = COALESCE(started_at, NOW())
       WHERE id = $1
         AND status IN ('created', 'finalize_failed')`,
      [parseRunId]
    );
  }

  async finalizeParseRun(input: FinalizeParseRunInput): Promise<void> {
    const intendedStatus = input.finalStatus;
    assertFinalStatus(intendedStatus);

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await this.finalizeParseRunInTransaction(client, input);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      await this.persistFinalizeFailure(input, intendedStatus).catch((persistError) => {
        console.error('[ParseRun] Failed to persist finalize_failed state:', persistError);
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async retryFinalizeParseRun(parseRunId: number): Promise<void> {
    const result = await this.db.query<any>(
      `SELECT *
       FROM parse_runs
       WHERE id = $1
       LIMIT 1`,
      [parseRunId]
    );
    const run = result.rows[0];
    if (!run) throw new Error('parse_run_not_found');
    if (run.status !== 'finalize_failed') throw new Error('parse_run_not_finalize_failed');

    const finalStatus = String(run.intended_final_status || '').trim();
    assertFinalStatus(finalStatus);

    await this.finalizeParseRun({
      parseRunId,
      finalStatus,
      outputJson: run.draft_output_json,
      repairsJson: run.draft_repairs_json,
      gateResultJson: run.draft_gate_result_json,
      consensusResultJson: run.draft_consensus_result_json,
      sourceSnapshotsJson: run.draft_source_snapshots_json,
      errorCode: run.error_code,
      errorMessage: run.error_message,
      enqueueFollowupJobs: true,
    });
  }

  async getCurrentParsedResult(reportVersionId: number): Promise<CurrentParsedResult | null> {
    const current = await this.db.query<any>(
      `SELECT pr.id, pr.report_version_id, rv.report_id, pr.output_json, pr.provider, pr.model, pr.prompt_version
       FROM parse_runs pr
       JOIN report_versions rv ON rv.id = pr.report_version_id
       WHERE pr.report_version_id = $1
         AND pr.is_current = TRUE
         AND pr.status = 'accepted'
         AND pr.output_json IS NOT NULL
       ORDER BY pr.accepted_at DESC, pr.id DESC
       LIMIT 1`,
      [reportVersionId]
    );

    const row = current.rows[0];
    if (row) {
      return {
        reportVersionId: Number(row.report_version_id),
        reportId: Number(row.report_id),
        parseRunId: Number(row.id),
        parsedJson: parseDbJson(row.output_json),
        provider: row.provider ?? null,
        model: row.model ?? null,
        promptVersion: row.prompt_version ?? null,
        source: 'parse_runs',
      };
    }

    const fallback = await this.db.query<any>(
      `SELECT id, report_id, parsed_json, provider, model, prompt_version
       FROM report_versions
       WHERE id = $1
       LIMIT 1`,
      [reportVersionId]
    );
    const version = fallback.rows[0];
    if (!version || version.parsed_json === null || version.parsed_json === undefined) {
      return null;
    }
    return {
      reportVersionId: Number(version.id),
      reportId: Number(version.report_id),
      parseRunId: null,
      parsedJson: parseDbJson(version.parsed_json),
      provider: version.provider ?? null,
      model: version.model ?? null,
      promptVersion: version.prompt_version ?? null,
      source: 'report_versions',
    };
  }

  async switchCurrentParseRun(reportVersionId: number, targetParseRunId: number): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await this.switchCurrentParseRunInTransaction(client, reportVersionId, targetParseRunId, false);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async restoreSupersededParseRun(reportVersionId: number, targetParseRunId: number): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await this.switchCurrentParseRunInTransaction(client, reportVersionId, targetParseRunId, true);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async finalizeParseRunInTransaction(client: Queryable, input: FinalizeParseRunInput): Promise<void> {
    const runResult = await client.query<any>(
      `SELECT pr.*, rv.report_id, rv.ingestion_batch_id
       FROM parse_runs pr
       JOIN report_versions rv ON rv.id = pr.report_version_id
       WHERE pr.id = $1
       FOR UPDATE`,
      [input.parseRunId]
    );
    const run = runResult.rows[0];
    if (!run) throw new Error('parse_run_not_found');

    await client.query(`SELECT id FROM report_versions WHERE id = $1 FOR UPDATE`, [run.report_version_id]);

    const outputJson = input.outputJson ?? run.draft_output_json ?? run.output_json ?? null;
    const repairsJson = input.repairsJson ?? run.draft_repairs_json ?? run.repairs_json ?? [];
    const gateResultJson = input.gateResultJson ?? run.draft_gate_result_json ?? run.gate_result_json ?? null;
    const consensusResultJson = input.consensusResultJson ?? run.draft_consensus_result_json ?? run.consensus_result_json ?? null;
    const sourceSnapshotsJson = input.sourceSnapshotsJson ?? run.draft_source_snapshots_json ?? null;
    const finalStatus = input.finalStatus;
    const errorCode = finalStatus === 'accepted' ? null : input.errorCode ?? run.error_code ?? inferErrorCode(finalStatus);
    const errorMessage = finalStatus === 'accepted'
      ? null
      : input.errorMessage ?? run.error_message ?? inferErrorMessage(finalStatus, gateResultJson);

    await client.query(
      `UPDATE parse_runs
       SET draft_output_json = $1,
           draft_repairs_json = $2,
           draft_gate_result_json = $3,
           draft_consensus_result_json = $4,
           draft_source_snapshots_json = $5,
           intended_final_status = $6,
           error_code = $7,
           error_message = $8
       WHERE id = $9`,
      [
        normalizeJsonParam(outputJson),
        normalizeJsonParam(repairsJson),
        normalizeJsonParam(gateResultJson),
        normalizeJsonParam(consensusResultJson),
        normalizeJsonParam(sourceSnapshotsJson),
        finalStatus,
        errorCode,
        errorMessage,
        input.parseRunId,
      ]
    );

    if (finalStatus === 'accepted') {
      if (outputJson === null || outputJson === undefined) {
        throw new Error('accepted_parse_run_requires_output');
      }

      const currentResult = await client.query<{ id: number }>(
        `SELECT id
         FROM parse_runs
         WHERE report_version_id = $1
           AND is_current = TRUE
           AND id <> $2
         FOR UPDATE`,
        [run.report_version_id, input.parseRunId]
      );

      for (const current of currentResult.rows) {
        await client.query(
          `UPDATE parse_runs
           SET is_current = FALSE,
               status = 'superseded',
               superseded_by = $1,
               superseded_at = NOW(),
               finished_at = COALESCE(finished_at, NOW())
           WHERE id = $2`,
          [input.parseRunId, current.id]
        );
      }

      await client.query(
        `UPDATE parse_runs
         SET status = 'accepted',
             is_current = TRUE,
             output_json = $1,
             repairs_json = $2,
             gate_result_json = $3,
             consensus_result_json = $4,
             error_code = NULL,
             error_message = NULL,
             finished_at = NOW(),
             accepted_at = COALESCE(accepted_at, NOW())
         WHERE id = $5`,
        [
          normalizeJsonParam(outputJson),
          normalizeJsonParam(repairsJson),
          normalizeJsonParam(gateResultJson),
          normalizeJsonParam(consensusResultJson),
          input.parseRunId,
        ]
      );

      await client.query(
        `UPDATE report_versions
         SET parsed_json = $1,
             provider = $2,
             model = $3,
             prompt_version = $4,
             schema_version = $5,
             updated_at = NOW()
         WHERE id = $6`,
        [
          normalizeJsonParam(outputJson),
          run.provider,
          run.model,
          run.prompt_version,
          run.schema_version,
          run.report_version_id,
        ]
      );

      await client.query(
        `INSERT INTO report_version_parses (report_version_id, provider, model, output_json, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [run.report_version_id, run.provider, run.model, normalizeJsonParam(outputJson)]
      );

      if (input.enqueueFollowupJobs !== false) {
        await this.enqueueMaterializeAndChecks(client, Number(run.report_id), Number(run.report_version_id), run.ingestion_batch_id ?? null);
      }
    } else {
      await client.query(
        `UPDATE parse_runs
         SET status = $1,
             is_current = FALSE,
             output_json = NULL,
             repairs_json = NULL,
             gate_result_json = $2,
             consensus_result_json = $3,
             error_code = $4,
             error_message = $5,
             finished_at = NOW()
         WHERE id = $6`,
        [
          finalStatus,
          normalizeJsonParam(gateResultJson),
          normalizeJsonParam(consensusResultJson),
          errorCode,
          errorMessage,
          input.parseRunId,
        ]
      );
    }

    await this.persistSourceSnapshots(
      client,
      input.parseRunId,
      Number(run.report_version_id),
      sourceSnapshotsJson
    );

    if (run.job_id) {
      await client.query(
        `UPDATE jobs
         SET status = $1,
             error_code = $2,
             error_message = $3,
             finished_at = NOW(),
             progress = 100,
             step_code = 'DONE',
             step_name = $4
         WHERE id = $5`,
        [
          toJobStatus(finalStatus),
          errorCode,
          errorMessage,
          finalStatus === 'accepted' ? '完成' : '解析未通过',
          run.job_id,
        ]
      );
    }
  }

  private async persistSourceSnapshots(
    client: Queryable,
    parseRunId: number,
    reportVersionId: number,
    sourceSnapshotsJson: unknown
  ): Promise<void> {
    const snapshots = parseDbJson(sourceSnapshotsJson);
    if (!Array.isArray(snapshots) || snapshots.length === 0) {
      return;
    }

    await client.query('DELETE FROM source_snapshots WHERE parse_run_id = $1', [parseRunId]);

    for (const snapshot of snapshots as SourceSnapshotRow[]) {
      if (!snapshot || typeof snapshot !== 'object') continue;
      await client.query(
        `INSERT INTO source_snapshots (
           parse_run_id, report_version_id, source_type, source_path,
           page_number, table_index, table_id, row_index, col_index,
           row_span, col_span, row_header, col_header, cell_text,
           normalized_text, bbox_json, metadata_json
         )
         VALUES (
           $1, $2, $3, $4,
           $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14,
           $15, $16, $17
         )`,
        [
          parseRunId,
          reportVersionId,
          snapshot.source_type || 'parsed_table3',
          snapshot.source_path ?? null,
          snapshot.page_number ?? null,
          snapshot.table_index ?? null,
          snapshot.table_id ?? null,
          snapshot.row_index ?? null,
          snapshot.col_index ?? null,
          snapshot.row_span ?? 1,
          snapshot.col_span ?? 1,
          snapshot.row_header ?? null,
          snapshot.col_header ?? null,
          snapshot.cell_text ?? null,
          snapshot.normalized_text ?? null,
          normalizeJsonParam(snapshot.bbox_json ?? null),
          normalizeJsonParam(snapshot.metadata_json ?? {}),
        ]
      );
    }
  }

  private async persistFinalizeFailure(input: FinalizeParseRunInput, intendedStatus: ParseFinalStatus): Promise<void> {
    await this.db.query(
      `UPDATE parse_runs
       SET status = 'finalize_failed',
           intended_final_status = $1,
           draft_output_json = COALESCE($2, draft_output_json),
           draft_repairs_json = COALESCE($3, draft_repairs_json),
           draft_gate_result_json = COALESCE($4, draft_gate_result_json),
           draft_consensus_result_json = COALESCE($5, draft_consensus_result_json),
           draft_source_snapshots_json = COALESCE($6, draft_source_snapshots_json),
           error_code = COALESCE($7, error_code, 'FINALIZE_FAILED'),
           error_message = COALESCE($8, error_message, 'Finalize parse run failed'),
           finished_at = NOW()
       WHERE id = $9`,
      [
        intendedStatus,
        normalizeJsonParam(input.outputJson),
        normalizeJsonParam(input.repairsJson),
        normalizeJsonParam(input.gateResultJson),
        normalizeJsonParam(input.consensusResultJson),
        normalizeJsonParam(input.sourceSnapshotsJson),
        input.errorCode ?? 'FINALIZE_FAILED',
        input.errorMessage ?? 'Finalize parse run failed',
        input.parseRunId,
      ]
    );
  }

  private async switchCurrentParseRunInTransaction(
    client: Queryable,
    reportVersionId: number,
    targetParseRunId: number,
    allowSupersededTarget: boolean
  ): Promise<void> {
    const targetResult = await client.query<any>(
      `SELECT pr.*, rv.report_id, rv.ingestion_batch_id
       FROM parse_runs pr
       JOIN report_versions rv ON rv.id = pr.report_version_id
       WHERE pr.id = $1
         AND pr.report_version_id = $2
       FOR UPDATE`,
      [targetParseRunId, reportVersionId]
    );
    const target = targetResult.rows[0];
    if (!target) throw new Error('parse_run_not_found');
    if (!target.output_json) throw new Error('target_parse_run_missing_output');
    if (allowSupersededTarget) {
      if (target.status !== 'superseded') throw new Error('target_parse_run_not_superseded');
    } else if (target.status !== 'accepted') {
      throw new Error('target_parse_run_not_accepted');
    }

    await client.query(`SELECT id FROM report_versions WHERE id = $1 FOR UPDATE`, [reportVersionId]);

    const currentResult = await client.query<any>(
      `SELECT id
       FROM parse_runs
       WHERE report_version_id = $1
         AND is_current = TRUE
         AND id <> $2
       FOR UPDATE`,
      [reportVersionId, targetParseRunId]
    );
    const current = currentResult.rows[0] || null;

    if (current?.id) {
      await client.query(
        `UPDATE parse_runs
         SET is_current = FALSE,
             status = 'superseded',
             superseded_by = $1,
             superseded_at = NOW(),
             finished_at = COALESCE(finished_at, NOW())
         WHERE id = $2`,
        [targetParseRunId, current.id]
      );
    }

    await client.query(
      `UPDATE parse_runs
       SET status = 'accepted',
           is_current = TRUE,
           restored_from = CASE WHEN $1::boolean THEN $2 ELSE restored_from END,
           restored_at = CASE WHEN $1::boolean THEN NOW() ELSE restored_at END,
           accepted_at = COALESCE(accepted_at, NOW()),
           finished_at = COALESCE(finished_at, NOW()),
           error_code = NULL,
           error_message = NULL
       WHERE id = $3`,
      [allowSupersededTarget, current?.id ?? null, targetParseRunId]
    );

    await client.query(
      `UPDATE report_versions
       SET parsed_json = $1,
           provider = $2,
           model = $3,
           prompt_version = $4,
           schema_version = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [
        normalizeJsonParam(target.output_json),
        target.provider,
        target.model,
        target.prompt_version,
        target.schema_version,
        reportVersionId,
      ]
    );

    await this.enqueueMaterializeAndChecks(client, Number(target.report_id), reportVersionId, target.ingestion_batch_id ?? null);
  }

  private async enqueueMaterializeAndChecks(
    client: Queryable,
    reportId: number,
    versionId: number,
    ingestionBatchId: number | null
  ): Promise<void> {
    await this.ensureJob(client, reportId, versionId, 'materialize', 'MATERIALIZE', '等待结构化', ingestionBatchId);
    await this.ensureJob(client, reportId, versionId, 'checks', 'POSTPROCESS', '等待校验', ingestionBatchId);
  }

  private async ensureJob(
    client: Queryable,
    reportId: number,
    versionId: number,
    kind: 'materialize' | 'checks',
    stepCode: string,
    stepName: string,
    ingestionBatchId: number | null
  ): Promise<void> {
    const existing = await client.query(
      `SELECT id
       FROM jobs
       WHERE report_id = $1
         AND version_id = $2
         AND kind = $3
         AND status IN ('queued', 'running')
       LIMIT 1`,
      [reportId, versionId, kind]
    );
    if (existing.rows[0]?.id) return;

    await client.query(
      `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, max_retries, ingestion_batch_id)
       VALUES ($1, $2, $3, 'queued', 60, $4, $5, 1, $6)`,
      [reportId, versionId, kind, stepCode, stepName, ingestionBatchId]
    );
  }
}

export const parseRunService = new ParseRunService();

export const __parseRunInternals = {
  stableStringify,
  inferErrorCode,
  inferErrorMessage,
  normalizeJsonParam,
  parseDbJson,
};
