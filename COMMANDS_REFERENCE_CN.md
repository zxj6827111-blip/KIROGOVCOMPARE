# 📖 命令参考 - 中文版

## 🎯 核心启动命令

### 启动数据库

```bash
# 启动 PostgreSQL
brew services start postgresql@15

# 启动 Redis
brew services start redis

# 验证
psql --version
redis-cli ping
```

### 启动系统（3 个终端）

```bash
# 终端 1 - API 服务器
npm run dev:api

# 终端 2 - Worker 进程
npm run dev:worker

# 终端 3 - 前端应用
cd frontend && npm start
```

### 一键启动脚本

```bash
chmod +x start-system.sh
./start-system.sh
```

---

## ✅ 验证命令

### 检查 API 状态

```bash
curl http://localhost:3000/health
```

**预期响应：**
```json
{"status":"ok"}
```

### 查看任务列表

```bash
curl http://localhost:3000/api/v1/tasks
```

### 查看特定任务

```bash
curl http://localhost:3000/api/v1/tasks/{taskId}
```

---

## 📤 上传命令

### 上传 PDF 文件

```bash
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@test.pdf" \
  -F "city=北京市" \
  -F "year=2023"
```

### 上传多个文件

```bash
# 上传文件 1
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@file1.pdf" \
  -F "city=北京市" \
  -F "year=2023"

# 上传文件 2
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@file2.pdf" \
  -F "city=上海市" \
  -F "year=2023"
```

---

## 🔍 查询命令

### 查看所有任务

```bash
curl http://localhost:3000/api/v1/tasks
```

### 查看所有资产

```bash
curl http://localhost:3000/api/v1/assets
```

### 按状态查询任务

```bash
# 查询待处理任务
curl "http://localhost:3000/api/v1/tasks?status=pending"

# 查询已完成任务
curl "http://localhost:3000/api/v1/tasks?status=completed"

# 查询失败任务
curl "http://localhost:3000/api/v1/tasks?status=failed"
```

---

## 🗄️ 数据库命令

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

### 查看表结构

```sql
\d compare_tasks
\d report_assets
```

### 清空表数据

```sql
DELETE FROM compare_tasks;
DELETE FROM report_assets;
```

---

## 🔴 Redis 命令

### 连接 Redis

```bash
redis-cli
```

### 查看队列长度

```bash
LLEN bull:compareTaskQueue:jobs
LLEN bull:compareTaskQueue:active
LLEN bull:compareTaskQueue:completed
```

### 查看队列内容

```bash
LRANGE bull:compareTaskQueue:jobs 0 -1
```

### 清空队列

```bash
DEL bull:compareTaskQueue:jobs
DEL bull:compareTaskQueue:active
DEL bull:compareTaskQueue:completed
```

### 查看所有键

```bash
KEYS *
```

---

## 🛑 停止命令

### 停止 API 服务器

```bash
# 在终端 1 按 Ctrl+C
```

### 停止 Worker 进程

```bash
# 在终端 2 按 Ctrl+C
```

### 停止前端应用

```bash
# 在终端 3 按 Ctrl+C
```

### 停止数据库服务

```bash
# 停止 PostgreSQL
brew services stop postgresql@15

# 停止 Redis
brew services stop redis
```

### 重启数据库服务

```bash
# 重启 PostgreSQL
brew services restart postgresql@15

# 重启 Redis
brew services restart redis
```

---

## 🔧 故障排查命令

### 检查端口占用

```bash
# 检查端口 3000
lsof -i :3000

# 检查端口 3001
lsof -i :3001

# 检查端口 5432（PostgreSQL）
lsof -i :5432

# 检查端口 6379（Redis）
lsof -i :6379
```

### 杀死进程

```bash
# 杀死占用端口 3000 的进程
kill -9 <PID>

# 或使用 fuser
fuser -k 3000/tcp
```

### 检查服务状态

```bash
# 查看所有 Homebrew 服务
brew services list

# 查看 PostgreSQL 状态
brew services list | grep postgresql

# 查看 Redis 状态
brew services list | grep redis
```

### 查看日志

```bash
# PostgreSQL 日志
tail -f /usr/local/var/log/postgres.log

# Redis 日志
tail -f /usr/local/var/log/redis.log
```

---

## 📦 依赖管理命令

### 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd frontend && npm install && cd ..
```

### 更新依赖

```bash
# 更新后端依赖
npm update

# 更新前端依赖
cd frontend && npm update && cd ..
```

### 清理依赖

```bash
# 清理后端缓存
npm cache clean --force

# 删除 node_modules 并重新安装
rm -rf node_modules package-lock.json
npm install

# 前端同样处理
cd frontend && rm -rf node_modules package-lock.json && npm install && cd ..
```

---

## 🧪 测试命令

### 运行单元测试

```bash
npm test
```

### 运行集成测试

```bash
npm run test:integration
```

### 运行所有测试

```bash
npm run test:coverage
```

### 运行回归测试

```bash
node scripts/regress_tables.js
```

---

## 🐳 Docker 命令

### 构建 Docker 镜像

```bash
docker build -t gov-report-diff:latest .
```

### 启动 Docker Compose

```bash
docker-compose up -d
```

### 停止 Docker Compose

```bash
docker-compose down
```

### 查看容器日志

```bash
# 查看所有日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f api
docker-compose logs -f worker
```

### 进入容器

```bash
docker-compose exec api bash
docker-compose exec worker bash
```

---

## 📝 构建和部署命令

### 构建项目

```bash
npm run build
```

### 启动生产环境

```bash
npm start
```

### 启动 API（生产）

```bash
npm run start:api
```

### 启动 Worker（生产）

```bash
npm run start:worker
```

---

## 🔐 环境变量命令

### 查看环境变量

```bash
cat .env
```

### 编辑环境变量

```bash
nano .env
# 或
vim .env
```

### 验证环境变量

```bash
# 检查数据库配置
grep DB_ .env

# 检查 Redis 配置
grep REDIS_ .env
```

---

## 📊 性能监控命令

### 监控 CPU 和内存

```bash
# 实时监控
top

# 或使用 htop（需要安装）
htop
```

### 查看进程信息

```bash
# 查看 Node.js 进程
ps aux | grep node

# 查看 PostgreSQL 进程
ps aux | grep postgres

# 查看 Redis 进程
ps aux | grep redis
```

---

## 🎯 常用命令组合

### 完整启动流程

```bash
# 1. 启动数据库
brew services start postgresql@15
brew services start redis

# 2. 等待 2 秒
sleep 2

# 3. 验证连接
psql -h localhost -U postgres -c "SELECT 1"
redis-cli ping

# 4. 打开 3 个终端（手动）
# 终端 1: npm run dev:api
# 终端 2: npm run dev:worker
# 终端 3: cd frontend && npm start

# 5. 验证系统
curl http://localhost:3000/health
```

### 完整停止流程

```bash
# 1. 停止所有终端（Ctrl+C）

# 2. 停止数据库
brew services stop postgresql@15
brew services stop redis

# 3. 验证
brew services list | grep -E "postgresql|redis"
```

### 快速重启

```bash
# 1. 停止所有服务
brew services stop postgresql@15
brew services stop redis

# 2. 等待 2 秒
sleep 2

# 3. 启动所有服务
brew services start postgresql@15
brew services start redis

# 4. 验证
sleep 2
psql -h localhost -U postgres -c "SELECT 1"
redis-cli ping
```

---

## 💡 快速参考表

| 命令 | 说明 |
|------|------|
| `npm run dev:api` | 启动 API 服务器 |
| `npm run dev:worker` | 启动 Worker 进程 |
| `cd frontend && npm start` | 启动前端应用 |
| `curl http://localhost:3000/health` | 检查 API 状态 |
| `brew services start postgresql@15` | 启动 PostgreSQL |
| `brew services start redis` | 启动 Redis |
| `psql -h localhost -U postgres -d gov_report_diff` | 连接数据库 |
| `redis-cli` | 连接 Redis |
| `lsof -i :3000` | 查看端口占用 |
| `kill -9 <PID>` | 杀死进程 |

---

**需要帮助？** 查看 [FINAL_STARTUP_GUIDE.md](./FINAL_STARTUP_GUIDE.md)
