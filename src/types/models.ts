import {
  TaskStatus,
  ProcessStage,
  AssetStatus,
  AISuggestionStatus,
  RiskLevel,
  Visibility,
  SourceType,
  ExportType,
  AlignmentQuality,
  DiffType,
  ChangeType,
} from './index';

// 警告信息
export interface Warning {
  code: string;
  message: string;
  stage: string;
  affectedAssetId?: string;
  section?: string;
  tableId?: string;
}

// 年报资产
export interface ReportAsset {
  assetId: string;
  fileName: string;
  fileHash: string;
  fileSize: number;
  storagePath: string;
  sourceType: SourceType;
  sourceUrl?: string;
  year?: number;
  region?: string;
  department?: string;
  reportType?: string;
  tags?: string[];
  status: AssetStatus;
  unusableReason?: string;
  versionGroupId?: string;
  revision?: number;
  supersedesAssetId?: string;
  parseVersion?: string;
  structuredDataPath?: string;
  ownerId: string;
  tenantId?: string;
  visibility: Visibility;
  sharedTo?: string[];
  uploadedBy: string;
  uploadedAt: Date;
  updatedAt: Date;
}

// 比对任务
export interface CompareTask {
  taskId: string;
  assetId_A: string;
  assetId_B: string;
  status: TaskStatus;
  stage: ProcessStage;
  progress: number;
  message?: string;
  warnings: Warning[];
  errorMessage?: string;
  diffResult?: DiffResult;
  diffResultPath?: string;
  summary?: DiffSummary;
  exports: ExportJob[];
  retryOf?: string;
  createdBy: string;
  tenantId?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// 导出任务
export interface ExportJob {
  exportId: string;
  type: ExportType;
  path: string;
  createdAt: Date;
  status: 'succeeded' | 'failed';
  errorMessage?: string;
}

// 差异摘要
export interface DiffSummary {
  topChangedSections: TopChangedSection[];
  statistics: DiffStatistics;
  keyNumberChanges: KeyNumberChange[];
  overallAssessment: string;
}

export interface TopChangedSection {
  sectionName: string;
  totalChangeCount: number;
  changeBreakdown: {
    added: number;
    deleted: number;
    modified: number;
  };
}

export interface DiffStatistics {
  addedParagraphs: number;
  deletedParagraphs: number;
  modifiedParagraphs: number;
  addedTables: number;
  deletedTables: number;
  modifiedTables: number;
}

export interface KeyNumberChange {
  location: string;
  oldValue: string;
  newValue: string;
  changeType: ChangeType;
}

// 差异结果
export interface DiffResult {
  sections: DiffSection[];
}

export interface DiffSection {
  sectionId: string;
  sectionTitle: string;
  level: number;
  paragraphs: DiffParagraph[];
  tables: DiffTable[];
  subsections?: DiffSection[];
}

export interface DiffParagraph {
  id: string;
  type: DiffType;
  before?: string;
  after?: string;
  anchor?: string;
}

export interface DiffTable {
  tableId: string;
  type: DiffType;
  alignmentQuality: AlignmentQuality;
  cellChanges: CellChange[];
}

export interface CellChange {
  rowIndex: number;
  colIndex: number;
  rowLabel?: string;      // 行标签（来自 schema）
  colName?: string;       // 列名（来自 schema）
  type: DiffType;
  before?: string;
  after?: string;
}

// 批量比对任务
export interface BatchJob {
  batchId: string;
  rule: string;
  region?: string;
  department?: string;
  pairs: BatchPair[];
  conflicts: BatchConflict[];
  status: TaskStatus;
  progress: number;
  taskIds: string[];
  taskResults?: BatchTaskResult[];
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface BatchPair {
  assetIdA: string;
  assetIdB: string;
  yearA?: number;
  yearB?: number;
}

export interface BatchConflict {
  assetId: string;
  reason: string;
}

export interface BatchTaskResult {
  taskId: string;
  status: TaskStatus;
  downloadUrl?: string;
}

// AI建议
export interface AISuggestion {
  suggestionId: string;
  compareTaskId: string;
  aiConfigVersion: number;
  status: AISuggestionStatus;
  interpretation?: string;
  suspiciousPoints?: SuspiciousPoint[];
  improvementSuggestions?: string[];
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface SuspiciousPoint {
  location: string;
  description: string;
  riskLevel: RiskLevel;
  recommendation: string;
}

// 结构化文档
export interface StructuredDocument {
  documentId: string;
  assetId: string;
  title: string;
  sections: Section[];
  metadata: DocumentMetadata;
}

export interface Section {
  id: string;
  level: number;
  title: string;
  content: Paragraph[];
  tables: Table[];
  subsections?: Section[];
}

export interface Paragraph {
  id: string;
  text: string;
  type: 'normal' | 'list' | 'quote';
}

export interface Table {
  id: string;
  title?: string;
  rows: TableRow[];
  columns: number;
  pageNumber?: number;
  position?: TablePosition;
}

export interface TableRow {
  id: string;
  rowIndex: number;
  rowLabel?: string;     // 行标签（来自 schema）
  cells: TableCell[];
}

export interface TableCell {
  id: string;
  rowIndex: number;
  colIndex: number;
  colKey?: string;       // 列键（来自 schema）
  colName?: string;      // 列名（来自 schema）
  content: string;
  isHeader?: boolean;
  colspan?: number;
  rowspan?: number;
}

export interface TablePosition {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface DocumentMetadata {
  totalPages: number;
  extractedAt: Date;
  parseVersion: string;
}
