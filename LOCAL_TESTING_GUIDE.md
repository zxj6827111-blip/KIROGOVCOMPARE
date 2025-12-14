# 本地测试指南 - API/Worker 分离 + Python 表格解析

## 📋 环境要求

### 必需

- Node.js 18+
- npm 或 yarn
- Python 3.8+
- PostgreSQL 12+（或 Docker）
- Redis 6+（或 Docker）

### 可选

- Docker & Docker Compose（推荐用于数据库）

---

## 🚀 快速启动（使用 Docker）

### 1. 启动数据库和缓存

```bash
# 启动 PostgreSQL 和 Redis（使用 Docker）
docker run -d \
  --name postgres_dev \
  -e POSTGRES_DB=gov_report_diff \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15-alpine

docker run -d \
  --name redis_dev \
  -p 6379:6379 \
  redis:7-alpine
```

### 2. 安装依赖

```bash
# 安装 Node 依赖
npm install

# 安装 Python 依赖
pip3 install -r python/requirements.txt
```

### 3. 启动后端服务

**终端 1：启动 API**

```bash
npm run dev:api
```

输出应该显示：
```
✓ Database connection successful
✓ API Server running on port 3000
```

**终端 2：启动 Worker**

```bash
npm run dev:worker
```

输出应该显示：
```
✓ Database connection successful
✓ Worker process started and listening to queues
```

### 4. 启动前端

**终端 3：启动前端开发服务器**

```bash
cd frontend
npm start
```

前端应该在 `http://localhost:3000` 启动（如果 React 使用不同端口，会自动调整）

---

## 🧪 测试 PDF 上传

### 1. 准备测试 PDF

创建 `sample_pdfs_v1/` 目录并放入样例 PDF：

```bash
mkdir -p sample_pdfs_v1
# 复制你的 PDF 文件到该目录
```

### 2. 通过前端上传

1. 打开浏览器访问 `http://localhost:3000`
2. 找到上传界面
3. 选择 PDF 文件上传
4. 观察处理进度

### 3. 通过 API 上传（curl）

```bash
# 上传 PDF
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@sample_pdfs_v1/test.pdf" \
  -F "city=北京市" \
  -F "year=2023"

# 查看上传的资产
curl http://localhost:3000/api/v1/assets
```

### 4. 监控处理进度

**查看 API 日志**：
```bash
# 在 API 终端查看请求日志
```

**查看 Worker 日志**：
```bash
# 在 Worker 终端查看处理日志
# 应该显示 Python 脚本执行和表格提取过程
```

**查看任务状态**：
```bash
curl http://localhost:3000/api/v1/tasks
```

---

## 🔍 验证系统

### 1. 健康检查

```bash
# API 健康检查
curl http://localhost:3000/health

# 应该返回：
# {"status":"ok"}
```

### 2. 数据库连接

```bash
# 进入 PostgreSQL
psql -h localhost -U postgres -d gov_report_diff

# 查看表
\dt

# 查看任务
SELECT * FROM compare_tasks;
```

### 3. Redis 连接

```bash
# 连接 Redis
redis-cli

# 查看队列
LLEN bull:compareTaskQueue:jobs

# 查看所有 keys
KEYS *
```

### 4. Python 脚本测试

```bash
# 手动测试 Python 表格提取
python3 python/extract_tables_pdfplumber.py \
  sample_pdfs_v1/test.pdf \
  --schema src/schemas/annual_report_table_schema_v2.json \
  --out -

# 应该输出 JSON 格式的表格数据
```

---

## 📊 查看处理结果

### 1. 前端查看

- 打开前端应用
- 查看任务列表
- 点击任务查看详情
- 查看表格完整性指标和 issues

### 2. 数据库查看

```bash
# 查看任务详情
SELECT task_id, status, progress, stage FROM compare_tasks LIMIT 5;

# 查看解析结果
SELECT task_id, content FROM compare_tasks WHERE content IS NOT NULL LIMIT 1;
```

### 3. 日志查看

```bash
# API 日志（在 API 终端）
# 显示请求和响应

# Worker 日志（在 Worker 终端）
# 显示任务处理过程
# 包括 Python 脚本执行结果
```

---

## 🐛 故障排查

### 问题 1：API 无法连接数据库

**症状**：
```
Failed to start API server: AggregateError
code: 'ECONNREFUSED'
```

**解决方案**：
```bash
# 检查 PostgreSQL 是否运行
docker ps | grep postgres

# 如果未运行，启动它
docker run -d \
  --name postgres_dev \
  -e POSTGRES_DB=gov_report_diff \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15-alpine
```

### 问题 2：Worker 无法消费队列

**症状**：
```
任务入队但不被处理
```

**解决方案**：
```bash
# 检查 Redis 是否运行
docker ps | grep redis

# 检查 Worker 日志
# 应该显示 "Worker process started"

# 检查队列
redis-cli LLEN bull:compareTaskQueue:jobs
```

### 问题 3：Python 脚本执行失败

**症状**：
```
Worker 日志显示 Python 错误
```

**解决方案**：
```bash
# 检查 Python 依赖
pip3 list | grep pdfplumber

# 手动测试 Python 脚本
python3 python/extract_tables_pdfplumber.py \
  sample_pdfs_v1/test.pdf \
  --schema src/schemas/annual_report_table_schema_v2.json \
  --out -

# 查看错误信息
```

### 问题 4：前端无法连接 API

**症状**：
```
前端显示 API 连接错误
```

**解决方案**：
```bash
# 检查 API 是否运行
curl http://localhost:3000/health

# 检查前端配置
# 确保前端使用相对路径 /api/v1/...

# 检查 CORS 配置
# 如需要，在 API 中添加 CORS 中间件
```

---

## 📝 常用命令

### 启动/停止服务

```bash
# 启动所有服务
npm run dev:api &
npm run dev:worker &
cd frontend && npm start &

# 停止所有服务
pkill -f "npm run dev"
pkill -f "node"
```

### 数据库操作

```bash
# 连接数据库
psql -h localhost -U postgres -d gov_report_diff

# 运行迁移
npm run db:migrate

# 清空数据（谨慎操作）
psql -h localhost -U postgres -d gov_report_diff -c "DROP TABLE IF EXISTS compare_tasks CASCADE;"
```

### 日志查看

```bash
# 查看 API 日志
tail -f logs/api.log

# 查看 Worker 日志
tail -f logs/worker.log

# 查看 Redis 日志
docker logs redis_dev -f
```

---

## 🎯 完整测试流程

### 1. 环境准备（5 分钟）

```bash
# 启动数据库
docker run -d --name postgres_dev \
  -e POSTGRES_DB=gov_report_diff \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:15-alpine

# 启动 Redis
docker run -d --name redis_dev -p 6379:6379 redis:7-alpine

# 安装依赖
npm install
pip3 install -r python/requirements.txt
```

### 2. 启动服务（3 分钟）

```bash
# 终端 1
npm run dev:api

# 终端 2
npm run dev:worker

# 终端 3
cd frontend && npm start
```

### 3. 验证系统（2 分钟）

```bash
# 检查 API
curl http://localhost:3000/health

# 检查前端
# 打开 http://localhost:3000
```

### 4. 上传测试（5 分钟）

```bash
# 准备样例 PDF
mkdir -p sample_pdfs_v1
# 复制 PDF 文件

# 通过前端上传
# 或通过 API 上传
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@sample_pdfs_v1/test.pdf" \
  -F "city=北京市" \
  -F "year=2023"
```

### 5. 监控处理（10 分钟）

```bash
# 查看 Worker 日志
# 应该显示 Python 脚本执行

# 查看任务状态
curl http://localhost:3000/api/v1/tasks

# 查看前端结果
# 打开浏览器查看处理结果
```

---

## 📊 预期输出

### API 启动

```
✓ Database connection successful: { now: '2025-12-15T10:30:00.000Z' }
✓ Database initialization completed
✓ API Server running on port 3000
```

### Worker 启动

```
✓ Database connection successful: { now: '2025-12-15T10:30:05.000Z' }
✓ Database initialization completed
✓ Worker process started and listening to queues
✓ Worker concurrency: 2
✓ Compare task processor registered
✓ AI suggestion processor registered
✓ DOCX export processor registered
✓ Batch job processor registered
✓ All queue processors initialized
```

### Python 脚本输出

```json
{
  "schema_version": "annual_report_table_schema_v2",
  "tables": {
    "sec2_art20_1": {
      "table_id": "sec2_art20_1",
      "rows": [...],
      "columns": [...],
      "cells": {...},
      "metrics": {
        "totalCells": 120,
        "nonEmptyCells": 85,
        "nonEmptyRatio": 0.7083,
        "matchedRows": 19,
        "expectedRows": 20,
        "rowMatchRate": 0.95,
        "numericParseRate": 0.88
      },
      "confidence": 0.86,
      "completeness": "partial",
      "issues": [...]
    }
  }
}
```

---

## 🔗 相关文档

- [QUICK_START_DEPLOYMENT.md](./QUICK_START_DEPLOYMENT.md) - Docker Compose 快速启动
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - 完整部署指南
- [IMPLEMENTATION_SUMMARY_PHASE8.md](./IMPLEMENTATION_SUMMARY_PHASE8.md) - 实现总结

---

## 💡 提示

1. **保持终端打开**：API、Worker 和前端都需要在单独的终端中运行
2. **查看日志**：遇到问题时首先查看各个服务的日志
3. **使用 curl 测试**：可以用 curl 命令测试 API 端点
4. **监控数据库**：使用 `psql` 或 `redis-cli` 监控数据库状态
5. **清理环境**：测试完成后记得停止 Docker 容器

---

**最后更新**：2025-12-15  
**版本**：1.0.0

