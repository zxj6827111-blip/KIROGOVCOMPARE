# PR #7 审查意见

**PR**：Add reports read API endpoints (GET /reports, GET /reports/:id)  
**状态**：✅ **已批准，可合并**  
**评分**：94/100

---

## 审查结果

### ✅ 通过项
- ✅ 功能完整：GET /reports（列表）+ GET /reports/:id（详情）
- ✅ 范围正确：仅做读取 API，无前端/LLM/DB 口径变更
- ✅ API 契约：状态码 200/400/404 语义正确
- ✅ 响应字段：满足前端接入最小集合
- ✅ 数据一致性：is_active 版本逻辑正确
- ✅ SQL 注入防护：正确使用 sqlValue helper
- ✅ 大字段控制：parsed_json 仅在 detail 返回
- ✅ 验收脚本：完整可一键跑通，具备断言

---

## 🔍 详细审查

### 1. 功能范围 ✅

**PR 内容**：
- ✅ GET /reports（列表查询）
- ✅ GET /reports/:id（详情查询）
- ✅ LLM_REPORTS_READ_TEST.sh（验收脚本）

**范围检查**：
- ✅ 仅做读取 API（无写入）
- ✅ 无前端改动
- ✅ 无 LLM provider 调用
- ✅ 无 DB 口径变更
- ✅ 无 API Key 泄露

---

### 2. API 契约 ✅

#### GET /reports（列表）

**参数验证**：
```typescript
// ✅ region_id 验证
if (region_id !== undefined) {
  const regionIdNum = Number(region_id);
  if (!region_id || Number.isNaN(regionIdNum) || !Number.isInteger(regionIdNum) || regionIdNum < 1) {
    return res.status(400).json({ error: 'region_id 无效' });
  }
}

// ✅ year 验证
if (year !== undefined) {
  const yearNum = Number(year);
  if (!year || Number.isNaN(yearNum) || !Number.isInteger(yearNum)) {
    return res.status(400).json({ error: 'year 无效' });
  }
}
```

**状态码**：
- ✅ 200：成功返回列表
- ✅ 400：参数无效

**响应字段**（最小集合）：
```json
{
  "data": [
    {
      "report_id": 1,
      "region_id": 1,
      "year": 2024,
      "active_version_id": 1,
      "latest_job": {
        "job_id": 1,
        "status": "succeeded",
        "progress": 100,
        "error_code": null,
        "error_message": null
      }
    }
  ]
}
```

**验证**：✅ 完全符合 HLD 第 4.5 章

---

#### GET /reports/:id（详情）

**参数验证**：
```typescript
// ✅ reportId 验证
const reportId = Number(req.params.id);
if (!reportId || Number.isNaN(reportId) || !Number.isInteger(reportId) || reportId < 1) {
  return res.status(400).json({ error: 'report_id 无效' });
}
```

**状态码**：
- ✅ 200：成功返回详情
- ✅ 400：参数无效
- ✅ 404：报告不存在

**响应字段**（完整）：
```json
{
  "report_id": 1,
  "region_id": 1,
  "year": 2024,
  "active_version": {
    "version_id": 1,
    "file_hash": "abc123...",
    "storage_path": "data/uploads/1/2024/abc123.pdf",
    "parsed_json": { /* 完整 JSON */ },
    "provider": "gemini",
    "model": "gemini-2.5-flash",
    "prompt_version": "v1",
    "schema_version": "v1",
    "text_path": null,
    "created_at": "2025-12-16T..."
  },
  "latest_job": {
    "job_id": 1,
    "status": "succeeded",
    "progress": 100,
    "error_code": null,
    "error_message": null
  }
}
```

**验证**：✅ 完全符合 HLD 第 4.6 章

---

### 3. 数据一致性 ✅

#### is_active 版本逻辑

**列表查询**：
```sql
LEFT JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = 1
```

**详情查询**：
```sql
LEFT JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = 1
```

**验证**：✅ 两处都正确读取 is_active=1 的版本

---

#### Job 绑定逻辑

**列表查询**：
```sql
(SELECT j.id FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_id,
(SELECT j.status FROM jobs j WHERE j.report_id = r.id ORDER BY j.id DESC LIMIT 1) AS job_status,
...
```

**详情查询**：
```sql
SELECT id, status, progress, error_code, error_message
FROM jobs
WHERE report_id = ${sqlValue(reportId)}
ORDER BY id DESC
LIMIT 1;
```

**验证**：✅ 两处都取"该 report 最新 job"（ORDER BY id DESC LIMIT 1）

---

### 4. 安全与稳定性 ✅

#### SQL 注入防护

**列表查询**：
```typescript
conditions.push(`r.region_id = ${sqlValue(Number(region_id))}`);
conditions.push(`r.year = ${sqlValue(Number(year))}`);
```

**详情查询**：
```typescript
WHERE r.id = ${sqlValue(reportId)}
WHERE report_id = ${sqlValue(reportId)}
```

**验证**：✅ 全部使用 sqlValue helper，无 SQL 注入风险

---

#### 大字段控制

**列表查询**：
```typescript
// ✅ 不返回 parsed_json
data: rows.map((row) => ({
  report_id: row.report_id,
  region_id: row.region_id,
  year: row.year,
  active_version_id: row.active_version_id || null,
  latest_job: { ... }
}))
```

**详情查询**：
```typescript
// ✅ 返回 parsed_json（已 JSON.parse）
active_version: report.version_id ? {
  version_id: report.version_id,
  file_hash: report.file_hash,
  storage_path: report.storage_path,
  parsed_json: parsedJson,  // ✅ 仅在 detail 返回
  ...
} : null
```

**验证**：✅ 列表不返回超大内容，detail 返回完整数据

---

#### 错误处理

```typescript
try {
  // ... 业务逻辑
} catch (error) {
  console.error('Error listing reports:', error);
  return res.status(500).json({ error: 'Internal server error' });
}
```

**验证**：✅ 完整的 try-catch，无日志泄露

---

### 5. 验收脚本 ✅

**LLM_REPORTS_READ_TEST.sh**：

**流程**：
1. ✅ 初始化 SQLite 数据库
2. ✅ 创建 region
3. ✅ 上传报告（调用 POST /reports）
4. ✅ 轮询 Job 直到成功
5. ✅ 查询列表（GET /reports?region_id=1&year=2024）
6. ✅ 查询详情（GET /reports/{reportId}）

**断言检查**：

```bash
# ✅ 列表响应断言
required_fields = ['report_id', 'region_id', 'year', 'active_version_id']
missing = [f for f in required_fields if f not in matched]
if missing:
    sys.exit(f'missing fields in list item: {missing}')

if matched.get('latest_job') is None or 'status' not in matched['latest_job']:
    sys.exit('latest_job missing or incomplete in list response')

# ✅ 详情响应断言
required = ['report_id', 'region_id', 'year', 'active_version']
missing = [f for f in required if f not in data]
if missing:
    sys.exit(f'missing fields in detail response: {missing}')

active_required = ['version_id', 'file_hash', 'storage_path', 'parsed_json']
missing_active = [f for f in active_required if f not in active]
if missing_active:
    sys.exit(f'missing fields in active_version: {missing_active}')

job_required = ['job_id', 'status', 'progress', 'error_code', 'error_message']
missing_job = [f for f in job_required if f not in latest_job]
if missing_job:
    sys.exit(f'missing fields in latest_job: {missing_job}')
```

**验证**：✅ 具备完整的字段断言，不仅打印

---

### 6. 与文档一致性 ✅

| 检查项 | 文档要求 | 当前实现 | 状态 |
|--------|---------|---------|------|
| GET /reports 端点 | 支持 | ✅ | ✅ |
| GET /reports/:id 端点 | 支持 | ✅ | ✅ |
| 状态码 200/400/404 | 正确 | ✅ | ✅ |
| 响应字段最小集合 | report + active_version + latest_job | ✅ | ✅ |
| is_active 逻辑 | 只读 active | ✅ | ✅ |
| Job 绑定 | 取最新 job | ✅ | ✅ |
| SQL 注入防护 | sqlValue helper | ✅ | ✅ |
| 大字段控制 | list 不返回，detail 返回 | ✅ | ✅ |
| 验收脚本 | 一键跑通 + 断言 | ✅ | ✅ |

---

## 🟢 建议改进（可选，不阻塞合并）

### 1. 添加 parsed_json 大小限制（P1）

当前 detail 返回完整 parsed_json，建议添加大小检查：

```typescript
// 可选：限制 parsed_json 大小（如 > 1MB 时截断）
if (parsedJson && JSON.stringify(parsedJson).length > 1024 * 1024) {
  console.warn(`parsed_json too large for report ${reportId}`);
  parsedJson = { _truncated: true, size: JSON.stringify(parsedJson).length };
}
```

### 2. 添加分页支持（P1）

当前列表无分页，建议后续添加：

```typescript
const limit = Math.min(Number(req.query.limit) || 20, 100);
const offset = Number(req.query.offset) || 0;

// ... 在 SQL 中添加 LIMIT ${limit} OFFSET ${offset}
```

### 3. 添加缓存头（P1）

建议添加 HTTP 缓存头：

```typescript
res.set('Cache-Control', 'public, max-age=60');  // 60 秒缓存
```

---

## ✅ 最终结论

**状态**：✅ **已批准，可合并**

**完整性**：
- ✅ 功能完整：列表 + 详情 API
- ✅ 范围正确：仅读取，无口径变更
- ✅ 契约正确：状态码、字段、验证都符合
- ✅ 数据一致：is_active 和 job 绑定逻辑正确
- ✅ 安全稳定：SQL 注入防护、大字段控制、错误处理完善
- ✅ 验收完整：脚本可一键跑通，具备完整断言

**代码质量**：94/100
- 功能完整正确
- 错误处理完善
- 代码结构清晰
- 与文档完全一致
- 验收脚本专业

**建议**：
- ✅ 立即合并（所有 P0 要求已满足）
- 📝 后续可考虑添加分页、缓存、大小限制（P1）

---

**审查完成**：2025-12-16  
**审查人**：Kiro  
**状态**：✅ 已批准，可合并
