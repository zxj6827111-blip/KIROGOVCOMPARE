# ⚡ 快速启动参考卡片

## 🎯 一句话总结

**打开 3 个终端，分别运行：`npm run dev:api`、`npm run dev:worker`、`cd frontend && npm start`**

---

## 📋 前置条件（一次性）

```bash
# 安装 PostgreSQL 和 Redis（如果未安装）
brew install postgresql@15 redis

# 启动数据库服务
brew services start postgresql@15
brew services start redis
```

---

## 🚀 启动系统（每次使用）

### 终端 1 - API 服务器

```bash
npm run dev:api
```

### 终端 2 - Worker 进程

```bash
npm run dev:worker
```

### 终端 3 - 前端应用

```bash
cd frontend && npm start
```

---

## ✅ 验证系统

```bash
# 检查 API 健康状态
curl http://localhost:3000/health

# 打开浏览器
http://localhost:3000
```

---

## 📤 上传 PDF 测试

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

## 🛑 停止系统

```bash
# 在各终端按 Ctrl+C

# 停止数据库服务
brew services stop postgresql@15
brew services stop redis
```

---

## 🔧 常见命令

| 命令 | 说明 |
|------|------|
| `npm run dev:api` | 启动 API 服务器（端口 3000） |
| `npm run dev:worker` | 启动 Worker 进程 |
| `cd frontend && npm start` | 启动前端应用 |
| `curl http://localhost:3000/health` | 检查 API 状态 |
| `brew services start postgresql@15` | 启动 PostgreSQL |
| `brew services start redis` | 启动 Redis |
| `brew services stop postgresql@15` | 停止 PostgreSQL |
| `brew services stop redis` | 停止 Redis |

---

## 🐛 快速排查

| 问题 | 解决方案 |
|------|--------|
| PostgreSQL 连接失败 | `brew services start postgresql@15` |
| Redis 连接失败 | `brew services start redis` |
| 端口 3000 被占用 | `lsof -i :3000` 然后 `kill -9 <PID>` |
| npm 依赖缺失 | `npm install && cd frontend && npm install` |

---

## 📚 详细文档

- [LOCAL_STARTUP_COMMANDS.md](./LOCAL_STARTUP_COMMANDS.md) - 完整启动指南
- [START_SYSTEM_NOW.md](./START_SYSTEM_NOW.md) - 详细步骤
- [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md) - 测试指南

---

**就这么简单！** 🎉
