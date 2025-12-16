# HLD：LLM 解析与入库系统（A 路线）

> 版本：v3（口径统一版）  
> 日期：2025-12-15

## 0. 核心决策（与 PRD 保持一致）

1) DB：生产 PostgreSQL；本地可选 SQLite  
2) reports：`UNIQUE(region_id, year)`（逻辑报告）  
3) 幂等：`report_versions`：`UNIQUE(report_id, file_hash)`  
4) Prompt：`prompts/vN/system.txt|user.txt|schema.json`  
5) API ID：统一 integer

## 1. 架构概览

```
前端（React） ──HTTP──> 后端 API（Node/Express/FastAPI 皆可按仓库实际）
                         │
                         ├─ FileUploadService（落盘、hash）
                         ├─ LLMParseService（Provider + Prompt + Schema 校验 + 重试）
                         ├─ JobRunner（队列/状态机）
                         └─ DB（PostgreSQL / SQLite）
```

## 2. 数据流（Phase 1）

1) 前端上传：regionId + year + PDF（multipart）
2) 后端：
   - 计算 SHA256(file_hash)
   - 将 PDF 保存到 `data/uploads/{regionId}/{year}/{file_hash}.pdf`
   - 若报告不存在：创建 reports(region_id, year)
   - 幂等检查：若 report_versions 已存在同 file_hash → 返回已有 reportId/versionId（409 或 200，见 API）
   - 创建 jobs 并入队
3) JobRunner：
   - 读取 prompts/vN
   - 调用 Provider（Gemini）
   - JSON Schema 校验，失败按规则重试
   - 成功写入 report_versions（并将其 is_active=true，旧版本 is_active=false）
4) 前端轮询 jobs/{id} 获取进度，完成后拉取 reports/{id} 查看结果

## 3. 数据库设计

### 3.1 PostgreSQL（生产）
```sql
CREATE TABLE regions (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  province VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE reports (
  id BIGSERIAL PRIMARY KEY,
  region_id BIGINT NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(region_id, year)
);

CREATE INDEX idx_reports_region_year ON reports(region_id, year);

CREATE TABLE report_versions (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_name VARCHAR(255) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  file_size BIGINT,
  storage_path TEXT NOT NULL,
  text_path TEXT,
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt_version VARCHAR(50) NOT NULL,
  parsed_json JSONB NOT NULL,
  schema_version VARCHAR(50) NOT NULL DEFAULT 'v1',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX uq_report_versions_report_file
ON report_versions(report_id, file_hash);

CREATE INDEX idx_report_versions_report_active
ON report_versions(report_id, is_active);

CREATE TABLE jobs (
  id BIGSERIAL PRIMARY KEY,
  report_id BIGINT NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version_id BIGINT REFERENCES report_versions(id) ON DELETE SET NULL,
  kind VARCHAR(30) NOT NULL DEFAULT 'parse',
  status VARCHAR(30) NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  error_code VARCHAR(50),
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_jobs_report ON jobs(report_id);
CREATE INDEX idx_jobs_status ON jobs(status);
```

### 3.2 SQLite（本地可选）
```sql
PRAGMA foreign_keys = ON;

CREATE TABLE regions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  province TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  region_id INTEGER NOT NULL REFERENCES regions(id),
  year INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(region_id, year)
);

CREATE INDEX idx_reports_region_year ON reports(region_id, year);

CREATE TABLE report_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size INTEGER,
  storage_path TEXT NOT NULL,
  text_path TEXT,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  parsed_json TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT 'v1',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(report_id, file_hash)
);

CREATE INDEX idx_report_versions_report_active
ON report_versions(report_id, is_active);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  version_id INTEGER REFERENCES report_versions(id),
  kind TEXT NOT NULL DEFAULT 'parse',
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);

CREATE INDEX idx_jobs_report ON jobs(report_id);
CREATE INDEX idx_jobs_status ON jobs(status);
```

## 4. API 契约（最小可用）

### 4.1 POST /api/regions
请求：
```json
{"code":"huangpu","name":"黄浦区","province":"上海市"}
```
响应：
```json
{"id":1,"code":"huangpu","name":"黄浦区","province":"上海市"}
```

### 4.2 GET /api/regions
响应示例（ID 不重复）：
```json
{"data":[
  {"id":1,"code":"huangpu","name":"黄浦区","province":"上海市"},
  {"id":2,"code":"hongkou","name":"虹口区","province":"上海市"}
]}
```

### 4.3 POST /api/reports（上传）
multipart/form-data：
- regionId: 1
- year: 2024
- file: @sample.pdf
- fullText: (可选)

响应（201）：
```json
{"reportId":1,"jobId":1,"status":"queued"}
```

幂等响应（409）：
```json
{"code":"REPORT_ALREADY_EXISTS","message":"Report version already exists for this region/year/file.","reportId":1,"versionId":1}
```

### 4.4 GET /api/jobs/{id}
```json
{"id":1,"status":"running","progress":40,"errorCode":null,"errorMessage":null}
```

### 4.5 GET /api/reports?regionId=1&year=2024
```json
{"data":[{"reportId":1,"regionId":1,"year":2024,"activeVersionId":1}]}
```

### 4.6 GET /api/reports/{reportId}
```json
{
  "reportId":1,
  "regionId":1,
  "year":2024,
  "activeVersion": {
    "versionId":1,
    "provider":"gemini",
    "model":"<model>",
    "promptVersion":"v1",
    "parsedJson": {}
  },
  "versions":[
    {"versionId":1,"createdAt":"...","isActive":true}
  ]
}
```

### 4.7 GET /api/reports/compare?regionId=1&years=2023,2024
```json
{"regionId":1,"years":[2023,2024],"diff":{},"summary":"..."}
```

### 4.8 错误码
| code | http | 含义 |
|---|---:|---|
| INVALID_FILE | 400 | 文件格式/大小不合法 |
| REGION_NOT_FOUND | 404 | 城市不存在 |
| REPORT_NOT_FOUND | 404 | 报告不存在 |
| JOB_NOT_FOUND | 404 | Job 不存在 |
| REPORT_ALREADY_EXISTS | 409 | 同城同年同文件已存在（幂等） |
| SCHEMA_VALIDATION_FAILED | 422 | JSON Schema 校验失败 |
| RATE_LIMIT_EXCEEDED | 429 | 速率限制 |
| LLM_API_ERROR | 502 | LLM 调用失败 |
| INTERNAL_ERROR | 500 | 内部错误 |

## 5. Prompt 资产管理（必须可审计）
```
prompts/
  v1/
    system.txt
    user.txt
    schema.json
  v2/
    ...
  README.md
```

## 6. 安全要点
- Key 仅后端环境变量；禁止写入前端/构建产物
- 日志脱敏：不得打印 fullText、API Key、原始 parsed_json
- 并发限制：解析并发上限（默认 5）
