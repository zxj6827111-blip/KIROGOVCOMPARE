# 🚀 系统启动指南 - 立即开始

## 📌 你现在需要做什么？

Phase 8 已经完成所有开发工作。现在你需要启动系统进行 PDF 上传测试。

---

## ⚡ 最快启动方式（5 分钟）

### 第 1 步：启动数据库

```bash
brew services start postgresql@15
brew services start redis
```

### 第 2 步：打开 3 个终端

**在终端 1 中运行：**
```bash
npm run dev:api
```

**在终端 2 中运行：**
```bash
npm run dev:worker
```

**在终端 3 中运行：**
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

## 📤 上传 PDF 测试

### 方式 1：使用 curl 命令

```bash
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@test.pdf" \
  -F "city=北京市" \
  -F "year=2023"
```

### 方式 2：使用前端界面

1. 打开浏览器 `http://localhost:3000`
2. 找到上传表单
3. 选择 PDF 文件
4. 填写城市和年份
5. 点击上传

---

## 🎯 预期结果

### 系统启动成功标志

**终端 1 - API：**
```
✓ Database connection successful
✓ API Server running on port 3000
```

**终端 2 - Worker：**
```
✓ Database connection successful
✓ Worker process started and listening to queues
✓ Worker concurrency: 2
```

**终端 3 - 前端：**
```
Compiled successfully!
You can now view the app in the browser.
```

### PDF 上传成功标志

```json
{
  "id": "uuid-here",
  "filename": "test.pdf",
  "city": "北京市",
  "year": 2023,
  "status": "pending"
}
```

---

## 🔍 监控处理进度

### 查看所有任务

```bash
curl http://localhost:3000/api/v1/tasks
```

### 查看 API 日志

在**终端 1**查看实时日志

### 查看 Worker 日志

在**终端 2**查看实时日志

---

## 🛑 停止系统

```bash
# 在各终端按 Ctrl+C

# 停止数据库
brew services stop postgresql@15
brew services stop redis
```

---

## 🐛 常见问题

### 问题 1：PostgreSQL 连接失败

```bash
brew services start postgresql@15
```

### 问题 2：Redis 连接失败

```bash
brew services start redis
```

### 问题 3：端口 3000 被占用

```bash
lsof -i :3000
kill -9 <PID>
```

### 问题 4：npm 依赖缺失

```bash
npm install
cd frontend && npm install && cd ..
```

---

## 📚 详细文档

| 文档 | 用途 |
|------|------|
| [FINAL_STARTUP_GUIDE.md](./FINAL_STARTUP_GUIDE.md) | 完整启动指南 |
| [LOCAL_STARTUP_COMMANDS.md](./LOCAL_STARTUP_COMMANDS.md) | 详细命令说明 |
| [QUICK_STARTUP_REFERENCE.md](./QUICK_STARTUP_REFERENCE.md) | 快速参考卡片 |
| [COMMANDS_REFERENCE_CN.md](./COMMANDS_REFERENCE_CN.md) | 中文命令参考 |
| [STARTUP_CHECKLIST.md](./STARTUP_CHECKLIST.md) | 启动前检查清单 |
| [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md) | 本地测试指南 |

---

## 🎓 系统架构

```
前端应用 (React)
    ↓
API 服务器 (Express, 端口 3000)
    ↓
Redis 队列 (Bull)
    ↓
Worker 进程 (PDF 处理)
    ↓
PostgreSQL 数据库
```

---

## ✨ 系统特性

✅ **API/Worker 分离** - 独立扩展，互不影响
✅ **Python 表格提取** - 使用 pdfplumber 自动提取表格
✅ **完整测试基础设施** - 回归测试、Docker 验证
✅ **生产就绪** - Docker Compose 部署配置

---

## 🚀 下一步

1. **启动系统** - 按照上面的步骤启动
2. **上传 PDF** - 测试 PDF 上传功能
3. **验证结果** - 检查表格提取是否正确
4. **生产部署** - 使用 Docker Compose 部署

---

## 📞 需要帮助？

- **启动问题** → [LOCAL_STARTUP_COMMANDS.md](./LOCAL_STARTUP_COMMANDS.md)
- **测试问题** → [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md)
- **命令参考** → [COMMANDS_REFERENCE_CN.md](./COMMANDS_REFERENCE_CN.md)
- **部署问题** → [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)

---

**准备好了吗？** 🎉 现在就启动系统！

```bash
# 第 1 步：启动数据库
brew services start postgresql@15
brew services start redis

# 第 2 步：打开 3 个终端
# 终端 1: npm run dev:api
# 终端 2: npm run dev:worker
# 终端 3: cd frontend && npm start

# 第 3 步：验证系统
curl http://localhost:3000/health

# 第 4 步：打开浏览器
# http://localhost:3000
```
