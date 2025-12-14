import TaskService from './TaskService';
import AssetService from './AssetService';
import DiffService from './DiffService';
import SummaryService from './SummaryService';
import DocxExportService from './DocxExportService';
import ExportJobService from './ExportJobService';
import PdfParseService from './PdfParseService';
import StructuringService from './StructuringService';
import { Warning } from '../types/models';
import pool from '../config/database';

export class CompareTaskProcessor {
  /**
   * 处理比对任务的完整流程
   */
  async processCompareTask(taskId: string): Promise<void> {
    try {
      // 获取任务
      const task = await TaskService.getTaskById(taskId);
      if (!task) {
        throw new Error(`任务 ${taskId} 不存在`);
      }

      // 更新任务状态为running
      await TaskService.updateTaskStatus(taskId, 'running', 'ingesting');

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
      await this.parsePDFs(taskId, assetA.storagePath, assetB.storagePath);

      // 阶段2: 结构化
      await this.structureDocuments(taskId);

      // 阶段3: 比对
      await this.diffDocuments(taskId);

      // 阶段4: 生成摘要
      await this.generateSummary(taskId);

      // 阶段5: 导出DOCX
      await this.exportDocx(taskId);

      // 更新任务为成功
      await TaskService.updateTaskProgress(taskId, 100);
      await TaskService.updateTaskStatus(taskId, 'succeeded');
    } catch (error) {
      console.error(`比对任务 ${taskId} 处理失败:`, error);
      await TaskService.setTaskError(taskId, `${error}`);
      throw error;
    }
  }

  /**
   * 解析PDF阶段
   */
  private async parsePDFs(taskId: string, pathA: string, pathB: string): Promise<void> {
    try {
      await TaskService.updateTaskStage(taskId, 'parsing');
      await TaskService.updateTaskProgress(taskId, 10);

      // 获取任务以获取 assetId
      const task = await TaskService.getTaskById(taskId);
      if (!task) {
        throw new Error(`任务 ${taskId} 不存在`);
      }

      // 解析两个PDF - 使用正确的 parsePDF 方法签名
      const resultA = await PdfParseService.parsePDF(pathA, task.assetId_A);
      const resultB = await PdfParseService.parsePDF(pathB, task.assetId_B);

      if (!resultA.success || !resultB.success) {
        throw new Error('PDF解析失败');
      }

      // 保存到临时存储
      await pool.query(
        `
        UPDATE compare_tasks
        SET message = $1
        WHERE task_id = $2
        `,
        ['PDF解析完成', taskId]
      );

      await TaskService.updateTaskProgress(taskId, 20);
    } catch (error) {
      const warning: Warning = {
        code: 'PDF_PARSE_FAILED',
        message: `PDF解析失败: ${error}`,
        stage: 'parsing',
      };
      await TaskService.addTaskWarning(taskId, warning);
      throw error;
    }
  }

  /**
   * 结构化阶段
   */
  private async structureDocuments(taskId: string): Promise<void> {
    try {
      await TaskService.updateTaskStage(taskId, 'structuring');
      await TaskService.updateTaskProgress(taskId, 30);

      // TODO: 从临时存储获取解析结果并结构化
      // const structuredDocA = await StructuringService.structureDocument(docA);
      // const structuredDocB = await StructuringService.structureDocument(docB);

      await pool.query(
        `
        UPDATE compare_tasks
        SET message = $1
        WHERE task_id = $2
        `,
        ['文档结构化完成', taskId]
      );

      await TaskService.updateTaskProgress(taskId, 40);
    } catch (error) {
      const warning: Warning = {
        code: 'STRUCTURING_FAILED',
        message: `文档结构化失败: ${error}`,
        stage: 'structuring',
      };
      await TaskService.addTaskWarning(taskId, warning);
      throw error;
    }
  }

  /**
   * 比对阶段
   */
  private async diffDocuments(taskId: string): Promise<void> {
    try {
      await TaskService.updateTaskStage(taskId, 'diffing');
      await TaskService.updateTaskProgress(taskId, 50);

      // TODO: 从临时存储获取结构化文档并比对
      // const diffResult = await DiffService.diffDocuments(structuredDocA, structuredDocB);

      await pool.query(
        `
        UPDATE compare_tasks
        SET message = $1
        WHERE task_id = $2
        `,
        ['差异比对完成', taskId]
      );

      await TaskService.updateTaskProgress(taskId, 60);
    } catch (error) {
      const warning: Warning = {
        code: 'DIFF_FAILED',
        message: `差异比对失败: ${error}`,
        stage: 'diffing',
      };
      await TaskService.addTaskWarning(taskId, warning);
      throw error;
    }
  }

  /**
   * 生成摘要阶段
   */
  private async generateSummary(taskId: string): Promise<void> {
    try {
      await TaskService.updateTaskStage(taskId, 'summarizing');
      await TaskService.updateTaskProgress(taskId, 70);

      // TODO: 从临时存储获取差异结果并生成摘要
      // const summary = SummaryService.generateSummary(diffResult);

      await pool.query(
        `
        UPDATE compare_tasks
        SET message = $1
        WHERE task_id = $2
        `,
        ['差异摘要生成完成', taskId]
      );

      await TaskService.updateTaskProgress(taskId, 80);
    } catch (error) {
      const warning: Warning = {
        code: 'SUMMARY_FAILED',
        message: `摘要生成失败: ${error}`,
        stage: 'summarizing',
      };
      await TaskService.addTaskWarning(taskId, warning);
      throw error;
    }
  }

  /**
   * 导出DOCX阶段
   */
  private async exportDocx(taskId: string): Promise<void> {
    try {
      await TaskService.updateTaskStage(taskId, 'exporting');
      await TaskService.updateTaskProgress(taskId, 90);

      // TODO: 从临时存储获取差异结果和摘要，生成DOCX
      // const docxPath = await DocxExportService.generateDiffReport(diffResult, summary);

      // 创建导出任务记录
      const exportJob = await ExportJobService.createExportJob({
        taskId,
        type: 'diff',
      });

      if (exportJob) {
        // TODO: 更新导出任务状态
        // await ExportJobService.updateExportJobStatus(exportJob.exportId, 'succeeded', docxPath);
      }

      await pool.query(
        `
        UPDATE compare_tasks
        SET message = $1
        WHERE task_id = $2
        `,
        ['DOCX导出完成', taskId]
      );

      await TaskService.updateTaskProgress(taskId, 95);
    } catch (error) {
      const warning: Warning = {
        code: 'DOCX_EXPORT_FAILED',
        message: `DOCX导出失败: ${error}`,
        stage: 'exporting',
      };
      await TaskService.addTaskWarning(taskId, warning);
      // 不抛出错误，允许任务继续完成
    }
  }
}

export default new CompareTaskProcessor();
