import express from 'express';
import { dbQuery, ensureDbMigrations } from '../config/db-llm';
import { sqlValue } from '../config/sqlite';
import { llmJobRunner } from '../services/LlmJobRunner';
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/auth';
import { getAllowedRegionIds } from '../utils/dataScope';

const router = express.Router();
router.use(authMiddleware);

async function getVersionRegionId(versionId: number): Promise<number | null> {
    const row = (await dbQuery(`
      SELECT r.region_id
      FROM report_versions rv
      JOIN reports r ON rv.report_id = r.id
      WHERE rv.id = ${sqlValue(versionId)}
      LIMIT 1;
    `))[0] as { region_id?: number } | undefined;
    return row?.region_id ?? null;
}

function isRegionAllowed(regionId: number | null, allowedRegionIds: number[] | null): boolean {
    if (!allowedRegionIds) return true;
    if (!regionId) return false;
    return allowedRegionIds.includes(regionId);
}

/**
 * GET /api/jobs
 * List jobs - each job is a separate record (history mode)
 * Query params: region_id, year, unit_name, status, page, limit
 */
router.get('/', async (req, res) => {
    try {
        ensureDbMigrations();

        const { region_id, year, unit_name, status, page, limit } = req.query;

        // Pagination defaults
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
        const offset = (pageNum - 1) * limitNum;

        // Build WHERE clause
        const conditions: string[] = [];
        // Recursive CTE variable
        let recursiveRegionCTE = '';

        if (region_id) {
            const regionIdNum = Number(region_id);
            if (Number.isNaN(regionIdNum)) {
                return res.status(400).json({ error: 'Invalid region_id' });
            }
            recursiveRegionCTE = `
              WITH RECURSIVE sub_regions(id) AS (
                SELECT id FROM regions WHERE id = ${sqlValue(regionIdNum)}
                UNION ALL
                SELECT r.id FROM regions r JOIN sub_regions sr ON r.parent_id = sr.id
              )
            `;
            conditions.push(`r.region_id IN (SELECT id FROM sub_regions)`);
        }
        if (year) {
            const yearNum = Number(year);
            if (Number.isNaN(yearNum)) {
                return res.status(400).json({ error: 'Invalid year' });
            }
            conditions.push(`r.year = ${sqlValue(yearNum)}`);
        }
        if (unit_name !== undefined && unit_name !== '') {
            conditions.push(`r.unit_name = ${sqlValue(String(unit_name))}`);
        }
        if (status) {
            // Map 'processing' to 'running' for backward compatibility
            const dbStatus = status === 'processing' ? 'running' : status;
            conditions.push(`j.status = ${sqlValue(String(dbStatus))}`);
        }

        // Exclude 'checks' jobs from the main list - they are internal validation tasks
        // This merges parse+checks into a single visual row per upload
        conditions.push(`j.kind != 'checks'`);

        // DATA SCOPE FILTER
        const allowedRegionIds = getAllowedRegionIds((req as AuthRequest).user);
        if (allowedRegionIds) {
            if (allowedRegionIds.length > 0) {
                conditions.push(`r.region_id IN (${allowedRegionIds.join(',')})`);
            } else {
                conditions.push('1=0');
            }
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Count total for pagination
        const countResult = await dbQuery(`
          ${recursiveRegionCTE}
          SELECT COUNT(*) as total
          FROM jobs j
          JOIN report_versions rv ON j.version_id = rv.id
          JOIN reports r ON rv.report_id = r.id
          ${whereClause};
        `) as Array<{ total: number }>;
        const total = countResult[0]?.total || 0;

        // Query jobs as primary table - each job is a separate record
        const rows = await dbQuery(`
          ${recursiveRegionCTE}
          SELECT 
            j.id AS job_id,
            j.version_id,
            j.report_id,
            j.kind,
            j.status,
            j.progress,
            j.step_code,
            j.step_name,
            j.attempt,
            j.provider,
            j.model,
            j.error_code,
            j.error_message,
            j.batch_id,
            j.created_at AS job_created_at,
            j.started_at,
            j.finished_at,
            rv.file_name,
            r.region_id,
            r.year,
            r.unit_name
          FROM jobs j
          JOIN report_versions rv ON j.version_id = rv.id
          JOIN reports r ON rv.report_id = r.id
          ${whereClause}
          ORDER BY j.created_at DESC
          LIMIT ${limitNum} OFFSET ${offset};
        `) as Array<{
            job_id: number;
            version_id: number;
            report_id: number;
            kind: string;
            status: string;
            progress: number;
            step_code: string;
            step_name: string;
            attempt: number;
            provider?: string;
            model?: string;
            error_code?: string;
            error_message?: string;
            batch_id?: string;
            job_created_at: string;
            started_at?: string;
            finished_at?: string;
            file_name: string;
            region_id: number;
            year: number;
            unit_name: string;
        }>;

        // Map to response format
        const jobs = rows.map((row) => {
            // Normalize status for frontend compatibility
            const displayStatus = row.status === 'running' ? 'processing' : row.status;
            return {
                job_id: row.job_id,
                version_id: row.version_id,
                report_id: row.report_id,
                region_id: row.region_id,
                year: row.year,
                unit_name: row.unit_name,
                file_name: row.file_name,
                kind: row.kind,
                status: displayStatus,
                progress: row.progress || 0,
                step_code: row.step_code || 'QUEUED',
                step_name: row.step_name || '绛夊緟澶勭悊',
                attempt: row.attempt || 1,
                provider: row.provider,
                model: row.model,
                error_code: row.error_code,
                error_message: row.error_message,
                batch_id: row.batch_id,
                created_at: row.job_created_at,
                updated_at: row.finished_at || row.started_at || row.job_created_at,
            };
        });

        return res.json({
            jobs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum),
            },
        });
    } catch (error) {
        console.error('Error listing jobs:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


/**
 * GET /api/jobs/:version_id
 * Get aggregated job details for a specific version
 */
router.get('/:version_id', async (req, res) => {
    try {
        ensureDbMigrations();

        const versionId = Number(req.params.version_id);
        if (Number.isNaN(versionId)) {
            return res.status(400).json({ error: 'Invalid version_id' });
        }

        // Get version details
        const version = (await dbQuery(`
      SELECT 
        rv.id AS version_id,
        rv.report_id,
        r.region_id,
        r.year,
        r.unit_name,
        rv.file_name,
        rv.created_at
      FROM report_versions rv
      JOIN reports r ON rv.report_id = r.id
      WHERE rv.id = ${sqlValue(versionId)}
      LIMIT 1;
    `))[0] as {
            version_id: number;
            report_id: number;
            region_id: number;
            year: number;
            unit_name: string;
            file_name: string;
            created_at: string;
        } | undefined;

        if (!version) {
            return res.status(404).json({ error: 'Version not found' });
        }
        const allowedRegionIds = getAllowedRegionIds((req as AuthRequest).user);
        if (!isRegionAllowed(version.region_id, allowedRegionIds)) {
            return res.status(403).json({ error: 'forbidden' });
        }

        // Get all jobs for this version
        const jobs = await dbQuery(`
      SELECT 
        id,
        kind,
        status,
        progress,
        step_code,
        step_name,
        attempt,
        provider,
        model,
        error_code,
        error_message,
        retry_count,
        max_retries,
        created_at,
        started_at,
        finished_at
      FROM jobs
      WHERE version_id = ${sqlValue(versionId)}
      ORDER BY created_at ASC;
    `) as Array<{
            id: number;
            kind: string;
            status: string;
            progress: number;
            step_code: string;
            step_name: string;
            attempt: number;
            provider?: string;
            model?: string;
            error_code?: string;
            error_message?: string;
            retry_count: number;
            max_retries: number;
            created_at: string;
            started_at?: string;
            finished_at?: string;
        }>;

        // Aggregate status
        const aggregatedStatus = determineVersionStatus(jobs);

        // Get current progress (from running/last job)
        const currentJob = jobs.find((j) => j.status === 'running' || j.status === 'queued') || jobs[jobs.length - 1];

        return res.json({
            version_id: version.version_id,
            report_id: version.report_id,
            region_id: version.region_id,
            year: version.year,
            unit_name: version.unit_name,
            file_name: version.file_name,
            status: aggregatedStatus,
            progress: currentJob?.progress || 0,
            step_code: currentJob?.step_code || 'QUEUED',
            step_name: currentJob?.step_name || '绛夊緟澶勭悊',
            attempt: currentJob?.attempt || 1,
            provider: currentJob?.provider,
            model: currentJob?.model,
            error_code: currentJob?.error_code,
            error_message: currentJob?.error_message,
            created_at: version.created_at,
            updated_at: version.created_at,
            jobs, // Include sub-jobs for debugging (optional)
        });
    } catch (error) {
        console.error('Error getting job details:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/jobs/:version_id/cancel
 * Cancel any running or queued jobs for a specific version
 */
router.post('/:version_id/cancel', requirePermission('manage_jobs'), async (req, res) => {
    try {
        ensureDbMigrations();

        const versionId = Number(req.params.version_id);
        if (Number.isNaN(versionId)) {
            return res.status(400).json({ error: 'Invalid version_id' });
        }
        const allowedRegionIds = getAllowedRegionIds((req as AuthRequest).user);
        const regionId = await getVersionRegionId(versionId);
        if (regionId === null) {
            return res.status(404).json({ error: 'Version not found' });
        }
        if (!isRegionAllowed(regionId, allowedRegionIds)) {
            return res.status(403).json({ error: 'forbidden' });
        }

        // Get running/queued jobs for this version
        const jobs = await dbQuery(`
      SELECT id, status
      FROM jobs
      WHERE version_id = ${sqlValue(versionId)}
        AND status IN ('queued', 'running');
    `) as Array<{ id: number; status: string }>;

        if (jobs.length === 0) {
            return res.status(404).json({ error: 'No active jobs found for this version to cancel' });
        }

        let cancelCount = 0;
        for (const job of jobs) {
            const success = await llmJobRunner.cancelJob(job.id);
            if (success) cancelCount++;
        }

        console.log(`[Cancel] Cancelled ${cancelCount} jobs for version ${versionId}`);

        return res.json({
            message: 'Jobs cancelled',
            version_id: versionId,
            cancelled_count: cancelCount,
        });
    } catch (error) {
        console.error('Error cancelling jobs:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/jobs/:version_id/retry
 * Manually retry a failed job
 */
router.post('/:version_id/retry', requirePermission('manage_jobs'), async (req, res) => {
    try {
        ensureDbMigrations();

        const versionId = Number(req.params.version_id);
        if (Number.isNaN(versionId)) {
            return res.status(400).json({ error: 'Invalid version_id' });
        }
        const allowedRegionIds = getAllowedRegionIds((req as AuthRequest).user);
        const regionId = await getVersionRegionId(versionId);
        if (regionId === null) {
            return res.status(404).json({ error: 'Version not found' });
        }
        if (!isRegionAllowed(regionId, allowedRegionIds)) {
            return res.status(403).json({ error: 'forbidden' });
        }

        // Get all jobs for this version
        const jobs = await dbQuery(`
      SELECT id, status, kind
      FROM jobs
      WHERE version_id = ${sqlValue(versionId)}
      ORDER BY created_at ASC;
    `) as Array<{ id: number; status: string; kind: string }>;

        if (jobs.length === 0) {
            return res.status(404).json({ error: 'No jobs found for this version' });
        }

        // Check if all jobs are in final failed state
        const hasNonFailed = jobs.some((j) => j.status !== 'failed');
        if (hasNonFailed) {
            return res.status(400).json({ error: 'Cannot retry: not all jobs are in failed state' });
        }

        // Retry Strategy: Create NEW jobs instead of resetting old ones.
        // This preserves history and fixes the "reuse" issue.

        // 1. Find jobs to retry (usually failed ones, or we just retry the whole flow?)
        // The user usually wants to retry the FAILED step.
        // If 'parse' failed, we assume we need to re-parse.
        // If 'checks' failed, we re-run checks (using existing parse if avail).

        // Simplified: If any job failed, we check what failed and re-queue a FRESH job for it.
        // If multiple failed, we look for the earliest failure point?
        // Actually, usually it's just one active flow.

        // Hard restart: If parsing failed, queue a new Parse job.
        // If parsing succeeded but checks failed (unlikely logic yet), queue Checks.

        // Find the "Comparison" job if it exists? No, just Parse/Checks.

        let retryCount = 0;

        // Re-queue PARSE jobs if they exist and aren't superseded by a success?
        // Actually, just find the failed jobs and 'clone' them as new active jobs.
        const failedJobs = jobs.filter(j => j.status === 'failed' || j.status === 'cancelled'); // Allow retry of cancelled too

        if (failedJobs.length === 0) {
            // If nothing failed, maybe we force a re-run of everything?
            // For now, only retry failed/cancelled.
            return res.status(400).json({ error: 'No failed or cancelled jobs to retry' });
        }

        for (const job of failedJobs) {
            // Get full details to clone
            const jobDetails = (await dbQuery(`SELECT * FROM jobs WHERE id = ${sqlValue(job.id)}`))[0] as any;

            // Insert NEW job
            await dbQuery(`
                INSERT INTO jobs (
                    report_id, version_id, kind, status, 
                    progress, step_code, step_name, 
                    created_at, retry_count, max_retries
                ) VALUES (
                    ${sqlValue(jobDetails.report_id)},
                    ${sqlValue(jobDetails.version_id)},
                    ${sqlValue(jobDetails.kind)},
                    'queued',
                    0,
                    'QUEUED',
                    '绛夊緟澶勭悊',
                    datetime('now'),
                    0,
                    1
                )
            `);
            retryCount++;
        }

        console.log(`[Retry] Created ${retryCount} new jobs for version ${versionId}`);

        console.log(`[Retry] Reset ${jobs.length} jobs for version ${versionId}`);

        return res.json({
            message: 'Jobs reset to queued for retry',
            version_id: versionId,
            jobs_reset: jobs.length,
        });
    } catch (error) {
        console.error('Error retrying jobs:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * Determine the overall status for a version based on its jobs.
 * Logic: Use the status of the LATEST created job.
 * - If latest is 'succeeded', return 'succeeded' (unless a newer job is queued?)
 * - Actually, the jobs are ordered by created_at. The last one represents the current state.
 * - However, we often have a chain: Parse -> Checks.
 * - If Parse Succeeded, Checks Queued -> Latest is Checks (Queued). Overall: Processing/Queued.
 * - If Parse Failed -> Latest is Parse (Failed). Overall: Failed.
 * - If Parse Succeeded, Checks Succeeded -> Latest is Checks (Succeeded). Overall: Succeeded.
 */
function determineVersionStatus(jobs: Array<{ status: string; kind: string }>): string {
    if (jobs.length === 0) return 'queued';

    // Assume jobs are ordered by created_at ASC or ID ASC
    const lastJob = jobs[jobs.length - 1];

    if (lastJob.status === 'running') return 'processing';
    if (lastJob.status === 'queued') {
        // If the last job is 'checks' and it's queued, the user might consider this "Processing" or "Queued"
        // But for consistency with the "Progress" bar (which shows active movement), let's call it queued/processing
        // purely based on the job status.
        return 'queued'; // The main UI will show "鎺掗槦涓?
    }
    if (lastJob.status === 'failed') return 'failed';
    if (lastJob.status === 'succeeded') return 'succeeded';

    return lastJob.status;
}

/**
 * Helper: Delete a specific version and all its related data
 */
async function deleteVersion(versionId: number) {
    // 1. Delete associated jobs
    await dbQuery(`DELETE FROM jobs WHERE version_id = ${sqlValue(versionId)}`);

    // 2. Delete parse results
    await dbQuery(`DELETE FROM report_version_parses WHERE report_version_id = ${sqlValue(versionId)}`);

    // 3. Delete the version itself
    await dbQuery(`DELETE FROM report_versions WHERE id = ${sqlValue(versionId)}`);
}

/**
 * DELETE /api/jobs/all
 * Delete ALL job history and versions
 */
router.delete('/all', requirePermission('manage_jobs'), async (req, res) => {
    try {
        ensureDbMigrations();

        // Delete all jobs, parses, and versions
        // We can just truncate/delete from tables directly for speed, but let's be relational?
        // SQLite doesn't strictly support TRUNCATE with cascade the same way, so DELETE is safer.
        await dbQuery('DELETE FROM jobs');
        await dbQuery('DELETE FROM report_version_parses');
        await dbQuery('DELETE FROM report_versions');
        // Optionally clean reports? No, reports are the "source" (metadata), usually kept?
        // But if versions are gone, reports might be empty shells.
        // For now, only delete the "Task" (Versions + Jobs). 
        // If the user considers "Task" as "Report + Version", we might need to delete reports too?
        // Usually, in this system, "jobs" lists Versions. So deleting versions is sufficient.

        console.log('[Delete All] Cleared all specific job/version history');

        return res.json({ message: 'All jobs deleted' });
    } catch (error) {
        console.error('Error deleting all jobs:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/jobs/batch-delete
 * Delete multiple versions
 */
router.post('/batch-delete', requirePermission('manage_jobs'), async (req, res) => {
    try {
        ensureDbMigrations();
        const { version_ids } = req.body;

        if (!Array.isArray(version_ids) || version_ids.length === 0) {
            return res.status(400).json({ error: 'Invalid or empty version_ids' });
        }

        const ids = version_ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id));
        if (ids.length === 0) {
            return res.status(400).json({ error: 'Invalid or empty version_ids' });
        }

        const allowedRegionIds = getAllowedRegionIds((req as AuthRequest).user);
        if (allowedRegionIds) {
            if (allowedRegionIds.length === 0) {
                return res.status(403).json({ error: 'forbidden' });
            }
            const allowedRows = await dbQuery(`
              SELECT rv.id
              FROM report_versions rv
              JOIN reports r ON rv.report_id = r.id
              WHERE rv.id IN (${ids.join(',')})
                AND r.region_id IN (${allowedRegionIds.join(',')});
            `) as Array<{ id: number }>;
            const allowedIds = new Set(allowedRows.map((row) => row.id));
            if (allowedIds.size !== ids.length) {
                return res.status(403).json({ error: 'forbidden' });
            }
        }

        let count = 0;
        for (const id of ids) {
            const vid = Number(id);
            if (!Number.isNaN(vid)) {
                await deleteVersion(vid);
                count++;
            }
        }

        console.log(`[Batch Delete] Deleted ${count} versions`);
        return res.json({ message: 'Batch delete successful', count });
    } catch (error) {
        console.error('Error batch deleting:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/jobs/:version_id
 * Delete a single version
 */
router.delete('/:version_id', requirePermission('manage_jobs'), async (req, res) => {
    try {
        ensureDbMigrations();
        const versionId = Number(req.params.version_id);
        if (Number.isNaN(versionId)) {
            return res.status(400).json({ error: 'Invalid version_id' });
        }
        const allowedRegionIds = getAllowedRegionIds((req as AuthRequest).user);
        const regionId = await getVersionRegionId(versionId);
        if (regionId === null) {
            return res.status(404).json({ error: 'Version not found' });
        }
        if (!isRegionAllowed(regionId, allowedRegionIds)) {
            return res.status(403).json({ error: 'forbidden' });
        }

        await deleteVersion(versionId);
        console.log(`[Delete] Deleted version ${versionId}`);

        return res.json({ message: 'Job deleted', version_id: versionId });
    } catch (error) {
        console.error('Error deleting job:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

export default router;

