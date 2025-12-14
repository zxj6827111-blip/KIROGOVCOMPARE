import { AISuggestion as IAISuggestion, SuspiciousPoint } from '../types/models';
import { AISuggestionStatus } from '../types';

export class AISuggestion implements IAISuggestion {
  suggestionId: string = '';
  compareTaskId: string = '';
  aiConfigVersion: number = 1;
  status: AISuggestionStatus = 'queued';
  interpretation?: string;
  suspiciousPoints?: SuspiciousPoint[];
  improvementSuggestions?: string[];
  errorMessage?: string;
  createdAt: Date = new Date();
  updatedAt: Date = new Date();
  completedAt?: Date;

  constructor(data: Partial<IAISuggestion>) {
    Object.assign(this, data);
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

  getHighRiskPoints(): SuspiciousPoint[] {
    return (this.suspiciousPoints || []).filter((p) => p.riskLevel === 'high');
  }

  getMediumRiskPoints(): SuspiciousPoint[] {
    return (this.suspiciousPoints || []).filter((p) => p.riskLevel === 'medium');
  }

  getLowRiskPoints(): SuspiciousPoint[] {
    return (this.suspiciousPoints || []).filter((p) => p.riskLevel === 'low');
  }
}
