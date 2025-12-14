# 政府信息公开年度报告差异比对系统 - 设计文档

## 概述

本设计文档为政府信息公开年度报告差异比对系统提供详细的架构、数据模型、API规范和实现指导。系统采用微服务架构，支持异步处理、缓存复用和AI建议生成。

## 架构设计

### 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                     前端应用 (Web UI)                        │
│  - 上传/URL输入界面                                          │
│  - 任务历史与详情查看                                        │
│  - 差异结果展示与导出                                        │
│  - AI建议查看与下载                                          │
└────────────────────┬────────────────────────────────────────┘
                     │ HTTP/REST API
┌────────────────────▼────────────────────────────────────────┐
│                   API 网关 & 认证层                          │
│  - 请求路由与限流                                            │
│  - 用户认证与权限检查                                        │
└────────────────────┬────────────────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
┌───────▼──┐  ┌──────▼──┐  ┌─────▼──────┐
│ 任务服务  │  │ 资料库   │  │ AI建议服务  │
│ Service  │  │ Service  │  │ Service    │
└───────┬──┘  └──────┬──┘  └─────┬──────┘
        │            │            │
        └────────────┼────────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
┌───────▼──┐  ┌──────▼──┐  ┌─────▼──────┐
│ 异步队列  │  │ 缓存层   │  │ 文件存储    │
│ (Redis)  │  │ (Redis) │  │ (S3/本地)  │
└──────────┘  └─────────┘  └────────────┘
        │
┌───────▼──────────────────────────────────┐
│         数据库 (PostgreSQL)               │
│  - 任务表、资产表、结果表、建议表         │
└──────────────────────────────────────────┘
```

### 核心模块

1. **任务管理服务** - 处理任务创建、状态管理、异步处理
2. **资料库服务** - 管理年报资产、元数据、可用性校验
3. **解析服务** - PDF解析、结构化、缓存管理
4. **比对服务** - 差异识别、摘要生成
5. **导出服务** - DOCX生成、文件管理
6. **AI建议服务** - 异步生成、缓存管理、版本控制
7. **文件服务** - 上传、下载、存储管理

## 数据模型

### 核心实体

#### 1. Report Asset（年报资产 - 权威定义）

```typescript
interface ReportAsset {
  // 基本信息
  assetId: string;                    // 唯一标识
  fileName: string;                   // 原始文件名
  fileHash: string;                   // SHA256哈希，用于全库去重
  fileSize: number;                   // 文件大小（字节）
  storagePath: string;                // 存储路径
  
  // 来源追溯
  sourceType: 'upload' | 'url';       // 来源类型
  sourceUrl?: string;                 // 原始URL（仅url方式，用于审计与排错）
  
  // 元数据
  year?: number;                      // 年份
  region?: string;                    // 地区
  department?: string;                // 部门/单位
  reportType?: string;                // 报告类型
  tags?: string[];                    // 标签
  
  // 可用性状态
  status: 'usable' | 'unusable';      // 可用性
  unusableReason?: string;            // 不可用原因（加密/损坏/解析失败等）
  
  // 版本链路（用于new-version策略）
  versionGroupId?: string;            // 同一逻辑年报的版本组ID
  revision?: number;                  // 版本号（递增整数）
  supersedesAssetId?: string;         // 新版本指向旧版本的assetId
  
  // 解析缓存
  parseVersion?: string;              // 解析算法版本
  structuredDataPath?: string;        // 结构化数据存储路径（S3/本地）
  
  // 权限与可见性
  ownerId: string;                    // 所有者ID
  tenantId?: string;                  // 租户ID（可选）
  visibility: 'private' | 'org' | 'public';  // 可见性
  sharedTo?: string[];                // 共享给的用户ID列表
  
  // 元数据
  uploadedBy: string;                 // 上传人
  uploadedAt: Date;                   // 上传时间
  updatedAt: Date;                    // 更新时间
}
```

#### 2. Compare Task（比对任务）

```typescript
interface CompareTask {
  taskId: string;                     // 唯一任务ID
  
  // 输入
  assetId_A: string;                  // 第一份资产ID
  assetId_B: string;                  // 第二份资产ID
  
  // 状态管理
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  stage: 'ingesting' | 'downloading' | 'parsing' | 'structuring' | 
         'diffing' | 'summarizing' | 'exporting';
  progress: number;                   // 0-100
  
  // 处理信息
  message?: string;                   // 当前处理消息
  warnings: Warning[];                // 警告列表
  errorMessage?: string;              // 错误信息（仅failed时）
  
  // 结果
  diffResult?: DiffResult;            // 比对结果（内存中）
  diffResultPath?: string;            // 比对结果存储路径（S3/本地）
  summary?: DiffSummary;              // 差异摘要
  
  // 导出产物
  exports: {
    type: 'diff' | 'diff_with_ai';    // 导出类型
    path: string;                     // 文件路径
    createdAt: Date;                  // 生成时间
    status: 'succeeded' | 'failed';   // 导出状态
    errorMessage?: string;            // 导出失败原因
  }[];
  
  // 重试
  retryOf?: string;                   // 重试的原任务ID
  
  // 权限与可见性
  createdBy: string;                  // 创建者ID
  tenantId?: string;                  // 租户ID（可选）
  
  // 元数据
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

interface Warning {
  code: string;                       // 警告代码
  message: string;                    // 警告信息
  stage: string;                      // 所在阶段
  affectedAssetId?: string;           // 受影响的资产ID
  section?: string;                   // 受影响的章节
  tableId?: string;                   // 受影响的表格ID
}
```

#### 3. Diff Summary（差异摘要）

```typescript
interface DiffSummary {
  topChangedSections: {               // 变化最多的章节
    sectionName: string;
    totalChangeCount: number;         // 总变更数
    changeBreakdown: {
      added: number;
      deleted: number;
      modified: number;
    };
  }[];
  
  statistics: {
    addedParagraphs: number;          // 新增段落数
    deletedParagraphs: number;        // 删除段落数
    modifiedParagraphs: number;       // 修改段落数
    addedTables: number;              // 新增表格数
    deletedTables: number;            // 删除表格数
    modifiedTables: number;           // 修改表格数
  };
  
  keyNumberChanges: {                 // 关键数字变化
    location: string;                 // 位置
    oldValue: string;
    newValue: string;
    changeType: 'increase' | 'decrease' | 'change';
  }[];
  
  overallAssessment: string;          // 总体评估
}

interface DiffResult {
  sections: DiffSection[];            // 按章节组织的差异
}

interface DiffSection {
  sectionId: string;
  sectionTitle: string;
  level: number;
  paragraphs: DiffParagraph[];
  tables: DiffTable[];
  subsections?: DiffSection[];
}

interface DiffParagraph {
  id: string;
  type: 'added' | 'deleted' | 'modified';
  before?: string;                    // 修改前内容
  after?: string;                     // 修改后内容
  anchor?: string;                    // 定位锚点
}

interface DiffTable {
  tableId: string;
  type: 'added' | 'deleted' | 'modified';
  alignmentQuality: 'perfect' | 'partial' | 'failed';  // 对齐质量
  cellChanges: {
    rowIndex: number;
    colIndex: number;
    type: 'added' | 'deleted' | 'modified';
    before?: string;
    after?: string;
  }[];
}
```

#### 4. Batch Job（批量比对任务）

```typescript
interface BatchJob {
  batchId: string;                    // 唯一批量任务ID
  
  // 配置
  rule: 'same-region-cross-year' | 'same-department-cross-year' | 'custom';
  region?: string;                    // 地区（当rule包含region时）
  department?: string;                // 部门（当rule包含department时）
  
  // 配对
  pairs: {
    assetIdA: string;
    assetIdB: string;
    yearA?: number;
    yearB?: number;
  }[];
  
  conflicts: {
    assetId: string;
    reason: string;                   // 冲突原因
  }[];
  
  // 状态
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;                   // 0-100
  
  // 结果
  taskIds: string[];                  // 生成的比对任务ID列表
  taskResults?: {
    taskId: string;
    status: 'queued' | 'running' | 'succeeded' | 'failed';
    downloadUrl?: string;
  }[];
  
  // 元数据
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
```

#### 5. AI Suggestion（AI建议）

```typescript
interface AISuggestion {
  suggestionId: string;               // 唯一ID
  compareTaskId: string;              // 关联的比对任务ID
  
  // 版本管理
  aiConfigVersion: number;            // AI配置版本
  
  // 状态
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  
  // 内容
  interpretation?: string;            // 差异点解读
  suspiciousPoints?: {                // 可疑点（需人工复核）
    location: string;
    description: string;
    riskLevel: 'low' | 'medium' | 'high';  // 建议人工复核优先级
    recommendation: string;
  }[];
  
  improvementSuggestions?: string[];  // 规范性改进建议
  
  // 错误处理
  errorMessage?: string;              // 失败原因
  
  // 元数据
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// 注：riskLevel 的含义是"建议人工复核优先级"，措辞保守，不作为事实裁决
```

#### 5. Structured Document（结构化文档）

```typescript
interface StructuredDocument {
  documentId: string;
  assetId: string;
  
  title: string;
  sections: Section[];
  
  metadata: {
    totalPages: number;
    extractedAt: Date;
    parseVersion: string;
  };
}

interface Section {
  id: string;
  level: number;                      // 标题级别 1-6
  title: string;
  content: Paragraph[];
  tables: Table[];
  subsections?: Section[];
}

interface Paragraph {
  id: string;
  text: string;
  type: 'normal' | 'list' | 'quote';
}

interface Table {
  id: string;
  title?: string;
  rows: TableRow[];
  columns: number;
  
  // 定位信息
  pageNumber?: number;
  position?: {
    top: number;
    left: number;
    width: number;
    height: number;
  };
}

interface TableRow {
  id: string;
  rowIndex: number;
  cells: TableCell[];
}

interface TableCell {
  id: string;
  rowIndex: number;
  colIndex: number;
  content: string;
  
  // 单元格属性
  isHeader?: boolean;
  colspan?: number;
  rowspan?: number;
}
```

## API 设计

### 任务管理 API

#### 创建比对任务 - 上传方式

```
POST /api/v1/tasks/compare/upload
Content-Type: multipart/form-data

请求体：
- fileA: File (PDF)
- fileB: File (PDF)

响应：
{
  "taskId": "task_xxx",
  "status": "queued",
  "assetIdA": "asset_a",
  "assetIdB": "asset_b",
  "createdAt": "2025-01-01T00:00:00Z"
}
```

#### 创建比对任务 - URL方式

```
POST /api/v1/tasks/compare/url
Content-Type: application/json

请求体：
{
  "urlA": "https://example.com/report_2024.pdf",
  "urlB": "https://example.com/report_2023.pdf"
}

响应：
{
  "taskId": "task_xxx",
  "status": "queued",
  "assetIdA": "asset_a",
  "assetIdB": "asset_b",
  "createdAt": "2025-01-01T00:00:00Z"
}
```

#### 创建比对任务 - 资产方式

```
POST /api/v1/tasks/compare/asset
Content-Type: application/json

请求体：
{
  "assetIdA": "asset_a",
  "assetIdB": "asset_b"
}

响应：
{
  "taskId": "task_xxx",
  "status": "queued",
  "createdAt": "2025-01-01T00:00:00Z"
}
```

**注：仅支持上述三个独立endpoint，不使用单endpoint + sourceType分流方案**

#### 重试任务

```
POST /api/v1/tasks/{taskId}/retry

响应：
{
  "newTaskId": "task_yyy",
  "retryOf": "task_xxx",
  "status": "queued"
}
```

#### 查询任务列表

```
GET /api/v1/tasks?page=1&limit=20&status=succeeded&sortBy=createdAt

响应：
{
  "tasks": [
    {
      "taskId": "task_xxx",
      "status": "succeeded",
      "createdAt": "2025-01-01T00:00:00Z",
      "summary": { ... }
    }
  ],
  "total": 100,
  "page": 1
}
```

#### 删除任务

```
DELETE /api/v1/tasks/{taskId}

响应：
{
  "success": true,
  "message": "任务已删除"
}
```

#### 查询任务状态

```
GET /api/v1/tasks/{taskId}

响应：
{
  "taskId": "task_xxx",
  "status": "running",
  "stage": "diffing",
  "progress": 65,
  "message": "正在比对差异...",
  "warnings": [
    {
      "code": "TABLE_PARSE_FAILED",
      "message": "表格解析失败",
      "stage": "parsing",
      "affectedAssetId": "asset_a"
    }
  ]
}
```

#### 获取比对结果

```
GET /api/v1/tasks/{taskId}/result

响应：
{
  "taskId": "task_xxx",
  "status": "succeeded",
  "summary": { ... },
  "diffResult": { ... },
  "docxDownloadUrl": "https://api.example.com/v1/tasks/task_xxx/download/diff",
  "docxWithAiDownloadUrl": "https://api.example.com/v1/tasks/task_xxx/download/diff-with-ai"
}
```

#### 触发重新导出DOCX

```
POST /api/v1/tasks/{taskId}/export/docx

请求体：
{
  "includeAiSuggestion": false  // 是否包含AI建议
}

响应：
{
  "taskId": "task_xxx",
  "exportStatus": "queued",
  "message": "DOCX导出已排队"
}

DOCX导出策略：
- 基础报告（diff_report_[taskId].docx）：任务succeeded时自动生成
- AI建议报告（diff_report_with_ai_[taskId].docx）：
  - 仅当AI建议status=succeeded时允许生成
  - 如果AI建议未生成，触发此导出时自动先生成AI建议
  - 生成后可独立下载

幂等性与并发：
- 同一选项重复点击：复用正在进行的导出job
- 不同选项（有/无AI建议）：可并发导出
- 导出失败时：保持任务succeeded，记录warning，允许重新导出
```

#### 下载DOCX报告

```
GET /api/v1/tasks/{taskId}/download/diff
GET /api/v1/tasks/{taskId}/download/diff-with-ai

响应：
- Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
- Content-Disposition: attachment; filename="diff_report_task_xxx.docx"
- 文件流

注：
- 如果DOCX不存在或导出失败，返回404或提示用户重新导出
```

### 资料库 API

#### 批量上传资产

```
POST /api/v1/assets/batch-upload
Content-Type: multipart/form-data

请求体：
- files: File[] (多个PDF)
- deduplicationStrategy: "reuse" | "new-version"  // 默认reuse

响应：
{
  "results": [
    {
      "fileName": "report_2024.pdf",
      "status": "success",
      "assetId": "asset_xxx",
      "assetStatus": "usable",
      "duplicateOf": null
    },
    {
      "fileName": "report_2023.pdf",
      "status": "success",
      "assetId": "asset_yyy",
      "assetStatus": "unusable",
      "unusableReason": "PDF加密，无法读取正文"
    },
    {
      "fileName": "report_2022.pdf",
      "status": "failed",
      "reason": "文件无法落盘（磁盘满）"
    }
  ]
}

注：
- status=success + assetStatus=usable: 正常可用
- status=success + assetStatus=unusable: 文件已入库但不可用（返回assetId便于追溯）
- status=failed: 入库失败（无assetId）
```

#### 查询资料库

```
GET /api/v1/assets?year=2024&region=北京&department=市政府&status=usable&page=1&limit=20

响应：
{
  "assets": [
    {
      "assetId": "asset_xxx",
      "fileName": "report_2024.pdf",
      "year": 2024,
      "region": "北京",
      "department": "市政府",
      "status": "usable",
      "uploadedAt": "2025-01-01T00:00:00Z"
    }
  ],
  "total": 100,
  "page": 1
}
```

#### 更新资产元数据

```
PATCH /api/v1/assets/{assetId}

请求体：
{
  "year": 2024,
  "region": "北京",
  "department": "市政府",
  "reportType": "政府信息公开年报",
  "tags": ["2024", "北京"]
}

响应：
{
  "assetId": "asset_xxx",
  "year": 2024,
  "region": "北京",
  "department": "市政府",
  "revision": 1,
  "updatedAt": "2025-01-01T00:00:00Z"
}
```

#### 管理员批量比对 - 预览

```
POST /api/v1/admin/batch-jobs/preview

请求体：
{
  "assetIds": ["asset_a", "asset_b", "asset_c"],
  "rule": "same-region-cross-year",
  "region": "北京"
}

响应：
{
  "pairs": [
    {
      "assetIdA": "asset_a",
      "assetIdB": "asset_b",
      "yearA": 2023,
      "yearB": 2024
    }
  ],
  "unpaired": [
    {
      "assetId": "asset_c",
      "reason": "缺少配对年份"
    }
  ]
}
```

#### 管理员批量比对 - 执行

```
POST /api/v1/admin/batch-jobs/run

请求体：
{
  "pairs": [
    {
      "assetIdA": "asset_a",
      "assetIdB": "asset_b"
    }
  ]
}

响应：
{
  "batchId": "batch_xxx",
  "taskIds": ["task_1", "task_2"],
  "status": "queued"
}
```

#### 查询批量比对进度

```
GET /api/v1/admin/batch-jobs/{batchId}

响应：
{
  "batchId": "batch_xxx",
  "status": "running",
  "progress": 50,
  "tasks": [
    {
      "taskId": "task_1",
      "status": "succeeded",
      "downloadUrl": "..."
    },
    {
      "taskId": "task_2",
      "status": "running",
      "progress": 75
    }
  ]
}
```

**注：批量比对API统一使用 /api/v1/admin/batch-jobs/ 路径（资源化命名）**

### AI建议 API

#### 生成AI建议

```
POST /api/v1/tasks/{taskId}/suggestions

请求体：
{
  "forceRegenerate": false  // 是否强制重新生成
}

响应：
{
  "suggestionId": "sugg_xxx",
  "status": "queued",
  "compareTaskId": "task_xxx"
}
```

#### 查询AI建议

```
GET /api/v1/tasks/{taskId}/suggestions

响应：
{
  "suggestionId": "sugg_xxx",
  "status": "succeeded",
  "interpretation": "...",
  "suspiciousPoints": [...],
  "improvementSuggestions": [...]
}
```

## 状态机设计

### 任务状态转移

```
┌─────────┐
│ queued  │
└────┬────┘
     │ 开始处理
     ▼
┌─────────┐
│ running │
└────┬────┘
     │
     ├─ 成功 ──────┐
     │             │
     └─ 失败 ──────┤
                   │
            ┌──────▼──────┐
            │ succeeded   │
            │ 或 failed   │
            └─────────────┘

注：重试通过 POST /tasks/{taskId}/retry 创建新任务，不在状态机中回环
```

### 处理阶段流程

```
ingesting/downloading
        │
        ▼
    parsing
        │
        ▼
  structuring
        │
        ▼
    diffing
        │
        ▼
  summarizing
        │
        ▼
   exporting
        │
        ▼
   succeeded/failed
```

### AI建议状态转移

```
┌─────────┐
│ queued  │
└────┬────┘
     │
     ▼
┌─────────┐
│ running │ ◄──────────────┐
└────┬────┘               │
     │                    │ 重试
     ├─ 成功 ──────┐      │
     │             │      │
     └─ 失败 ──────┼──────┘
                   │
            ┌──────▼──────┐
            │ succeeded   │
            │ 或 failed   │
            └─────────────┘
```

## 处理流程

### 比对任务处理流程

```
1. 任务创建
   - 验证输入（文件/URL/资产）
   - 创建/复用资产
   - 创建任务记录
   - 入队异步处理

2. Ingesting/Downloading 阶段
   - 上传：验证文件格式、大小、签名
   - URL：下载文件、校验重定向、验证签名
   - 存储文件到S3/本地

3. Parsing 阶段
   - 检查解析缓存（按assetId）
   - 如果缓存存在且有效，跳过解析
   - 否则执行PDF解析
   - 提取文本、表格、元数据
   - 记录解析警告（表格失败等）
   - 缓存结构化结果

4. Structuring 阶段
   - 构建文档树（标题、章节、段落）
   - 识别表格结构
   - 生成结构化JSON

5. Diffing 阶段
   - 比对两份文档结构
   - 识别新增/删除/修改段落
   - 比对表格（尽力对齐）
   - 生成差异结果JSON

6. Summarizing 阶段
   - 统计差异数据
   - 提取Top N变化章节
   - 识别关键数字变化
   - 生成摘要

7. Exporting 阶段
   - 生成DOCX报告
   - 如果失败，记录warning但保持succeeded
   - 存储DOCX文件

8. 完成
   - 更新任务状态为succeeded/failed
   - 记录完成时间
```

### AI建议生成流程

```
1. 用户点击"生成AI建议"
   - 检查缓存（compareTaskId + aiConfigVersion）
   - 如果缓存存在，直接返回
   - 否则创建建议任务，入队

2. 异步生成
   - 获取比对结果和摘要
   - 截断输入（Top N章节 + 最大字符数）
   - 调用AI服务
   - 解析响应

3. 缓存存储
   - 存储建议结果
   - 记录aiConfigVersion

4. 版本管理
   - aiConfigVersion更新时，旧版本视为未命中
   - 后台GC清理旧版本缓存
```

## 错误处理与降级

### 解析失败处理

- **表格解析失败**: 继续处理，标注warning，任务succeeded
- **文本解析失败**: 任务failed，返回错误信息
- **降级**: 表格失败时，仅进行文本比对

### URL下载失败处理

- **超时/连接失败**: 返回用户可读错误，允许重试
- **SSRF防护**: 拒绝内网地址、限制重定向、禁止协议降级
- **内容校验失败**: 返回错误，不处理非PDF内容

### DOCX导出失败处理

- **导出失败**: 保持任务succeeded，记录warning
- **允许重新导出**: 用户可手动触发重新导出

## 安全考虑

1. **SSRF防护**
   - 拒绝内网地址（127.0.0.1、192.168.x.x、10.x.x.x、IPv6本地地址）
   - 防止DNS rebinding攻击（缓存DNS结果）
   - 拒绝非http/https scheme
   - 校验重定向后的最终地址
   - 限制重定向次数
   - 禁止HTTPS→HTTP降级

2. **文件安全**
   - 验证文件类型（PDF）
   - 检查文件大小（≤100MB）
   - 校验文件签名
   - 隔离存储

3. **权限控制**
   - 普通用户：上传、查看自己的任务、使用有权限的资产
   - 管理员：批量入库、元数据管理、批量比对

## 性能优化

1. **缓存复用**
   - 解析结果按assetId缓存
   - 同一资产多次比对避免重复解析
   - 批量比对时显著提升吞吐

2. **异步处理**
   - 所有长时间操作异步化
   - 前端不阻塞
   - 支持进度查询

3. **增量处理**
   - 支持断点续传
   - 支持任务重试

## 扩展性考虑

1. **支持更多文件格式** (v2)
   - Word、Excel、HTML等

2. **OCR支持** (v2)
   - 扫描件识别

3. **权限模型细化** (v2)
   - 资产级权限
   - 任务级权限

4. **多语言支持** (v2)
   - 国际化



## 正确性属性

A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.

### 属性1：任务状态单调性
**验证需求**: 需求2-6

*对于任何比对任务，任务的进度百分比应该单调不减；当任务succeeded时进度必须为100；当任务failed时进度保持在失败点；阶段切换时进度至少增加1%*

**实现方式**: 
- 生成随机任务进度序列
- 验证每个进度值 >= 前一个进度值
- 验证succeeded时progress == 100
- 验证failed时progress不再变化

### 属性2：资产哈希去重
**验证需求**: 需求1-6, 需求16-3

*对于任何两个内容相同的PDF文件，系统应该基于文件哈希识别为重复，而不是基于URL或文件名*

**实现方式**:
- 生成相同内容的两个PDF文件
- 通过不同URL或不同名称上传
- 验证系统识别为重复并复用assetId

### 属性3：解析缓存复用
**验证需求**: 需求20-1, 需求20-2

*对于同一资产的多次比对，系统应该复用缓存的结构化结果，避免重复解析*

**实现方式**:
- 创建资产并首次比对（记录解析时间）
- 再次使用同一资产比对（记录解析时间）
- 验证第二次解析时间显著更短（缓存命中）

### 属性4：AI建议缓存命中
**验证需求**: 需求10-3, 需求10-4

*对于同一比对任务的多次AI建议请求，系统应该返回缓存结果而不重新调用AI服务*

**实现方式**:
- 生成AI建议（记录调用次数）
- 再次请求同一任务的建议（记录调用次数）
- 验证第二次请求不增加AI调用次数

### 属性5：差异摘要统计准确性
**验证需求**: 需求6-3, 需求15-2

*对于任何比对结果，摘要中的统计数据（新增段落数、删除段落数、修改段落数）应该等于实际差异结果中的对应数据*

**实现方式**:
- 生成随机差异结果
- 生成摘要
- 验证摘要统计 == 实际差异统计

### 属性6：表格对齐降级
**验证需求**: 需求5-1

*当表格结构无法可靠对齐时，系统应该标注"表格结构对齐不完全"并仍展示可对比内容，而不是失败*

**实现方式**:
- 生成结构差异较大的两个表格
- 执行比对
- 验证任务succeeded且包含warning
- 验证仍有可对比内容展示

### 属性7：DOCX导出失败降级
**验证需求**: 需求8-6

*当DOCX导出失败时，任务应该保持succeeded状态，报告页可查看，并在warnings中标注失败*

**实现方式**:
- 模拟DOCX导出失败
- 验证任务状态仍为succeeded
- 验证warnings包含"DOCX导出失败"
- 验证diff结果仍可查看

### 属性8：任务重试追溯
**验证需求**: 需求12-4

*当用户重试失败的任务时，系统应该创建新的taskId，并在新任务中记录retryOf指向原任务，两者均可追溯*

**实现方式**:
- 创建任务并让其失败
- 重试该任务
- 验证新任务有不同的taskId
- 验证新任务的retryOf == 原taskId
- 验证历史记录中两个任务都可见

### 属性9：AI建议版本管理
**验证需求**: 需求21-2, 需求21-3

*对于同一比对任务，当aiConfigVersion更新时，旧版本缓存应该视为未命中，新请求应该使用新版本重新生成*

**实现方式**:
- 生成AI建议（aiConfigVersion=1）
- 更新aiConfigVersion为2
- 请求同一任务的建议
- 验证返回新版本建议（不是旧版本缓存）

### 属性10：警告字段完整性
**验证需求**: 需求2-7

*系统返回的每条warning应该至少包含code、message、stage字段，便于前端定位*

**实现方式**:
- 生成包含warnings的任务状态
- 验证每条warning都有code、message、stage
- 验证code和message非空

## 测试策略

### 单元测试

单元测试验证特定的函数、类和模块的正确性，包括：

1. **PDF解析单元测试**
   - 测试标题提取
   - 测试段落识别
   - 测试表格提取
   - 测试元数据提取

2. **差异比对单元测试**
   - 测试段落diff算法
   - 测试表格对齐算法
   - 测试关键数字识别

3. **摘要生成单元测试**
   - 测试Top N章节识别
   - 测试统计计算
   - 测试关键数字提取

4. **缓存管理单元测试**
   - 测试缓存键生成
   - 测试缓存失效条件
   - 测试缓存查询

### 属性基测试 (Property-Based Testing)

使用fast-check库进行属性基测试，每个属性至少运行100次迭代：

1. **Property 1: 任务状态单调性**
   - 框架: fast-check
   - 生成器: 随机进度序列
   - 验证: 单调性、边界条件

2. **Property 2: 资产哈希去重**
   - 框架: fast-check
   - 生成器: 随机PDF内容
   - 验证: 哈希相同 => 去重

3. **Property 3: 解析缓存复用**
   - 框架: fast-check
   - 生成器: 随机资产
   - 验证: 缓存命中率

4. **Property 4: AI建议缓存命中**
   - 框架: fast-check
   - 生成器: 随机比对任务
   - 验证: 缓存命中

5. **Property 5: 差异摘要统计准确性**
   - 框架: fast-check
   - 生成器: 随机差异结果
   - 验证: 统计准确性

6. **Property 6: 表格对齐降级**
   - 框架: fast-check
   - 生成器: 随机表格对
   - 验证: 降级处理

7. **Property 7: DOCX导出失败降级**
   - 框架: fast-check
   - 生成器: 随机导出失败场景
   - 验证: 降级处理

8. **Property 8: 任务重试追溯**
   - 框架: fast-check
   - 生成器: 随机失败任务
   - 验证: 重试追溯

9. **Property 9: AI建议版本管理**
   - 框架: fast-check
   - 生成器: 随机版本更新
   - 验证: 版本管理

10. **Property 10: 警告字段完整性**
    - 框架: fast-check
    - 生成器: 随机warning
    - 验证: 字段完整性

### 集成测试

集成测试验证多个模块之间的交互：

1. **端到端比对流程**
   - 上传两份PDF
   - 验证任务创建
   - 验证异步处理
   - 验证结果生成
   - 验证DOCX导出

2. **资料库工作流**
   - 批量上传资产
   - 查询资料库
   - 基于资产发起比对
   - 验证追溯

3. **AI建议工作流**
   - 生成比对结果
   - 生成AI建议
   - 验证缓存
   - 验证强制重新生成

4. **错误处理工作流**
   - 测试各种失败场景
   - 验证降级处理
   - 验证错误信息

### 性能测试

1. **缓存效果测试**
   - 测试解析缓存对吞吐的影响
   - 测试AI建议缓存对成本的影响

2. **并发处理测试**
   - 测试多个任务并发处理
   - 测试资源竞争

3. **大文件处理测试**
   - 测试100MB PDF处理
   - 测试内存使用



## 缓存策略（唯一定义）

### 解析结果缓存

**存储架构**（分层设计）：
- **Redis层**（热缓存）：存储 key→path/元信息映射
  - 键: `parse_cache:{assetId}:{parseVersion}`
  - 值: `{path: "s3://...", size: 1024, extractedAt: "2025-01-01"}`
  - TTL: 30天（可配置）
  
- **对象存储层**（冷存储）：存储结构化JSON文件
  - 路径: `s3://structured-data/{assetId}/{parseVersion}/document.json`
  - 保留期: 长期保留（按GC策略清理）

**失效条件**:
- 源文件哈希变化 → 清除Redis缓存 + 对象存储文件
- parseVersion更新 → 清除旧版本缓存
- 手动清除 → 同时清除Redis和对象存储

**复用场景**: 资料库长期复用，同一资产多次比对避免重复解析

### AI建议缓存

- **键**: `ai_suggestion:{compareTaskId}:{aiConfigVersion}`
- **值**: 建议结果JSON（直接存Redis）
- **失效条件**:
  - aiConfigVersion更新 → 旧版本视为未命中（不物理删除）
  - 手动强制重新生成 → 清除缓存
  - 后台GC清理 → 按策略清理旧版本
- **TTL**: 无限期（版本管理）

## 约束与规范

### 输入约束（MVP范围 - 明确定论）

**支持的输入格式**:
- **上传**: 仅支持PDF格式（.pdf）
- **URL**: 仅支持HTTP/HTTPS协议的PDF文件
- **导出**: 支持DOCX格式（.docx）

**明确不支持**（MVP范围外）:
- Word、Excel、HTML等其他文档格式作为输入
- 扫描件（需OCR，v2考虑）
- DOC/DOCX作为输入（仅作为导出格式）

**错误提示**:
- 上传非PDF文件：`"仅支持PDF格式，请上传.pdf文件"`
- 上传扫描件：`"不支持扫描件，请上传原生PDF"`
- URL指向非PDF：`"URL必须指向PDF文件"`

### Warning Code标准集合（最小枚举）

系统使用以下标准化的warning code，便于前端聚类与筛选：

**解析相关**：
- `TABLE_PARSE_FAILED` - 表格解析失败
- `TABLE_ALIGN_PARTIAL` - 表格对齐不完全
- `PDF_ENCRYPTED` - PDF文件加密
- `PDF_CORRUPTED` - PDF文件损坏

**导出相关**：
- `DOCX_EXPORT_FAILED` - DOCX导出失败

**URL下载相关**：
- `URL_TIMEOUT` - URL下载超时
- `URL_REDIRECT_LIMIT` - URL重定向次数超限
- `URL_INVALID_SCHEME` - URL协议无效
- `URL_SSRF_BLOCKED` - URL被SSRF防护拒绝

**文件校验相关**：
- `FILE_SIGNATURE_INVALID` - 文件签名无效

### 去重与复用作用域

**物理层去重**（全库共享）：
- fileHash全库去重，blob复用（降成本）
- 相同内容的文件自动识别为重复
- 支持按deduplicationStrategy选择复用或新版本

**API层权限隔离**（防止侧信道泄露）：
- 批量上传响应中的duplicateOf字段：
  - 同租户用户：返回duplicateOf assetId
  - 跨租户用户：仅返回"已存在（内容相同）"，不暴露assetId
  - 管理员：可见所有assetId
  
- 权限控制通过visibility和sharedTo字段：
  - private: 仅所有者可见
  - org: 同租户可见
  - public: 全库可见

### 并发幂等规则

**AI建议**：
- 唯一约束: (compareTaskId, aiConfigVersion)
- 重复点击同一选项：复用同一条in-flight任务
- 返回相同的suggestionId和状态

**DOCX重新导出**：
- 唯一约束: (taskId, includeAiSuggestion)
- 同一task + 相同params再次触发：返回同一导出任务/状态
- 避免重复生成相同文件

**任务创建**：
- 同一对输入重复提交：不自动合并，允许创建多个任务
- idempotency-key支持（可选）：
  - 键: `idempotency-key: {uuid}`
  - 相同key的请求在24小时内返回相同taskId

### 任务/资产删除策略

**删除任务**:
- 删除该任务的比对结果、导出文件、AI建议
- 不删除仍被其他任务或资料库引用的源文件资产
- 解析缓存以assetId为粒度共享，不随任务删除

**删除资产**:
- 检查是否被任务引用
- 如果被引用，阻止删除或标记为已删除
- 删除资产时同时删除其结构化数据存储

**扫描件/OCR提示**:
- MVP不支持扫描件
- 上传扫描件时返回错误: `"不支持扫描件，请上传原生PDF"`
- 建议在UI中明确提示用户

## 性能优化

### 缓存复用

- 解析结果按assetId缓存
- 同一资产多次比对避免重复解析
- 批量比对时显著提升吞吐

### 异步处理

- 所有长时间操作异步化
- 前端不阻塞
- 支持进度查询

### 增量处理

- 支持任务重试（创建新taskId + retryOf追溯）
- 不支持断点续传（v2可考虑）

## 扩展性考虑

### v2 功能

1. **支持更多文件格式**
   - Word、Excel、HTML等

2. **OCR支持**
   - 扫描件识别

3. **权限模型细化**
   - 资产级权限
   - 任务级权限

4. **多语言支持**
   - 国际化

5. **断点续传**
   - 大文件上传优化



## 设计决策总结（一致性收敛）

本部分明确所有关键的设计决策，确保实现过程中的一致性。

### 1. 缓存策略（唯一定义）

**解析结果缓存**：
- Redis存path+元信息（热缓存，TTL 30天）
- 对象存储存结构化JSON（冷存储，长期保留）
- 失效条件：源文件哈希变化或parseVersion更新

**AI建议缓存**：
- Redis直接存JSON（无限期）
- aiConfigVersion更新时旧版本视为未命中
- 后台GC清理旧版本

### 2. 创建比对任务API（唯一定义）

**三个独立endpoint**：
- `POST /api/v1/tasks/compare/upload` (multipart/form-data)
- `POST /api/v1/tasks/compare/url` (application/json)
- `POST /api/v1/tasks/compare/asset` (application/json)

**不使用单endpoint + Content-Type分流**，避免混淆

### 3. 资产元数据字段（统一定义）

**三个独立字段**：
- `year`: 年份
- `region`: 地区
- `department`: 部门/单位

**查询API示例**：
```
GET /api/v1/assets?year=2024&region=北京&department=市政府
```

### 4. 批量比对最小闭环

**三个API**（资源化命名）：
- `POST /api/v1/admin/batch-jobs/preview` - 预览配对
- `POST /api/v1/admin/batch-jobs/run` - 执行批量比对
- `GET /api/v1/admin/batch-jobs/{batchId}` - 查询进度

**BatchJob实体**：包含pairs、conflicts、taskIds、progress等字段

### 5. DOCX导出边界（明确定义）

**两份独立文件**：
- `diff_report_[taskId].docx` - 基础对比报告（任务succeeded时自动生成）
- `diff_report_with_ai_[taskId].docx` - 包含AI建议的报告（按需生成）

**生成策略**：
- 基础报告：任务succeeded时自动生成
- AI建议报告：AI建议succeeded时允许生成，如未生成则自动触发

### 6. 入库失败vs资产不可用（明确区分）

**入库失败** (status=failed)：
- 文件无法落盘、无法计算哈希等
- 不返回assetId
- 用户需重新上传

**资产不可用** (status=success + assetStatus=unusable)：
- 文件已入库但无法解析（加密、损坏等）
- 返回assetId便于追溯
- 用户可后续替换或修复

### 7. 资产版本链路（明确定义）

**版本管理字段**（唯一定义）：
- `versionGroupId`: 同一逻辑年报的版本组ID（字符串）
- `revision`: 版本号（递增整数，从1开始）
- `supersedesAssetId`: 新版本指向旧版本的assetId（字符串）

**new-version策略**：
- 创建新assetId
- 设置versionGroupId相同
- revision递增（前一版本revision + 1）
- supersedesAssetId指向前一版本的assetId

### 8. 去重作用域（明确定义）

**fileHash去重**：全库共享（跨租户/权限域）
- 相同内容自动识别为重复
- 权限隔离通过visibility字段控制

**权限隔离**：
- private: 仅所有者可见
- org: 同租户可见
- public: 全库可见

### 9. Warning Code标准化

使用标准化的code字典（见"约束与规范"部分），便于前端聚类与筛选

### 10. 任务幂等性

- 同一对输入重复提交：不自动合并
- idempotency-key支持：可选，24小时内返回相同taskId

