# 部署指南

## 本地开发环境

### 前置要求
- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- npm 或 yarn

### 安装步骤

1. **克隆项目**
```bash
git clone <repository>
cd gov-report-diff
```

2. **安装依赖**
```bash
npm install
```

3. **配置环境变量**
```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库和Redis连接
```

4. **初始化数据库**
```bash
npm run build
npm run migrate
```

5. **启动开发服务器**
```bash
npm run dev
```

服务器将在 http://localhost:3000 启动

## Docker部署

### 使用Docker Compose

1. **启动所有服务**
```bash
docker-compose up -d
```

2. **查看日志**
```bash
docker-compose logs -f app
```

3. **停止服务**
```bash
docker-compose down
```

### 构建Docker镜像

```bash
docker build -t gov-report-diff:latest .
```

## 生产环境部署

### 前置要求
- Kubernetes 集群（可选）
- 云存储服务（AWS S3 或类似）
- 监控和日志系统

### 环境变量配置

```bash
# 数据库
DB_HOST=<production-db-host>
DB_PORT=5432
DB_NAME=gov_report_diff
DB_USER=<db-user>
DB_PASSWORD=<db-password>

# Redis
REDIS_HOST=<production-redis-host>
REDIS_PORT=6379

# 存储
STORAGE_TYPE=s3
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
S3_BUCKET=gov-report-diff

# AI配置
OPENAI_API_KEY=<your-api-key>
AI_CONFIG_VERSION=1

# 服务器
PORT=3000
NODE_ENV=production
```

### 性能优化

1. **启用缓存**
   - 配置Redis连接池
   - 设置适当的TTL

2. **数据库优化**
   - 创建必要的索引
   - 配置连接池大小

3. **文件存储**
   - 使用S3或CDN加速
   - 配置适当的过期策略

## 监控和维护

### 健康检查
```bash
curl http://localhost:3000/health
```

### 日志查看
```bash
# Docker
docker-compose logs app

# 系统日志
tail -f /var/log/gov-report-diff/app.log
```

### 数据库备份
```bash
# PostgreSQL备份
pg_dump -h localhost -U postgres gov_report_diff > backup.sql

# 恢复
psql -h localhost -U postgres gov_report_diff < backup.sql
```

## 故障排查

### 常见问题

1. **数据库连接失败**
   - 检查DB_HOST和DB_PORT配置
   - 确保PostgreSQL服务运行
   - 验证用户名和密码

2. **Redis连接失败**
   - 检查REDIS_HOST和REDIS_PORT配置
   - 确保Redis服务运行

3. **文件上传失败**
   - 检查存储配置
   - 确保有足够的磁盘空间
   - 验证S3凭证（如使用S3）

## 升级指南

1. **备份数据**
```bash
npm run backup
```

2. **更新代码**
```bash
git pull origin main
npm install
```

3. **运行迁移**
```bash
npm run migrate
```

4. **重启服务**
```bash
npm run restart
```
