import express, { Request, Response } from 'express';
import pool from '../config/database-llm';

const router = express.Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'error', database: 'unreachable' });
  }
});

router.get('/public-stats', async (_req: Request, res: Response) => {
  try {
    let reportsCount = 0;
    let regionsWithReportsCount = 0;

    const reportsResult = await pool.query('SELECT COUNT(*) as cnt FROM reports');
    // 统计有报告的区域数量（去重）
    const regionsResult = await pool.query('SELECT COUNT(DISTINCT region_id) as cnt FROM reports');
    reportsCount = parseInt(reportsResult.rows[0]?.cnt) || 0;
    regionsWithReportsCount = parseInt(regionsResult.rows[0]?.cnt) || 0;

    res.json({
      reports: reportsCount,
      regions: regionsWithReportsCount
    });
  } catch (error) {
    console.error('Stats check failed:', error);
    // Return zeros on error to allow page to load
    res.json({ reports: 0, regions: 0 });
  }
});

export default router;
