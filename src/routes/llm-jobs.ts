import express, { Request, Response } from 'express';
import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';

const router = express.Router();

router.get('/:id', (req: Request, res: Response) => {
  try {
    const jobId = Number(req.params.id);
    if (!jobId || Number.isNaN(jobId) || !Number.isInteger(jobId) || jobId < 1) {
      return res.status(400).json({ error: 'job_id 无效' });
    }

    ensureSqliteMigrations();

    const job = querySqlite(
      `SELECT id, report_id, version_id, status, created_at, started_at, finished_at, error_code, error_message
       FROM jobs WHERE id = ${sqlValue(jobId)} LIMIT 1;`
    )[0];

    if (!job) {
      return res.status(404).json({ error: 'job 不存在' });
    }

    return res.json({
      id: job.id,
      status: job.status,
      report_id: job.report_id,
      version_id: job.version_id,
      created_at: job.created_at,
      started_at: job.started_at,
      finished_at: job.finished_at,
      error: job.error_message || job.error_code || null,
    });
  } catch (error) {
    console.error('Error fetching job:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
