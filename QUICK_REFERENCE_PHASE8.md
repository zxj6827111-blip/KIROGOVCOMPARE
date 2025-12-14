# Phase 8 快速参考卡片

## 🚀 5 分钟快速启动

### 1. 启动数据库

```bash
# Docker 方式（推荐）
docker run -d --name postgres_dev \
  -e POSTGRES_DB=gov_report_diff \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:15-alpine

docker run -d --name redis_dev -p 6379:6379 redis:7-alpine
```

### 2. 启动后端（3 个终端）

```bash
# 终端 1：API
npm run dev:api

# 终端 2：Worker
npm run dev:worker

# 终端 3：前端
cd frontend && npm start
```

### 3. 验证系统

```bash
# 健康检查
curl http://localhost:3000/health

# 打开浏览器
http://localhost:3000
```

---

## 📤 上传 PDF 测试

### 通过前端上传

1. 打开 `http://localhost:3000`
2. 找到上传界面
3. 选择 PDF 文件
4. 填写城市和年份
5. 点击上传

### 通过 API 上传

```bash
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@sample.pdf" \
  -F "city=北京市" \
  -F "year=2023"
```

---

## 📊 查看结果

### 查看任务列表

```bash
curl http://localhost:3000/api/v1/tasks
```

### 查看任务详情

```bash
curl http://localhost:3000/api/v1/tasks/{taskId}
```

### 查看资产列表

```bash
curl http://localhost:3000/api/v1/assets
```

---

## 🔍 监控处理

### 查看 API 日志

在 API 终端查看请求日志

### 查看 Worker 日志

在 Worker 终端查看处理日志

### 查看数据库

```bash
psql -h localhost -U postgres -d gov_report_diff
SELECT * FROM compare_tasks;
```

### 查看 Redis 队列

```bash
redis-cli
LLEN bull:compareTaskQueue:jobs
```

---

## 🧪 测试 Python 脚本

```bash
python3 python/extract_tables_pdfplumber.py \
  sample.pdf \
  --schema src/schemas/annual_report_table_schema_v2.json \
  --out -
```

---

## 🐛 常见问题

### 数据库连接失败

```bash
# 检查 PostgreSQL
docker ps | grep postgres

# 启动 PostgreSQL
docker run -d --name postgres_dev \
  -e POSTGRES_DB=gov_report_diff \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:15-alpine
```

### Worker 不处理任务

```bash
# 检查 Redis
redis-cli PING

# 检查队列
redis-cli LLEN bull:compareTaskQueue:jobs
```

### Python 脚本错误

```bash
# 检查依赖
pip3 list | grep pdfplumber

# 手动测试
python3 python/extract_tables_pdfplumber.py test.pdf \
  --schema src/schemas/annual_report_table_schema_v2.json \
  --out -
```

---

## 📁 关键文件

| 文件 | 说明 |
|------|------|
| `src/server.ts` | API 入口 |
| `src/worker.ts` | Worker 入口 |
| `python/extract_tables_pdfplumber.py` | 表格提取脚本 |
| `docker-compose.yml` | 容器编排 |
| `nginx.conf` | 反代配置 |

---

## 📚 文档导航

| 文档 | 用途 |
|------|------|
| [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md) | 本地测试详细指南 |
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | 完整部署指南 |
| [QUICK_START_DEPLOYMENT.md](./QUICK_START_DEPLOYMENT.md) | Docker 快速启动 |
| [PHASE8_TESTING_SUMMARY.md](./PHASE8_TESTING_SUMMARY.md) | 测试总结 |
| [PHASE8_COMPLETION_REPORT.md](./PHASE8_COMPLETION_REPORT.md) | 完成报告 |

---

## 🎯 系统架构

```
Browser
  ↓
Nginx (80)
  ├─ 前端静态站点
  ├─ /api/v1/* → API:3000
  └─ /health → API:3000/health

API (Node)
  ├─ Express 路由
  ├─ 入队
  └─ 读库返回

Worker (Node)
  ├─ 消费队列
  ├─ Python 表格提取
  └─ 结果落库

Postgres + Redis
  └─ 数据存储和队列
```

---

## ⚙️ 环境变量

### API 配置

```bash
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gov_report_diff
REDIS_URL=redis://localhost:6379
PORT=3000
DISABLE_PROCESSORS=1
ENABLE_TS_TABLE_FALLBACK=0
```

### Worker 配置

```bash
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gov_report_diff
REDIS_URL=redis://localhost:6379
WORKER_CONCURRENCY=2
PY_TABLE_TIMEOUT_MS=180000
ENABLE_TS_TABLE_FALLBACK=0
```

---

## 💡 性能指标

| 指标 | 目标 | 说明 |
|------|------|------|
| API 响应时间 | < 100ms | 不包括处理时间 |
| PDF 处理时间 | < 10s | 单个 PDF |
| 并发处理 | 10+ | 同时处理能力 |
| 内存使用 | < 500MB | API + Worker |
| 表格提取准确率 | > 85% | 完整性指标 |

---

## 🔗 常用命令

```bash
# 启动/停止
npm run dev:api
npm run dev:worker
cd frontend && npm start

# 编译
npm run build

# 测试
bash scripts/test-system-local.sh
node scripts/regress_tables.js

# 数据库
npm run db:migrate
psql -h localhost -U postgres -d gov_report_diff

# Docker
docker ps
docker logs [container]
docker exec -it [container] bash
```

---

## ✅ 验收清单

- [ ] API 启动成功
- [ ] Worker 启动成功
- [ ] 前端启动成功
- [ ] PDF 上传成功
- [ ] 表格提取成功
- [ ] 结果保存成功
- [ ] 查询功能正常
- [ ] 并发处理正常

---

## 📞 获取帮助

1. 查看 [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md)
2. 运行 `bash scripts/test-system-local.sh`
3. 查看容器日志
4. 查看代码注释

---

**版本**：1.0.0  
**更新**：2025-12-15  
**状态**：✅ 就绪

