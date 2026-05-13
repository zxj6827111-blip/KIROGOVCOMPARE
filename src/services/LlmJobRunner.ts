import pool from '../config/database-llm';
import { LlmParseResult, LlmProvider, LlmProviderError } from './LlmProvider';
import { createLlmProvider } from './LlmProviderFactory';
import { consistencyCheckService } from './ConsistencyCheckService';
import { materializeService } from './data-center/MaterializeService';
import { ingestionBatchService } from './data-center/IngestionBatchService';
import { govInsightStatsService } from './GovInsightStatsService';
import { stabilizeParsedOutput } from './ParsedOutputStabilityService';
import { parseConsensusService } from './ParseConsensusService';
import { visionReviewService } from './VisionReviewService';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { summarizeDiff } from '../utils/jsonDiff';
import { calculateReportMetrics } from '../utils/reportAnalysis';
import { hasParsedContent } from '../utils/parsedContent';
import { PROJECT_ROOT } from '../config/constants';
import { normalizeAnnualReportOutputFromSource } from './SegmentedAnnualReportParse';
import { resolveParsePrimaryConfig } from '../utils/llmProviderConfig';
import { buildParseConfigSnapshot, parseRunService } from './ParseRunService';
import { buildSourceGateConfig, sourceGateService } from './SourceGateService';

interface QueuedJob {
  id: number;
  kind: string;
  report_id: number | null;
  version_id: number | null;
  retry_count: number;
  max_retries: number;
  storage_path?: string;
  file_hash?: string;
  comparison_id?: number | null;
  ingestion_batch_id?: number | null;
}

// 5-step progress tracking (Chinese)
const STEPS = {
  RECEIVED: { code: 'RECEIVED', name: '已接收并保存文件', progress: 10 },
  ENQUEUED: { code: 'ENQUEUED', name: '已入库并创建解析任务', progress: 20 },
  PARSING: { code: 'PARSING', name: 'AI parsing', progress: 50 },
  MATERIALIZE: { code: 'MATERIALIZE', name: 'Materializing', progress: 70 },
  POSTPROCESS: { code: 'POSTPROCESS', name: 'Validating and saving', progress: 80 },
  DONE: { code: 'DONE', name: '完成', progress: 100 },
  QUEUED: { code: 'QUEUED', name: '等待处理', progress: 0 },
  CANCELLED: { code: 'CANCELLED', name: 'Cancelled', progress: 100 },
};

const POLL_INTERVAL_MS = 5000; // 5秒轮询间隔，避免API速率限制
const POST_JOB_COOLDOWN_MS = Number(process.env.LLM_POST_JOB_COOLDOWN_MS || 10000); // Cooldown after parse jobs (default 10s) to avoid API rate limits.
const COMPARE_CONCURRENCY = 5; // compare task concurrency

const WORKER_MODE = (process.env.LLM_WORKER_MODE || 'all').toLowerCase().trim();
const PARSE_CONSENSUS_ENABLED = toBooleanEnv(process.env.LLM_PARSE_CONSENSUS_ENABLED, false);
const PARSE_RULE_GATE_ENABLED = toBooleanEnv(process.env.LLM_PARSE_RULE_GATE_ENABLED, false);
const PARSE_CONSENSUS_ALLOW_SAME_MODEL = toBooleanEnv(process.env.LLM_PARSE_CONSENSUS_ALLOW_SAME_MODEL, true);
const PARSE_STABILIZE_MODE = (process.env.LLM_PARSE_STABILIZE_MODE || 'none').toLowerCase().trim();
const SOURCE_GATE_ENABLED = toBooleanEnv(process.env.SOURCE_GATE_ENABLED, false);
const AUTO_PUBLISH_CLEAN_UPLOADS = toBooleanEnv(process.env.AUTO_PUBLISH_CLEAN_UPLOADS, true);

function getFailureStep(jobKind: string): { code: string; name: string; progress: number } {
  switch (jobKind) {
    case 'parse':
      return { code: STEPS.PARSING.code, name: 'AI 解析失败', progress: STEPS.PARSING.progress };
    case 'materialize':
    case 'checks':
    case 'vision_review':
      return { code: STEPS.POSTPROCESS.code, name: '结果校验与入库失败', progress: STEPS.POSTPROCESS.progress };
    default:
      return { code: STEPS.QUEUED.code, name: '处理失败', progress: 100 };
  }
}

function toBooleanEnv(raw: string | undefined, fallback: boolean): boolean {
  if (!raw) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

function resolveStabilizeOptions(modeRaw: string): { table3: boolean; table4: boolean } {
  const mode = modeRaw.trim().toLowerCase();
  if (mode === 'all' || mode === 'full') {
    return { table3: true, table4: true };
  }
  if (mode === 'table4' || mode === 'table4-only') {
    return { table3: false, table4: true };
  }
  return { table3: false, table4: false };
}

const PARSE_STABILIZE_OPTIONS = resolveStabilizeOptions(PARSE_STABILIZE_MODE);

function resolveAllowedKinds(mode: string): Set<string> {
  if (!mode || mode === 'all') {
    return new Set(['parse', 'materialize', 'checks', 'vision_review', 'compare']);
  }
  if (mode.includes(',')) {
    return new Set(mode.split(',').map((k) => k.trim()).filter(Boolean));
  }
  if (mode === 'materialize' || mode === 'materialize-checks' || mode === 'checks-materialize') {
    return new Set(['materialize', 'checks', 'vision_review']);
  }
  if (mode === 'parse' || mode === 'checks' || mode === 'vision_review' || mode === 'compare') {
    return new Set([mode]);
  }
  // Fallback: treat as single kind
  return new Set([mode]);
}

const ALLOWED_KINDS = resolveAllowedKinds(WORKER_MODE);
const ALLOWED_KIND_LIST = Array.from(ALLOWED_KINDS);
const NON_COMPARE_ALLOWED_KIND_LIST = ALLOWED_KIND_LIST.filter((kind) => kind !== 'compare');

export class LlmJobRunner {
  private running = false;
  private processing = false;
  private parsedJsonColumnExists: boolean | null = null;
  private rawTextColumnExists: boolean | null = null;
  private currentAbortController: AbortController | null = null;
  private currentJobId: number | null = null;
  private compareWorkersActive = 0; // 当前活跃的比对任务数

  start(): void {
    if (this.running) {
      return;
    }

    // Restart recovery: reset all running jobs to queued
    this.recoverRunningJobs();

    this.running = true;
    console.log(`[JobRunner] Worker mode: ${WORKER_MODE} (kinds: ${ALLOWED_KIND_LIST.join(', ') || 'none'})`);
    console.log(
      `[JobRunner] Parse stabilize mode: ${PARSE_STABILIZE_MODE || 'none'} (table3=${PARSE_STABILIZE_OPTIONS.table3}, table4=${PARSE_STABILIZE_OPTIONS.table4}), parse_rule_gate=${PARSE_RULE_GATE_ENABLED}`
    );
    console.log(`[JobRunner] Source gate enabled=${SOURCE_GATE_ENABLED}`);
    this.scheduleNextTick();
  }

  stop(): void {
    this.running = false;
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }

  private async processJob(job: QueuedJob): Promise<void> {
    this.currentJobId = job.id;
    try {
      if (job.kind === 'compare') {
        await this.processCompareJob(job);
      } else if (job.kind === 'materialize') {
        await this.processMaterializeJob(job);
      } else if (job.kind === 'checks') {
        await this.processChecksJob(job);
      } else if (job.kind === 'vision_review') {
        await this.processVisionReviewJob(job);
      } else {
        await this.processParseJob(job);
      }
    } catch (error: any) {
      await this.handleJobFailure(job, error);
    } finally {
      this.currentJobId = null;
      this.currentAbortController = null;
    }
  }

  /**
   * Cancel a specific job.
   * If it's currently running, abort it.
   * If it's queued/running but not current (race condition?), update DB.
   */
  public async cancelJob(jobId: number): Promise<boolean> {
    // 1. If it's the current running job, abort it
    if (this.currentJobId === jobId && this.currentAbortController) {
      console.log(`[Job ${jobId}] Cancellation requested. Aborting current process...`);
      this.currentAbortController.abort('User cancelled');
      return true;
    }

    // 2. If valid but not running in memory, update DB directly.
    await pool.query(`
      UPDATE jobs
      SET status = 'cancelled',
          step_code = 'CANCELLED',
          step_name = 'Cancelled',
          progress = 100,
          finished_at = NOW(),
          error_message = '用户手动取消'
      WHERE id = $1 AND status IN ('queued', 'running')`, [jobId]);

    return true;
  }

  private async handleJobFailure(job: QueuedJob, error: any): Promise<void> {
    const { code, message } = this.normalizeError(error);
    const failureStep = getFailureStep(job.kind);
    const nonRetryableCodes = new Set([
      'SOURCE_FILE_MISSING',
      'MATERIALIZE_EMPTY_FACTS',
      'PARSED_JSON_EMPTY',
      'PARSE_NOT_READY',
      'vision_channel_unavailable',
      'vision_provider_unsupported',
      'source_capture_failed',
    ]);

    // Check for Cancellation
    if (axios.isCancel(error) || error.name === 'AbortError' || message.includes('User cancelled') || message.includes('canceled')) {
      console.log(`[Job ${job.id}] Job was cancelled.`);
      await pool.query(`
        UPDATE jobs 
        SET status = 'cancelled',
            error_message = '用户手动取消',
            progress = 100,
            step_code = 'CANCELLED',
            step_name = 'Cancelled',
            finished_at = NOW()
        WHERE id = $1`, [job.id]);
      return;
    }

    if (nonRetryableCodes.has(code)) {
      await pool.query(`
        UPDATE jobs
        SET status = 'failed',
            error_code = $1,
            error_message = $2,
            finished_at = NOW(),
            progress = $3,
            step_code = $4,
            step_name = $5
        WHERE id = $6`,
        [code, message, failureStep.progress, failureStep.code, failureStep.name, job.id]);
      console.error(`[Job ${job.id}] Non-retryable failure: ${code} ${message}`);
      return;
    }

    const attempt = job.retry_count + 1;

    console.error(`[Job ${job.id}] Attempt ${attempt} failed:`, error);

    const previousErrorRes = await pool.query(
      `SELECT error_message FROM jobs WHERE id = $1 LIMIT 1`,
      [job.id]
    );
    const previousErrorMessage = String(previousErrorRes.rows[0]?.error_message || '').trim();
    const finalMessage = previousErrorMessage
      ? `${previousErrorMessage}\nAttempt ${attempt} failed: ${message}`
      : `Attempt ${attempt} failed: ${message}`;

    await pool.query(`
      UPDATE jobs
      SET status = 'failed',
          error_code = $1,
          error_message = $2,
          finished_at = NOW(),
          progress = $3,
          step_code = $4,
          step_name = $5
      WHERE id = $6`,
      [code, finalMessage, failureStep.progress, failureStep.code, failureStep.name, job.id]);

    console.error(`[Job ${job.id}] Final failure after ${attempt} attempt(s)`);

    if (job.version_id) {
      await this.generateNotificationIfNeeded(job.version_id);
    }
  }

  private async processParseJob(job: QueuedJob): Promise<void> {
    if (!job.version_id || !job.storage_path) {
      throw new Error('Job missing required version or storage');
    }

    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;

    const attempt = job.retry_count + 1;
    let provider: LlmProvider;
    let selectedProviderName: string | undefined;
    let selectedModelName: string | undefined;
    let parseRunId: number | null = null;
    let draftOutput: any = null;
    const draftRepairs: string[] = [];
    let draftGateResult: any = null;
    let draftConsensusResult: any = null;
    let draftSourceSnapshots: any[] = [];

    const parsePrimary = resolveParsePrimaryConfig();
    selectedProviderName = parsePrimary.provider;
    selectedModelName = parsePrimary.model;
    provider = createLlmProvider(parsePrimary.provider, parsePrimary.model);
    console.log(`[Job ${job.id}] Using config: Provider=${parsePrimary.provider}, Model=${parsePrimary.model}`);

    console.log(`[Job ${job.id}] Processing parse job (attempt ${attempt})...`);

    const resolvedStoragePath = path.isAbsolute(job.storage_path)
      ? job.storage_path
      : path.resolve(PROJECT_ROOT, job.storage_path);
    if (!fs.existsSync(resolvedStoragePath)) {
      throw new LlmProviderError(`source file missing: ${resolvedStoragePath}`, 'SOURCE_FILE_MISSING');
    }

    const configSnapshot = buildParseConfigSnapshot({
      provider: selectedProviderName || 'pending',
      model: selectedModelName || 'pending',
      stabilizeMode: PARSE_STABILIZE_MODE || 'none',
      ruleGateEnabled: PARSE_RULE_GATE_ENABLED,
      sourceGate: buildSourceGateConfig(),
    });
    const createdRun = await parseRunService.createParseRun({
      reportVersionId: job.version_id,
      jobId: job.id,
      config: configSnapshot,
      attempt,
    });
    parseRunId = createdRun.id;
    await parseRunService.markRunning(parseRunId);

    try {
      const parseResult = await provider.parse({
        reportId: job.report_id || 0,
        versionId: job.version_id,
        storagePath: resolvedStoragePath,
        fileHash: job.file_hash,
      }, signal);

      const annualReportNormalized = normalizeAnnualReportOutputFromSource(
        parseResult.output,
        typeof parseResult.sourceText === 'string' ? parseResult.sourceText : ''
      );
      parseResult.output = annualReportNormalized.output;
      draftRepairs.push(...annualReportNormalized.repairs);
      if (annualReportNormalized.repairs.length > 0) {
        console.log(
          `[Job ${job.id}] Applied ${annualReportNormalized.repairs.length} annual report repairs: ${annualReportNormalized.repairs.join(', ')}`
        );
      }
      if (annualReportNormalized.validationIssues.length > 0) {
        throw new LlmProviderError(
          `Annual report segmented validation failed: ${annualReportNormalized.validationIssues.join(', ')}`,
          'ANNUAL_REPORT_SEGMENT_VALIDATION_FAILED'
        );
      }

      const stabilized = stabilizeParsedOutput(parseResult.output, PARSE_STABILIZE_OPTIONS);
      parseResult.output = stabilized.output;
      draftRepairs.push(...stabilized.repairs);
      if (stabilized.repairs.length > 0) {
        console.log(
          `[Job ${job.id}] Applied ${stabilized.repairs.length} deterministic parse repairs: ${stabilized.repairs.slice(0, 10).join(', ')}`
        );
      }

      let verifierResult: LlmParseResult | null = null;
      if (PARSE_CONSENSUS_ENABLED) {
        const verifierConfig = this.resolveConsensusVerifierConfig(parseResult.provider, parseResult.model);
        const sameModel =
          verifierConfig.provider.toLowerCase() === parseResult.provider.toLowerCase() &&
          verifierConfig.model === parseResult.model;

        if (sameModel && !PARSE_CONSENSUS_ALLOW_SAME_MODEL) {
          throw new LlmProviderError(
            'Consensus verifier model equals primary model. Disable LLM_PARSE_CONSENSUS_ENABLED or set LLM_PARSE_CONSENSUS_ALLOW_SAME_MODEL=true.',
            'PARSE_CONSENSUS_CONFIG_INVALID'
          );
        }

        if (sameModel) {
          console.warn(`[Job ${job.id}] Consensus verifier uses same provider/model as primary parse.`);
        } else {
          console.log(
            `[Job ${job.id}] Running consensus verifier parse with Provider=${verifierConfig.provider}, Model=${verifierConfig.model}`
          );
        }

        const verifierProvider = createLlmProvider(verifierConfig.provider, verifierConfig.model);
        verifierResult = await verifierProvider.parse(
          {
            reportId: job.report_id || 0,
            versionId: job.version_id,
            storagePath: resolvedStoragePath,
            fileHash: job.file_hash,
          },
          signal
        );

        const verifierAnnualReportNormalized = normalizeAnnualReportOutputFromSource(
          verifierResult.output,
          typeof verifierResult.sourceText === 'string' ? verifierResult.sourceText : ''
        );
        verifierResult.output = verifierAnnualReportNormalized.output;
        draftRepairs.push(...verifierAnnualReportNormalized.repairs.map((repair) => `verifier:${repair}`));
        if (verifierAnnualReportNormalized.repairs.length > 0) {
          console.log(
            `[Job ${job.id}] Verifier applied ${verifierAnnualReportNormalized.repairs.length} annual report repairs: ${verifierAnnualReportNormalized.repairs.join(', ')}`
          );
        }
        if (verifierAnnualReportNormalized.validationIssues.length > 0) {
          throw new LlmProviderError(
            `Annual report segmented validation failed: ${verifierAnnualReportNormalized.validationIssues.join(', ')}`,
            'ANNUAL_REPORT_SEGMENT_VALIDATION_FAILED'
          );
        }

        const verifierStabilized = stabilizeParsedOutput(verifierResult.output, PARSE_STABILIZE_OPTIONS);
        verifierResult.output = verifierStabilized.output;
        draftRepairs.push(...verifierStabilized.repairs.map((repair) => `verifier:${repair}`));
        if (verifierStabilized.repairs.length > 0) {
          console.log(
            `[Job ${job.id}] Verifier applied ${verifierStabilized.repairs.length} deterministic repairs: ${verifierStabilized.repairs.slice(0, 10).join(', ')}`
          );
        }
      }

      const consensusResult = verifierResult
        ? parseConsensusService.compareCriticalSections(parseResult.output, verifierResult.output)
        : null;
      draftConsensusResult = consensusResult;

      if (consensusResult) {
        const mismatchSummary = consensusResult.sections
          .filter((item) => !item.matched)
          .map((item) => `${item.section}(a:${item.added},r:${item.removed},c:${item.changed})`)
          .join('; ');
        console.log(
          `[Job ${job.id}] Parse consensus matched=${consensusResult.matched}, mismatchedSections=${consensusResult.mismatchedSections.length}${mismatchSummary ? ` => ${mismatchSummary}` : ''
          }`
        );
      }

      const ruleGateResult = PARSE_RULE_GATE_ENABLED
        ? parseConsensusService.checkDeterministicRules(parseResult.output)
        : null;
      const sourceGateConfig = buildSourceGateConfig();
      const sourceGateResult = SOURCE_GATE_ENABLED
        ? sourceGateService.evaluate(parseResult.output, parseResult.sourceText || '', sourceGateConfig)
        : null;
      draftSourceSnapshots = sourceGateService.buildSourceSnapshots(parseResult.output, parseResult.sourceText || '', {
        sourcePath: resolvedStoragePath,
        sourceType: path.extname(resolvedStoragePath).replace(/^\./, '') || 'source_text',
      });
      if (sourceGateResult) {
        await sourceGateService.persist(parseRunId, job.version_id, sourceGateResult, sourceGateConfig);
      }
      draftGateResult = {
        ruleGate: ruleGateResult,
        sourceGate: sourceGateResult,
      };

      // Update progress: POSTPROCESS
      await pool.query(`
        UPDATE jobs
        SET step_code = $1,
            step_name = $2,
            progress = $3,
            provider = $4,
            model = $5
        WHERE id = $6`,
        [STEPS.POSTPROCESS.code, STEPS.POSTPROCESS.name, STEPS.POSTPROCESS.progress, parseResult.provider, parseResult.model, job.id]);

      draftOutput = parseResult.output;

      if (consensusResult && !consensusResult.matched) {
        const mismatchDetails = consensusResult.sections
          .filter((item) => !item.matched)
          .map((item) => `${item.section}:${item.samplePaths.join('|') || 'hash_mismatch'}`)
          .join('; ');
        const errorMessage = `Parse consensus mismatch on ${consensusResult.mismatchedSections.join(', ')}${mismatchDetails ? ` (${mismatchDetails})` : ''}`;
        await parseRunService.finalizeParseRun({
          parseRunId,
          finalStatus: 'gate_failed',
          outputJson: draftOutput,
          repairsJson: draftRepairs,
          gateResultJson: { type: 'consensus', passed: false, issues: [errorMessage], consensusResult },
          consensusResultJson: consensusResult,
          sourceSnapshotsJson: draftSourceSnapshots,
          errorCode: 'PARSE_CONSENSUS_MISMATCH',
          errorMessage,
        });
        return;
      }

      if (ruleGateResult && !ruleGateResult.passed) {
        const issueText = ruleGateResult.issues.slice(0, 8).join('; ');
        const errorMessage = `Deterministic parse rule gate failed: ${issueText}`;
        await parseRunService.finalizeParseRun({
          parseRunId,
          finalStatus: 'gate_failed',
          outputJson: draftOutput,
          repairsJson: draftRepairs,
          gateResultJson: ruleGateResult,
          consensusResultJson: consensusResult,
          sourceSnapshotsJson: draftSourceSnapshots,
          errorCode: 'PARSE_RULE_GATE_FAILED',
          errorMessage,
        });
        return;
      }

      if (sourceGateResult && !sourceGateResult.passed) {
        const issueText = sourceGateResult.issues.slice(0, 8).map((issue) => `${issue.path}:${issue.reason}`).join('; ');
        const errorMessage = `Source gate failed: ${issueText}`;
        await parseRunService.finalizeParseRun({
          parseRunId,
          finalStatus: 'gate_failed',
          outputJson: draftOutput,
          repairsJson: draftRepairs,
          gateResultJson: draftGateResult,
          consensusResultJson: consensusResult,
          sourceSnapshotsJson: draftSourceSnapshots,
          errorCode: 'SOURCE_GATE_FAILED',
          errorMessage,
        });
        return;
      }

      if (typeof parseResult.sourceText === 'string' && await this.hasRawTextColumn()) {
        await pool.query(
          `UPDATE report_versions
           SET raw_text = $1
           WHERE id = $2`,
          [parseResult.sourceText, job.version_id]
        );
      }

      await parseRunService.finalizeParseRun({
        parseRunId,
        finalStatus: 'accepted',
        outputJson: draftOutput,
        repairsJson: draftRepairs,
        gateResultJson: draftGateResult,
        consensusResultJson: draftConsensusResult,
        sourceSnapshotsJson: draftSourceSnapshots,
      });
    } catch (error) {
      if (parseRunId) {
        const normalized = this.normalizeError(error);
        await parseRunService.finalizeParseRun({
          parseRunId,
          finalStatus: 'failed',
          outputJson: draftOutput,
          repairsJson: draftRepairs,
          gateResultJson: draftGateResult,
          consensusResultJson: draftConsensusResult,
          sourceSnapshotsJson: draftSourceSnapshots,
          errorCode: normalized.code,
          errorMessage: normalized.message,
          enqueueFollowupJobs: false,
        }).catch((finalizeError) => {
          console.error(`[Job ${job.id}] Failed to finalize parse_run ${parseRunId} as failed:`, finalizeError);
        });
      }
      throw error;
    }

    // Check if we need to generate notification (after all jobs complete)
    if (job.version_id) {
      await this.generateNotificationIfNeeded(job.version_id);
    }
  }

  /**
   * Restart recovery: reset all 'running' jobs to 'queued' state
   * to avoid permanent stall on server restart
   */
  private recoverRunningJobs(): void {
    this.recoverRunningJobsAsync().catch(err =>
      console.error('[Recovery] Failed to recover running jobs:', err));
  }

  private async recoverRunningJobsAsync(): Promise<void> {
    const result = await pool.query(`SELECT id FROM jobs WHERE status = 'running'`);
    const runningJobs = result.rows;

    if (runningJobs.length > 0) {
      console.log(`[Recovery] Found ${runningJobs.length} running jobs, resetting to queued...`);

      await pool.query(`
        UPDATE jobs 
        SET status = 'queued',
            progress = $1,
            step_code = $2,
            step_name = $3,
            error_code = NULL,
            error_message = NULL
        WHERE status = 'running'`,
        [STEPS.QUEUED.progress, STEPS.QUEUED.code, STEPS.QUEUED.name]);

      console.log(`[Recovery] Reset ${runningJobs.length} jobs to queued`);
    }
  }

  private scheduleNextTick(): void {
    if (!this.running) {
      return;
    }

    setTimeout(() => {
      this.tick().catch((error) => console.error('LLM job runner tick failed:', error));
    }, POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (this.processing) {
      this.scheduleNextTick();
      return;
    }

    this.processing = true;

    try {
      // 先尝试启动比对任务的并发处理
      await this.processCompareJobsConcurrently();

      const job = await this.claimNextJob();
      if (!job) {
        return;
      }

      await this.processJob(job);

      // 任务完成后添加冷却时间，避免过快调用 API 触发速率限制
      // compare 任务是本地处理，不需要冷却。
      if (POST_JOB_COOLDOWN_MS > 0 && job.kind === 'parse') {
        console.log(`[JobRunner] Cooling down for ${POST_JOB_COOLDOWN_MS}ms before next job...`);
        await new Promise(resolve => setTimeout(resolve, POST_JOB_COOLDOWN_MS));
      }
    } finally {
      this.processing = false;
      this.scheduleNextTick();
    }
  }

  // 并发处理比对任务
  private async processCompareJobsConcurrently(): Promise<void> {
    if (!ALLOWED_KINDS.has('compare')) {
      return;
    }
    // 计算可以启动的 worker 数量
    const availableSlots = COMPARE_CONCURRENCY - this.compareWorkersActive;
    if (availableSlots <= 0) return;

    // 获取多个比对任务
    const jobs = await this.claimCompareJobs(availableSlots);
    if (jobs.length === 0) return;

    console.log(`[JobRunner] Starting ${jobs.length} concurrent compare workers (active: ${this.compareWorkersActive}/${COMPARE_CONCURRENCY})`);

    // 并发启动任务处理（不等待完成）
    for (const job of jobs) {
      this.compareWorkersActive++;
      this.runCompareWorker(job).finally(() => {
        this.compareWorkersActive--;
      });
    }
  }

  // 单个比对 worker
  private async runCompareWorker(job: QueuedJob): Promise<void> {
    try {
      await this.processCompareJob(job);
    } catch (error: any) {
      console.error(`[CompareWorker] Job ${job.id} failed:`, error.message);
      await pool.query(`
        UPDATE jobs 
        SET status = 'failed',
            error_message = $1,
            finished_at = NOW()
        WHERE id = $2`, [error.message, job.id]);
    }
  }

  // 批量获取比对任务
  private async claimCompareJobs(limit: number): Promise<QueuedJob[]> {
    const claimResult = await pool.query(`
      WITH next_jobs AS (
        SELECT id
        FROM jobs
        WHERE status = 'queued' AND kind = 'compare'
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs j
      SET status = 'running',
          started_at = NOW()
      FROM next_jobs n
      WHERE j.id = n.id
      RETURNING j.id, j.report_id, j.comparison_id
    `, [limit]);

    if (claimResult.rows.length === 0) return [];

    return claimResult.rows.map((row: any) => ({
      id: row.id,
      kind: 'compare',
      report_id: row.report_id,
      version_id: null,
      comparison_id: row.comparison_id,
      retry_count: 0,
      max_retries: 0,
    }));
  }

  private async claimNextJob(): Promise<QueuedJob | null> {
    // Compare jobs are handled by processCompareJobsConcurrently().
    if (NON_COMPARE_ALLOWED_KIND_LIST.length === 0) {
      return null;
    }

    const updateResult = await pool.query(`
      WITH next_job AS (
        SELECT id
        FROM jobs
        WHERE status = 'queued' AND kind != 'pdf_export'
          AND kind = ANY($4::text[])
        ORDER BY (CASE kind WHEN 'materialize' THEN 0 WHEN 'checks' THEN 1 WHEN 'vision_review' THEN 2 WHEN 'parse' THEN 3 WHEN 'compare' THEN 4 ELSE 9 END) ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE jobs j
      SET status = 'running',
          started_at = NOW(),
          step_code = $1,
          step_name = $2,
          progress = $3
      FROM next_job n
      WHERE j.id = n.id
      RETURNING j.id, j.report_id, j.version_id, j.kind, j.comparison_id, j.retry_count, j.max_retries
    `,
      [STEPS.PARSING.code, STEPS.PARSING.name, STEPS.PARSING.progress, NON_COMPARE_ALLOWED_KIND_LIST]);

    const updatedJobs = updateResult.rows;

    if (!updatedJobs.length) {
      return null;
    }

    const jobRow = updatedJobs[0] as {
      id: number;
      report_id?: number;
      version_id?: number;
      kind?: string;
      comparison_id?: number;
      retry_count?: number;
      max_retries?: number;
    };

    let storagePath: string | undefined;
    let fileHash: string | undefined;
    if ((jobRow.kind || 'parse') === 'parse' && jobRow.version_id) {
      const result = await pool.query(
        'SELECT storage_path, file_hash FROM report_versions WHERE id = $1 LIMIT 1',
        [jobRow.version_id]);
      const versionRow = result.rows[0];
      storagePath = versionRow?.storage_path;
      fileHash = versionRow?.file_hash;
    }

    return {
      id: jobRow.id,
      report_id: jobRow.report_id ?? null,
      version_id: jobRow.version_id ?? null,
      kind: jobRow.kind || 'parse',
      retry_count: jobRow.retry_count ?? 0,
      storage_path: storagePath,
      file_hash: fileHash,
      comparison_id: jobRow.comparison_id ?? null,
      max_retries: Number(jobRow.max_retries ?? 0),
    } as QueuedJob;
  }

  private async processMaterializeJob(job: QueuedJob): Promise<void> {
    if (!job.version_id || !job.report_id) {
      throw new Error('Materialize job missing version_id or report_id');
    }

    const currentResult = await parseRunService.getCurrentParsedResult(job.version_id);

    if (!currentResult) {
      throw new Error('Version not found');
    }

    if (!currentResult.parsedJson) {
      throw new LlmProviderError('parsed_json is empty, cannot materialize', 'PARSED_JSON_EMPTY');
    }

    const materializeResult = await materializeService.materializeVersion(job.version_id);

    if (!materializeResult.success) {
      throw new Error(`Materialization failed: ${materializeResult.error}`);
    }

    if ((materializeResult.factsCreated ?? 0) <= 0) {
      throw new LlmProviderError(
        `Materialization produced empty facts (version=${job.version_id})`,
        'MATERIALIZE_EMPTY_FACTS'
      );
    }

    const versionStatusRes = await pool.query(
      `SELECT review_status FROM report_versions WHERE id = $1 LIMIT 1`,
      [job.version_id]
    );
    const reportVersionRes = await pool.query(
      `SELECT active_version_id FROM reports WHERE id = $1 LIMIT 1`,
      [job.report_id]
    );
    const reviewStatus = String(versionStatusRes.rows[0]?.review_status || 'pending_review');
    const isCurrentActiveVersion = Number(reportVersionRes.rows[0]?.active_version_id || 0) === job.version_id;
    const shouldPromote = reviewStatus === 'published';
    let promoted = false;

    if (shouldPromote) {
      const updateRes = await pool.query(
        `UPDATE reports
         SET active_version_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [job.version_id, job.report_id]
      );
      promoted = (updateRes.rowCount ?? 0) > 0;
      if (promoted) {
        console.log(`[Job ${job.id}] Published version ${job.version_id} is now active for report ${job.report_id}`);
      }
    } else if (isCurrentActiveVersion) {
      console.log(`[Job ${job.id}] Materialized active version ${job.version_id}; refreshing GovInsight stats immediately.`);
    } else {
      console.log(`[Job ${job.id}] Materialized candidate version ${job.version_id}; awaiting manual review before publish.`);
    }

    await pool.query(
      `UPDATE jobs
         SET status = 'succeeded',
             progress = $1,
             step_code = $2,
             step_name = $3,
             error_code = NULL,
             error_message = NULL,
             finished_at = NOW()
         WHERE id = $4`,
      [STEPS.DONE.progress, STEPS.DONE.code, STEPS.DONE.name, job.id]
    );

    const shouldRefreshGovInsightStats = promoted || isCurrentActiveVersion;

    if (job.ingestion_batch_id) {
      await ingestionBatchService.updateBatchStats(Number(job.ingestion_batch_id));
    }

    if (shouldRefreshGovInsightStats) {
      await govInsightStatsService.refreshAnnualStats({
        reason: 'single_upload',
        reportId: job.report_id ?? undefined,
        versionId: job.version_id ?? undefined,
      });
    }

    const checksResult = await pool.query(
      `SELECT id FROM jobs WHERE report_id = $1 AND version_id = $2 AND kind = 'checks' AND status IN ('queued', 'running') LIMIT 1`,
      [job.report_id, job.version_id]
    );
    const existingChecksJob: { id?: number } | undefined = checksResult.rows[0];

    if (!existingChecksJob?.id) {
      let ingestionBatchId: number | null = null;
      const result = await pool.query(
        `SELECT ingestion_batch_id FROM report_versions WHERE id = $1 LIMIT 1`,
        [job.version_id]
      );
      ingestionBatchId = result.rows[0]?.ingestion_batch_id ?? null;

      await pool.query(
        `INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, max_retries, ingestion_batch_id)
           VALUES ($1, $2, 'checks', 'queued', 60, $3, $4, 0, $5)`,
        [job.report_id, job.version_id, STEPS.POSTPROCESS.code, '等待校验', ingestionBatchId]
      );
    }
  }

  private async processChecksJob(job: QueuedJob): Promise<void> {
    if (!job.version_id) {
      throw new Error('Checks job missing version_id');
    }

    const currentResult = await parseRunService.getCurrentParsedResult(job.version_id);

    if (!currentResult) {
      throw new Error('Version not found');
    }

    if (!currentResult.parsedJson) {
      throw new LlmProviderError('parsed_json is empty, cannot run checks', 'PARSED_JSON_EMPTY');
    }

    // Run consistency checks
    let consistencyItems: any[] = [];
    try {
      const { runId, items } = await consistencyCheckService.runAndPersist(job.version_id, currentResult.parsedJson);
      consistencyItems = items;
      console.log(`[Job ${job.id}] Consistency checks completed: runId=${runId}, items=${items.length}`);
    } catch (error) {
      console.error(`[Job ${job.id}] Consistency check failed:`, error);
      throw error;
    }

    if (job.report_id) {
      try {
        const queuedCount = await visionReviewService.enqueueForConsistencyItems(
          job.report_id,
          job.version_id,
          consistencyItems
        );
        if (queuedCount > 0) {
          console.log(`[Job ${job.id}] Queued ${queuedCount} table visual review item(s).`);
        }
      } catch (error) {
        console.warn(`[Job ${job.id}] Failed to enqueue visual review:`, error);
      }
    }

    // Check if we need to generate notification (after all jobs complete)
    if (job.version_id) {
      await this.generateNotificationIfNeeded(job.version_id);

      const wasAutoPublished = await this.autoPublishCleanVersion(job.version_id, job.report_id);
      const publishState = wasAutoPublished
        ? { reviewStatus: 'published', isPublishedCurrent: true }
        : await this.getVersionPublishState(job.version_id, job.report_id);
      if (publishState.isPublishedCurrent) {
        // Auto-trigger comparison only after a version is formally published.
        try {
          console.log(`[Job ${job.id}] Attempting to trigger auto-comparison for published version...`);
          await this.triggerAutoComparison(job.version_id, job.report_id);
        } catch (err) {
          // Log error but don't fail the check job itself, as checks technically passed
          console.error(`[Job ${job.id}] Auto-comparison trigger failed:`, err);
        }
      } else {
        console.log(`[Job ${job.id}] Skip auto-comparison because version ${job.version_id} is still pending review.`);
      }
    }

    await pool.query(`
        UPDATE jobs 
        SET status = 'succeeded', 
            progress = $1,
            step_code = $2,
            step_name = $3,
            error_code = NULL,
            error_message = NULL,
            finished_at = NOW() 
        WHERE id = $4`,
      [STEPS.DONE.progress, STEPS.DONE.code, STEPS.DONE.name, job.id]);
  }

  private async processVisionReviewJob(job: QueuedJob): Promise<void> {
    if (!job.version_id) {
      throw new Error('Vision review job missing version_id');
    }

    const results = await visionReviewService.processQueuedReviewsForVersion(job.version_id);
    console.log(`[Job ${job.id}] Vision review completed: items=${results.length}`);

    await pool.query(`
        UPDATE jobs
        SET status = 'succeeded',
            progress = $1,
            step_code = $2,
            step_name = $3,
            error_code = NULL,
            error_message = NULL,
            finished_at = NOW()
        WHERE id = $4`,
      [STEPS.DONE.progress, STEPS.DONE.code, STEPS.DONE.name, job.id]);
  }

  private async processCompareJob(job: QueuedJob): Promise<void> {
    if (!job.comparison_id) {
      throw new Error('Compare job missing comparison_id');
    }

    const result = await pool.query(
      `SELECT id, left_report_id, right_report_id FROM comparisons WHERE id = $1 LIMIT 1`,
      [job.comparison_id]);
    const comparison: any = result.rows[0];

    if (!comparison) {
      throw new Error('comparison_not_found');
    }

    console.log(`[Job ${job.id}] Running comparison ${comparison.id} for reports ${comparison.left_report_id} <-> ${comparison.right_report_id}...`);

    // Get JSON data for both versions
    const leftVersion = await this.loadActiveParsedVersionForCompare(Number(comparison.left_report_id), 'left');
    const rightVersion = await this.loadActiveParsedVersionForCompare(Number(comparison.right_report_id), 'right');

    const leftJson = leftVersion.parsedJson;
    const rightJson = rightVersion.parsedJson;

    // 1. Calculate Diff
    const diff = summarizeDiff(leftJson, rightJson);

    // 2. Calculate text similarity and data linkage check status using proper text analysis
    const metrics = calculateReportMetrics(leftJson, rightJson);
    const similarity = metrics.similarity;
    const checkStatus = metrics.checkStatus || '正常';

    // 3. Save Results
    await pool.query(
      'INSERT INTO comparison_results (comparison_id, diff_json) VALUES ($1, $2) ON CONFLICT (comparison_id) DO UPDATE SET diff_json = $2, created_at = NOW()',
      [comparison.id, JSON.stringify(diff)]
    );

    await pool.query(
      `UPDATE comparisons SET similarity = $1, check_status = $2, updated_at = NOW() WHERE id = $3`,
      [similarity, checkStatus, comparison.id]
    );

    await pool.query(`
      UPDATE jobs 
      SET status = 'succeeded', 
          progress = $1,
          step_code = $2,
          step_name = $3,
          finished_at = NOW() 
      WHERE id = $4`,
      [STEPS.DONE.progress, STEPS.DONE.code, STEPS.DONE.name, job.id]);
  }

  private parseJsonValue(value: any): any {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === 'object') {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  private async loadActiveParsedVersionForCompare(
    reportId: number,
    side: 'left' | 'right'
  ): Promise<{ versionId: number; parsedJson: any }> {
    const versionRes = await pool.query(
      `SELECT rv.id AS version_id, rv.parsed_json
       FROM reports r
       JOIN report_versions rv ON rv.id = r.active_version_id
       WHERE r.id = $1
       LIMIT 1`,
      [reportId]
    );
    const version = versionRes.rows[0];

    if (!version?.version_id) {
      throw new LlmProviderError(
        `comparison ${side} report ${reportId} has no published active version`,
        'PARSE_NOT_READY'
      );
    }

    const parsedJson = this.parseJsonValue(version.parsed_json);
    if (!hasParsedContent(parsedJson)) {
      throw new LlmProviderError(
        `comparison ${side} report ${reportId} active version ${version.version_id} has empty parsed content`,
        'PARSED_JSON_EMPTY'
      );
    }

    return {
      versionId: Number(version.version_id),
      parsedJson,
    };
  }

  private async hasParsedJsonColumn(): Promise<boolean> {
    if (this.parsedJsonColumnExists !== null) {
      return this.parsedJsonColumnExists;
    }

    const result = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'report_versions' AND column_name = 'parsed_json'
    `);
    this.parsedJsonColumnExists = result.rows.length > 0;
    return this.parsedJsonColumnExists;
  }

  private async hasRawTextColumn(): Promise<boolean> {
    if (this.rawTextColumnExists !== null) {
      return this.rawTextColumnExists;
    }

    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'report_versions' AND column_name = 'raw_text'
    `);
    this.rawTextColumnExists = result.rows.length > 0;
    return this.rawTextColumnExists;
  }

  private resolveConsensusVerifierConfig(primaryProvider: string, primaryModel: string): { provider: string; model: string } {
    const provider = (process.env.LLM_PARSE_CONSENSUS_PROVIDER || primaryProvider).trim().toLowerCase();
    const model = (process.env.LLM_PARSE_CONSENSUS_MODEL || primaryModel).trim();

    if (!provider) {
      throw new LlmProviderError('LLM parse consensus verifier provider is empty', 'PARSE_CONSENSUS_CONFIG_INVALID');
    }

    if (!model) {
      throw new LlmProviderError('LLM parse consensus verifier model is empty', 'PARSE_CONSENSUS_CONFIG_INVALID');
    }

    return { provider, model };
  }

  private stringifyOutput(result: LlmParseResult): string {
    if (typeof result.output === 'string') {
      return result.output;
    }
    return JSON.stringify(result.output, null, 2);
  }

  private normalizeError(error: any): { code: string; message: string } {
    const message = error instanceof Error ? error.message : String(error);
    let code = 'UNKNOWN_ERROR';
    if (error instanceof LlmProviderError) {
      code = error.code || 'UNKNOWN_ERROR';
    } else if (message.toLowerCase().includes('enoent') || message.toLowerCase().includes('no such file or directory')) {
      code = 'SOURCE_FILE_MISSING';
    } else if (message.includes('timeout')) {
      code = 'TIMEOUT';
    } else if (message.includes('network')) {
      code = 'NETWORK_ERROR';
    } else if (message.includes('json')) {
      code = 'JSON_PARSE_ERROR';
    }
    return { code, message };
  }

  /**
   * IMPORTANT: Notifications should trigger ONLY when all 3 jobs are done:
   * 1. PARSE (is parsed)
   * 2. MATERIALIZE (is materialized)
   * 3. CHECKS (consistency checks pass)
   *
   * But checks can be long running or fail independently.
   * Current Logic: Trigger when Parsing + Materialization is done.
   *
   * Checks job is subsequent.
   */
  private async generateNotificationIfNeeded(versionId: number): Promise<void> {
    // Check if main parsing job is done
    const parseJobRes = await pool.query(
      `SELECT status FROM jobs WHERE version_id = $1 AND kind = 'parse' ORDER BY created_at DESC LIMIT 1`,
      [versionId]
    );

    if (parseJobRes.rows[0]?.status !== 'succeeded') {
      return; // Not ready
    }

    // Check if materialized job exists and is done
    const matJobRes = await pool.query(
      `SELECT status FROM jobs WHERE version_id = $1 AND kind = 'materialize' ORDER BY created_at DESC LIMIT 1`,
      [versionId]
    );

    // If materialize job exists but not succeeded, wait.
    if (matJobRes.rows.length > 0 && matJobRes.rows[0].status !== 'succeeded') {
      return;
    }
    const visionJobRes = await pool.query(
      `SELECT status FROM jobs WHERE version_id = $1 AND kind = 'vision_review' ORDER BY created_at DESC LIMIT 1`,
      [versionId]
    );
    if (visionJobRes.rows.length > 0 && !['succeeded', 'failed', 'cancelled'].includes(String(visionJobRes.rows[0].status))) {
      return;
    }
    // If no materialize job (e.g. legacy), we might proceed, but typically we want it.

    // Get report details
    const reportRes = await pool.query(`
        SELECT r.region_id, r.year, r.unit_name, v.file_name, r.id as report_id
        FROM report_versions v
        JOIN reports r ON v.report_id = r.id
        WHERE v.id = $1
    `, [versionId]);

    const report = reportRes.rows[0];
    if (!report) return;

    // Create Notification
    const title = `解析完成: ${report.unit_name} ${report.year}`;
    const content = JSON.stringify({
      reportId: report.report_id,
      versionId: versionId,
      message: `File ${report.file_name} parsed and materialized successfully.`, 
      timestamp: new Date().toISOString()
    });

    await pool.query(`
        INSERT INTO notifications (type, title, content_json, related_version_id, created_at)
        VALUES ('upload_complete', $1, $2, $3, NOW())
    `, [title, content, versionId]);
  }

  public async triggerAutoComparisonForPublishedVersion(versionId: number, reportId: number | null): Promise<void> {
    if (!reportId) {
      return;
    }
    const publishState = await this.getVersionPublishState(versionId, reportId);
    if (!publishState.isPublishedCurrent) {
      console.log(`[AutoCompare] Skip manual trigger for version ${versionId}: not current published version.`);
      return;
    }
    await this.triggerAutoComparison(versionId, reportId);
  }

  private async countOpenReviewIssues(versionId: number): Promise<number> {
    const result = await pool.query(
      `SELECT COUNT(*) AS count
       FROM report_consistency_items
       WHERE report_version_id = $1
         AND auto_status IN ('FAIL', 'UNCERTAIN')
         AND COALESCE(human_status, 'pending') != 'dismissed'`,
      [versionId]
    );
    return Number(result.rows[0]?.count || 0);
  }

  private async hasConsistencyRun(versionId: number): Promise<boolean> {
    const result = await pool.query(
      `SELECT 1
       FROM report_consistency_runs
       WHERE report_version_id = $1
       LIMIT 1`,
      [versionId]
    );
    return result.rows.length > 0;
  }

  private async hasMaterializedFacts(versionId: number): Promise<boolean> {
    const result = await pool.query(
      `SELECT
         (
           (SELECT COUNT(*) FROM fact_active_disclosure WHERE version_id = $1) +
           (SELECT COUNT(*) FROM fact_application WHERE version_id = $1) +
           (SELECT COUNT(*) FROM fact_legal_proceeding WHERE version_id = $1)
         ) AS fact_count`,
      [versionId]
    );
    return Number(result.rows[0]?.fact_count || 0) > 0;
  }

  private async autoPublishCleanVersion(versionId: number, reportId: number | null): Promise<boolean> {
    if (!AUTO_PUBLISH_CLEAN_UPLOADS || !reportId) {
      return false;
    }

    const versionRes = await pool.query(
      `SELECT id, review_status, state, is_active, parsed_json
       FROM report_versions
       WHERE id = $1 AND report_id = $2
       LIMIT 1`,
      [versionId, reportId]
    );
    const version = versionRes.rows[0];
    if (!version) {
      return false;
    }

    const reviewStatus = String(version.review_status || 'pending_review');
    if (reviewStatus === 'published' && Boolean(version.is_active)) {
      return false;
    }
    if (reviewStatus !== 'pending_review') {
      console.log(`[AutoPublish] Skip version ${versionId}: review_status=${reviewStatus}`);
      return false;
    }

    if (!hasParsedContent(this.parseJsonValue(version.parsed_json))) {
      console.log(`[AutoPublish] Skip version ${versionId}: parsed content is empty.`);
      return false;
    }

    const checksRun = await this.hasConsistencyRun(versionId);
    if (!checksRun) {
      console.log(`[AutoPublish] Skip version ${versionId}: consistency checks have not run.`);
      return false;
    }

    const openIssueCount = await this.countOpenReviewIssues(versionId);
    if (openIssueCount > 0) {
      console.log(`[AutoPublish] Skip version ${versionId}: ${openIssueCount} open review issue(s).`);
      return false;
    }

    const materialized = await this.hasMaterializedFacts(versionId);
    if (!materialized) {
      console.log(`[AutoPublish] Skip version ${versionId}: no materialized facts.`);
      return false;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(
        `UPDATE report_versions
         SET is_active = false,
             updated_at = NOW()
         WHERE report_id = $1`,
        [reportId]
      );

      await client.query(
        `UPDATE report_versions
         SET review_status = 'history',
             updated_at = NOW()
         WHERE report_id = $1
           AND id != $2
           AND review_status IN ('published', 'pending_review')`,
        [reportId, versionId]
      );

      const updateVersionRes = await client.query(
        `UPDATE report_versions
         SET is_active = true,
             review_status = 'published',
             state = 'published',
             approved_at = NOW(),
             approved_by = NULL,
             updated_at = NOW()
         WHERE report_id = $1
           AND id = $2`,
        [reportId, versionId]
      );

      if ((updateVersionRes.rowCount ?? 0) !== 1) {
        await client.query('ROLLBACK');
        return false;
      }

      await client.query(
        `UPDATE reports
         SET active_version_id = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [versionId, reportId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    try {
      await govInsightStatsService.refreshAnnualStats({
        reason: 'single_upload',
        reportId,
        versionId,
      });
    } catch (error) {
      console.warn(`[AutoPublish] Failed to refresh annual stats for report ${reportId}, version ${versionId}:`, error);
    }

    console.log(`[AutoPublish] Published clean version ${versionId} for report ${reportId}.`);
    return true;
  }

  private async getVersionPublishState(
    versionId: number,
    reportId: number | null
  ): Promise<{ reviewStatus: string; isPublishedCurrent: boolean }> {
    if (!reportId) {
      return { reviewStatus: 'pending_review', isPublishedCurrent: false };
    }

    const versionRes = await pool.query(
      `SELECT review_status FROM report_versions WHERE id = $1 LIMIT 1`,
      [versionId]
    );
    const reviewStatus = String(versionRes.rows[0]?.review_status || 'pending_review');

    const reportRes = await pool.query(
      `SELECT active_version_id FROM reports WHERE id = $1 LIMIT 1`,
      [reportId]
    );
    const activeVersionId = Number(reportRes.rows[0]?.active_version_id || 0);

    return {
      reviewStatus,
      isPublishedCurrent: reviewStatus === 'published' && activeVersionId === versionId,
    };
  }

  /**
   * Auto-trigger comparison jobs against neighbor years (previous/next).
   * This is called after consistency checks are done.
   */
  private async triggerAutoComparison(versionId: number, reportId: number | null): Promise<void> {
    if (!reportId) return;

    // 1. Get current report details (region, year)
    const currentRes = await pool.query('SELECT region_id, year, unit_name FROM reports WHERE id = $1', [reportId]);
    const currentReport = currentRes.rows[0];
    if (!currentReport) {
      console.log(`[AutoCompare] Report ${reportId} not found, skipping.`);
      return;
    }

    const currentYear = Number(currentReport.year);
    const neighborYears = [currentYear - 1, currentYear + 1];

    for (const targetYear of neighborYears) {
      if (!Number.isFinite(targetYear)) {
        continue;
      }

      console.log(`[AutoCompare] Triggered for Report ${reportId} (${currentReport.unit_name}, ${currentYear}). Looking for year ${targetYear}...`);

      // 2. Find neighbor year's active report for same region
      const targetRes = await pool.query(`
        SELECT id, active_version_id
        FROM reports
        WHERE region_id = $1 AND year = $2
        ORDER BY (active_version_id IS NOT NULL) DESC, updated_at DESC, id DESC
        LIMIT 1
      `, [currentReport.region_id, targetYear]);

      const targetReport = targetRes.rows[0];
      if (!targetReport?.id || !targetReport.active_version_id) {
        console.log(`[AutoCompare] No active report found for region ${currentReport.region_id} in year ${targetYear}. Skipping comparison.`);
        continue;
      }

      console.log(`[AutoCompare] Found report ${targetReport.id} for year ${targetYear}. Creating comparison job...`);

      // 3. Create or Update Comparison Record
      // We want year_a = min, year_b = max to keep it ordered
      const yearA = Math.min(currentYear, targetYear);
      const yearB = Math.max(currentYear, targetYear);

      if (yearA === yearB) {
        console.log(`[AutoCompare] Skipping same-year comparison for region ${currentReport.region_id}, year ${yearA}`);
        continue;
      }

      const reportA = currentYear < targetYear ? reportId : targetReport.id;
      const reportB = currentYear < targetYear ? targetReport.id : reportId;

      // Upsert comparison
      const compRes = await pool.query(`
        INSERT INTO comparisons (region_id, year_a, year_b, left_report_id, right_report_id, check_status)
        VALUES ($1, $2, $3, $4, $5, 'pending')
        ON CONFLICT (region_id, year_a, year_b)
        DO UPDATE SET left_report_id = $4, right_report_id = $5, check_status = 'pending', updated_at = NOW()
        RETURNING id
      `, [currentReport.region_id, yearA, yearB, reportA, reportB]);

      const comparisonId = compRes.rows[0].id;

      // 4. Enqueue Comparison Job
      // Check if job already exists
      const jobRes = await pool.query(`
        SELECT id FROM jobs
        WHERE comparison_id = $1 AND kind = 'compare' AND status IN ('queued', 'running')
      `, [comparisonId]);

      if (jobRes.rows.length === 0) {
        await pool.query(`
          INSERT INTO jobs (report_id, version_id, kind, status, progress, step_code, step_name, comparison_id)
          VALUES ($1, $2, 'compare', 'queued', 0, 'QUEUED', $4, $3)
        `, [reportId, versionId, comparisonId, STEPS.QUEUED.name]);
        console.log(`[AutoCompare] Enqueued comparison job for comparison ${comparisonId}`);
      }
    }
  }
}

export const llmJobRunner = new LlmJobRunner();

