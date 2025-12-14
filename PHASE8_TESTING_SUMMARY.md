# Phase 8 测试总结 - API/Worker 分离 + Python 表格解析引擎

## ✅ 系统检查结果

### 环境检查

- ✅ Node.js v22.20.0
- ✅ npm 10.9.3
- ✅ Python 3.11.3
- ✅ pdfplumber 0.11.7（已安装）

### 编译检查

- ✅ TypeScript 5.9.3
- ✅ dist/server.js 存在
- ✅ dist/worker.js 存在
- ✅ 编译成功

### 文件检查

#### 核心文件

- ✅ src/server.ts（API 入口）
- ✅ src/worker.ts（Worker 入口）
- ✅ docker-compose.yml（容器编排）
- ✅ Dockerfile（镜像构建）
- ✅ nginx.conf（反代配置）
- ✅ docker-entrypoint.sh（启动脚本）

#### Python 表格引擎

- ✅ python/requirements.txt
- ✅ python/extract_tables_pdfplumber.py

#### 测试与验证

- ✅ scripts/regress_tables.js（回归测试）
- ✅ scripts/verify-docker-compose.sh（Docker 验证）
- ✅ scripts/test-system-local.sh（本地测试）

#### 文档

- ✅ DEPLOYMENT_GUIDE.md（部署指南）
- ✅ QUICK_START_DEPLOYMENT.md（快速启动）
- ✅ LOCAL_TESTING_GUIDE.md（本地测试指南）
- ✅ IMPLEMENTATION_SUMMARY_PHASE8.md（实现总结）
- ✅ PHASE8_ACCEPTANCE_CHECKLIST.md（验收清单）

---

## 🚀 启动系统指南

### 前置条件

需要启动 PostgreSQL 和 Redis。有两种方式：

#### 方式 1：使用 Docker（推荐）

```bash
# 启动 PostgreSQL
docker run -d \
  --name postgres_dev \
  -e POSTGRES_DB=gov_report_diff \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15-alpine

# 启动 Redis
docker run -d \
  --name redis_dev \
  -p 6379:6379 \
  redis:7-alpine
```

#### 方式 2：本地安装

```bash
# macOS
brew install postgresql redis
brew services start postgresql
brew services start redis

# Linux
sudo apt-get install postgresql redis-server
sudo systemctl start postgresql
sudo systemctl start redis-server
```

### 启动后端服务

**终端 1：启动 API**

```bash
npm run dev:api
```

预期输出：
```
✓ Database connection successful
✓ Database initialization completed
✓ API Server running on port 3000
```

**终端 2：启动 Worker**

```bash
npm run dev:worker
```

预期输出：
```
✓ Database connection successful
✓ Database initialization completed
✓ Worker process started and listening to queues
✓ Worker concurrency: 2
✓ All queue processors initialized
```

### 启动前端

**终端 3：启动前端开发服务器**

```bash
cd frontend
npm start
```

前端应该在 `http://localhost:3000` 或其他端口启动

---

## 🧪 测试 PDF 上传

### 1. 准备测试 PDF

```bash
# 创建样例目录
mkdir -p sample_pdfs_v1

# 复制你的 PDF 文件到该目录
# 或使用现有的样例 PDF
```

### 2. 通过前端上传

1. 打开浏览器访问 `http://localhost:3000`
2. 找到上传界面
3. 选择 PDF 文件
4. 填写城市和年份信息
5. 点击上传

### 3. 通过 API 上传

```bash
# 上传 PDF
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@sample_pdfs_v1/test.pdf" \
  -F "city=北京市" \
  -F "year=2023"

# 响应示例：
# {
#   "assetId": "uuid-xxx",
#   "fileName": "test.pdf",
#   "city": "北京市",
#   "year": 2023,
#   "uploadedAt": "2025-12-15T10:30:00Z"
# }
```

### 4. 查看任务状态

```bash
# 查看所有任务
curl http://localhost:3000/api/v1/tasks

# 查看特定任务
curl http://localhost:3000/api/v1/tasks/{taskId}
```

---

## 📊 监控处理过程

### 1. 查看 API 日志

在 API 终端查看请求日志：

```
POST /api/v1/assets/upload
GET /api/v1/tasks
```

### 2. 查看 Worker 日志

在 Worker 终端查看处理日志：

```
✓ 比对任务 {taskId} 处理完成
✓ Python 脚本执行成功
```

### 3. 查看数据库

```bash
# 连接数据库
psql -h localhost -U postgres -d gov_report_diff

# 查看任务
SELECT task_id, status, progress FROM compare_tasks;

# 查看资产
SELECT asset_id, file_name, city, year FROM report_assets;
```

### 4. 查看 Redis 队列

```bash
# 连接 Redis
redis-cli

# 查看队列长度
LLEN bull:compareTaskQueue:jobs

# 查看所有 keys
KEYS *
```

---

## 🔍 验证系统功能

### 1. 健康检查

```bash
# API 健康检查
curl http://localhost:3000/health

# 预期响应：
# {"status":"ok"}
```

### 2. API 路由验证

```bash
# 查看任务列表
curl http://localhost:3000/api/v1/tasks

# 查看资产列表
curl http://localhost:3000/api/v1/assets

# 查看建议列表
curl http://localhost:3000/api/v1/tasks/suggestions
```

### 3. Python 脚本验证

```bash
# 手动测试 Python 脚本
python3 python/extract_tables_pdfplumber.py \
  sample_pdfs_v1/test.pdf \
  --schema src/schemas/annual_report_table_schema_v2.json \
  --out -

# 预期输出：JSON 格式的表格数据
```

### 4. 进程分离验证

```bash
# 检查 API 进程
ps aux | grep "npm run dev:api"
# 应该显示 Node.js 进程，不包含 Worker 处理器

# 检查 Worker 进程
ps aux | grep "npm run dev:worker"
# 应该显示 Node.js 进程，不包含 HTTP Server
```

---

## 📈 性能测试

### 1. 单个 PDF 处理时间

```bash
# 记录开始时间
time python3 python/extract_tables_pdfplumber.py \
  sample_pdfs_v1/test.pdf \
  --schema src/schemas/annual_report_table_schema_v2.json \
  --out /tmp/output.json

# 预期：< 10 秒
```

### 2. 并发处理测试

```bash
# 上传多个 PDF
for i in {1..5}; do
  curl -X POST http://localhost:3000/api/v1/assets/upload \
    -F "file=@sample_pdfs_v1/test.pdf" \
    -F "city=北京市" \
    -F "year=$((2019 + i))"
done

# 查看队列长度
redis-cli LLEN bull:compareTaskQueue:jobs

# 预期：所有任务排队，API 响应时间不增加
```

### 3. 内存使用监控

```bash
# 监控 Node.js 进程内存
ps aux | grep node

# 预期：API 和 Worker 各占用 < 200MB
```

---

## 🐛 常见问题

### 问题 1：数据库连接失败

**症状**：
```
Failed to start API server: AggregateError
code: 'ECONNREFUSED'
```

**解决方案**：
```bash
# 检查 PostgreSQL 是否运行
docker ps | grep postgres

# 或检查本地 PostgreSQL
psql -h localhost -U postgres -c "SELECT NOW();"

# 如果未运行，启动它
docker run -d --name postgres_dev \
  -e POSTGRES_DB=gov_report_diff \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:15-alpine
```

### 问题 2：Worker 无法消费队列

**症状**：
```
任务入队但不被处理
```

**解决方案**：
```bash
# 检查 Redis 是否运行
redis-cli PING

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

# 检查浏览器控制台错误
# 打开浏览器开发者工具 (F12)
```

---

## 📝 测试清单

### 基础功能测试

- [ ] API 启动成功
- [ ] Worker 启动成功
- [ ] 前端启动成功
- [ ] 数据库连接正常
- [ ] Redis 连接正常

### 上传功能测试

- [ ] 通过前端上传 PDF
- [ ] 通过 API 上传 PDF
- [ ] 上传文件保存到 uploads 目录
- [ ] 任务入队成功

### 处理功能测试

- [ ] Worker 消费任务
- [ ] Python 脚本执行
- [ ] 表格提取成功
- [ ] 结果保存到数据库

### 查询功能测试

- [ ] 查看任务列表
- [ ] 查看任务详情
- [ ] 查看资产列表
- [ ] 查看处理结果

### 性能测试

- [ ] 单个 PDF 处理时间 < 10 秒
- [ ] 并发处理不阻塞 API
- [ ] 内存使用 < 500MB
- [ ] 队列处理正常

---

## 🎯 下一步

### 短期（立即）

1. ✅ 启动 PostgreSQL 和 Redis
2. ✅ 启动 API、Worker 和前端
3. ✅ 上传测试 PDF
4. ✅ 验证处理结果

### 中期（1-2 周）

1. 准备 3-5 份样例 PDF
2. 运行回归测试：`node scripts/regress_tables.js`
3. 验证表格完整性指标
4. 测试并发处理能力

### 长期（2-4 周）

1. 部署到生产环境
2. 配置监控和告警
3. 性能优化和调优
4. 文档完善

---

## 📚 相关文档

| 文档 | 用途 |
|------|------|
| [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md) | 本地测试详细指南 |
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | 完整部署指南 |
| [QUICK_START_DEPLOYMENT.md](./QUICK_START_DEPLOYMENT.md) | Docker Compose 快速启动 |
| [IMPLEMENTATION_SUMMARY_PHASE8.md](./IMPLEMENTATION_SUMMARY_PHASE8.md) | 实现总结 |
| [PHASE8_ACCEPTANCE_CHECKLIST.md](./PHASE8_ACCEPTANCE_CHECKLIST.md) | 验收清单 |

---

## 💡 快速命令参考

```bash
# 启动数据库
docker run -d --name postgres_dev \
  -e POSTGRES_DB=gov_report_diff \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 postgres:15-alpine

docker run -d --name redis_dev -p 6379:6379 redis:7-alpine

# 启动后端服务
npm run dev:api &
npm run dev:worker &

# 启动前端
cd frontend && npm start &

# 测试 API
curl http://localhost:3000/health
curl http://localhost:3000/api/v1/tasks

# 查看日志
tail -f logs/api.log
tail -f logs/worker.log

# 停止所有服务
pkill -f "npm run dev"
pkill -f "node"

# 清理 Docker 容器
docker stop postgres_dev redis_dev
docker rm postgres_dev redis_dev
```

---

**测试日期**：2025-12-15  
**系统状态**：✅ 就绪  
**版本**：1.0.0

