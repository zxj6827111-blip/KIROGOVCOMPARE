# 政府信息公开年度报告差异比对系统 - 启动说明

**最后更新**: 2025年1月13日

---

## 快速启动 (5分钟)

### 前置要求

```bash
# 检查环境
node --version      # 需要 18+
npm --version       # 需要 8+
docker --version    # 需要 20+
docker-compose --version  # 需要 1.29+
```

### 步骤1: 克隆项目

```bash
git clone <repository-url>
cd gov-report-diff
```

### 步骤2: 安装依赖

```bash
npm install
```

### 步骤3: 配置环境

```bash
# 复制环境变量模板
cp .env.example .env

# 编辑 .env 文件（可选，使用默认值也可以）
# 主要配置项：
# - DATABASE_URL: PostgreSQL连接字符串
# - REDIS_URL: Redis连接字符串
# - STORAGE_TYPE: 存储类型 (local 或 s3)
# - PORT: 应用端口 (默认3000)
```

### 步骤4: 启动服务

#### 方式1: Docker Compose (推荐，一键启动)

```bash
# 启动所有服务 (PostgreSQL, Redis, 应用)
docker-compose up -d

# 查看启动日志
docker-compose logs -f app

# 等待应用启动完成（约30秒）
# 看到 "Server running on port 3000" 表示启动成功
```

#### 方式2: 本地开发 (需要本地PostgreSQL和Redis)

```bash
# 确保PostgreSQL和Redis已启动
# 然后运行应用
npm run dev

# 应用将在 http://localhost:3000 启动
```

### 步骤5: 验证系统

```bash
# 检查系统完整性
node test-system.js

# 应该看到：
# 🎯 总体完成度: 63/63 (100%)
# ✅ 系统完整性检查通过！所有组件已实现。
```

---

## 详细启动指南

### 使用Docker Compose启动 (推荐)

#### 1. 启动所有服务

```bash
# 进入项目目录
cd gov-report-diff

# 启动所有服务
docker-compose up -d

# 输出示例：
# Creating network "gov-report-diff_default" with the default driver
# Creating gov-report-diff_postgres_1 ... done
# Creating gov-report-diff_redis_1 ... done
# Creating gov-report-diff_app_1 ... done
```

#### 2. 查看服务状态

```bash
# 查看所有服务
docker-compose ps

# 输出示例：
# NAME                    COMMAND                  SERVICE      STATUS      PORTS
# gov-report-diff_app_1       "node dist/index.js"     app          Up 2 mins   0.0.0.0:3000->3000/tcp
# gov-report-diff_postgres_1  "docker-entrypoint..."   postgres     Up 2 mins   5432/tcp
# gov-report-diff_redis_1     "redis-server"           redis        Up 2 mins   6379/tcp
```

#### 3. 查看应用日志

```bash
# 查看应用日志
docker-compose logs -f app

# 输出示例：
# app_1  | Server running on port 3000
# app_1  | Database connected
# app_1  | Redis connected
# app_1  | Queue initialized
```

#### 4. 停止服务

```bash
# 停止所有服务
docker-compose down

# 停止并删除数据
docker-compose down -v
```

### 本地开发启动

#### 1. 启动PostgreSQL

```bash
# 使用Docker启动PostgreSQL
docker run -d \
  --name postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=gov_report_diff \
  -p 5432:5432 \
  postgres:15

# 或使用本地PostgreSQL
# 确保已创建数据库 gov_report_diff
```

#### 2. 启动Redis

```bash
# 使用Docker启动Redis
docker run -d \
  --name redis \
  -p 6379:6379 \
  redis:7

# 或使用本地Redis
# 确保Redis已启动
```

#### 3. 配置环境变量

```bash
# 编辑 .env 文件
cat > .env << EOF
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gov_report_diff
REDIS_URL=redis://localhost:6379
STORAGE_TYPE=local
STORAGE_PATH=./uploads
PORT=3000
NODE_ENV=development
EOF
```

#### 4. 启动应用

```bash
# 开发模式（自动重启）
npm run dev

# 输出示例：
# > gov-report-diff@1.0.0 dev
# > ts-node src/index.ts
# Server running on port 3000
# Database connected
# Redis connected
# Queue initialized
```

#### 5. 构建生产版本

```bash
# 编译TypeScript
npm run build

# 启动生产版本
npm start
```

---

## 验证启动成功

### 方式1: 检查系统完整性

```bash
node test-system.js

# 应该看到：
# 🎯 总体完成度: 63/63 (100%)
# ✅ 系统完整性检查通过！所有组件已实现。
```

### 方式2: 测试API端点

```bash
# 查询任务列表（应该返回空列表）
curl http://localhost:3000/api/v1/tasks

# 输出示例：
# {"tasks":[],"total":0,"page":1}
```

### 方式3: 查看应用日志

```bash
# Docker Compose
docker-compose logs app

# 本地开发
# 查看终端输出
```

---

## 常见启动问题

### 问题1: 端口已被占用

```bash
# 错误信息：
# Error: listen EADDRINUSE: address already in use :::3000

# 解决方案1: 修改端口
# 编辑 .env 文件
PORT=3001

# 解决方案2: 杀死占用端口的进程
lsof -i :3000
kill -9 <PID>
```

### 问题2: 数据库连接失败

```bash
# 错误信息：
# Error: connect ECONNREFUSED 127.0.0.1:5432

# 解决方案1: 检查PostgreSQL是否运行
docker-compose ps postgres

# 解决方案2: 检查连接字符串
echo $DATABASE_URL

# 解决方案3: 重启PostgreSQL
docker-compose restart postgres
```

### 问题3: Redis连接失败

```bash
# 错误信息：
# Error: connect ECONNREFUSED 127.0.0.1:6379

# 解决方案1: 检查Redis是否运行
docker-compose ps redis

# 解决方案2: 检查连接字符串
echo $REDIS_URL

# 解决方案3: 重启Redis
docker-compose restart redis
```

### 问题4: 依赖安装失败

```bash
# 错误信息：
# npm ERR! code ERESOLVE

# 解决方案1: 清除缓存
npm cache clean --force

# 解决方案2: 使用 --legacy-peer-deps
npm install --legacy-peer-deps

# 解决方案3: 删除 node_modules 重新安装
rm -rf node_modules package-lock.json
npm install
```

### 问题5: 权限问题

```bash
# 错误信息：
# Error: EACCES: permission denied

# 解决方案: 使用 sudo
sudo docker-compose up -d

# 或添加用户到docker组
sudo usermod -aG docker $USER
```

---

## 启动后的操作

### 1. 运行测试

```bash
# 运行所有测试
npm test

# 运行属性基测试
npm test -- properties.test.ts

# 运行集成测试
npm test -- integration.test.ts
```

### 2. 查看API文档

```bash
# 打开浏览器访问
http://localhost:3000/api/docs

# 或查看 API.md 文件
cat API.md
```

### 3. 测试API端点

```bash
# 创建比对任务（上传方式）
curl -X POST http://localhost:3000/api/v1/tasks/compare/upload \
  -F "fileA=@fixtures/sample_pdfs_v1/haq2023.pdf" \
  -F "fileB=@fixtures/sample_pdfs_v1/haq2024.pdf"

# 查询任务列表
curl http://localhost:3000/api/v1/tasks

# 查询任务状态
curl http://localhost:3000/api/v1/tasks/<taskId>
```

### 4. 查看日志

```bash
# Docker Compose
docker-compose logs -f app

# 本地开发
# 查看终端输出
```

---

## 停止和清理

### 停止服务

```bash
# 停止所有服务（保留数据）
docker-compose stop

# 停止并删除容器（保留数据）
docker-compose down

# 停止并删除所有数据
docker-compose down -v
```

### 清理资源

```bash
# 删除未使用的镜像
docker image prune

# 删除未使用的容器
docker container prune

# 删除未使用的卷
docker volume prune
```

---

## 性能优化

### 1. 增加内存限制

编辑 `docker-compose.yml`:

```yaml
services:
  app:
    mem_limit: 2g
    memswap_limit: 2g
```

### 2. 增加数据库连接池

编辑 `.env`:

```bash
DATABASE_POOL_MIN=5
DATABASE_POOL_MAX=20
```

### 3. 增加Redis缓存

编辑 `.env`:

```bash
REDIS_CACHE_TTL=86400  # 24小时
```

---

## 监控和调试

### 1. 查看应用日志

```bash
# 实时日志
docker-compose logs -f app

# 最后100行
docker-compose logs --tail=100 app

# 特定时间范围
docker-compose logs --since 2025-01-13T10:00:00 app
```

### 2. 进入容器调试

```bash
# 进入应用容器
docker-compose exec app sh

# 进入数据库容器
docker-compose exec postgres psql -U postgres -d gov_report_diff

# 进入Redis容器
docker-compose exec redis redis-cli
```

### 3. 查看资源使用

```bash
# 查看容器资源使用
docker stats

# 查看磁盘使用
docker system df
```

---

## 生产部署

### 1. 构建生产镜像

```bash
# 构建镜像
docker build -t gov-report-diff:1.0.0 .

# 标记镜像
docker tag gov-report-diff:1.0.0 myregistry/gov-report-diff:1.0.0

# 推送到镜像仓库
docker push myregistry/gov-report-diff:1.0.0
```

### 2. 部署到Kubernetes

```bash
# 创建命名空间
kubectl create namespace gov-report-diff

# 部署应用
kubectl apply -f k8s/deployment.yaml -n gov-report-diff

# 查看部署状态
kubectl get pods -n gov-report-diff
```

### 3. 配置反向代理

```nginx
# Nginx配置示例
upstream app {
    server localhost:3000;
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 快速参考

### 常用命令

```bash
# 启动
docker-compose up -d

# 停止
docker-compose down

# 查看日志
docker-compose logs -f app

# 重启
docker-compose restart

# 查看状态
docker-compose ps

# 进入容器
docker-compose exec app sh

# 运行测试
npm test

# 构建
npm run build

# 开发
npm run dev
```

### 常用URL

```
应用首页: http://localhost:3000
API文档: http://localhost:3000/api/docs
任务列表: http://localhost:3000/api/v1/tasks
资料库: http://localhost:3000/api/v1/assets
```

### 常用文件

```
配置: .env
Docker: docker-compose.yml
数据库: migrations/001_init_schema.sql
API文档: API.md
部署指南: DEPLOYMENT.md
```

---

## 获取帮助

### 查看文档

- **快速启动**: QUICK_START_GUIDE.md
- **API文档**: API.md
- **部署指南**: DEPLOYMENT.md
- **测试报告**: COMPREHENSIVE_TEST_REPORT.md
- **故障排查**: DEPLOYMENT.md (故障排查部分)

### 查看日志

```bash
# 应用日志
docker-compose logs app

# 数据库日志
docker-compose logs postgres

# Redis日志
docker-compose logs redis
```

### 联系支持

如有问题，请：
1. 查看相关文档
2. 查看应用日志
3. 运行系统检查: `node test-system.js`
4. 运行测试: `npm test`

---

**最后更新**: 2025年1月13日  
**版本**: 1.0.0

