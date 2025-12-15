import { compareTaskQueue, aiSuggestionQueue, docxExportQueue, batchJobQueue } from '../config/queue';
import TaskService from '../services/TaskService';
import AssetService from '../services/AssetService';
import DiffService from '../services/DiffService';
import SummaryService from '../services/SummaryService';
import DocxExportService from '../services/DocxExportService';
import ExportJobService from '../services/ExportJobService';
import PdfParseService from '../services/PdfParseService';
import StructuringService from '../services/StructuringService';
import PythonTableExtractionService from '../services/PythonTableExtractionService';
import pool from '../config/database';
import * as path from 'path';

/**
 * 合并 Python 提取的表格到文档
 */
const mergeTablesIntoDocument = (document: any, pythonTables: any[]): void => {
  if (!document.sections || !Array.isArray(document.sections)) {
    return;
  }

  for (const table of pythonTables) {
    if (!table.section) continue;

    // 根据 section 找到对应的章节
    const section = document.sections.find((s: any) => s.title?.includes(table.section));
    if (section) {
      if (!section.tables) {
        section.tables = [];
      }
      section.tables.push(table);
    }
  }
};

/**
 * 比对任务处理器
 */
export async function setupCompareTaskProcessor(): Promise<void> {
  // 从环境变量读取并发参数（默认 1）
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);
  
  compareTaskQueue.process(concurrency, async (job) => {
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

      const resultA = await PdfParseService.parsePDF(assetA.storagePath, task.assetId_A);
      const resultB = await PdfParseService.parsePDF(assetB.storagePath, task.assetId_B);

      if (!resultA.success || !resultB.success) {
        throw new Error('PDF解析失败');
      }

      const docA = resultA.document;
      const docB = resultB.document;

      if (!docA || !docB) {
        throw new Error('PDF 解析结果为空');
      }

      await TaskService.updateTaskProgress(taskId, 25);

      // 阶段2: Python 表格提取（接入主链路）
      await TaskService.updateTaskStage(taskId, 'table_extraction');
      await TaskService.updateTaskProgress(taskId, 30);

      const schemaPath = path.join(__dirname, '../schemas/annual_report_table_schema_v2.json');
      const pyTimeoutMs = parseInt(process.env.PY_TABLE_TIMEOUT_MS || '180000', 10);

      console.log(`[Worker] 启动 Python 表格提取 (A)`);
      const pyResultA = await PythonTableExtractionService.extractTablesFromPdf(
        assetA.storagePath,
        schemaPath,
        pyTimeoutMs
      );

      if (pyResultA.success && pyResultA.tables) {
        console.log(`[Worker] Python 表格提取成功 (A): ${pyResultA.tables.length} 张表`);
        if (pyResultA.metrics) {
          console.log(`  耗时: ${pyResultA.metrics.elapsedMs}ms, 置信度: ${pyResultA.metrics.confidence}`);
        }
        // 合并 Python 提取的表格到 docA
        if (docA.sections) {
          mergeTablesIntoDocument(docA, pyResultA.tables);
        }
      } else {
        console.warn(`[Worker] Python 表格提取失败 (A): ${pyResultA.error}`);
        if (pyResultA.warnings) {
          resultA.warnings.push(...pyResultA.warnings);
        }
      }

      console.log(`[Worker] 启动 Python 表格提取 (B)`);
      const pyResultB = await PythonTableExtractionService.extractTablesFromPdf(
        assetB.storagePath,
        schemaPath,
        pyTimeoutMs
      );

      if (pyResultB.success && pyResultB.tables) {
        console.log(`[Worker] Python 表格提取成功 (B): ${pyResultB.tables.length} 张表`);
        if (pyResultB.metrics) {
          console.log(`  耗时: ${pyResultB.metrics.elapsedMs}ms, 置信度: ${pyResultB.metrics.confidence}`);
        }
        // 合并 Python 提取的表格到 docB
        if (docB.sections) {
          mergeTablesIntoDocument(docB, pyResultB.tables);
        }
      } else {
        console.warn(`[Worker] Python 表格提取失败 (B): ${pyResultB.error}`);
        if (pyResultB.warnings) {
          resultB.warnings.push(...pyResultB.warnings);
        }
      }

      // P0-2 修复：合并 Python 表格后必须落盘，保证 /content 接口拿到最新数据
      console.log(`[Worker] 保存合并后的解析数据 (A)`);
      try {
        const ParsedDataStorageService = (await import('../services/ParsedDataStorageService')).default;
        await ParsedDataStorageService.saveParseData(task.assetId_A, docA);
        console.log(`✓ 解析数据已保存 (A)`);
      } catch (error) {
        console.warn(`⚠️ 保存解析数据失败 (A):`, error);
      }

      console.log(`[Worker] 保存合并后的解析数据 (B)`);
      try {
        const ParsedDataStorageService = (await import('../services/ParsedDataStorageService')).default;
        await ParsedDataStorageService.saveParseData(task.assetId_B, docB);
        console.log(`✓ 解析数据已保存 (B)`);
      } catch (error) {
        console.warn(`⚠️ 保存解析数据失败 (B):`, error);
      }

      await TaskService.updateTaskProgress(taskId, 40);

      // 阶段3: 结构化
      await TaskService.updateTaskStage(taskId, 'structuring');
      await TaskService.updateTaskProgress(taskId, 45);

      const structuredResultA = await StructuringService.structureDocument(resultA);
      const structuredResultB = await StructuringService.structureDocument(resultB);

      if (!structuredResultA.document || !structuredResultB.document) {
        throw new Error('文档结构化失败');
      }

      const structuredDocA = structuredResultA.document;
      const structuredDocB = structuredResultB.document;

      await TaskService.updateTaskProgress(taskId, 50);

      // 阶段3: 比对
      await TaskService.updateTaskStage(taskId, 'diffing');
      await TaskService.updateTaskProgress(taskId, 55);

      const diffResult = await DiffService.diffDocuments(structuredDocA, structuredDocB);

      // 保存差异结果到数据库
      await pool.query(
        `
        INSERT INTO diff_results (task_id, diff_result, created_at)
        VALUES ($1, $2, $3)
        ON CONFLICT (task_id) DO UPDATE SET diff_result = $2, updated_at = $3
        `,
        [taskId, JSON.stringify(diffResult), new Date()]
      );

      await TaskService.updateTaskProgress(taskId, 65);

      // 阶段4: 生成摘要
      await TaskService.updateTaskStage(taskId, 'summarizing');
      await TaskService.updateTaskProgress(taskId, 75);

      const summary = SummaryService.generateSummary(diffResult);

      // 保存摘要到任务
      await pool.query(
        `
        UPDATE compare_tasks
        SET summary = $1, updated_at = $2
        WHERE task_id = $3
        `,
        [JSON.stringify(summary), new Date(), taskId]
      );

      await TaskService.updateTaskProgress(taskId, 85);

      // 阶段5: 导出DOCX
      await TaskService.updateTaskStage(taskId, 'exporting');
      await TaskService.updateTaskProgress(taskId, 90);

      const docxPath = await DocxExportService.generateDiffReport(diffResult, summary, {
        title: `${assetA.fileName} vs ${assetB.fileName}`,
      });

      // 创建导出任务记录
      const exportJob = await ExportJobService.createExportJob({
        taskId,
        type: 'diff',
      });

      if (exportJob) {
        await ExportJobService.updateExportJobStatus(
          exportJob.exportId,
          'succeeded',
          docxPath
        );
      }

      // 更新任务为成功
      await TaskService.updateTaskProgress(taskId, 100);
      await TaskService.updateTaskStatus(taskId, 'succeeded');

      console.log(`✓ 比对任务 ${taskId} 处理完成`);
      return { success: true, taskId };
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
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);
  
  aiSuggestionQueue.process(concurrency, async (job) => {
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
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);
  
  docxExportQueue.process(concurrency, async (job) => {
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
  const concurrency = parseInt(process.env.WORKER_CONCURRENCY || '2', 10);
  
  batchJobQueue.process(concurrency, async (job) => {
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
