# 🎯 本地启动完整命令指南

## 📋 前置条件检查

在启动系统前，请确保已安装以下服务：

```bash
# 检查 PostgreSQL
psql --version

# 检查 Redis
redis-cli ping
# 应该返回：PONG

# 检查 Node.js
node --version

# 检查 npm
npm --version
```

---

## 🚀 启动步骤

### 第 1 步：启动数据库服务（如果未运行）

```bash
# 启动 PostgreSQL
brew services start postgresql@15

# 启动 Redis
brew services start redis

# 验证
brew services list | grep -E "postgresql|redis"
```

### 第 2 步：打开 3 个独立终端窗口

#### 终端 1 - 启动 API 服务器

```bash
npm run dev:api
```

**预期输出：**
```
✓ Database connection successful
✓ Database initialization completed
✓ API Server running on port 3000
```

#### 终端 2 - 启动 Worker 进程

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

#### 终端 3 - 启动前端应用

```bash
cd frontend && npm start
```

**预期输出：**
```
Compiled successfully!

You can now view the app in the browser.

  Local:            http://localhost:3000
  On Your Network:  http://192.168.x.x:3000
```

---

## ✅ 验证系统启动成功

### 1. 检查 API 健康状态

在新终端中运行：

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

**预期响应：**
```json
[]
```

---

## 📤 上传 PDF 测试

### 方法 1：使用 curl 命令上传

```bash
# 上传 PDF 文件
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@/path/to/your/file.pdf" \
  -F "city=北京市" \
  -F "year=2023"
```

**预期响应：**
```json
{
  "id": "uuid-here",
  "filename": "file.pdf",
  "city": "北京市",
  "year": 2023,
  "status": "pending",
  "createdAt": "2025-12-15T..."
}
```

### 方法 2：使用前端界面上传

1. 打开浏览器访问 `http://localhost:3000`
2. 找到上传表单
3. 选择 PDF 文件
4. 填写城市和年份
5. 点击上传

---

## 📊 监控处理进度

### 查看所有任务

```bash
curl http://localhost:3000/api/v1/tasks
```

### 查看特定任务详情

```bash
curl http://localhost:3000/api/v1/tasks/{taskId}
```

### 查看 API 日志

在**终端 1**中查看实时日志

### 查看 Worker 日志

在**终端 2**中查看实时日志

---

## 🔍 数据库查询

### 连接数据库

```bash
psql -h localhost -U postgres -d gov_report_diff
```

### 查看任务表

```sql
SELECT id, status, created_at FROM compare_tasks ORDER BY created_at DESC LIMIT 10;
```

### 查看资产表

```sql
SELECT id, filename, city, year FROM report_assets ORDER BY created_at DESC LIMIT 10;
```

### 查看队列状态

```bash
redis-cli
LLEN bull:compareTaskQueue:jobs
LLEN bull:compareTaskQueue:active
LLEN bull:compareTaskQueue:completed
```

---

## 🛑 停止系统

### 停止前端（终端 3）

```bash
# 按 Ctrl+C
```

### 停止 Worker（终端 2）

```bash
# 按 Ctrl+C
```

### 停止 API（终端 1）

```bash
# 按 Ctrl+C
```

### 停止数据库服务

```bash
# 停止 PostgreSQL
brew services stop postgresql@15

# 停止 Redis
brew services stop redis
```

---

## 🐛 常见问题排查

### 问题 1：PostgreSQL 连接失败

```
Error: connect ECONNREFUSED 127.0.0.1:5432
```

**解决方案：**
```bash
# 检查 PostgreSQL 状态
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
# 检查 Redis 状态
redis-cli ping

# 启动 Redis
brew services start redis

# 或手动启动
redis-server
```

### 问题 3：端口 3000 已被占用

```
Error: listen EADDRINUSE :::3000
```

**解决方案：**
```bash
# 查找占用端口的进程
lsof -i :3000

# 杀死进程（替换 PID）
kill -9 <PID>

# 或更改端口
PORT=3001 npm run dev:api
```

### 问题 4：前端无法连接到 API

**症状：** 前端显示错误，无法加载数据

**解决方案：**
```bash
# 检查 API 是否运行
curl http://localhost:3000/health

# 检查前端代理配置
cat frontend/package.json | grep proxy

# 检查浏览器控制台错误
# 打开浏览器 -> F12 -> Console 标签
```

### 问题 5：npm 依赖缺失

```
Error: Cannot find module 'express'
```

**解决方案：**
```bash
# 重新安装依赖
npm install

# 前端依赖
cd frontend && npm install && cd ..
```

---

## 💡 快速命令参考

```bash
# 启动数据库
brew services start postgresql@15
brew services start redis

# 启动 API（终端 1）
npm run dev:api

# 启动 Worker（终端 2）
npm run dev:worker

# 启动前端（终端 3）
cd frontend && npm start

# 测试 API
curl http://localhost:3000/health

# 上传 PDF
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@test.pdf" \
  -F "city=北京市" \
  -F "year=2023"

# 查看任务
curl http://localhost:3000/api/v1/tasks

# 停止数据库
brew services stop postgresql@15
brew services stop redis
```

---

## 📝 完整启动流程（一步一步）

### 第 1 步：启动数据库

```bash
brew services start postgresql@15
brew services start redis
sleep 2
```

### 第 2 步：打开终端 1 - API

```bash
npm run dev:api
```

等待看到：`✓ API Server running on port 3000`

### 第 3 步：打开终端 2 - Worker

```bash
npm run dev:worker
```

等待看到：`✓ Worker process started and listening to queues`

### 第 4 步：打开终端 3 - 前端

```bash
cd frontend && npm start
```

等待看到：`Compiled successfully!`

### 第 5 步：验证系统

在新终端中运行：

```bash
curl http://localhost:3000/health
```

### 第 6 步：打开浏览器

访问：`http://localhost:3000`

### 第 7 步：上传 PDF 测试

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
- ✅ 查询数据库

---

## 📚 相关文档

- [START_SYSTEM_NOW.md](./START_SYSTEM_NOW.md) - 详细启动指南
- [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md) - 本地测试详细指南
- [QUICK_REFERENCE_PHASE8.md](./QUICK_REFERENCE_PHASE8.md) - 快速参考
- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - Docker 部署指南

---

**准备好了吗？** 按照上面的步骤启动系统！
