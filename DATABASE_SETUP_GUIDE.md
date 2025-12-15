# 📦 数据库安装指南

## 当前状态

✅ **PostgreSQL 15 正在安装中**
- 状态：编译中（需要 5-10 分钟）
- 不要中断此过程

❌ **Redis 无法安装**
- 原因：Homebrew 被 PostgreSQL 安装进程锁定
- 解决方案：等待 PostgreSQL 完成后再安装

---

## 📋 完整安装步骤

### 第 1 步：等待 PostgreSQL 安装完成

**选项 A：使用监控脚本（推荐）**

```bash
chmod +x wait-for-postgres.sh
./wait-for-postgres.sh
```

脚本会：
- 每 10 秒检查一次安装进度
- 安装完成后自动验证
- 提示可以安装 Redis

**选项 B：手动检查**

```bash
# 查看 PostgreSQL 进程
ps aux | grep postgresql

# 当进程消失时，说明安装完成
```

### 第 2 步：验证 PostgreSQL 安装

```bash
# 检查版本
psql --version

# 应该输出类似：
# psql (PostgreSQL) 15.x
```

### 第 3 步：启动 PostgreSQL

```bash
brew services start postgresql@15
```

**预期输出：**
```
==> Successfully started `postgresql@15` (label: homebrew.mxcl.postgresql@15)
```

### 第 4 步：验证 PostgreSQL 运行

```bash
# 检查服务状态
brew services list | grep postgresql

# 应该显示：
# postgresql@15    started    zhang    /Users/zhang/Library/LaunchAgents/homebrew.mxcl.postgresql@15.plist
```

### 第 5 步：安装 Redis

等 PostgreSQL 完成后，运行：

```bash
brew install redis
```

### 第 6 步：启动 Redis

```bash
brew services start redis
```

**预期输出：**
```
==> Successfully started `redis` (label: homebrew.mxcl.redis)
```

### 第 7 步：验证 Redis 运行

```bash
redis-cli ping

# 应该返回：
# PONG
```

---

## ✅ 完整验证清单

```bash
# 1. 检查 PostgreSQL
psql -h localhost -U postgres -c "SELECT 1"

# 2. 检查 Redis
redis-cli ping

# 3. 检查服务状态
brew services list | grep -E "postgresql|redis"

# 应该都显示 "started"
```

---

## 🐛 常见问题

### 问题 1：PostgreSQL 安装卡住

**症状：** 进程一直在运行，没有进展

**解决方案：**
```bash
# 查看详细日志
tail -f /usr/local/var/log/postgres.log

# 如果确实卡住，可以中断（Ctrl+C）并重新安装
brew install postgresql@15
```

### 问题 2：PostgreSQL 安装失败

**症状：** 安装完成但 `psql` 命令不存在

**解决方案：**
```bash
# 重新安装
brew reinstall postgresql@15

# 或使用 MacPorts（如果 Homebrew 有问题）
# 参考：https://www.macports.org
```

### 问题 3：Redis 仍然无法安装

**症状：** 即使 PostgreSQL 完成，Redis 仍然报错

**解决方案：**
```bash
# 清理 Homebrew 缓存
brew cleanup

# 重新尝试
brew install redis
```

---

## 📊 预期时间

| 步骤 | 时间 |
|------|------|
| PostgreSQL 编译 | 5-10 分钟 |
| PostgreSQL 启动 | < 1 分钟 |
| Redis 安装 | 1-2 分钟 |
| Redis 启动 | < 1 分钟 |
| **总计** | **10-15 分钟** |

---

## 💡 提示

- 不要在 PostgreSQL 安装时关闭终端
- 不要同时运行多个 `brew install` 命令
- 如果网络不稳定，安装可能会更慢
- 可以在另一个终端窗口进行其他操作

---

## 🎯 下一步

安装完成后：

1. 启动 PostgreSQL：`brew services start postgresql@15`
2. 启动 Redis：`brew services start redis`
3. 验证连接：
   ```bash
   psql -h localhost -U postgres -c "SELECT 1"
   redis-cli ping
   ```
4. 然后启动系统的 3 个终端：
   - 终端 1：`npm run dev:api`
   - 终端 2：`npm run dev:worker`
   - 终端 3：`cd frontend && npm start`

---

**需要帮助？** 查看 [README_STARTUP.md](./README_STARTUP.md)
