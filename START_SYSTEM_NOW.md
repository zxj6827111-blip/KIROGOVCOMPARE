# 🚀 立即启动系统 - 3 个终端

## ⚠️ 前置条件

你需要在本地安装并运行：
- **PostgreSQL** 
- **Redis**

### macOS 安装（使用 Homebrew）

```bash
# 安装 PostgreSQL
brew install postgresql@15

# 安装 Redis
brew install redis

# 启动 PostgreSQL
brew services start postgresql@15

# 启动 Redis
brew services start redis
```

### 验证安装

```bash
# 检查 PostgreSQL
psql --version

# 检查 Redis
redis-cli ping
# 应该返回：PONG
```

---

## 🎯 启动 3 个终端

### 终端 1：启动 API

```bash
npm run dev:api
```

**预期输出：**
```
✓ Database connection successful
✓ Database initialization completed
✓ API Server running on port 3000
```

### 终端 2：启动 Worker

```bash
npm run dev:worker
```

**预期输出：**
```
✓ Database connection successful
✓ Database initialization completed
✓ Worker process started and listening to queues
✓ Worker concurrency: 2
✓ All queue processors initialized
```

### 终端 3：启动前端

```bash
cd frontend
npm start
```

**预期输出：**
```
Compiled successfully!
You can now view the app in the browser.
```

---

## ✅ 验证系统

### 1. 检查 API 健康状态

```bash
curl http://localhost:3000/health
```

**预期响应：**
```json
{"status":"ok"}
```

### 2. 打开浏览器

访问：`http://localhost:3000`

应该看到前端应用界面

### 3. 查看任务列表

```bash
curl http://localhost:3000/api/v1/tasks
```

---

## 📤 上传 PDF 测试

### 1. 准备 PDF 文件

```bash
# 创建样例目录
mkdir -p sample_pdfs_v1

# 复制你的 PDF 文件到该目录
# 或使用现有的样例 PDF
```

### 2. 通过 API 上传

```bash
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@sample_pdfs_v1/test.pdf" \
  -F "city=北京市" \
  -F "year=2023"
```

### 3. 查看任务

```bash
curl http://localhost:3000/api/v1/tasks
```

---

## 📊 监控处理

### 查看 API 日志
在**终端 1**查看请求日志

### 查看 Worker 日志
在**终端 2**查看处理日志

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

## 🐛 常见问题

### 问题 1：PostgreSQL 连接失败

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**解决方案：**
```bash
# 检查 PostgreSQL 是否运行
brew services list | grep postgresql

# 启动 PostgreSQL
brew services start postgresql@15

# 或手动启动
pg_ctl -D /usr/local/var/postgres start
```

### 问题 2：Redis 连接失败

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**解决方案：**
```bash
# 检查 Redis 是否运行
redis-cli ping

# 启动 Redis
brew services start redis

# 或手动启动
redis-server
```

### 问题 3：端口已被占用

```
Error: listen EADDRINUSE :::3000
```

**解决方案：**
```bash
# 查找占用端口的进程
lsof -i :3000

# 杀死进程
kill -9 <PID>
```

---

## 💡 快速命令参考

```bash
# 启动 PostgreSQL
brew services start postgresql@15

# 启动 Redis
brew services start redis

# 启动 API
npm run dev:api

# 启动 Worker
npm run dev:worker

# 启动前端
cd frontend && npm start

# 测试 API
curl http://localhost:3000/health

# 查看任务
curl http://localhost:3000/api/v1/tasks

# 停止 PostgreSQL
brew services stop postgresql@15

# 停止 Redis
brew services stop redis
```

---

## 📝 完整启动流程

### 第 1 步：启动数据库（如果未运行）

```bash
brew services start postgresql@15
brew services start redis
```

### 第 2 步：打开 3 个终端

**终端 1：**
```bash
npm run dev:api
```

**终端 2：**
```bash
npm run dev:worker
```

**终端 3：**
```bash
cd frontend && npm start
```

### 第 3 步：验证系统

```bash
# 在新终端中运行
curl http://localhost:3000/health
```

### 第 4 步：打开浏览器

访问 `http://localhost:3000`

### 第 5 步：上传 PDF 测试

```bash
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@sample.pdf" \
  -F "city=北京市" \
  -F "year=2023"
```

---

## ✨ 系统就绪！

现在你可以：
- ✅ 上传 PDF 文件
- ✅ 查看处理进度
- ✅ 查看表格提取结果
- ✅ 监控系统日志

---

**需要帮助？** 查看 [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md) 获取详细信息

