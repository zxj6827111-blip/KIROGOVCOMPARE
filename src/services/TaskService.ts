import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';
import { CompareTask } from '../models';
import { Warning } from '../types/models';
import { TaskStatus, ProcessStage } from '../types';

export interface CreateTaskOptions {
  assetId_A: string;
  assetId_B: string;
  createdBy: string;
  tenantId?: string;
}

export interface QueryTasksOptions {
  status?: TaskStatus;
  createdBy?: string;
  page?: number;
  limit?: number;
}

export interface QueryResult {
  tasks: CompareTask[];
  total: number;
  page: number;
}

export class TaskService {
  async createTask(options: CreateTaskOptions): Promise<CompareTask | null> {
    try {
      const taskId = `task_${uuidv4()}`;
      const now = new Date();

      const query = `
        INSERT INTO compare_tasks (
          task_id, asset_id_a, asset_id_b, status, stage, progress,
          warnings, created_by, tenant_id, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `;

      const result = await pool.query(query, [
        taskId,
        options.assetId_A,
        options.assetId_B,
        'queued',
        'ingesting',
        0,
        JSON.stringify([]),
        options.createdBy,
        options.tenantId,
        now,
        now,
      ]);

      if (result.rows.length > 0) {
        return this.rowToTask(result.rows[0]);
      }
    } catch (error) {
      console.error('创建任务失败:', error);
    }
    return null;
  }

  async getTaskById(taskId: string): Promise<CompareTask | null> {
    try {
      const result = await pool.query('SELECT * FROM compare_tasks WHERE task_id = $1', [
        taskId,
      ]);
      if (result.rows.length > 0) {
        return this.rowToTask(result.rows[0]);
      }
    } catch (error) {
      console.error('查询任务失败:', error);
    }
    return null;
  }

  async queryTasks(options: QueryTasksOptions): Promise<QueryResult> {
    try {
      let query = 'SELECT * FROM compare_tasks WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (options.status) {
        query += ` AND status = $${paramIndex}`;
        params.push(options.status);
        paramIndex++;
      }

      if (options.createdBy) {
        query += ` AND created_by = $${paramIndex}`;
        params.push(options.createdBy);
        paramIndex++;
      }

      // 获取总数
      const countResult = await pool.query(
        `SELECT COUNT(*) as total FROM (${query}) as t`,
        params
      );
      const total = parseInt(countResult.rows[0].total);

      // 分页
      const page = options.page || 1;
      const limit = options.limit || 20;
      const offset = (page - 1) * limit;

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
      params.push(limit, offset);

      const result = await pool.query(query, params);
      const tasks = result.rows.map((row) => this.rowToTask(row));

      return { tasks, total, page };
    } catch (error) {
      console.error('查询任务列表失败:', error);
      return { tasks: [], total: 0, page: 1 };
    }
  }

  async updateTaskStatus(
    taskId: string,
    status: TaskStatus,
    stage?: ProcessStage
  ): Promise<boolean> {
    try {
      const updates: string[] = ['status = $1', 'updated_at = $2'];
      const params: any[] = [status, new Date()];
      let paramIndex = 3;

      if (stage) {
        updates.push(`stage = $${paramIndex}`);
        params.push(stage);
        paramIndex++;
      }

      if (status === 'succeeded' || status === 'failed') {
        updates.push(`completed_at = $${paramIndex}`);
        params.push(new Date());
        paramIndex++;
      }

      params.push(taskId);

      const query = `
        UPDATE compare_tasks
        SET ${updates.join(', ')}
        WHERE task_id = $${paramIndex}
      `;

      const result = await pool.query(query, params);
      return result.rowCount! > 0;
    } catch (error) {
      console.error('更新任务状态失败:', error);
      return false;
    }
  }

  async updateTaskProgress(taskId: string, progress: number): Promise<boolean> {
    try {
      if (progress < 0 || progress > 100) {
        throw new Error('进度必须在0-100之间');
      }

      const result = await pool.query(
        `
        UPDATE compare_tasks
        SET progress = $1, updated_at = $2
        WHERE task_id = $3
        `,
        [progress, new Date(), taskId]
      );
      return result.rowCount! > 0;
    } catch (error) {
      console.error('更新任务进度失败:', error);
      return false;
    }
  }

  async updateTaskStage(taskId: string, stage: ProcessStage): Promise<boolean> {
    try {
      const result = await pool.query(
        `
        UPDATE compare_tasks
        SET stage = $1, updated_at = $2
        WHERE task_id = $3
        `,
        [stage, new Date(), taskId]
      );
      return result.rowCount! > 0;
    } catch (error) {
      console.error('更新任务阶段失败:', error);
      return false;
    }
  }

  async addTaskWarning(taskId: string, warning: Warning): Promise<boolean> {
    try {
      const task = await this.getTaskById(taskId);
      if (!task) {
        return false;
      }

      task.warnings.push(warning);

      const result = await pool.query(
        `
        UPDATE compare_tasks
        SET warnings = $1, updated_at = $2
        WHERE task_id = $3
        `,
        [JSON.stringify(task.warnings), new Date(), taskId]
      );
      return result.rowCount! > 0;
    } catch (error) {
      console.error('添加任务警告失败:', error);
      return false;
    }
  }

  async setTaskError(taskId: string, errorMessage: string): Promise<boolean> {
    try {
      const result = await pool.query(
        `
        UPDATE compare_tasks
        SET status = 'failed', error_message = $1, updated_at = $2, completed_at = $3
        WHERE task_id = $4
        `,
        [errorMessage, new Date(), new Date(), taskId]
      );
      return result.rowCount! > 0;
    } catch (error) {
      console.error('设置任务错误失败:', error);
      return false;
    }
  }

  async retryTask(originalTaskId: string, createdBy: string): Promise<CompareTask | null> {
    try {
      const originalTask = await this.getTaskById(originalTaskId);
      if (!originalTask) {
        return null;
      }

      const newTask = await this.createTask({
        assetId_A: originalTask.assetId_A,
        assetId_B: originalTask.assetId_B,
        createdBy,
        tenantId: originalTask.tenantId,
      });

      if (newTask) {
        // 记录重试关系
        await pool.query(
          `
          UPDATE compare_tasks
          SET retry_of = $1
          WHERE task_id = $2
          `,
          [originalTaskId, newTask.taskId]
        );
      }

      return newTask;
    } catch (error) {
      console.error('重试任务失败:', error);
      return null;
    }
  }

  async deleteTask(taskId: string): Promise<boolean> {
    try {
      // 删除关联的导出任务
      await pool.query('DELETE FROM export_jobs WHERE task_id = $1', [taskId]);

      // 删除关联的AI建议
      await pool.query('DELETE FROM ai_suggestions WHERE compare_task_id = $1', [taskId]);

      // 删除关联的差异结果
      await pool.query('DELETE FROM diff_results WHERE task_id = $1', [taskId]);

      // 删除任务
      const result = await pool.query('DELETE FROM compare_tasks WHERE task_id = $1', [taskId]);

      return result.rowCount! > 0;
    } catch (error) {
      console.error('删除任务失败:', error);
      return false;
    }
  }

  /**
   * 获取任务的对照视图模型（用于前端左右并排展示）
   */
  async getViewModelForTask(taskId: string): Promise<any | null> {
    try {
      const task = await this.getTaskById(taskId);
      if (!task || task.status !== 'succeeded') {
        return null;
      }

      // 从数据库获取差异结果
      const diffResult = await pool.query(
        'SELECT diff_result FROM diff_results WHERE task_id = $1',
        [taskId]
      );

      if (diffResult.rows.length === 0) {
        return null;
      }

      const diffData = diffResult.rows[0].diff_result;

      // 构建视图模型（包含完整的段落和表格，不只是差异）
      const viewModel = {
        taskId,
        sections: diffData.sections || [],
      };

      return viewModel;
    } catch (error) {
      console.error('获取视图模型失败:', error);
      return null;
    }
  }

  private rowToTask(row: any): CompareTask {
    return new CompareTask({
      taskId: row.task_id,
      assetId_A: row.asset_id_a,
      assetId_B: row.asset_id_b,
      status: row.status,
      stage: row.stage,
      progress: row.progress,
      message: row.message,
      warnings: row.warnings || [],
      errorMessage: row.error_message,
      diffResultPath: row.diff_result_path,
      summary: row.summary,
      retryOf: row.retry_of,
      createdBy: row.created_by,
      tenantId: row.tenant_id,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    });
  }
}

export default new TaskService();
