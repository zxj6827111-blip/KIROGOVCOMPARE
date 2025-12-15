# 🎯 系统启动总结

## 📌 当前状态

**Docker 不可用** - 改用本地开发模式

---

## ✅ 需要做的事

### 1️⃣ 启动数据库（macOS）

```bash
# 启动 PostgreSQL
brew services start postgresql@15

# 启动 Redis
brew services start redis

# 验证
psql --version
redis-cli ping  # 应该返回 PONG
```

### 2️⃣ 打开 3 个独立终端

**终端 1 - API：**
```bash
npm run dev:api
```

**终端 2 - Worker：**
```bash
npm run dev:worker
```

**终端 3 - 前端：**
```bash
cd frontend && npm start
```

### 3️⃣ 验证系统

```bash
# 在新终端中运行
curl http://localhost:3000/health

# 打开浏览器
http://localhost:3000
```

---

## 📊 预期输出

### API 启动成功
```
✓ Database connection successful
✓ API Server running on port 3000
```

### Worker 启动成功
```
✓ Database connection successful
✓ Worker process started and listening to queues
✓ All queue processors initialized
```

### 前端启动成功
```
Compiled successfully!
You can now view the app in the browser.
```

---

## 🧪 测试上传

```bash
# 上传 PDF
curl -X POST http://localhost:3000/api/v1/assets/upload \
  -F "file=@sample.pdf" \
  -F "city=北京市" \
  -F "year=2023"

# 查看任务
curl http://localhost:3000/api/v1/tasks
```

---

## 📚 详细指南

- [START_SYSTEM_NOW.md](./START_SYSTEM_NOW.md) - 完整启动指南
- [LOCAL_TESTING_GUIDE.md](./LOCAL_TESTING_GUIDE.md) - 本地测试详细指南
- [QUICK_REFERENCE_PHASE8.md](./QUICK_REFERENCE_PHASE8.md) - 快速参考

---

**准备好了吗？** 按照上面的步骤启动系统！

