# Phase 8 验收清单 - API/Worker 分离 + Python 表格解析引擎

## 📋 验收标准

本清单用于验证 Phase 8 实现是否满足所有需求。

---

## ✅ 需求验收

### 需求 1：API 与 Worker 进程分离

- [ ] **1.1** API 进程启动时仅启动 HTTP Server
  - 验证：`npm run start:api` 启动后 `curl http://localhost:3000/health` 返回 200
  - 文件：`src/server.ts`

- [ ] **1.2** API 进程禁止注册任何队列处理器
  - 验证：查看 `src/server.ts` 不包含 `setupAllProcessors()` 调用
  - 文件：`src/server.ts`

- [ ] **1.3** Worker 进程仅注册队列处理器并消费任务
  - 验证：`npm run start:worker` 启动后日志显示 "Worker process started"
  - 文件：`src/worker.ts`

- [ ] **1.4** Worker 进程禁止启动 HTTP Server
  - 验证：查看 `src/worker.ts` 不包含 `app.listen()` 调用
  - 文件：`src/worker.ts`

### 需求 2：并发参数可配置

- [ ] **2.1** Worker 支持通过 `WORKER_CONCURRENCY` 环境变量控制并发
  - 验证：`WORKER_CONCURRENCY=4 npm run start:worker` 启动后日志显示并发数
  - 文件：`src/queue/processors.ts`

- [ ] **2.2** 并发压力增大时系统通过队列排队吸收压力
  - 验证：高并发上传时 API 响应时间不显著增加
  - 文件：`docker-compose.yml`

### 需求 3：Docker Compose 部署配置

- [ ] **3.1** Docker Compose 启动 Nginx、API、Worker、Redis、Postgres
  - 验证：`docker compose up -d` 后 `docker compose ps` 显示 5 个容器 running
  - 文件：`docker-compose.yml`

- [ ] **3.2** 仅对宿主机暴露 Nginx 80 端口
  - 验证：`docker compose ps` 中仅 nginx 显示 `0.0.0.0:80->80/tcp`
  - 文件：`docker-compose.yml`

- [ ] **3.3** API/Worker 通过容器内网络连接 Redis/Postgres
  - 验证：`docker compose exec api curl http://redis:6379` 返回连接
  - 文件：`docker-compose.yml`

- [ ] **3.4** Nginx 托管前端静态文件并反代 API
  - 验证：`curl http://localhost/` 返回前端 HTML
  - 文件：`nginx.conf`

### 需求 4：数据库迁移脚本（幂等）

- [ ] **4.1** 容器启动时自动执行幂等迁移脚本
  - 验证：`docker compose up -d` 后查看日志显示迁移执行
  - 文件：`docker-entrypoint.sh`、`Dockerfile`

- [ ] **4.2** 迁移已应用时跳过该迁移
  - 验证：重启容器后迁移不重复执行
  - 文件：`src/db/migrations.ts`

- [ ] **4.3** 迁移失败时输出错误日志并以非零退出码退出
  - 验证：故意破坏迁移文件后容器启动失败
  - 文件：`docker-entrypoint.sh`

### 需求 5：Python 表格解析引擎集成

- [ ] **5.1** Worker 调用 `python/extract_tables_pdfplumber.py` 解析三张核心表
  - 验证：查看 Worker 代码调用 Python 脚本
  - 文件：`python/extract_tables_pdfplumber.py`

- [ ] **5.2** Python 输出与前端渲染兼容的 canonical tables 结构
  - 验证：Python 输出包含 rows/columns/cells 结构
  - 文件：`python/extract_tables_pdfplumber.py`

- [ ] **5.3** Python 失败时记录错误与 issues，标记 `completeness=failed`
  - 验证：测试 PDF 失败时输出包含 issues 和 completeness
  - 文件：`python/extract_tables_pdfplumber.py`

### 需求 6：Python 环境与依赖管理

- [ ] **6.1** 构建镜像时安装 `python/requirements.txt` 内依赖
  - 验证：`docker compose build` 后 `docker compose exec worker pip list | grep pdfplumber`
  - 文件：`Dockerfile`、`python/requirements.txt`

- [ ] **6.2** Worker 调用 Python 时设置超时并捕获 stderr
  - 验证：查看 Worker 代码包含超时和错误捕获逻辑
  - 文件：`src/queue/processors.ts`（需补充）

### 需求 7：禁止生成示例表格数据

- [ ] **7.1** 表格解析失败时返回空/部分表格并附带 issues
  - 验证：测试失败场景，输出不包含示例数据
  - 文件：`python/extract_tables_pdfplumber.py`

- [ ] **7.2** 禁止填充示例数据或默认表格
  - 验证：查看代码不包含示例数据填充逻辑
  - 文件：`docker-compose.yml`（ENABLE_TS_TABLE_FALLBACK=0）

### 需求 8：表格完整性判定标准

- [ ] **8.1** Python 输出每张表的指标
  - 验证：Python 输出包含 nonEmptyCells、matchedRows、confidence 等
  - 文件：`python/extract_tables_pdfplumber.py`

- [ ] **8.2** 前端显著展示 completeness != complete 的警告
  - 验证：前端代码包含警告展示逻辑（需前端验证）
  - 文件：前端代码

- [ ] **8.3** 禁止仅凭"行列骨架齐全"判定 complete
  - 验证：查看完整性判定规则基于指标而非骨架
  - 文件：`python/extract_tables_pdfplumber.py`

### 需求 9：表格模板规范与 rowKey/colKey 对齐

- [ ] **9.1** 表2 rowKey/colKey 对齐 schema 中 sec2_art20_*
  - 验证：Python 输出的 rowKey 与 schema 一致
  - 文件：`python/extract_tables_pdfplumber.py`

- [ ] **9.2** 表3 rowKey/colKey 对齐 schema 中 sec3_requests
  - 验证：Python 输出的 rowKey 与 schema 一致
  - 文件：`python/extract_tables_pdfplumber.py`

- [ ] **9.3** 表4 rowKey/colKey 对齐 schema 中 sec4_review_litigation
  - 验证：Python 输出的 rowKey 与 schema 一致
  - 文件：`python/extract_tables_pdfplumber.py`

- [ ] **9.4** 前端基于固定 rowKey 进行稳定对齐
  - 验证：跨年比对时 diff 不漂移（需前端验证）
  - 文件：前端代码

### 需求 10：回归测试脚本

- [ ] **10.1** 回归脚本对至少 3 份样例 PDF 输出每张表的指标
  - 验证：`node scripts/regress_tables.js` 输出包含所有指标
  - 文件：`scripts/regress_tables.js`

- [ ] **10.2** 回归失败时输出可读报告
  - 验证：`cat output/regress_tables_summary.json` 包含完整信息
  - 文件：`scripts/regress_tables.js`

### 需求 11：Docker Compose 一键启动与验证

- [ ] **11.1** `docker compose up -d --build` 在合理时间内启动成功
  - 验证：命令执行成功，所有容器 running
  - 文件：`docker-compose.yml`

- [ ] **11.2** 验证脚本使用 `http://localhost/health`（走 Nginx 80）
  - 验证：`curl http://localhost/health` 返回 200
  - 文件：`scripts/verify-docker-compose.sh`

- [ ] **11.3** 验证脚本使用 `http://localhost/api/v1/...`（走 Nginx 80）
  - 验证：`curl http://localhost/api/v1/tasks` 返回 200 或 401
  - 文件：`scripts/verify-docker-compose.sh`

- [ ] **11.4** 内部诊断使用 `docker exec` 访问 API:3000
  - 验证：`docker exec <api容器> curl http://localhost:3000/health` 返回 200
  - 文件：`scripts/verify-docker-compose.sh`

### 需求 12：API 路由前缀统一

- [ ] **12.1** API 提供路由统一使用 `/api/v1/` 前缀
  - 验证：查看 `src/server.ts` 所有路由使用 `/api/v1/` 前缀
  - 文件：`src/server.ts`

- [ ] **12.2** Nginx 反代将 `/api/v1/*` 透传到 API 容器
  - 验证：`curl http://localhost/api/v1/tasks` 成功
  - 文件：`nginx.conf`

- [ ] **12.3** 前端使用相对路径 `/api/v1/...`
  - 验证：前端代码不包含硬编码 `http://localhost`（需前端验证）
  - 文件：前端代码

### 需求 13：文件共享存储

- [ ] **13.1** API 保存上传文件到 `/app/uploads`
  - 验证：查看 API 代码写入路径为 `/app/uploads`
  - 文件：`src/routes/assets.ts`（需验证）

- [ ] **13.2** Worker 通过同一个共享 volume 访问 `/app/uploads`
  - 验证：Worker 代码读取路径为 `/app/uploads`
  - 文件：`src/queue/processors.ts`（需验证）

- [ ] **13.3** 部署使用命名 volume `uploads:/app/uploads`
  - 验证：`docker volume ls` 显示 uploads volume
  - 文件：`docker-compose.yml`

---

## 📁 文件完整性检查

### 核心文件

- [ ] `src/server.ts` 存在且包含 API 入口逻辑
- [ ] `src/worker.ts` 存在且包含 Worker 入口逻辑
- [ ] `docker-compose.yml` 存在且配置完整
- [ ] `Dockerfile` 存在且支持 Python
- [ ] `nginx.conf` 存在且配置反代规则
- [ ] `docker-entrypoint.sh` 存在且可执行

### Python 表格引擎

- [ ] `python/requirements.txt` 存在且包含 pdfplumber
- [ ] `python/extract_tables_pdfplumber.py` 存在且实现完整

### 测试与验证

- [ ] `scripts/regress_tables.js` 存在且可执行
- [ ] `scripts/verify-docker-compose.sh` 存在且可执行

### 文档

- [ ] `DEPLOYMENT_GUIDE.md` 存在且内容完整
- [ ] `QUICK_START_DEPLOYMENT.md` 存在且内容完整
- [ ] `IMPLEMENTATION_SUMMARY_PHASE8.md` 存在且内容完整

---

## 🧪 功能测试

### 本地开发测试

- [ ] `npm run dev:api` 启动 API 成功
- [ ] `npm run dev:worker` 启动 Worker 成功
- [ ] `npm run db:migrate` 执行迁移成功
- [ ] `npm run build` 编译成功

### Docker Compose 测试

- [ ] `docker compose up -d --build` 启动成功
- [ ] `docker compose ps` 显示 5 个容器 running
- [ ] `curl http://localhost/health` 返回 200
- [ ] `curl http://localhost/api/v1/tasks` 返回 200 或 401
- [ ] `docker compose logs` 无错误信息

### 回归测试

- [ ] 准备 3 份样例 PDF 到 `sample_pdfs_v1/`
- [ ] `node scripts/regress_tables.js` 执行成功
- [ ] `output/regress_tables_summary.json` 包含完整数据
- [ ] 所有表格的 completeness 值正确

### 验证脚本测试

- [ ] `bash scripts/verify-docker-compose.sh` 执行成功
- [ ] 脚本输出显示所有检查通过

---

## 📊 性能基准

- [ ] 记录 API 响应时间（目标 <100ms）
- [ ] 记录 Worker 处理时间（目标 <30s/PDF）
- [ ] 记录 Python 表格提取时间（目标 <10s/PDF）
- [ ] 记录系统内存使用（目标 <2GB）

---

## 🔒 安全检查

- [ ] API 不暴露 3000 端口到宿主机
- [ ] Postgres/Redis 不暴露端口到宿主机
- [ ] 仅 Nginx 80 对外暴露
- [ ] 环境变量中无硬编码密码（使用 .env）

---

## 📝 文档完整性

- [ ] 部署指南包含故障排查部分
- [ ] 快速启动指南包含 5 分钟上手步骤
- [ ] 实现总结包含所有完成的任务
- [ ] 所有文档包含中文说明

---

## ✨ 额外检查

- [ ] 代码无编译错误（`npm run build` 成功）
- [ ] 代码无 lint 错误（`npm run lint` 成功）
- [ ] 所有新文件都有适当的注释
- [ ] 所有配置文件都有说明文档

---

## 🎯 验收结论

### 验收通过条件

- [ ] 所有 13 个需求都标记为 ✅
- [ ] 所有核心文件都存在且完整
- [ ] Docker Compose 一键启动成功
- [ ] 所有验证脚本执行成功
- [ ] 无编译错误和 lint 错误

### 验收签字

| 角色 | 姓名 | 日期 | 签字 |
|------|------|------|------|
| 开发 | - | - | - |
| 测试 | - | - | - |
| 产品 | - | - | - |

---

## 📞 问题记录

如验收过程中发现问题，请记录在此：

| 问题 | 严重程度 | 状态 | 备注 |
|------|---------|------|------|
| - | - | - | - |

---

**验收日期**：2025-12-15  
**版本**：1.0.0  
**状态**：待验收

