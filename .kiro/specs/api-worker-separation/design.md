# design.md
# API 与 Worker 分离 + Python 表格解析引擎 - 设计文档（最终收口版）

## 1. 背景与目标

系统面向“政府信息公开年报 PDF”，需支持按 **城市/年份** 管理年报，上传后自动解析：
- 正文：6 个章节正文提取（可读、分段/换行合理），可保留现有 TypeScript / PDF.js 方案；
- 表格：三张核心表（模板固定、无网格线）：  
  - 表2：主动公开政府信息情况  
  - 表3：收到和处理政府信息公开申请情况  
  - 表4：政府信息公开行政复议、行政诉讼情况  
  表格解析主链路必须切换为 **后端 Python(pdfplumber)**，输出结构化 JSON + 置信度与问题列表。

上线形态目标（并发上来只排队不崩）：
- Nginx：前端静态站点 + 反代 API
- API（Node）：只接收请求/入队/读库返回（**不做解析**）
- Redis：队列
- Worker（Node）：只消费队列任务（调用 Python 提取表格 + 组装 content JSON）
- Postgres：任务状态与解析结果持久化

## 2. 非目标（本阶段不做/不强依赖）

- 不要求前端改造表格渲染逻辑（Python 输出需对齐现有 canonical tables v2 结构）
- 不引入 OCR 作为主路径（可作为后续增强）
- 不在 API 进程中执行任何 CPU/IO 重任务（解析/比对/导出一律在 Worker）

## 3. 关键约束（必须遵守）

1) **API 与 Worker 必须真正分离**
- API 进程不允许注册任何 Bull processors
- Worker 进程不允许启动 HTTP Server

2) **表格解析必须以 Python(pdfplumber) 为主引擎**
- TypeScript 表格抽取仅允许 debug（默认关闭），不得作为生产兜底污染结果

3) **严禁示例数据兜底**
- 不得在表格缺失/失败时填充“示例表格/默认表格”
- 不允许仅凭“行列骨架齐全”就判定 complete

4) **complete/completeness 判定必须指标驱动**
- 需输出 nonEmptyCells/totalCells、matchedRows/expectedRows、numericParseRate、confidence、issues
- 前端必须能基于 completeness 展示显著警告（banner/标签）

## 4. 运行架构

### 4.1 部署拓扑

```
Browser
  |
  v
Nginx (80)  ----->  / (静态站点)
  |
  +-----> /api/v1/*  -----> API (Node, 内网:3000) -----> Postgres
  |                                             |
  |                                             +-----> Redis(BullMQ 入队)
  |
  +-----> /health  -----> API /health (透传)

Worker (Node, 无端口) <----- Redis(BullMQ 出队)
  |
  +-----> python/extract_tables_pdfplumber.py (pdfplumber)
  |
  +-----> Postgres(写入 content JSON + metrics + issues)
```

### 4.2 任务状态机（建议最小集）

- `queued`：已入队，等待 Worker
- `processing`：Worker 正在处理
- `succeeded`：任务完成（注意：允许“正文成功但表格部分失败”，通过 content.tables.completeness 表达）
- `failed`：任务失败（系统错误、不可恢复）

> 注：不新增额外任务状态也可以，但必须把“表格失败/低置信度”写入 content 的 `issues` + `tables.completeness`，并要求前端显著展示。

## 5. Docker Compose（生产口径：唯一权威示例）

> 说明：该 compose 为“生产口径默认最小暴露面”。  
> - **仅 Nginx 对外暴露 80**  
> - Postgres/Redis 不对宿主机暴露端口（如需本机调试，用 `docker exec` 或另做 dev override）

```yaml
version: "3.9"

services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: report_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres -d report_db"]
      interval: 5s
      timeout: 3s
      retries: 20

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 20

  api:
    build: .
    command: ["npm", "run", "start:api"]
    expose:
      - "3000"
    volumes:
      - uploads:/app/uploads
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/report_db
      REDIS_URL: redis://redis:6379
      # 强制关闭 TS 表格兜底（仅 debug 才允许打开）
      ENABLE_TS_TABLE_FALLBACK: "0"
      # 仅入队，不在 API 做解析
      DISABLE_PROCESSORS: "1"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  worker:
    build: .
    command: ["npm", "run", "start:worker"]
    volumes:
      - uploads:/app/uploads
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/report_db
      REDIS_URL: redis://redis:6379
      # Worker 并发可控
      WORKER_CONCURRENCY: "2"
      # Python 调用超时（毫秒）
      PY_TABLE_TIMEOUT_MS: "180000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      # 如你的前端产物目录不是 frontend/build，请在此处调整（保持单一口径）
      - ./frontend/build:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - api

volumes:
  pgdata:
  redis_data:
  uploads:
```

## 6. Nginx 配置（nginx.conf，唯一权威示例）

```nginx
server {
  listen 80;
  server_name _;

  # 上传大小限制（按需调整）
  client_max_body_size 50m;

  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  # API 反代：统一 /api/v1/
  location /api/v1/ {
    proxy_pass http://api:3000/api/v1/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  # 健康检查
  location /health {
    proxy_pass http://api:3000/health;
  }
}
```

## 7. 进程拆分设计（Node）

### 7.1 API 进程（src/server.ts）

职责：
- 提供 `/api/v1/*` 路由（tasks/assets/batch-jobs/suggestions 等）
- 接收上传（写入 uploads volume）
- 创建任务记录（Postgres）
- 入队（Redis/BullMQ）
- 提供 `/health`
- **禁止**注册 processors、禁止执行解析/比对/导出

强制防呆：
- `DISABLE_PROCESSORS=1` 时，任何 processor 注册函数不得被调用
- 构建时可做静态检查：server.ts 不允许 import Worker 处理模块

### 7.2 Worker 进程（src/worker.ts）

职责：
- 启动 BullMQ Worker（消费队列）
- 对每个任务执行解析流水线（正文可选 + Python 表格提取 + 结果落库）
- 更新任务状态/错误信息
- **禁止**启动 HTTP Server

Worker 并发：
- `WORKER_CONCURRENCY` 环境变量控制（默认 2），可在上线阶段逐步调大
- 任何外部并发压力只会体现在队列长度增长，不应拖垮 API

## 8. Python 表格解析集成（主引擎）

### 8.1 目录结构

```
python/
  requirements.txt
  extract_tables_pdfplumber.py
  utils/
    schema.py
    table_locator.py
    cell_parser.py
```

### 8.2 脚本调用协议（唯一标准：argv）

Worker 使用 `execFile` 调用（禁止 stdin JSON/多协议并存）：

```bash
python3 python/extract_tables_pdfplumber.py <pdf_path> \
  --schema specs/annual_report_table_schema_v2.json \
  --out - 
```

- `<pdf_path>`：uploads volume 内真实路径
- `--schema`：固定 schema 文件
- `--out -`：输出 JSON 到 stdout（便于 Worker 捕获），也可扩展为文件路径但不作为默认

### 8.3 Python 输出 JSON（与前端兼容的 canonical 结构）

顶层结构建议：

```json
{
  "schema_version": "annual_report_table_schema_v2",
  "tables": {
    "sec2_art20_active_disclosure": {
      "table_id": "sec2_art20_active_disclosure",
      "rows": [{"key":"...","label":"..."}],
      "columns": [{"key":"...","label":"..."}],
      "cells": {
        "rowKey__colKey": {
          "text": "12",
          "value": 12,
          "raw_text": "12",
          "confidence": 0.92
        }
      },
      "metrics": {
        "totalCells": 120,
        "nonEmptyCells": 85,
        "nonEmptyRatio": 0.7083,
        "expectedRows": 20,
        "matchedRows": 19,
        "rowMatchRate": 0.95,
        "numericParseRate": 0.88
      },
      "confidence": 0.86,
      "completeness": "partial",
      "issues": ["..."]
    },
    "sec3_requests": { "...": "..." },
    "sec4_review_litigation": { "...": "..." }
  },
  "issues": [],
  "runtime": {
    "engine": "pdfplumber",
    "elapsed_ms": 1234
  }
}
```

关键要求：
- **rowKey/colKey 必须来自 schema 的 `row.key / column.key`**，不得输出中文临时 key
- `cells` 的 key 格式固定：`{rowKey}__{colKey}`
- `value` 必须尽量解析为 number（无法解析则为 null，并计入 numericParseRate）
- `issues` 必须可读可追踪（定位“为何为空/为何错位”）

## 9. 完整性（completeness）判定规则（指标驱动）

Python 每张表必须计算：
- `nonEmptyRatio = nonEmptyCells / totalCells`
- `rowMatchRate = matchedRows / expectedRows`
- `numericParseRate = parsedNumericCells / candidateNumericCells`
- `confidence`（0~1，综合指标）

建议阈值（可在 requirements 固化）：
- `complete`：nonEmptyRatio ≥ 0.60 且 rowMatchRate ≥ 0.90 且 confidence ≥ 0.80
- `partial`：满足部分阈值但未达 complete
- `failed`：表定位失败/主要指标极低/脚本异常

**禁止**：仅凭“行列骨架齐全”判定 complete。

前端展示：
- 任一核心表 `completeness != complete` 必须显著展示 warning（banner/标签）
- issues 必须可查看/可复制（便于人工复核与后续修复）

## 10. TS 表格抽取（仅 debug）

- 默认关闭：`ENABLE_TS_TABLE_FALLBACK=0`
- 仅在开发调试时可开：`ENABLE_TS_TABLE_FALLBACK=1`
- 即便开启也不得覆盖 Python 输出：只能作为 debug 对比字段（例如 `tables_debug.ts_extraction`）

## 11. 回归测试（必须有）

提供至少 3 份样例 PDF（例如 `sample_pdfs_v1/`），回归脚本输出每张表：
- nonEmptyCells/totalCells
- matchedRows/expectedRows
- confidence
- completeness
- issues（前 5 条即可）

建议落地方式：
- Node 脚本：`node scripts/regress_tables.js`
- 输出：`output/regress_tables_summary.json` + 控制台表格打印

## 12. 验证口径（生产 vs 内部诊断）

生产验收（只走 Nginx 80）：
- `curl http://localhost/health`
- `curl http://localhost/api/v1/tasks`（按路由实际方法/鉴权调整）

内部诊断（仅容器内）：
- `docker exec <api_container> curl http://localhost:3000/health`

禁止在“生产验收步骤”里写 `curl http://localhost:3000/...`，避免与“API 不对外暴露”冲突。

## 13. 上线硬化清单（本阶段必须满足）

- Worker 调用 Python：超时、stderr 捕获、非零退出码处理、可重试（有限次数）
- 任务幂等：同 assetId+year+city 的重复入队策略明确（覆盖/版本化/拒绝）
- 失败可追踪：DB 记录 taskId、assetId、错误栈/错误码、python issues
- 权限与索引：assets(city,year)、tasks(status,created_at) 索引
- 资源隔离：API 不执行解析；Worker 并发可控；队列过载不影响 API 可用性
