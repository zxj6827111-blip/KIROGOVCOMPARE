# 快速启动指南 - API/Worker 分离 + Python 表格解析

## 🚀 5 分钟快速启动

### 1. 构建并启动

```bash
# 构建镜像并启动所有服务
docker compose up -d --build

# 等待服务启动（约 30 秒）
sleep 30
```

### 2. 验证系统

```bash
# 验证 Nginx 健康检查（生产口径）
curl http://localhost/health

# 验证 API 可用
curl http://localhost/api/v1/tasks

# 查看容器状态
docker compose ps
```

### 3. 查看日志

```bash
# 查看所有日志
docker compose logs -f

# 查看特定服务日志
docker compose logs -f api
docker compose logs -f worker
docker compose logs -f nginx
```

---

## 📊 系统架构一览

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │
       ▼
┌──────────────────────────────────────┐
│  Nginx (80)                          │
│  ├─ 前端静态站点                      │
│  ├─ /api/v1/* → API:3000             │
│  └─ /health → API:3000/health        │
└──────┬──────────────────────────────┘
       │
       ├─────────────────────┬──────────────────────┐
       ▼                     ▼                      ▼
   ┌────────┐           ┌────────┐            ┌────────┐
   │  API   │           │ Worker │            │Postgres│
   │(Node)  │           │(Node)  │            │ Redis  │
   └────────┘           └────────┘            └────────┘
       │                    │
       │                    ├─ Python (pdfplumber)
       │                    │
       └────────┬───────────┘
                ▼
           uploads/
          (共享存储)
```

---

## 🔧 常用命令

| 命令 | 说明 |
|------|------|
| `docker compose up -d` | 启动所有服务 |
| `docker compose down` | 停止所有服务 |
| `docker compose logs -f` | 查看实时日志 |
| `docker compose ps` | 查看容器状态 |
| `docker compose exec api bash` | 进入 API 容器 |
| `docker compose exec worker bash` | 进入 Worker 容器 |
| `docker compose restart worker` | 重启 Worker |

---

## ⚙️ 环境变量配置

编辑 `docker-compose.yml` 中的 `environment` 部分：

### API 配置

```yaml
api:
  environment:
    NODE_ENV: production
    DATABASE_URL: postgresql://postgres:postgres@postgres:5432/report_db
    REDIS_URL: redis://redis:6379
    PORT: 3000
    DISABLE_PROCESSORS: "1"              # 禁止 API 注册处理器
    ENABLE_TS_TABLE_FALLBACK: "0"        # 禁止 TS 表格兜底
```

### Worker 配置

```yaml
worker:
  environment:
    NODE_ENV: production
    DATABASE_URL: postgresql://postgres:postgres@postgres:5432/report_db
    REDIS_URL: redis://redis:6379
    WORKER_CONCURRENCY: "2"              # 并发数（默认 2）
    PY_TABLE_TIMEOUT_MS: "180000"        # Python 超时（毫秒）
    ENABLE_TS_TABLE_FALLBACK: "0"        # 禁止 TS 表格兜底
```

---

## 🧪 测试表格解析

### 1. 准备样例 PDF

将样例 PDF 放在 `sample_pdfs_v1/` 目录：

```bash
mkdir -p sample_pdfs_v1
# 复制 PDF 文件到该目录
```

### 2. 运行回归测试

```bash
# 需要先编译 TypeScript
npm run build

# 运行回归测试
node scripts/regress_tables.js

# 查看测试报告
cat output/regress_tables_summary.json
```

### 3. 查看测试结果

输出示例：

```
📄 sample_report_2023.pdf
─────────────────────────────────────────────────────────────
表格 ID              │完整性    │置信度  │非空单元格│总单元格│...
─────────────────────────────────────────────────────────────
sec2_art20_1        │complete  │0.92   │85       │120    │...
sec3_requests       │partial   │0.78   │156      │280    │...
sec4_review_litig...│failed    │0.45   │12       │80     │...
```

---

## 🐛 故障排查

### API 无法连接

```bash
# 检查 API 容器
docker compose ps api

# 查看 API 日志
docker compose logs api

# 进入容器检查
docker compose exec api curl http://localhost:3000/health
```

### Worker 不处理任务

```bash
# 查看 Worker 日志
docker compose logs worker

# 检查 Redis 连接
docker compose exec redis redis-cli PING

# 检查队列
docker compose exec redis redis-cli LLEN bull:compareTaskQueue:jobs
```

### Python 脚本错误

```bash
# 进入 Worker 容器
docker compose exec worker bash

# 手动测试 Python 脚本
python3 python/extract_tables_pdfplumber.py \
  /app/uploads/test.pdf \
  --schema src/schemas/annual_report_table_schema_v2.json \
  --out -
```

---

## 📝 关键文件

| 文件 | 说明 |
|------|------|
| `docker-compose.yml` | 容器编排配置 |
| `Dockerfile` | 镜像构建配置 |
| `nginx.conf` | Nginx 反代配置 |
| `src/server.ts` | API 入口 |
| `src/worker.ts` | Worker 入口 |
| `python/extract_tables_pdfplumber.py` | Python 表格提取脚本 |
| `scripts/regress_tables.js` | 回归测试脚本 |
| `DEPLOYMENT_GUIDE.md` | 完整部署指南 |

---

## 📚 更多信息

- 详细部署指南：[DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md)
- API 文档：[API.md](./API.md)
- 架构设计：[.kiro/specs/api-worker-separation/design.md](./.kiro/specs/api-worker-separation/design.md)

---

## ✅ 验证清单

启动后请检查：

- [ ] `curl http://localhost/health` 返回 200
- [ ] `curl http://localhost/api/v1/tasks` 返回 200（或 401 如需鉴权）
- [ ] `docker compose ps` 显示所有容器 running
- [ ] `docker compose logs` 无错误信息
- [ ] 前端可访问：`http://localhost/`

---

## 🎯 下一步

1. **上传 PDF**：通过前端或 API 上传政府年报 PDF
2. **监控处理**：查看 Worker 日志了解处理进度
3. **查看结果**：前端展示解析结果和表格完整性指标
4. **调优性能**：根据需要调整 `WORKER_CONCURRENCY` 和 `PY_TABLE_TIMEOUT_MS`

