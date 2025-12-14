import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import TaskService from '../services/TaskService';
import AISuggestionService from '../services/AISuggestionService';
import AISuggestionCacheService from '../services/AISuggestionCacheService';
import { aiSuggestionQueue } from '../config/queue';

const router = Router();

/**
 * 生成AI建议
 * POST /api/v1/tasks/:taskId/suggestions
 */
router.post('/:taskId/suggestions', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { forceRegenerate } = req.body;

    // 获取任务
    const task = await TaskService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    if (task.status !== 'succeeded') {
      return res.status(400).json({ error: '任务未完成' });
    }

    if (!task.summary) {
      return res.status(400).json({ error: '任务摘要不存在' });
    }

    // 检查缓存
    if (!forceRegenerate) {
      const cached = await AISuggestionCacheService.getCachedSuggestion(
        taskId,
        parseInt(process.env.AI_CONFIG_VERSION || '1')
      );
      if (cached) {
        return res.status(200).json({
          suggestionId: cached.suggestionId,
          status: cached.status,
          compareTaskId: cached.compareTaskId,
          interpretation: cached.interpretation,
          suspiciousPoints: cached.suspiciousPoints,
          improvementSuggestions: cached.improvementSuggestions,
        });
      }
    }

    // 生成建议
    const suggestion = await AISuggestionService.generateSuggestion(
      taskId,
      task.summary,
      { forceRegenerate }
    );

    if (!suggestion) {
      return res.status(500).json({ error: '生成建议失败' });
    }

    // 缓存建议
    await AISuggestionCacheService.cacheSuggestion(
      taskId,
      suggestion.aiConfigVersion,
      suggestion
    );

    res.status(201).json({
      suggestionId: suggestion.suggestionId,
      status: suggestion.status,
      compareTaskId: suggestion.compareTaskId,
      interpretation: suggestion.interpretation,
      suspiciousPoints: suggestion.suspiciousPoints,
      improvementSuggestions: suggestion.improvementSuggestions,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 查询AI建议
 * GET /api/v1/tasks/:taskId/suggestions
 */
router.get('/:taskId/suggestions', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    // 检查缓存
    const cached = await AISuggestionCacheService.getCachedSuggestion(
      taskId,
      parseInt(process.env.AI_CONFIG_VERSION || '1')
    );

    if (!cached) {
      return res.status(404).json({ error: '建议不存在' });
    }

    res.json({
      suggestionId: cached.suggestionId,
      status: cached.status,
      compareTaskId: cached.compareTaskId,
      interpretation: cached.interpretation,
      suspiciousPoints: cached.suspiciousPoints,
      improvementSuggestions: cached.improvementSuggestions,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

export default router;
