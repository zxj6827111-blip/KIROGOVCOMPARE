import express, { Request, Response } from 'express';
import pool, { dbType } from '../config/database-llm';

const router = express.Router();

router.get('/health', async (_req: Request, res: Response) => {
  try {
    if (dbType === 'sqlite') {
      await new Promise<void>((resolve, reject) => {
        pool.get('SELECT 1', (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
    } else {
      await pool.query('SELECT 1');
    }

    res.json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(500).json({ status: 'error', database: 'unreachable' });
  }
});

export default router;
