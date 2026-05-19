# API 文档

## 基础信息

- 当前主后端入口：`/api`
- 当前运行端口：本地开发通常为 `http://localhost:8787`
- 认证方式：除公开健康检查和公开看板接口外，业务接口使用 `Authorization: Bearer <token>`

## 当前可用的主线 Compare

当前系统使用“报告入库后再对比”的主线 Compare，不再使用旧版临时任务管线。

### 创建报告对比

```http
POST /api/comparisons
Authorization: Bearer <token>
Content-Type: application/json
```

按地区和年份创建：

```json
{
  "region_id": 123,
  "year_a": 2023,
  "year_b": 2024
}
```

或按两份已入库报告创建：

```json
{
  "left_report_id": 1001,
  "right_report_id": 1002
}
```

成功响应：

```json
{
  "comparison_id": 456,
  "job_id": 789
}
```

### 查看对比历史

```http
GET /api/comparisons/history
Authorization: Bearer <token>
```

### 查看对比结果

```http
GET /api/comparisons/{comparisonId}/result
Authorization: Bearer <token>
```

### 前端页面

- `/history`：对比结果汇总
- `/comparison/:id`：对比详情页
- `/print/comparison/:id`：打印/PDF 使用的对比视图

## 已下线的旧版 Compare 任务接口

以下旧接口已明确下线，不应继续作为可用 API 使用：

- `POST /api/v1/tasks/compare/upload`
- `POST /api/v1/tasks/compare/url`
- `POST /api/v1/tasks/compare/asset`
- `GET /api/v1/tasks/:taskId`

如果这些旧路由被误挂载，当前实现会返回：

```json
{
  "error": "legacy_compare_tasks_retired",
  "replacement": "/api/comparisons"
}
```

如未来需要“上传两个 PDF 直接临时对比”的能力，应作为新功能接入当前报告上传、解析、物化和 `/api/comparisons` 流程，不建议复活旧任务管线。
