// 任务状态
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

// 处理阶段
export type ProcessStage =
  | 'ingesting'
  | 'downloading'
  | 'parsing'
  | 'structuring'
  | 'diffing'
  | 'summarizing'
  | 'exporting';

// 资产状态
export type AssetStatus = 'usable' | 'unusable';

// AI建议状态
export type AISuggestionStatus = 'queued' | 'running' | 'succeeded' | 'failed';

// 批量比对规则
export type BatchJobRule =
  | 'same-region-cross-year'
  | 'same-department-cross-year'
  | 'custom';

// 风险等级
export type RiskLevel = 'low' | 'medium' | 'high';

// 可见性
export type Visibility = 'private' | 'org' | 'public';

// 来源类型
export type SourceType = 'upload' | 'url';

// 导出类型
export type ExportType = 'diff' | 'diff_with_ai';

// 对齐质量
export type AlignmentQuality = 'perfect' | 'partial' | 'failed';

// 差异类型
export type DiffType = 'added' | 'deleted' | 'modified';

// 变化类型
export type ChangeType = 'increase' | 'decrease' | 'change';
