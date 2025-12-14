import { CompareTask as ICompareTask, Warning, ExportJob } from '../types/models';
import { TaskStatus, ProcessStage } from '../types';

export class CompareTask implements ICompareTask {
  taskId: string = '';
  assetId_A: string = '';
  assetId_B: string = '';
  status: TaskStatus = 'queued';
  stage: ProcessStage = 'ingesting';
  progress: number = 0;
  message?: string;
  warnings: Warning[] = [];
  errorMessage?: string;
  diffResult?: any;
  diffResultPath?: string;
  summary?: any;
  exports: ExportJob[] = [];
  retryOf?: string;
  createdBy: string = '';
  tenantId?: string;
  createdAt: Date = new Date();
  updatedAt: Date = new Date();
  completedAt?: Date;

  constructor(data: Partial<ICompareTask>) {
    Object.assign(this, data);
    this.warnings = data.warnings || [];
    this.exports = data.exports || [];
  }

  isQueued(): boolean {
    return this.status === 'queued';
  }

  isRunning(): boolean {
    return this.status === 'running';
  }

  isCompleted(): boolean {
    return this.status === 'succeeded' || this.status === 'failed';
  }

  isSucceeded(): boolean {
    return this.status === 'succeeded';
  }

  isFailed(): boolean {
    return this.status === 'failed';
  }

  updateProgress(newProgress: number): void {
    if (newProgress < this.progress) {
      throw new Error('Progress cannot decrease');
    }
    if (newProgress > 100) {
      throw new Error('Progress cannot exceed 100');
    }
    this.progress = newProgress;
    this.updatedAt = new Date();
  }

  addWarning(warning: Warning): void {
    this.warnings.push(warning);
    this.updatedAt = new Date();
  }

  addExport(exportJob: ExportJob): void {
    this.exports.push(exportJob);
    this.updatedAt = new Date();
  }

  getExport(type: 'diff' | 'diff_with_ai'): ExportJob | undefined {
    return this.exports.find((e) => e.type === type && e.status === 'succeeded');
  }

  hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  getWarningsByCode(code: string): Warning[] {
    return this.warnings.filter((w) => w.code === code);
  }
}
