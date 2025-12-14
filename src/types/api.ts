import { CompareTask, ReportAsset, AISuggestion, BatchJob } from './models';

// 创建比对任务响应
export interface CreateTaskResponse {
  taskId: string;
  status: string;
  assetIdA?: string;
  assetIdB?: string;
  createdAt: Date;
}

// 查询任务状态响应
export interface TaskStatusResponse {
  taskId: string;
  status: string;
  stage: string;
  progress: number;
  message?: string;
  warnings: any[];
}

// 获取比对结果响应
export interface GetResultResponse {
  taskId: string;
  status: string;
  summary?: any;
  diffResult?: any;
  docxDownloadUrl?: string;
  docxWithAiDownloadUrl?: string;
}

// 批量上传资产响应
export interface BatchUploadResponse {
  results: UploadResult[];
}

export interface UploadResult {
  fileName: string;
  status: 'success' | 'failed';
  assetId?: string;
  assetStatus?: string;
  duplicateOf?: string;
  reason?: string;
  unusableReason?: string;
}

// 查询资料库响应
export interface QueryAssetsResponse {
  assets: ReportAsset[];
  total: number;
  page: number;
}

// 批量比对预览响应
export interface BatchJobPreviewResponse {
  pairs: any[];
  unpaired: any[];
}

// 批量比对执行响应
export interface BatchJobRunResponse {
  batchId: string;
  taskIds: string[];
  status: string;
}

// 查询批量比对进度响应
export interface BatchJobProgressResponse {
  batchId: string;
  status: string;
  progress: number;
  tasks: any[];
}

// AI建议响应
export interface AISuggestionResponse {
  suggestionId: string;
  status: string;
  compareTaskId: string;
  interpretation?: string;
  suspiciousPoints?: any[];
  improvementSuggestions?: string[];
}

// 错误响应
export interface ErrorResponse {
  code: string;
  message: string;
  details?: any;
}
