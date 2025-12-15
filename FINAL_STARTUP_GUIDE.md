# 🎯 最终启动指南 - Phase 8 本地开发

## 📌 系统状态

✅ **Phase 8 实现完成**
- API/Worker 进程分离
- Python pdfplumber 表格提取引擎
- Docker 生产部署配置
- 完整测试基础设施

---

## 🚀 快速启动（3 步）

### 第 1 步：启动数据库

```bash
brew services start postgresql@15
brew services start redis
```

### 第 2 步：打开 3 个终端

**终端 1 - API 服务器：**
```bash
npm run dev:api
```

**终端 2 - Worker 进程：**
```bash
npm run dev:worker
```

**终端 3 - 前端应用：**
```bash
cd frontend && npm start
```

### 第 3 步：验证系统

```bash
# 检查 API
curl http://localhost:3000/health

# 打开浏览器
http://localhost:3000
```

---

## 📤 上传 PDF 测试

### 使用 curl 上传

```bash
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@test.pdf" \
  -F "city=北京市" \
  -F "year=2023"
```

### 查看任务

```bash
curl http://localhost:3000/api/v1/tasks
```

---

## 🔧 自动启动脚本

如果想一键启动所有服务：

```bash
chmod +x start-system.sh
./start-system.sh
```

脚本会自动：
- ✅ 检查系统要求
- ✅ 启动数据库服务
- ✅ 验证数据库连接
- ✅ 检查依赖
- ✅ 打开 3 个终端（可选）

---

## 📊 预期输出

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

## 🛑 停止系统

```bash
# 在各终端按 Ctrl+C

# 停止数据库服务
brew services stop postgresql@15
brew services stop redis
```

---

## 🐛 常见问题

| 问题 | 解决方案 |
|------|--------|
| PostgreSQL 连接失败 | `brew services start postgresql@15` |
| Redis 连接失败 | `brew services start redis` |
| 端口 3000 被占用 | `lsof -i :3000` 然后 `kill -9 <PID>` |
| npm 依赖缺失 | `npm install && cd frontend && npm install` |

---

## 📚 详细文档

| 文档 | 说明 |
|------|------|
| [LOCAL_STARTUP_COMMANDS.md](./LOCAL_STARTUP_COMMANDS.md) | 完整启动命令指南 |
| [QUICK_STARTUP_REFERENCE.md](./QUICK_STARTUP_REFERENCE.md) | 快速参考卡片 |
| [STARTUP_CHECKLIST.md](./STARTUP_CHECKLIST.md) | 启动前检查清单 |
| [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md) | 本地测试详细指南 |
| [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) | Docker 部署指南 |

---

## 🎯 系统架构

```
┌─────────────────────────────────────────────────────┐
│                    前端应用                          │
│              (React, 端口 3000)                     │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│                  API 服务器                         │
│         (Express, 端口 3000, 仅处理 HTTP)          │
│  - 文件上传                                         │
│  - 任务查询                                         │
│  - 数据返回                                         │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │      Redis 队列            │
        │  (Bull Queue)              │
        └────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────┐
│                Worker 进程                          │
│         (独立进程，仅处理队列任务)                  │
│  - PDF 解析                                         │
│  - 表格提取（Python pdfplumber）                   │
│  - 数据处理                                         │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────┐
        │    PostgreSQL 数据库       │
        │  (共享数据存储)            │
        └────────────────────────────┘
```

---

## ✨ 系统特性

### API/Worker 分离

- **API 进程**：仅处理 HTTP 请求，不执行长时间任务
- **Worker 进程**：独立处理队列任务，支持并发配置
- **优势**：可独立扩展，互不影响

### Python 表格提取引擎

- **技术**：pdfplumber + pandas
- **功能**：自动提取 PDF 表格，计算质量指标
- **输出**：标准 JSON 格式

### 完整测试基础设施

- 回归测试脚本
- Docker Compose 验证
- 本地系统诊断

---

## 📋 环境变量

默认配置已在 `.env` 中设置：

```
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gov_report_diff
DB_USER=postgres
DB_PASSWORD=postgres
REDIS_HOST=localhost
REDIS_PORT=6379
PORT=3000
NODE_ENV=development
```

---

## 🔍 监控系统

### 查看 API 日志

在**终端 1**查看实时请求日志

### 查看 Worker 日志

在**终端 2**查看实时处理日志

### 查看数据库

```bash
psql -h localhost -U postgres -d gov_report_diff
SELECT * FROM compare_tasks ORDER BY created_at DESC LIMIT 10;
```

### 查看 Redis 队列

```bash
redis-cli
LLEN bull:compareTaskQueue:jobs
LLEN bull:compareTaskQueue:active
LLEN bull:compareTaskQueue:completed
```

---

## 🎓 学习资源

### Phase 8 实现文档

- [IMPLEMENTATION_SUMMARY_PHASE8.md](./IMPLEMENTATION_SUMMARY_PHASE8.md) - 实现总结
- [PHASE8_COMPLETION_REPORT.md](./PHASE8_COMPLETION_REPORT.md) - 完成报告
- [PHASE8_ACCEPTANCE_CHECKLIST.md](./PHASE8_ACCEPTANCE_CHECKLIST.md) - 验收清单

### 架构设计

- [ARCHITECTURE_REDESIGN.md](./ARCHITECTURE_REDESIGN.md) - 架构设计文档
- [API.md](./API.md) - API 文档

### 部署指南

- [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) - 生产部署指南
- [QUICK_START_DEPLOYMENT.md](./QUICK_START_DEPLOYMENT.md) - Docker 快速开始

---

## ✅ 验收清单

启动系统后，验证以下功能：

- [ ] API 服务器运行正常（`curl http://localhost:3000/health`）
- [ ] Worker 进程正常运行（查看终端 2 日志）
- [ ] 前端应用可访问（`http://localhost:3000`）
- [ ] 可以上传 PDF 文件
- [ ] 任务正常处理
- [ ] 表格正确提取
- [ ] 数据库正常存储

---

## 🚀 下一步

1. **本地测试**：上传 PDF 文件，验证表格提取功能
2. **性能测试**：测试并发处理能力
3. **生产部署**：使用 Docker Compose 部署到生产环境

---

## 📞 需要帮助？

查看相关文档：
- 启动问题 → [LOCAL_STARTUP_COMMANDS.md](./LOCAL_STARTUP_COMMANDS.md)
- 测试问题 → [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md)
- 部署问题 → [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

---

**准备好了吗？** 🎉 开始启动系统！
