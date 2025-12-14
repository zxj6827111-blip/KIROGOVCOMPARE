# API 文档

## 基础信息

- **基础URL**: `http://localhost:3000/api/v1`
- **认证**: 通过 `X-User-Id` 请求头
- **响应格式**: JSON

## 任务管理 API

### 创建比对任务 - 上传方式
```
POST /tasks/compare/upload
Content-Type: multipart/form-data

请求体:
- fileA: File (PDF)
- fileB: File (PDF)

响应:
{
  "taskId": "task_xxx",
  "status": "queued",
  "assetIdA": "asset_a",
  "assetIdB": "asset_b",
  "createdAt": "2025-01-01T00:00:00Z"
}
```

### 创建比对任务 - URL方式
```
POST /tasks/compare/url
Content-Type: application/json

请求体:
{
  "urlA": "https://example.com/report_2024.pdf",
  "urlB": "https://example.com/report_2023.pdf"
}

响应:
{
  "taskId": "task_xxx",
  "status": "queued",
  "assetIdA": "asset_a",
  "assetIdB": "asset_b",
  "createdAt": "2025-01-01T00:00:00Z"
}
```

### 创建比对任务 - 资产方式
```
POST /tasks/compare/asset
Content-Type: application/json

请求体:
{
  "assetIdA": "asset_a",
  "assetIdB": "asset_b"
}

响应:
{
  "taskId": "task_xxx",
  "status": "queued",
  "createdAt": "2025-01-01T00:00:00Z"
}
```

### 查询任务状态
```
GET /tasks/:taskId

响应:
{
  "taskId": "task_xxx",
  "status": "running",
  "stage": "diffing",
  "progress": 65,
  "message": "正在比对差异...",
  "warnings": [...]
}
```

### 查询任务列表
```
GET /tasks?page=1&limit=20&status=succeeded

响应:
{
  "tasks": [...],
  "total": 100,
  "page": 1
}
```

### 获取比对结果
```
GET /tasks/:taskId/result

响应:
{
  "taskId": "task_xxx",
  "status": "succeeded",
  "summary": {...},
  "diffResult": {...},
  "docxDownloadUrl": "/api/v1/tasks/task_xxx/download/diff",
  "docxWithAiDownloadUrl": "/api/v1/tasks/task_xxx/download/diff-with-ai"
}
```

### 重试任务
```
POST /tasks/:taskId/retry

响应:
{
  "newTaskId": "task_yyy",
  "retryOf": "task_xxx",
  "status": "queued"
}
```

### 删除任务
```
DELETE /tasks/:taskId

响应:
{
  "success": true,
  "message": "任务已删除"
}
```

## 资料库 API

### 查询资料库
```
GET /assets?year=2024&region=北京&department=市政府&page=1&limit=20

响应:
{
  "assets": [...],
  "total": 100,
  "page": 1
}
```

### 获取资产详情
```
GET /assets/:assetId

响应:
{
  "assetId": "asset_xxx",
  "fileName": "report_2024.pdf",
  "year": 2024,
  "region": "北京",
  "department": "市政府",
  "status": "usable",
  "uploadedAt": "2025-01-01T00:00:00Z"
}
```

### 更新资产元数据
```
PATCH /assets/:assetId
Content-Type: application/json

请求体:
{
  "year": 2024,
  "region": "北京",
  "department": "市政府",
  "reportType": "政府信息公开年报",
  "tags": ["2024", "北京"]
}

响应:
{
  "assetId": "asset_xxx",
  "year": 2024,
  "region": "北京",
  "department": "市政府",
  "revision": 1,
  "updatedAt": "2025-01-01T00:00:00Z"
}
```

## AI建议 API

### 生成AI建议
```
POST /tasks/:taskId/suggestions
Content-Type: application/json

请求体:
{
  "forceRegenerate": false
}

响应:
{
  "suggestionId": "sugg_xxx",
  "status": "succeeded",
  "compareTaskId": "task_xxx",
  "interpretation": "...",
  "suspiciousPoints": [...],
  "improvementSuggestions": [...]
}
```

### 查询AI建议
```
GET /tasks/:taskId/suggestions

响应:
{
  "suggestionId": "sugg_xxx",
  "status": "succeeded",
  "compareTaskId": "task_xxx",
  "interpretation": "...",
  "suspiciousPoints": [...],
  "improvementSuggestions": [...]
}
```

## 批量比对 API

### 批量比对预览
```
POST /admin/batch-jobs/preview
Content-Type: application/json

请求体:
{
  "assetIds": ["asset_a", "asset_b", "asset_c"],
  "rule": "same-region-cross-year",
  "region": "北京"
}

响应:
{
  "pairs": [...],
  "unpaired": [...]
}
```

### 执行批量比对
```
POST /admin/batch-jobs/run
Content-Type: application/json

请求体:
{
  "pairs": [
    {
      "assetIdA": "asset_a",
      "assetIdB": "asset_b"
    }
  ]
}

响应:
{
  "batchId": "batch_xxx",
  "taskIds": ["task_1", "task_2"],
  "status": "queued"
}
```

### 查询批量比对进度
```
GET /admin/batch-jobs/:batchId

响应:
{
  "batchId": "batch_xxx",
  "status": "running",
  "progress": 50,
  "tasks": [...]
}
```

## 错误响应

所有错误响应都遵循以下格式：

```json
{
  "error": "错误信息"
}
```

常见HTTP状态码：
- 200: 成功
- 201: 创建成功
- 400: 请求错误
- 404: 资源不存在
- 500: 服务器错误
