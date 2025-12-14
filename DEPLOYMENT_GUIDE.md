# API 与 Worker 分离 + Python 表格解析引擎 - 部署指南

## 📋 目录

1. [系统架构](#系统架构)
2. [前置要求](#前置要求)
3. [本地开发](#本地开发)
4. [Docker Compose 部署](#docker-compose-部署)
5. [验证与测试](#验证与测试)
6. [故障排查](#故障排查)
7. [性能调优](#性能调优)

---

## 系统架构

### 部署拓扑

```
Browser
  ↓
Nginx (80) ──→ 前端静态站点
  ├──→ /api/v1/* ──→ API (Node, 内网:3000)
  └──→ /health ──→ API /health

API (Node)
  ├──→ Postgres (数据库)
  └──→ Redis (队列)

Worker (Node)
  ├──→ Redis (消费队列)
  ├──→ Python (pdfplumber 表格提取)
  ├──→ Postgres (写入结果)
  └──→ uploads volume (读取 PDF)
```

### 关键特性

- **进程分离**：API 与 Worker 完全独立，避免解析任务拖垮对外服务
- **并发可控**：通过 `WORKER_CONCURRENCY` 环境变量控制并发数
- **Python 表格引擎**：使用 pdfplumber 提取三张核心表格
- **完整性指标**：输出 nonEmptyCells、rowMatchRate、confidence 等指标
- **禁止示例数据**：表格失败时不填充默认数据，保证数据真实性

---

## 前置要求

### 系统要求

- Docker & Docker Compose（推荐 Docker 20.10+）
- Python 3.8+（如本地开发）
- Node.js 18+（如本地开发）

### 环境检查

```bash
# 检查 Docker
docker --version
docker compose version

# 检查 Python（可选，本地开发用）
python3 --version

# 检查 Node（可选，本地开发用）
node --version
npm --version
```

---

## 本地开发

### 1. 安装依赖

```bash
# 安装 Node 依赖
npm install

# 安装 Python 依赖（可选）
pip3 install -r python/requirements.txt
```

### 2. 启动本地服务

#### 方式 A：分别启动 API 和 Worker

```bash
# 终端 1：启动 API
npm run dev:api

# 终端 2：启动 Worker
npm run dev:worker

# 终端 3：启动 Redis（如未运行）
redis-server

# 终端 4：启动 Postgres（如未运行）
# 或使用 Docker：
docker run -d \
  -e POSTGRES_DB=report_db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15-alpine
```

#### 方式 B：使用 Docker Compose（推荐）

```bash
docker compose up -d
```

### 3. 验证本地开发环境

```bash
# 检查 API 健康状态
curl http://localhost:3000/health

# 检查 API 路由
curl http://localhost:3000/api/v1/tasks

# 查看日志
docker compose logs -f api
docker compose logs -f worker
```

---

## Docker Compose 部署

### 1. 构建镜像

```bash
# 构建镜像（自动运行）
docker compose up -d --build

# 或手动构建
docker compose build
```

### 2. 启动服务

```bash
# 启动所有服务
docker compose up -d

# 查看服务状态
docker compose ps

# 查看日志
docker compose logs -f
```

### 3. 环境变量配置

编辑 `docker-compose.yml` 中的环境变量：

```yaml
environment:
  # API 配置
  NODE_ENV: production
  DATABASE_URL: postgresql://postgres:postgres@postgres:5432/report_db
  REDIS_URL: redis://redis:6379
  PORT: 3000
  
  # Worker 配置
  WORKER_CONCURRENCY: "2"           # 并发数（默认 2）
  PY_TABLE_TIMEOUT_MS: "180000"     # Python 超时（毫秒）
  ENABLE_TS_TABLE_FALLBACK: "0"     # 禁止 TS 表格兜底
```

### 4. 数据持久化

系统使用以下 volumes：

- `pgdata`：Postgres 数据
- `redis_data`：Redis 数据
- `uploads`：上传的 PDF 文件（API 和 Worker 共享）

```bash
# 查看 volumes
docker volume ls

# 清理 volumes（谨慎操作）
docker compose down -v
```

---

## 验证与测试

### 1. 一键验证脚本

```bash
# 运行完整验证
bash scripts/verify-docker-compose.sh
```

该脚本会：
- 构建并启动容器
- 验证 Nginx 健康检查
- 验证 API 可用性
- 验证容器内部诊断

### 2. 手动验证

#### 验证 Nginx（生产口径）

```bash
# 健康检查
curl http://localhost/health

# API 路由
curl http://localhost/api/v1/tasks

# 前端静态站点
curl http://localhost/
```

#### 验证容器内部（诊断用）

```bash
# 进入 API 容器
docker compose exec api bash

# 容器内检查 API
curl http://localhost:3000/health

# 检查 Redis 连接
redis-cli -h redis ping

# 检查 Postgres 连接
psql -h postgres -U postgres -d report_db -c "SELECT NOW();"
```

### 3. 表格解析回归测试

```bash
# 运行回归测试（需要样例 PDF）
node scripts/regress_tables.js

# 查看测试报告
cat output/regress_tables_summary.json
```

---

## 故障排查

### 问题 1：Nginx 无法连接到 API

**症状**：`curl http://localhost/api/v1/tasks` 返回 502 Bad Gateway

**排查步骤**：

```bash
# 1. 检查 API 容器是否运行
docker compose ps api

# 2. 检查 API 日志
docker compose logs api

# 3. 检查 Nginx 配置
docker compose exec nginx cat /etc/nginx/conf.d/default.conf

# 4. 检查容器网络
docker compose exec api curl http://localhost:3000/health
```

**解决方案**：
- 确保 API 容器已启动且健康
- 检查 `nginx.conf` 中的 `proxy_pass` 地址是否正确
- 检查 Docker 网络连接

### 问题 2：Worker 无法消费队列

**症状**：任务入队但不被处理

**排查步骤**：

```bash
# 1. 检查 Worker 日志
docker compose logs worker

# 2. 检查 Redis 连接
docker compose exec redis redis-cli PING

# 3. 检查队列状态
docker compose exec redis redis-cli LLEN bull:compareTaskQueue:jobs
```

**解决方案**：
- 确保 Worker 容器已启动
- 检查 `REDIS_URL` 环境变量是否正确
- 检查 Worker 并发配置

### 问题 3：Python 表格提取失败

**症状**：Worker 日志显示 Python 脚本错误

**排查步骤**：

```bash
# 1. 进入 Worker 容器
docker compose exec worker bash

# 2. 手动运行 Python 脚本
python3 python/extract_tables_pdfplumber.py \
  /app/uploads/sample.pdf \
  --schema src/schemas/annual_report_table_schema_v2.json \
  --out -

# 3. 检查 Python 依赖
pip3 list | grep pdfplumber
```

**解决方案**：
- 检查 `python/requirements.txt` 是否正确安装
- 检查 PDF 文件是否有效
- 检查 schema 文件路径是否正确

### 问题 4：数据库迁移失败

**症状**：容器启动时显示迁移错误

**排查步骤**：

```bash
# 1. 查看启动日志
docker compose logs api

# 2. 进入 API 容器手动运行迁移
docker compose exec api npm run db:migrate

# 3. 检查迁移文件
ls -la migrations/
```

**解决方案**：
- 确保 `migrations/` 目录存在且包含 SQL 文件
- 检查 Postgres 连接是否正常
- 检查迁移 SQL 语法是否正确

---

## 性能调优

### 1. 调整 Worker 并发数

```yaml
# docker-compose.yml
worker:
  environment:
    WORKER_CONCURRENCY: "4"  # 根据 CPU 核心数调整
```

**建议**：
- 单核：1-2
- 双核：2-4
- 四核：4-8
- 八核+：8-16

### 2. 调整 Python 超时

```yaml
worker:
  environment:
    PY_TABLE_TIMEOUT_MS: "300000"  # 5 分钟
```

**建议**：
- 小 PDF（<10MB）：60-120 秒
- 中等 PDF（10-50MB）：120-180 秒
- 大 PDF（>50MB）：180-300 秒

### 3. 调整 Nginx 上传限制

```nginx
# nginx.conf
client_max_body_size 100m;  # 根据需要调整
```

### 4. 调整 Redis 持久化

```yaml
# docker-compose.yml
redis:
  command: ["redis-server", "--appendonly", "yes", "--appendfsync", "everysec"]
```

---

## 常用命令

```bash
# 启动服务
docker compose up -d

# 停止服务
docker compose down

# 查看日志
docker compose logs -f [service_name]

# 重启服务
docker compose restart [service_name]

# 进入容器
docker compose exec [service_name] bash

# 查看容器状态
docker compose ps

# 清理所有数据（谨慎操作）
docker compose down -v

# 重新构建镜像
docker compose build --no-cache

# 查看网络
docker network ls
docker network inspect [network_name]
```

---

## 生产部署建议

### 1. 安全性

- 使用强密码替换默认 Postgres 密码
- 配置 Nginx SSL/TLS
- 限制 API 访问 IP
- 定期更新依赖包

### 2. 监控与日志

- 配置日志收集（ELK、Splunk 等）
- 设置告警规则
- 监控队列长度和处理时间
- 监控资源使用情况

### 3. 备份与恢复

- 定期备份 Postgres 数据
- 定期备份 uploads volume
- 测试恢复流程

### 4. 扩展性

- 使用负载均衡器（如 HAProxy）
- 水平扩展 Worker 实例
- 使用外部 Redis（如 AWS ElastiCache）
- 使用托管数据库（如 AWS RDS）

---

## 支持与反馈

如遇到问题，请：

1. 查看 [故障排查](#故障排查) 部分
2. 检查容器日志：`docker compose logs`
3. 运行验证脚本：`bash scripts/verify-docker-compose.sh`
4. 提交 Issue 或联系技术支持

