# ✅ 启动前检查清单

## 📋 系统要求检查

- [ ] macOS 系统
- [ ] Node.js 已安装（版本 14+）
- [ ] npm 已安装
- [ ] PostgreSQL 已安装
- [ ] Redis 已安装

### 验证命令

```bash
# 检查 Node.js
node --version

# 检查 npm
npm --version

# 检查 PostgreSQL
psql --version

# 检查 Redis
redis-cli --version
```

---

## 🔧 环境配置检查

- [ ] `.env` 文件存在
- [ ] 数据库配置正确
- [ ] Redis 配置正确
- [ ] 存储路径配置正确

### 检查 .env 文件

```bash
cat .env | grep -E "DB_|REDIS_"
```

**预期输出：**
```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gov_report_diff
DB_USER=postgres
DB_PASSWORD=postgres
REDIS_HOST=localhost
REDIS_PORT=6379
```

---

## 📦 依赖检查

- [ ] 后端依赖已安装
- [ ] 前端依赖已安装

### 检查依赖

```bash
# 检查后端依赖
ls -la node_modules | head -20

# 检查前端依赖
ls -la frontend/node_modules | head -20
```

如果缺失，运行：

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd frontend && npm install && cd ..
```

---

## 🗄️ 数据库检查

- [ ] PostgreSQL 服务已启动
- [ ] Redis 服务已启动
- [ ] 数据库可连接

### 启动数据库服务

```bash
# 启动 PostgreSQL
brew services start postgresql@15

# 启动 Redis
brew services start redis
```

### 验证连接

```bash
# 检查 PostgreSQL
psql -h localhost -U postgres -c "SELECT 1"

# 检查 Redis
redis-cli ping
# 应该返回：PONG
```

---

## 📁 文件结构检查

- [ ] `src/server.ts` 存在
- [ ] `src/worker.ts` 存在
- [ ] `src/queue/processors.ts` 存在
- [ ] `frontend/` 目录存在
- [ ] `python/extract_tables_pdfplumber.py` 存在

### 检查文件

```bash
# 检查关键文件
ls -la src/server.ts src/worker.ts
ls -la frontend/package.json
ls -la python/extract_tables_pdfplumber.py
```

---

## 🚀 启动前最后检查

- [ ] 所有终端已关闭
- [ ] 没有进程占用端口 3000
- [ ] 没有进程占用端口 3001（前端）

### 检查端口

```bash
# 检查端口 3000
lsof -i :3000

# 检查端口 3001
lsof -i :3001

# 如果有占用，杀死进程
kill -9 <PID>
```

---

## ✨ 准备启动

所有检查完成后，按照以下步骤启动：

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

访问：`http://localhost:3000`

---

## 🎯 启动成功标志

### API 服务器（终端 1）

```
✓ Database connection successful
✓ Database initialization completed
✓ API Server running on port 3000
```

### Worker 进程（终端 2）

```
✓ Database connection successful
✓ Database initialization completed
✓ Worker process started and listening to queues
✓ Worker concurrency: 2
✓ All queue processors initialized
```

### 前端应用（终端 3）

```
Compiled successfully!

You can now view the app in the browser.

  Local:            http://localhost:3000
```

---

## 📤 测试上传

系统启动成功后，测试 PDF 上传：

```bash
# 上传 PDF
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@test.pdf" \
  -F "city=北京市" \
  -F "year=2023"

# 查看任务
curl http://localhost:3000/api/v1/tasks
```

---

## 🐛 如果出现问题

### 问题排查步骤

1. **检查数据库连接**
   ```bash
   psql -h localhost -U postgres -d gov_report_diff
   ```

2. **检查 Redis 连接**
   ```bash
   redis-cli ping
   ```

3. **检查日志**
   - 查看各终端的输出信息
   - 查看浏览器控制台（F12）

4. **重启服务**
   ```bash
   # 停止所有服务
   # 按 Ctrl+C 在各终端
   
   # 重启数据库
   brew services restart postgresql@15
   brew services restart redis
   
   # 重新启动系统
   ```

---

## 📚 相关文档

- [LOCAL_STARTUP_COMMANDS.md](./LOCAL_STARTUP_COMMANDS.md) - 完整启动指南
- [QUICK_STARTUP_REFERENCE.md](./QUICK_STARTUP_REFERENCE.md) - 快速参考
- [START_SYSTEM_NOW.md](./START_SYSTEM_NOW.md) - 详细步骤
- [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md) - 测试指南

---

**准备好了吗？** ✅ 开始启动系统！
