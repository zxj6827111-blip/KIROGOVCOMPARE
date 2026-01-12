import express, { Request, Response } from 'express';
import pool, { dbType } from '../config/database-llm';

const router = express.Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    if (dbType === 'sqlite') {
      if (typeof pool.query === 'function') {
        await pool.query('SELECT 1');
      } else if (typeof pool.execute === 'function') {
        await pool.execute('SELECT 1');
      } else if (typeof pool.run === 'function') {
        await new Promise<void>((resolve, reject) => {
          pool.run('SELECT 1', (err: any) => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else {
        throw new Error('No sqlite execution method available for health check');
      }
    } else {
      await pool.query('SELECT 1');
    }

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

    if (dbType === 'postgres') {
      const reportsResult = await pool.query('SELECT COUNT(*) as cnt FROM reports');
      // 统计有报告的区域数量（去重）
      const regionsResult = await pool.query('SELECT COUNT(DISTINCT region_id) as cnt FROM reports');
      reportsCount = parseInt(reportsResult.rows[0]?.cnt) || 0;
      regionsWithReportsCount = parseInt(regionsResult.rows[0]?.cnt) || 0;
    } else {
      const { querySqlite } = require('../config/sqlite');
      reportsCount = querySqlite('SELECT COUNT(*) as cnt FROM reports')[0]?.cnt || 0;
      // 统计有报告的区域数量（去重）
      regionsWithReportsCount = querySqlite('SELECT COUNT(DISTINCT region_id) as cnt FROM reports')[0]?.cnt || 0;
    }

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
