import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { ExportJob } from '../types/models';
import { ExportType } from '../types';

export interface CreateExportJobOptions {
  taskId: string;
  type: ExportType;
}

export class ExportJobService {
  /**
   * 创建导出任务
   */
  async createExportJob(options: CreateExportJobOptions): Promise<ExportJob | null> {
    try {
      const exportId = `export_${uuidv4()}`;
      const now = new Date();

      const query = `
        INSERT INTO export_jobs (
          export_id, task_id, export_type, file_path, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;

      const result = await pool.query(query, [
        exportId,
        options.taskId,
        options.type,
        '', // 初始为空，后续更新
        'queued',
        now,
      ]);

      if (result.rows.length > 0) {
        return this.rowToExportJob(result.rows[0]);
      }
    } catch (error) {
      console.error('创建导出任务失败:', error);
    }
    return null;
  }

  /**
   * 获取导出任务
   */
  async getExportJob(exportId: string): Promise<ExportJob | null> {
    try {
      const result = await pool.query('SELECT * FROM export_jobs WHERE export_id = $1', [
        exportId,
      ]);
      if (result.rows.length > 0) {
        return this.rowToExportJob(result.rows[0]);
      }
    } catch (error) {
      console.error('查询导出任务失败:', error);
    }
    return null;
  }

  /**
   * 获取任务的导出任务
   */
  async getTaskExportJobs(taskId: string): Promise<ExportJob[]> {
    try {
      const result = await pool.query(
        'SELECT * FROM export_jobs WHERE task_id = $1 ORDER BY created_at DESC',
        [taskId]
      );
      return result.rows.map((row) => this.rowToExportJob(row));
    } catch (error) {
      console.error('查询任务导出任务失败:', error);
      return [];
    }
  }

  /**
   * 获取特定类型的导出任务
   */
  async getTaskExportJobByType(taskId: string, type: ExportType): Promise<ExportJob | null> {
    try {
      const result = await pool.query(
        'SELECT * FROM export_jobs WHERE task_id = $1 AND export_type = $2 ORDER BY created_at DESC LIMIT 1',
        [taskId, type]
      );
      if (result.rows.length > 0) {
        return this.rowToExportJob(result.rows[0]);
      }
    } catch (error) {
      console.error('查询导出任务失败:', error);
    }
    return null;
  }

  /**
   * 更新导出任务状态
   */
  async updateExportJobStatus(
    exportId: string,
    status: 'succeeded' | 'failed',
    filePath?: string,
    errorMessage?: string
  ): Promise<boolean> {
    try {
      const updates: string[] = ['status = $1', 'updated_at = $2'];
      const params: any[] = [status, new Date()];
      let paramIndex = 3;

      if (filePath) {
        updates.push(`file_path = $${paramIndex}`);
        params.push(filePath);
        paramIndex++;
      }

      if (errorMessage) {
        updates.push(`error_message = $${paramIndex}`);
        params.push(errorMessage);
        paramIndex++;
      }

      params.push(exportId);

      const query = `
        UPDATE export_jobs
        SET ${updates.join(', ')}
        WHERE export_id = $${paramIndex}
      `;

      const result = await pool.query(query, params);
      return result.rowCount! > 0;
    } catch (error) {
      console.error('更新导出任务状态失败:', error);
      return false;
    }
  }

  /**
   * 检查是否存在成功的导出任务
   */
  async hasSuccessfulExport(taskId: string, type: ExportType): Promise<boolean> {
    try {
      const result = await pool.query(
        'SELECT COUNT(*) as count FROM export_jobs WHERE task_id = $1 AND export_type = $2 AND status = $3',
        [taskId, type, 'succeeded']
      );
      return parseInt(result.rows[0].count) > 0;
    } catch (error) {
      console.error('检查导出任务失败:', error);
      return false;
    }
  }

  /**
   * 删除导出任务
   */
  async deleteExportJob(exportId: string): Promise<boolean> {
    try {
      const result = await pool.query('DELETE FROM export_jobs WHERE export_id = $1', [
        exportId,
      ]);
      return result.rowCount! > 0;
    } catch (error) {
      console.error('删除导出任务失败:', error);
      return false;
    }
  }

  /**
   * 删除任务的所有导出任务
   */
  async deleteTaskExportJobs(taskId: string): Promise<boolean> {
    try {
      const result = await pool.query('DELETE FROM export_jobs WHERE task_id = $1', [taskId]);
      return result.rowCount! > 0;
    } catch (error) {
      console.error('删除任务导出任务失败:', error);
      return false;
    }
  }

  private rowToExportJob(row: any): ExportJob {
    return {
      exportId: row.export_id,
      type: row.export_type,
      path: row.file_path,
      createdAt: new Date(row.created_at),
      status: row.status,
      errorMessage: row.error_message,
    };
  }
}

export default new ExportJobService();
