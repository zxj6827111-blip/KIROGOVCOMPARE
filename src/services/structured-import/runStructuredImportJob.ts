/**
 * Worker handler for kind=structured_import.
 * Kept out of LlmJobRunner so the runner only dispatches.
 * Never calls an LLM provider.
 */
import pool from '../../config/database-llm';
import { structuredImportService } from './StructuredImportService';

const STEPS = {
  POSTPROCESS: { code: 'POSTPROCESS', progress: 80 },
  DONE: { code: 'DONE', progress: 100 },
} as const;

export type StructuredImportQueuedJob = {
  id: number;
  report_id: number | null;
  version_id: number | null;
};

export async function runStructuredImportJob(job: StructuredImportQueuedJob): Promise<void> {
  if (!job.version_id || !job.report_id) {
    throw new Error('structured_import job missing version_id or report_id');
  }

  await pool.query(
    `UPDATE jobs
     SET step_code = $1,
         step_name = $2,
         progress = $3,
         provider = COALESCE(provider, 'structured_import'),
         model = COALESCE(model, 'none')
     WHERE id = $4`,
    [STEPS.POSTPROCESS.code, 'structured_import running', STEPS.POSTPROCESS.progress, job.id]
  );

  await structuredImportService.executeImportJob({
    id: job.id,
    report_id: job.report_id,
    version_id: job.version_id,
  });

  await pool.query(
    `UPDATE jobs
     SET status = 'succeeded',
         progress = $1,
         step_code = $2,
         step_name = $3,
         error_code = NULL,
         error_message = NULL,
         finished_at = NOW()
     WHERE id = $4
       AND status IN ('running', 'queued', 'succeeded')`,
    [STEPS.DONE.progress, STEPS.DONE.code, 'structured_import done', job.id]
  );
}
