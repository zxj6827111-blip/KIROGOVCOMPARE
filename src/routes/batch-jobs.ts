import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { batchJobQueue } from '../config/queue';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

/**
 * 批量比对预览
 * POST /api/v1/admin/batch-jobs/preview
 */
router.post('/preview', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { assetIds, rule, region, department } = req.body;

    if (!assetIds || assetIds.length < 2) {
      return res.status(400).json({ error: '至少需要两个资产' });
    }

    // TODO: 实现配对逻辑
    // 根据rule生成配对
    // 返回配对结果和冲突

    res.json({
      pairs: [
        {
          assetIdA: assetIds[0],
          assetIdB: assetIds[1],
          yearA: 2023,
          yearB: 2024,
        },
      ],
      unpaired: [],
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 执行批量比对
 * POST /api/v1/admin/batch-jobs/run
 */
router.post('/run', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { pairs } = req.body;
    const userId = req.user?.id ? String(req.user.id) : 'admin';

    if (!pairs || pairs.length === 0) {
      return res.status(400).json({ error: '必须提供配对列表' });
    }

    // 创建批量任务
    const batchId = `batch_${uuidv4()}`;
    const now = new Date();

    const query = `
      INSERT INTO batch_jobs (
        batch_id, rule, pairs, status, progress, created_by, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

    await pool.query(query, [
      batchId,
      'custom',
      JSON.stringify(pairs),
      'queued',
      0,
      userId,
      now,
      now,
    ]);

    // 入队处理
    await batchJobQueue.add({ batchId });

    res.status(201).json({
      batchId,
      taskIds: [],
      status: 'queued',
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 查询批量比对进度
 * GET /api/v1/admin/batch-jobs/:batchId
 */
router.get('/:batchId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const { batchId } = req.params;

    const result = await pool.query('SELECT * FROM batch_jobs WHERE batch_id = $1', [batchId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: '批量任务不存在' });
    }

    const batch = result.rows[0];

    res.json({
      batchId: batch.batch_id,
      status: batch.status,
      progress: batch.progress,
      tasks: batch.task_results || [],
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

export default router;
