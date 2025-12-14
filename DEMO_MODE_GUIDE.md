# 演示模式启动指南

**最后更新**: 2025年1月13日

---

## 问题说明

系统需要 PostgreSQL 数据库才能完整运行。如果你没有安装 PostgreSQL，可以使用以下方式：

---

## 方式1: 使用 Docker (推荐)

### 前置要求
- Docker 已安装

### 启动步骤

```bash
# 1. 启动 PostgreSQL 容器
docker run -d \
  --name postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=gov_report_diff \
  -p 5432:5432 \
  postgres:15

# 2. 启动 Redis 容器
docker run -d \
  --name redis \
  -p 6379:6379 \
  redis:7

# 3. 等待容器启动 (约10秒)
sleep 10

# 4. 启动应用
npm install
npm run build
npm start
```

### 验证

```bash
# 检查容器是否运行
docker ps

# 应该看到 postgres 和 redis 容器
```

### 停止

```bash
# 停止容器
docker stop postgres redis

# 删除容器
docker rm postgres redis
```

---

## 方式2: 使用本地 PostgreSQL

### 前置要求
- PostgreSQL 15+ 已安装
- Redis 7+ 已安装

### 启动步骤

```bash
# 1. 创建数据库
createdb gov_report_diff

# 2. 配置环境变量
cat > .env << EOF
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gov_report_diff
REDIS_URL=redis://localhost:6379
PORT=3000
NODE_ENV=development
EOF

# 3. 启动应用
npm install
npm run build
npm start
```

---

## 方式3: 使用 Docker Compose (最简单)

### 前置要求
- Docker 已安装
- Docker Compose 已安装

### 启动步骤

```bash
# 1. 启动所有服务
docker-compose up -d

# 2. 等待服务启动 (约30秒)
sleep 30

# 3. 验证服务
docker-compose ps

# 应该看到 app, postgres, redis 都在运行
```

### 访问应用

```
http://localhost:3000
```

### 停止

```bash
docker-compose down
```

---

## 方式4: 快速演示 (无需数据库)

如果你只想快速查看代码和文档，不需要运行应用：

```bash
# 1. 查看系统完整性
node test-system.js

# 2. 查看 API 文档
cat API.md

# 3. 查看快速启动指南
cat QUICK_START_GUIDE.md

# 4. 查看测试报告
cat COMPREHENSIVE_TEST_REPORT.md
```

---

## 故障排查

### 问题1: Docker 未安装

```bash
# 检查 Docker
docker --version

# 如果未安装，访问 https://www.docker.com/products/docker-desktop
```

### 问题2: 端口已被占用

```bash
# 修改 .env 文件中的 PORT
PORT=3001

# 或杀死占用端口的进程
# macOS/Linux
lsof -i :5432
kill -9 <PID>

# Windows
netstat -ano | findstr :5432
taskkill /PID <PID> /F
```

### 问题3: 容器启动失败

```bash
# 查看容器日志
docker logs postgres
docker logs redis

# 重启容器
docker restart postgres redis
```

### 问题4: 数据库连接失败

```bash
# 检查数据库是否运行
docker ps | grep postgres

# 检查连接字符串
echo $DATABASE_URL

# 测试连接
psql $DATABASE_URL -c "SELECT 1"
```

---

## 推荐方案

### 对于快速演示
👉 **方式4: 快速演示** - 无需任何依赖

### 对于本地开发
👉 **方式3: Docker Compose** - 一键启动所有服务

### 对于已有环境
👉 **方式2: 本地 PostgreSQL** - 使用现有的数据库

### 对于 Docker 用户
👉 **方式1: Docker** - 手动启动容器

---

## 完整的启动流程

### 使用 Docker Compose (推荐)

```bash
# 1. 克隆项目
git clone <repository-url>
cd gov-report-diff

# 2. 启动所有服务
docker-compose up -d

# 3. 等待启动完成
sleep 30

# 4. 验证系统
node test-system.js

# 5. 访问应用
# 打开浏览器访问 http://localhost:3000

# 6. 运行测试
npm test

# 7. 停止服务
docker-compose down
```

---

## 快速参考

| 方式 | 难度 | 时间 | 依赖 |
|------|------|------|------|
| 方式1: Docker | 中 | 5分钟 | Docker |
| 方式2: 本地 | 高 | 10分钟 | PostgreSQL, Redis |
| 方式3: Docker Compose | 低 | 3分钟 | Docker, Docker Compose |
| 方式4: 快速演示 | 低 | 1分钟 | 无 |

---

## 获取帮助

### 查看文档
- **启动说明**: STARTUP_INSTRUCTIONS.md
- **快速启动**: QUICK_START_GUIDE.md
- **系统启动**: SYSTEM_STARTUP_GUIDE.md
- **部署指南**: DEPLOYMENT.md

### 查看日志
```bash
# Docker Compose
docker-compose logs -f app

# 本地开发
# 查看终端输出
```

### 运行诊断
```bash
# 系统完整性检查
node test-system.js

# 运行测试
npm test
```

---

**最后更新**: 2025年1月13日  
**版本**: 1.0.0

