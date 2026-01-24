import express from 'express';
import fs from 'fs';
import pool from '../config/database-llm';
import { llmJobRunner } from '../services/LlmJobRunner';
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';

const router = express.Router();
router.use(authMiddleware);

async function getVersionRegionId(versionId: number): Promise<number | null> {
    const res = await pool.query(`
      SELECT r.region_id
      FROM report_versions rv
      JOIN reports r ON rv.report_id = r.id
      WHERE rv.id = $1
      LIMIT 1
    `, [versionId]);
    return res.rows[0]?.region_id ?? null;
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
        const { region_id, year, unit_name, status, page, limit } = req.query;

        // Pagination defaults
        const pageNum = Math.max(1, Number(page) || 1);
        const limitNum = Math.min(100, Math.max(1, Number(limit) || 20));
        const offset = (pageNum - 1) * limitNum;

        // Build WHERE clause
        const conditions: string[] = [];
        const params: any[] = [];
        let paramIndex = 1;

        // Recursive CTE variable (not needed as variable for Postgres if integrated in query)
        // But for cleaner query construction we handle it.
        let withClause = '';

        if (region_id) {
            const regionIdNum = Number(region_id);
            if (Number.isNaN(regionIdNum)) {
                return res.status(400).json({ error: 'Invalid region_id' });
            }
            withClause = `
              WITH RECURSIVE sub_regions(id) AS (
                SELECT id FROM regions WHERE id = $${paramIndex++}
                UNION ALL
                SELECT r.id FROM regions r JOIN sub_regions sr ON r.parent_id = sr.id
              )
            `;
            params.push(regionIdNum);
            conditions.push(`r.region_id IN (SELECT id FROM sub_regions)`);
        }

        if (year) {
            const yearNum = Number(year);
            if (Number.isNaN(yearNum)) {
                return res.status(400).json({ error: 'Invalid year' });
            }
            conditions.push(`r.year = $${paramIndex++}`);
            params.push(yearNum);
        }

        if (unit_name !== undefined && unit_name !== '') {
            // 模糊搜索：单位名称或区域名称包含搜索词
            const searchPattern = `%${String(unit_name)}%`;
            conditions.push(`(
                r.unit_name ILIKE $${paramIndex}
                OR EXISTS (
                    SELECT 1 FROM regions rg
                    WHERE rg.id = r.region_id AND rg.name ILIKE $${paramIndex}
                )
            )`);
            paramIndex++;
            params.push(searchPattern);
        }

        if (status) {
            // Map 'processing' to 'running' for backward compatibility
            const dbStatus = status === 'processing' ? 'running' : status;
            conditions.push(`j.status = $${paramIndex++}`);
            params.push(String(dbStatus));
        }

        // Exclude 'checks' jobs from the main list
        conditions.push(`j.kind != 'checks'`);

        // DATA SCOPE FILTER
        const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
        if (allowedRegionIds) {
            if (allowedRegionIds.length > 0) {
                conditions.push(`r.region_id = ANY($${paramIndex++}::int[])`);
                params.push(allowedRegionIds);
            } else {
                conditions.push('1=0');
            }
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

        // Count total for pagination
        const countQueryParams = [...params]; // Copy params for count query
        const countRes = await pool.query(`
          ${withClause}
          SELECT COUNT(*) as total
          FROM jobs j
          JOIN report_versions rv ON j.version_id = rv.id
          JOIN reports r ON rv.report_id = r.id
          ${whereClause};
        `, countQueryParams);
        const total = parseInt(countRes.rows[0]?.total) || 0;

        // Query jobs
        const queryParams = [...params, limitNum, offset];
        // Note: limit and offset indexes need to be dynamic
        const limitIndex = paramIndex++;
        const offsetIndex = paramIndex++;

        const rowsRes = await pool.query(`
          ${withClause}
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
          LIMIT $${limitIndex} OFFSET $${offsetIndex};
        `, queryParams);

        const rows = rowsRes.rows;

        // Map to response format
        const jobs = rows.map((row: any) => {
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
                step_name: row.step_name || '等待处理',
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
        const versionId = Number(req.params.version_id);
        if (Number.isNaN(versionId)) {
            return res.status(400).json({ error: 'Invalid version_id' });
        }

        // Get version details
        const versionRes = await pool.query(`
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
      WHERE rv.id = $1
      LIMIT 1;
    `, [versionId]);

        const version = versionRes.rows[0];

        if (!version) {
            return res.status(404).json({ error: 'Version not found' });
        }
        const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
        if (!isRegionAllowed(version.region_id, allowedRegionIds)) {
            return res.status(403).json({ error: 'forbidden' });
        }

        // Get all jobs for this version
        const jobsRes = await pool.query(`
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
      WHERE version_id = $1
      ORDER BY created_at ASC;
    `, [versionId]);

        const jobs = jobsRes.rows;

        // Aggregate status
        const aggregatedStatus = determineVersionStatus(jobs);

        // Get current progress
        const currentJob = jobs.find((j: any) => j.status === 'running' || j.status === 'queued') || jobs[jobs.length - 1];

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
            step_name: currentJob?.step_name || '等待处理',
            attempt: currentJob?.attempt || 1,
            provider: currentJob?.provider,
            model: currentJob?.model,
            error_code: currentJob?.error_code,
            error_message: currentJob?.error_message,
            created_at: version.created_at,
            updated_at: version.created_at,
            jobs,
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
        const versionId = Number(req.params.version_id);
        if (Number.isNaN(versionId)) {
            return res.status(400).json({ error: 'Invalid version_id' });
        }
        const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
        const regionId = await getVersionRegionId(versionId);
        if (regionId === null) {
            return res.status(404).json({ error: 'Version not found' });
        }
        if (!isRegionAllowed(regionId, allowedRegionIds)) {
            return res.status(403).json({ error: 'forbidden' });
        }

        // Get running/queued jobs for this version
        const jobsRes = await pool.query(`
      SELECT id, status
      FROM jobs
      WHERE version_id = $1
        AND status IN ('queued', 'running');
    `, [versionId]);
        const jobs = jobsRes.rows;

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
        const versionId = Number(req.params.version_id);
        if (Number.isNaN(versionId)) {
            return res.status(400).json({ error: 'Invalid version_id' });
        }
        const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
        const regionId = await getVersionRegionId(versionId);
        if (regionId === null) {
            return res.status(404).json({ error: 'Version not found' });
        }
        if (!isRegionAllowed(regionId, allowedRegionIds)) {
            return res.status(403).json({ error: 'forbidden' });
        }

        // Get all jobs for this version
        const jobsRes = await pool.query(`
      SELECT id, status, kind
      FROM jobs
      WHERE version_id = $1
      ORDER BY created_at ASC;
    `, [versionId]);
        const jobs = jobsRes.rows;

        if (jobs.length === 0) {
            return res.status(404).json({ error: 'No jobs found for this version' });
        }

        // Check if all jobs are in final failed state
        const hasNonFailed = jobs.some((j: any) => j.status !== 'failed');
        if (hasNonFailed) {
            return res.status(400).json({ error: 'Cannot retry: not all jobs are in failed state' });
        }

        let retryCount = 0;
        const failedJobs = jobs.filter((j: any) => j.status === 'failed' || j.status === 'cancelled');

        if (failedJobs.length === 0) {
            return res.status(400).json({ error: 'No failed or cancelled jobs to retry' });
        }

        for (const job of failedJobs) {
            // Get full details to clone
            const jobDetailsRes = await pool.query('SELECT * FROM jobs WHERE id = $1', [job.id]);
            const jobDetails = jobDetailsRes.rows[0];

            // Insert NEW job
            await pool.query(`
                INSERT INTO jobs (
                    report_id, version_id, kind, status, 
                    progress, step_code, step_name, 
                    created_at, retry_count, max_retries, ingestion_batch_id
                ) VALUES (
                    $1, $2, $3, 'queued', 
                    0, 'QUEUED', '等待处理', 
                    NOW(), 0, 1, $4
                )
            `, [jobDetails.report_id, jobDetails.version_id, jobDetails.kind, jobDetails.ingestion_batch_id || null]);
            retryCount++;
        }

        console.log(`[Retry] Created ${retryCount} new jobs for version ${versionId}`);

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
 */
function determineVersionStatus(jobs: Array<{ status: string; kind: string }>): string {
    if (jobs.length === 0) return 'queued';

    // Assume jobs are ordered by created_at ASC or ID ASC
    const lastJob = jobs[jobs.length - 1];

    if (lastJob.status === 'running') return 'processing';
    if (lastJob.status === 'queued') {
        return 'queued';
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
    await pool.query('DELETE FROM jobs WHERE version_id = $1', [versionId]);

    // 2. Delete parse results
    await pool.query('DELETE FROM report_version_parses WHERE report_version_id = $1', [versionId]);

    // 3. Delete the version itself
    await pool.query('DELETE FROM report_versions WHERE id = $1', [versionId]);
}

/**
 * DELETE /api/jobs/all
 * Delete ALL job history and versions
 */
router.delete('/all', requirePermission('manage_jobs'), async (req, res) => {
    try {
        await pool.query('DELETE FROM jobs');
        await pool.query('DELETE FROM report_version_parses');
        await pool.query('DELETE FROM report_versions');

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
        const { version_ids } = req.body;

        if (!Array.isArray(version_ids) || version_ids.length === 0) {
            return res.status(400).json({ error: 'Invalid or empty version_ids' });
        }

        const ids = version_ids.map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id));
        if (ids.length === 0) {
            return res.status(400).json({ error: 'Invalid or empty version_ids' });
        }

        const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
        if (allowedRegionIds) {
            if (allowedRegionIds.length === 0) {
                return res.status(403).json({ error: 'forbidden' });
            }
            const allowedRes = await pool.query(`
              SELECT rv.id
              FROM report_versions rv
              JOIN reports r ON rv.report_id = r.id
              WHERE rv.id = ANY($1::int[])
                AND r.region_id = ANY($2::int[]);
            `, [ids, allowedRegionIds]);
            const allowedIds = new Set(allowedRes.rows.map((row: any) => row.id));
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
 * DELETE /api/jobs/task/:jobId
 * Delete a specific job/task securely.
 */
router.delete('/task/:jobId', requirePermission('manage_jobs'), async (req, res) => {
    try {
        const jobId = Number(req.params.jobId);
        if (Number.isNaN(jobId)) {
            return res.status(400).json({ error: 'Invalid job_id' });
        }

        const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);

        // 1. Get job details ensuring region permission
        const jobRes = await pool.query(`
            SELECT j.*, r.region_id 
            FROM jobs j
            JOIN reports r ON j.report_id = r.id
            WHERE j.id = $1
        `, [jobId]);
        const jobs = jobRes.rows;

        if (jobs.length === 0) {
            return res.status(404).json({ error: 'Job not found' });
        }
        const job = jobs[0];

        // Check permission
        if (!isRegionAllowed(job.region_id, allowedRegionIds)) {
            return res.status(403).json({ error: 'forbidden' });
        }

        if (job.kind === 'pdf_export') {
            if (job.file_path && fs.existsSync(job.file_path)) {
                try {
                    fs.unlinkSync(job.file_path);
                } catch (e) {
                    console.warn('Failed to delete PDF file:', e);
                }
            }
            await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
            console.log(`[Delete Task] Deleted PDF job ${jobId}`);
        } else {
            if (job.version_id) {
                await deleteVersion(job.version_id);
                console.log(`[Delete Task] Deleted Version ${job.version_id} via job ${jobId}`);
            } else {
                await pool.query('DELETE FROM jobs WHERE id = $1', [jobId]);
                console.log(`[Delete Task] Deleted orphan job ${jobId}`);
            }
        }

        return res.json({ message: 'Task deleted successfully' });
    } catch (error) {
        console.error('Error deleting task:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * DELETE /api/jobs/:version_id
 * Delete a single version
 */
router.delete('/:version_id', requirePermission('manage_jobs'), async (req, res) => {
    try {
        const versionId = Number(req.params.version_id);
        if (Number.isNaN(versionId)) {
            return res.status(400).json({ error: 'Invalid version_id' });
        }
        const allowedRegionIds = await getAllowedRegionIdsAsync((req as AuthRequest).user);
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
