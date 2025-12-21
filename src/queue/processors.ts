import { compareTaskQueue, aiSuggestionQueue, docxExportQueue, batchJobQueue } from '../config/queue';
import TaskService from '../services/TaskService';
import AssetService from '../services/AssetService';
import DiffService from '../services/DiffService';
import SummaryService from '../services/SummaryService';

import ExportJobService from '../services/ExportJobService';
// Legacy services - commented out as they no longer exist
// import PdfParseService from '../services/PdfParseService';
// import StructuringService from '../services/StructuringService';
import pool from '../config/database';

/**
 * 比对任务处理器
 */
export async function setupCompareTaskProcessor(): Promise<void> {
  compareTaskQueue.process(async (job) => {
    const { taskId } = job.data;

    try {
      // 更新任务状态为running
      await TaskService.updateTaskStatus(taskId, 'running', 'ingesting');

      // 获取任务
      const task = await TaskService.getTaskById(taskId);
      if (!task) {
        throw new Error(`任务 ${taskId} 不存在`);
      }

      // 获取资产
      const assetA = await AssetService.getAssetById(task.assetId_A);
      const assetB = await AssetService.getAssetById(task.assetId_B);

      if (!assetA || !assetB) {
        throw new Error('资产不存在');
      }

      // 检查资产可用性
      if (!assetA.isUsable() || !assetB.isUsable()) {
        throw new Error('资产不可用');
      }

      // 阶段1: 解析PDF
      await TaskService.updateTaskStage(taskId, 'parsing');
      await TaskService.updateTaskProgress(taskId, 15);

      // Legacy services commented out - these no longer exist
      // const resultA = await PdfParseService.parsePDF(assetA.storagePath, task.assetId_A);
      // const resultB = await PdfParseService.parsePDF(assetB.storagePath, task.assetId_B);
      //
      // if (!resultA.success || !resultB.success) {
      //   throw new Error('PDF解析失败');
      // }
      //
      // const docA = resultA.document;
      // const docB = resultB.document;
      //
      // if (!docA || !docB) {
      //   throw new Error('PDF 解析结果为空');
      // }

      await TaskService.updateTaskProgress(taskId, 25);

      // 阶段2: 结构化
      await TaskService.updateTaskStage(taskId, 'structuring');
      await TaskService.updateTaskProgress(taskId, 35);

      // const structuredResultA = await StructuringService.structureDocument(resultA);
      // const structuredResultB = await StructuringService.structureDocument(resultB);
      //
      // if (!structuredResultA.document || !structuredResultB.document) {
      //   throw new Error('文档结构化失败');
      // }
      //
      // const structuredDocA = structuredResultA.document;
      // const structuredDocB = structuredResultB.document;

      // 说明：PdfParseService / StructuringService 已在当前版本移除。
      // 为避免运行时/编译期错误，这里明确标记该队列处理器暂不可用。
      await TaskService.setTaskError(
        taskId,
        'Compare pipeline disabled: PdfParseService/StructuringService not available'
      );
      await TaskService.updateTaskStatus(taskId, 'failed', 'structuring');
      return { success: false, taskId, reason: 'COMPARE_DISABLED' };
    } catch (error) {
      console.error(`比对任务 ${taskId} 处理失败:`, error);
      await TaskService.setTaskError(taskId, `${error}`);
      throw error;
    }
  });

  console.log('✓ Compare task processor registered');
}

/**
 * AI建议处理器
 */
export async function setupAISuggestionProcessor(): Promise<void> {
  aiSuggestionQueue.process(async (job) => {
    const { suggestionId, compareTaskId } = job.data;

    try {
      // TODO: 实现AI建议生成逻辑
      console.log(`Processing AI suggestion ${suggestionId} for task ${compareTaskId}`);

      return { success: true, suggestionId };
    } catch (error) {
      console.error(`AI建议 ${suggestionId} 处理失败:`, error);
      throw error;
    }
  });

  console.log('✓ AI suggestion processor registered');
}

/**
 * DOCX导出处理器
 */
export async function setupDocxExportProcessor(): Promise<void> {
  docxExportQueue.process(async (job) => {
    const { exportId, taskId, includeAiSuggestion } = job.data;

    try {
      // TODO: 实现DOCX导出逻辑
      console.log(`Processing DOCX export ${exportId} for task ${taskId}`);

      return { success: true, exportId };
    } catch (error) {
      console.error(`DOCX导出 ${exportId} 处理失败:`, error);
      throw error;
    }
  });

  console.log('✓ DOCX export processor registered');
}

/**
 * 批量比对处理器
 */
export async function setupBatchJobProcessor(): Promise<void> {
  batchJobQueue.process(async (job) => {
    const { batchId } = job.data;

    try {
      // TODO: 实现批量比对逻辑
      console.log(`Processing batch job ${batchId}`);

      return { success: true, batchId };
    } catch (error) {
      console.error(`批量比对 ${batchId} 处理失败:`, error);
      throw error;
    }
  });

  console.log('✓ Batch job processor registered');
}

/**
 * 初始化所有处理器
 */
export async function setupAllProcessors(): Promise<void> {
  await setupCompareTaskProcessor();
  await setupAISuggestionProcessor();
  await setupDocxExportProcessor();
  await setupBatchJobProcessor();
  console.log('✓ All queue processors initialized');
}
