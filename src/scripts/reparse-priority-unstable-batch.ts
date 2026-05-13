import fsp from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

type PriorityBucket = 'P0_BLOCKED' | 'P1_TABLE_ACCURACY' | 'P2_ACTIVE_UNSTABLE' | 'P3_MONITOR';
type RecommendedAction =
  | 'restore_source_first'
  | 'source_gated_reparse_table_priority'
  | 'reparse_and_compare'
  | 'monitor_or_defer';

type PriorityRow = {
  priority_bucket: PriorityBucket;
  priority_score: number;
  recommended_action: RecommendedAction;
  focus_reason?: string;
  report_id: number;
  version_id: number;
  region_id?: number | null;
  region_name?: string | null;
  year?: number | null;
  is_active?: boolean;
  review_status?: string | null;
  storage_path?: string;
  source_exists?: boolean;
  parse_count?: number;
  distinct_output_count?: number;
  open_issue_count?: number;
  open_table_issue_count?: number;
  open_table3_issue_count?: number;
  open_visual_issue_count?: number;
  open_quality_issue_count?: number;
  parse_error_count?: number;
  table3_fragmentation_rows?: number;
  table3_fragmentation_response_types?: string[];
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
  compared_fields?: number;
  mismatched_fields?: number;
  reason?: string;
  mismatches?: Array<{ field: string; source: number; parsed: number }>;
  repairs_applied?: number;
  facts_created?: number;
  cells_created?: number;
};

type ProviderConfig = {
  provider: string;
  model?: string;
};

type AttemptTrail = {
  provider: string;
  model?: string;
  artifact_summary_json: string;
  artifact_details_json: string;
  detail: RepairDetail;
};

type FinalDecision = {
  target: PriorityRow;
  final_status:
    | 'passed'
    | 'blocked_missing_source'
    | 'non_retryable_failure'
    | 'still_unresolved_after_provider_chain';
  chosen_provider?: string;
  chosen_model?: string;
  final_detail?: RepairDetail;
  attempts: AttemptTrail[];
};

const PASS_STATUSES = new Set<RepairDetail['status']>(['ok', 'dry_run_ok']);
const DEFAULT_RETRY_STATUSES = new Set<RepairDetail['status']>([
  'parse_failed',
  'source_gate_failed',
  'materialize_failed',
]);

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

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildTimestamp(): string {
  const now = new Date();
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

function resolvePathArg(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
}

function parseProviderConfigs(value: string | undefined): ProviderConfig[] {
  const entries = parseList(value);
  if (entries.length === 0) {
    const primaryProvider = String(process.env.LLM_PARSE_PROVIDER || process.env.LLM_PROVIDER || 'stub').trim().toLowerCase();
    const primaryModel = String(process.env.LLM_PARSE_MODEL || process.env.LLM_MODEL || '').trim();
    return [{ provider: primaryProvider, model: primaryModel || undefined }];
  }

  return entries.map((entry) => {
    const [providerRaw, modelRaw] = entry.split(':');
    const provider = String(providerRaw || '').trim().toLowerCase();
    const model = String(modelRaw || '').trim();
    if (!provider) {
      throw new Error(`invalid_provider_entry:${entry}`);
    }
    return {
      provider,
      model: model || undefined,
    };
  });
}

function normalizeVersionId(value: unknown): number {
  const num = Number(value);
  return Number.isInteger(num) && num > 0 ? num : 0;
}

function buildCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const escape = (value: unknown) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => escape(row[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function loadPriorityRows(summaryPath: string): Promise<PriorityRow[]> {
  const raw = await fsp.readFile(summaryPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`priority_summary_not_array:${summaryPath}`);
  }
  return parsed as PriorityRow[];
}

function selectTargets(
  rows: PriorityRow[],
  priorityBuckets: Set<string>,
  recommendedActions: Set<string>,
  limit: number
): PriorityRow[] {
  const filtered = rows.filter((row) => {
    if (priorityBuckets.size > 0 && !priorityBuckets.has(String(row.priority_bucket))) {
      return false;
    }
    if (recommendedActions.size > 0 && !recommendedActions.has(String(row.recommended_action))) {
      return false;
    }
    return true;
  });

  filtered.sort((left, right) => {
    const scoreDelta = Number(right.priority_score || 0) - Number(left.priority_score || 0);
    if (scoreDelta !== 0) return scoreDelta;
    return Number(left.version_id || 0) - Number(right.version_id || 0);
  });

  return filtered.slice(0, limit);
}

async function runSingleProvider(input: {
  providerConfig: ProviderConfig;
  summaryPath: string;
  outDir: string;
  apply: boolean;
  gateMode: string;
  stabilizeMode: string;
  maxAttempts: number;
  minSourceFields: number;
  minRowSourceFields: number;
  retryDelayMs: number;
  rateLimitDelayMs: number;
  checkpointPath: string;
  summaryOutputPath: string;
  detailsOutputPath: string;
  csvOutputPath: string;
}): Promise<RepairDetail[]> {
  const tsNodeBin = require.resolve('ts-node/dist/bin.js');
  const args = [
    tsNodeBin,
    'src/scripts/reparse-table3-mismatches-with-source-gate.ts',
    `--summary-json=${input.summaryPath}`,
    `--out-dir=${input.outDir}`,
    `--provider=${input.providerConfig.provider}`,
    `--gate-mode=${input.gateMode}`,
    `--stabilize-mode=${input.stabilizeMode}`,
    `--max-attempts=${input.maxAttempts}`,
    `--min-source-fields=${input.minSourceFields}`,
    `--min-row-source-fields=${input.minRowSourceFields}`,
    `--retry-delay-ms=${input.retryDelayMs}`,
    `--rate-limit-delay-ms=${input.rateLimitDelayMs}`,
    `--checkpoint-file=${input.checkpointPath}`,
    '--reset-checkpoint',
    '--no-resume',
    `--summary-output=${input.summaryOutputPath}`,
    `--details-output=${input.detailsOutputPath}`,
    `--csv-output=${input.csvOutputPath}`,
  ];

  if (input.providerConfig.model) {
    args.push(`--model=${input.providerConfig.model}`);
  }
  if (input.apply) {
    args.push('--apply');
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`provider_batch_failed:${input.providerConfig.provider}:${code}`));
    });
  });

  const detailRaw = await fsp.readFile(input.detailsOutputPath, 'utf8');
  const parsed = JSON.parse(detailRaw);
  if (!Array.isArray(parsed)) {
    throw new Error(`provider_details_not_array:${input.detailsOutputPath}`);
  }
  return parsed as RepairDetail[];
}

async function main(): Promise<void> {
  const summaryPath = resolvePathArg(
    parseArg('summary-json'),
    path.resolve(process.cwd(), 'tmp/unstable_parse_priority_table_accuracy_top_20260402_125450.json')
  );
  const outDir = resolvePathArg(parseArg('out-dir'), path.resolve(process.cwd(), 'tmp'));
  const timestamp = buildTimestamp();
  const providers = parseProviderConfigs(parseArg('providers'));
  const priorityBuckets = new Set(parseList(parseArg('priority-buckets') || 'P1_TABLE_ACCURACY'));
  const recommendedActions = new Set(
    parseList(parseArg('recommended-actions') || 'source_gated_reparse_table_priority')
  );
  const retryStatuses = new Set(
    parseList(parseArg('retry-statuses')).length > 0
      ? (parseList(parseArg('retry-statuses')) as RepairDetail['status'][])
      : Array.from(DEFAULT_RETRY_STATUSES)
  );
  const limit = toInt(parseArg('limit'), 50);
  const gateMode = (parseArg('gate-mode') || 'legacy').trim();
  const stabilizeMode = (parseArg('stabilize-mode') || 'all').trim();
  const maxAttempts = toInt(parseArg('max-attempts'), 1);
  const minSourceFields = toInt(parseArg('min-source-fields'), 3);
  const minRowSourceFields = toInt(parseArg('min-row-source-fields'), 4);
  const retryDelayMs = toInt(parseArg('retry-delay-ms'), 0);
  const rateLimitDelayMs = toInt(parseArg('rate-limit-delay-ms'), 15000);
  const apply = hasFlag('apply');

  await fsp.mkdir(outDir, { recursive: true });

  const allRows = await loadPriorityRows(summaryPath);
  const selected = selectTargets(allRows, priorityBuckets, recommendedActions, limit);
  const selectedByVersionId = new Map(selected.map((row) => [row.version_id, row]));

  const blocked = selected.filter((row) => row.source_exists === false);
  const remaining = new Map<number, PriorityRow>(
    selected.filter((row) => row.source_exists !== false).map((row) => [row.version_id, row])
  );
  const trails = new Map<number, AttemptTrail[]>();
  const winners = new Map<number, RepairDetail>();
  const terminalFailures = new Map<number, RepairDetail>();

  for (const providerConfig of providers) {
    if (remaining.size === 0) {
      break;
    }

    const providerTag = `${providerConfig.provider}${providerConfig.model ? `_${providerConfig.model}` : ''}`
      .replace(/[^\w.-]+/g, '_');
    const providerDir = path.join(outDir, `priority_reparse_${timestamp}_${providerTag}`);
    await fsp.mkdir(providerDir, { recursive: true });

    const providerTargets = Array.from(remaining.values());
    const inputSummaryPath = path.join(providerDir, 'input_summary.json');
    const summaryOutputPath = path.join(providerDir, 'summary.json');
    const detailsOutputPath = path.join(providerDir, 'details.json');
    const csvOutputPath = path.join(providerDir, 'details.csv');
    const checkpointPath = path.join(providerDir, 'checkpoint.json');

    await fsp.writeFile(inputSummaryPath, `${JSON.stringify(providerTargets, null, 2)}\n`, 'utf8');

    console.log(
      `[priority-reparse] provider=${providerConfig.provider} model=${providerConfig.model || ''} targets=${providerTargets.length}`
    );

    const details = await runSingleProvider({
      providerConfig,
      summaryPath: inputSummaryPath,
      outDir: providerDir,
      apply,
      gateMode,
      stabilizeMode,
      maxAttempts,
      minSourceFields,
      minRowSourceFields,
      retryDelayMs,
      rateLimitDelayMs,
      checkpointPath,
      summaryOutputPath,
      detailsOutputPath,
      csvOutputPath,
    });

    const seenVersionIds = new Set<number>();
    for (const detail of details) {
      const versionId = normalizeVersionId(detail.version_id);
      if (!versionId || !remaining.has(versionId)) {
        continue;
      }
      seenVersionIds.add(versionId);

      const attemptList = trails.get(versionId) || [];
      attemptList.push({
        provider: providerConfig.provider,
        model: providerConfig.model,
        artifact_summary_json: summaryOutputPath,
        artifact_details_json: detailsOutputPath,
        detail,
      });
      trails.set(versionId, attemptList);

      if (PASS_STATUSES.has(detail.status)) {
        winners.set(versionId, detail);
        remaining.delete(versionId);
        continue;
      }

      if (!retryStatuses.has(detail.status)) {
        terminalFailures.set(versionId, detail);
        remaining.delete(versionId);
      }
    }

    for (const versionId of Array.from(remaining.keys())) {
      if (seenVersionIds.has(versionId)) {
        continue;
      }
      const syntheticDetail: RepairDetail = {
        report_id: remaining.get(versionId)?.report_id || 0,
        version_id: versionId,
        storage_path: remaining.get(versionId)?.storage_path || '',
        status: 'parse_failed',
        reason: `provider_no_detail:${providerConfig.provider}`,
      };
      const attemptList = trails.get(versionId) || [];
      attemptList.push({
        provider: providerConfig.provider,
        model: providerConfig.model,
        artifact_summary_json: summaryOutputPath,
        artifact_details_json: detailsOutputPath,
        detail: syntheticDetail,
      });
      trails.set(versionId, attemptList);
    }
  }

  const finalDecisions: FinalDecision[] = selected.map((target) => {
    const attempts = trails.get(target.version_id) || [];
    if (target.source_exists === false) {
      return {
        target,
        final_status: 'blocked_missing_source',
        attempts,
      };
    }

    const winner = winners.get(target.version_id);
    if (winner) {
      return {
        target,
        final_status: 'passed',
        chosen_provider: winner.provider,
        chosen_model: winner.model,
        final_detail: winner,
        attempts,
      };
    }

    const terminal = terminalFailures.get(target.version_id);
    if (terminal) {
      return {
        target,
        final_status: 'non_retryable_failure',
        chosen_provider: terminal.provider,
        chosen_model: terminal.model,
        final_detail: terminal,
        attempts,
      };
    }

    const lastAttempt = attempts[attempts.length - 1]?.detail;
    return {
      target,
      final_status: 'still_unresolved_after_provider_chain',
      chosen_provider: lastAttempt?.provider,
      chosen_model: lastAttempt?.model,
      final_detail: lastAttempt,
      attempts,
    };
  });

  const summary = {
    scanned_at: new Date().toISOString(),
    summary_input: summaryPath,
    apply,
    limit_requested: limit,
    selected_targets: selected.length,
    blocked_missing_source: blocked.length,
    provider_chain: providers,
    gate_mode: gateMode,
    stabilize_mode: stabilizeMode,
    max_attempts_per_provider: maxAttempts,
    min_source_fields: minSourceFields,
    min_row_source_fields: minRowSourceFields,
    retry_delay_ms: retryDelayMs,
    rate_limit_delay_ms: rateLimitDelayMs,
    passed: finalDecisions.filter((item) => item.final_status === 'passed').length,
    non_retryable_failure: finalDecisions.filter((item) => item.final_status === 'non_retryable_failure').length,
    still_unresolved_after_provider_chain: finalDecisions.filter(
      (item) => item.final_status === 'still_unresolved_after_provider_chain'
    ).length,
  };

  const summaryOutputPath = path.join(outDir, `priority_unstable_reparse_summary_${timestamp}.json`);
  const detailsOutputPath = path.join(outDir, `priority_unstable_reparse_details_${timestamp}.json`);
  const remainingOutputPath = path.join(outDir, `priority_unstable_reparse_remaining_${timestamp}.json`);
  const csvOutputPath = path.join(outDir, `priority_unstable_reparse_details_${timestamp}.csv`);

  const remainingRows = finalDecisions
    .filter((item) => item.final_status === 'still_unresolved_after_provider_chain')
    .map((item) => ({
      ...item.target,
      last_status: item.final_detail?.status || null,
      last_provider: item.final_detail?.provider || null,
      last_model: item.final_detail?.model || null,
      last_reason: item.final_detail?.reason || null,
    }));

  const csvRows = finalDecisions.map((item) => ({
    report_id: item.target.report_id,
    version_id: item.target.version_id,
    region_name: item.target.region_name || '',
    year: item.target.year || '',
    priority_bucket: item.target.priority_bucket,
    priority_score: item.target.priority_score,
    final_status: item.final_status,
    chosen_provider: item.chosen_provider || '',
    chosen_model: item.chosen_model || '',
    last_detail_status: item.final_detail?.status || '',
    last_detail_reason: item.final_detail?.reason || '',
    attempt_count: item.attempts.length,
  }));

  await fsp.writeFile(summaryOutputPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fsp.writeFile(detailsOutputPath, `${JSON.stringify(finalDecisions, null, 2)}\n`, 'utf8');
  await fsp.writeFile(remainingOutputPath, `${JSON.stringify(remainingRows, null, 2)}\n`, 'utf8');
  await fsp.writeFile(
    csvOutputPath,
    buildCsv(csvRows, [
      'report_id',
      'version_id',
      'region_name',
      'year',
      'priority_bucket',
      'priority_score',
      'final_status',
      'chosen_provider',
      'chosen_model',
      'last_detail_status',
      'last_detail_reason',
      'attempt_count',
    ]),
    'utf8'
  );

  console.log(
    JSON.stringify(
      {
        summary,
        artifacts: {
          summary_json: summaryOutputPath,
          details_json: detailsOutputPath,
          remaining_json: remainingOutputPath,
          details_csv: csvOutputPath,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error('[reparse-priority-unstable-batch] failed:', error);
  process.exitCode = 1;
});
