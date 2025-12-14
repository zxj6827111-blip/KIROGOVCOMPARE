import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import TaskService from '../services/TaskService';
import AssetService from '../services/AssetService';
import FileUploadService from '../services/FileUploadService';
import URLDownloadService from '../services/URLDownloadService';
import { compareTaskQueue } from '../config/queue';

const router = Router();

// 配置 multer 用于文件上传
const uploadDir = path.join(process.cwd(), 'uploads', 'temp');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (_req: any, file: any, cb: any) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
  },
  fileFilter: (_req: any, file: any, cb: any) => {
    if (file.mimetype === 'application/pdf' || file.originalname.endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PDF 文件'));
    }
  },
});

/**
 * 创建比对任务 - 上传方式
 * POST /api/v1/tasks/compare/upload
 */
router.post('/compare/upload', upload.fields([
  { name: 'fileA', maxCount: 1 },
  { name: 'fileB', maxCount: 1 },
]), async (req: Request, res: Response) => {
  try {
    const files = (req as any).files as { [key: string]: any[] };
    const userId = req.headers['x-user-id'] as string || 'anonymous';

    // 验证文件
    if (!files || !files.fileA || !files.fileB) {
      return res.status(400).json({ error: '必须上传两个 PDF 文件' });
    }

    const fileA = files.fileA[0];
    const fileB = files.fileB[0];

    // 上传文件 A
    const resultA = await FileUploadService.uploadFile(
      fileA.path,
      fileA.originalname,
      userId
    );

    if (!resultA.success) {
      // 清理已上传的文件
      fs.unlinkSync(fileA.path);
      fs.unlinkSync(fileB.path);
      return res.status(400).json({ error: `文件 A 上传失败: ${resultA.error}` });
    }

    // 上传文件 B
    const resultB = await FileUploadService.uploadFile(
      fileB.path,
      fileB.originalname,
      userId
    );

    if (!resultB.success) {
      // 清理已上传的文件
      fs.unlinkSync(fileA.path);
      fs.unlinkSync(fileB.path);
      return res.status(400).json({ error: `文件 B 上传失败: ${resultB.error}` });
    }

    // 清理临时文件
    fs.unlinkSync(fileA.path);
    fs.unlinkSync(fileB.path);

    // 创建任务
    const task = await TaskService.createTask({
      assetId_A: resultA.assetId!,
      assetId_B: resultB.assetId!,
      createdBy: userId,
    });

    if (!task) {
      return res.status(500).json({ error: '创建任务失败' });
    }

    // 入队处理
    await compareTaskQueue.add({ taskId: task.taskId });

    res.status(201).json({
      taskId: task.taskId,
      status: task.status,
      assetIdA: task.assetId_A,
      assetIdB: task.assetId_B,
      createdAt: task.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 创建比对任务 - URL方式
 * POST /api/v1/tasks/compare/url
 */
router.post('/compare/url', async (req: Request, res: Response) => {
  try {
    const { urlA, urlB } = req.body;
    const userId = req.headers['x-user-id'] as string || 'anonymous';

    if (!urlA || !urlB) {
      return res.status(400).json({ error: '必须提供两个URL' });
    }

    // 下载文件
    const resultA = await URLDownloadService.downloadFile(urlA, userId);
    const resultB = await URLDownloadService.downloadFile(urlB, userId);

    if (!resultA.success || !resultB.success) {
      return res.status(400).json({
        error: resultA.success ? resultB.error : resultA.error,
      });
    }

    // 创建任务
    const task = await TaskService.createTask({
      assetId_A: resultA.assetId!,
      assetId_B: resultB.assetId!,
      createdBy: userId,
    });

    if (!task) {
      return res.status(500).json({ error: '创建任务失败' });
    }

    // 入队处理
    await compareTaskQueue.add({ taskId: task.taskId });

    res.status(201).json({
      taskId: task.taskId,
      status: task.status,
      assetIdA: task.assetId_A,
      assetIdB: task.assetId_B,
      createdAt: task.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 创建比对任务 - 资产方式
 * POST /api/v1/tasks/compare/asset
 */
router.post('/compare/asset', async (req: Request, res: Response) => {
  try {
    const { assetIdA, assetIdB } = req.body;
    const userId = req.headers['x-user-id'] as string || 'anonymous';

    if (!assetIdA || !assetIdB) {
      return res.status(400).json({ error: '必须提供两个资产ID' });
    }

    // 验证资产存在且可用
    const assetA = await AssetService.getAssetById(assetIdA);
    const assetB = await AssetService.getAssetById(assetIdB);

    if (!assetA || !assetB) {
      return res.status(404).json({ error: '资产不存在' });
    }

    if (!assetA.isUsable() || !assetB.isUsable()) {
      return res.status(400).json({ error: '资产不可用' });
    }

    // 创建任务
    const task = await TaskService.createTask({
      assetId_A: assetIdA,
      assetId_B: assetIdB,
      createdBy: userId,
    });

    if (!task) {
      return res.status(500).json({ error: '创建任务失败' });
    }

    // 入队处理
    await compareTaskQueue.add({ taskId: task.taskId });

    res.status(201).json({
      taskId: task.taskId,
      status: task.status,
      createdAt: task.createdAt,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 查询任务状态
 * GET /api/v1/tasks/:taskId
 */
router.get('/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    const task = await TaskService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    res.json({
      taskId: task.taskId,
      status: task.status,
      stage: task.stage,
      progress: task.progress,
      message: task.message,
      warnings: task.warnings,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 查询任务列表
 * GET /api/v1/tasks
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const status = req.query.status as string;
    const userId = req.headers['x-user-id'] as string || 'anonymous';

    const result = await TaskService.queryTasks({
      status: status as any,
      createdBy: userId,
      page,
      limit,
    });

    res.json({
      tasks: result.tasks.map((t) => ({
        taskId: t.taskId,
        status: t.status,
        createdAt: t.createdAt,
        summary: t.summary,
      })),
      total: result.total,
      page: result.page,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取比对结果
 * GET /api/v1/tasks/:taskId/result
 */
router.get('/:taskId/result', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    const task = await TaskService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    if (task.status !== 'succeeded') {
      return res.status(400).json({ error: '任务未完成' });
    }

    res.json({
      taskId: task.taskId,
      status: task.status,
      summary: task.summary,
      diffResult: task.diffResult,
      docxDownloadUrl: `/api/v1/tasks/${taskId}/download/diff`,
      docxWithAiDownloadUrl: `/api/v1/tasks/${taskId}/download/diff-with-ai`,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取差异结果
 * GET /api/v1/tasks/:taskId/diff
 */
router.get('/:taskId/diff', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    const task = await TaskService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    if (task.status !== 'succeeded') {
      return res.status(400).json({ error: '任务未完成或失败' });
    }

    res.json({
      taskId: task.taskId,
      status: task.status,
      diffResult: task.diffResult || {},
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取摘要信息
 * GET /api/v1/tasks/:taskId/summary
 */
router.get('/:taskId/summary', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    const task = await TaskService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    if (task.status !== 'succeeded') {
      return res.status(400).json({ error: '任务未完成或失败' });
    }

    // 返回摘要数据
    const summary = task.summary || {
      statistics: {
        modifiedParagraphs: 0,
        addedParagraphs: 0,
        deletedParagraphs: 0,
        modifiedTables: 0,
      },
      topChangedSections: [],
      overallAssessment: '暂无评估',
    };

    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 获取对照视图模型（用于前端左右并排展示）
 * GET /api/v1/tasks/:taskId/view-model
 */
router.get('/:taskId/view-model', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    const task = await TaskService.getTaskById(taskId);
    if (!task) {
      return res.status(404).json({ error: '任务不存在' });
    }

    if (task.status !== 'succeeded') {
      return res.status(400).json({ error: '任务未完成' });
    }

    // 获取 DiffViewService 生成的 view-model
    const viewModel = await TaskService.getViewModelForTask(taskId);
    if (!viewModel) {
      return res.status(500).json({ error: '无法生成视图模型' });
    }

    res.json(viewModel);
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 重试任务
 * POST /api/v1/tasks/:taskId/retry
 */
router.post('/:taskId/retry', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const userId = req.headers['x-user-id'] as string || 'anonymous';

    const originalTask = await TaskService.getTaskById(taskId);
    if (!originalTask) {
      return res.status(404).json({ error: '原任务不存在' });
    }

    // 创建新任务
    const newTask = await TaskService.retryTask(taskId, userId);
    if (!newTask) {
      return res.status(500).json({ error: '重试失败' });
    }

    // 入队处理
    await compareTaskQueue.add({ taskId: newTask.taskId });

    res.status(201).json({
      newTaskId: newTask.taskId,
      retryOf: taskId,
      status: newTask.status,
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

/**
 * 删除任务
 * DELETE /api/v1/tasks/:taskId
 */
router.delete('/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    const success = await TaskService.deleteTask(taskId);
    if (!success) {
      return res.status(500).json({ error: '删除失败' });
    }

    res.json({ success: true, message: '任务已删除' });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

export default router;
