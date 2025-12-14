import { BatchJob as IBatchJob, BatchPair, BatchConflict } from '../types/models';
import { TaskStatus, BatchJobRule } from '../types';

export class BatchJob implements IBatchJob {
  batchId: string = '';
  rule: BatchJobRule = 'same-region-cross-year';
  region?: string;
  department?: string;
  pairs: BatchPair[] = [];
  conflicts: BatchConflict[] = [];
  status: TaskStatus = 'queued';
  progress: number = 0;
  taskIds: string[] = [];
  taskResults?: any[];
  createdBy: string = '';
  createdAt: Date = new Date();
  updatedAt: Date = new Date();
  completedAt?: Date;

  constructor(data: Partial<IBatchJob>) {
    Object.assign(this, data);
    this.pairs = data.pairs || [];
    this.conflicts = data.conflicts || [];
    this.taskIds = data.taskIds || [];
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

  getTotalPairs(): number {
    return this.pairs.length;
  }

  getUnpairedCount(): number {
    return this.conflicts.length;
  }

  getPairingRate(): number {
    const total = this.getTotalPairs() + this.getUnpairedCount();
    return total === 0 ? 0 : (this.getTotalPairs() / total) * 100;
  }

  addPair(pair: BatchPair): void {
    this.pairs.push(pair);
    this.updatedAt = new Date();
  }

  addConflict(conflict: BatchConflict): void {
    this.conflicts.push(conflict);
    this.updatedAt = new Date();
  }

  addTaskId(taskId: string): void {
    if (!this.taskIds.includes(taskId)) {
      this.taskIds.push(taskId);
      this.updatedAt = new Date();
    }
  }
}
