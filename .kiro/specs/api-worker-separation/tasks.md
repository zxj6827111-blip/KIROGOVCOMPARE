# tasks.md
# API 与 Worker 分离 + Python 表格解析引擎 - 实现计划（最终收口版）

> 目标：按 requirements.md 的最终口径落地；所有验证默认走 Nginx 80（生产口径），容器内诊断才允许访问 API:3000。

## 阶段 1：进程分离（必须先完成）

- [ ] 1. 新增 API 入口文件 `src/server.ts`
  - 从 `src/index.ts` 抽离 Express 初始化与路由注册
  - 所有路由统一 `/api/v1/` 前缀
  - 提供 `/health`
  - **禁止**注册任何队列 processors（不得调用 setupAllProcessors/等价函数）
  - **禁止**提供静态文件（静态由 Nginx 承担）
  - 对应：需求 1、12

- [ ] 2. 新增 Worker 入口文件 `src/worker.ts`
  - 从 `src/index.ts` 抽离队列消费与处理逻辑
  - 启动 BullMQ Worker 并消费任务
  - **禁止**启动 HTTP Server
  - 并发通过 `WORKER_CONCURRENCY` 配置
  - 对应：需求 1、2

- [ ] 3. 修改 `package.json` 启动命令
  - `start:api` -> 仅启动 server
  - `start:worker` -> 仅启动 worker
  - 对应：需求 1

## 阶段 2：部署与基础设施（compose 生产口径）

- [ ] 4. 提供唯一权威 `docker-compose.yml`
  - 对外仅暴露 Nginx 80
  - API 仅 expose 3000（不对宿主机暴露）
  - Postgres/Redis 不暴露宿主机端口（生产口径）
  - 使用命名 volume：`uploads:/app/uploads`
  - 对应：需求 3、13

- [ ] 5. 提供 `nginx.conf`
  - 静态站点托管
  - 反代 `/api/v1/*` 到 API
  - 反代 `/health` 到 API
  - 配置 `client_max_body_size`
  - 对应：需求 3、11、12

## 阶段 3：数据库迁移（幂等）

- [ ] 6. 落地迁移机制
  - 提供 `migrations/`（或等价机制）与执行脚本
  - `npm run db:migrate` 可在容器启动时执行
  - 失败必须非零退出码并阻断启动
  - 对应：需求 4

## 阶段 4：Python 表格主引擎（核心）

- [ ] 7. 创建 Python 目录与依赖
  - `python/requirements.txt`（pdfplumber 等）
  - `python/extract_tables_pdfplumber.py`
  - 只保留 **argv 调用协议**（禁止多协议并存）
  - 对应：需求 5、6

- [ ] 8. Worker 集成 Python 调用
  - 使用 `execFile('python3', [...])`
  - 超时 `PY_TABLE_TIMEOUT_MS`
  - 捕获 stdout/stderr，非零退出码处理
  - 将表格 JSON 合并写入最终 `content`
  - 对应：需求 5、6、8

- [ ] 9. rowKey/colKey 映射与稳定对齐
  - 读取 `specs/annual_report_table_schema_v2.json`
  - 三张表分别对齐：表2->sec2_art20_*，表3->sec3_requests，表4->sec4_review_litigation
  - 对应：需求 9

- [ ] 10. 完整性指标与前端告警
  - 计算：nonEmptyRatio、rowMatchRate、numericParseRate、confidence
  - 输出：completeness（complete/partial/failed）+ issues
  - 禁止“骨架齐全即 complete”
  - 对应：需求 8

- [ ] 11. 禁用示例数据兜底（强制）
  - 删除/禁用任何“默认表格/示例表格”填充逻辑
  - TS 表格抽取仅 debug，默认关闭（`ENABLE_TS_TABLE_FALLBACK=0`）
  - 对应：需求 7

## 阶段 5：回归测试（验收必备）

- [ ] 12. 回归脚本与样例 PDF
  - 至少 3 份样例 PDF（`sample_pdfs_v1/`）
  - 输出每张表：nonEmptyCells/totalCells、matchedRows/expectedRows、confidence、completeness、issues（前若干条）
  - 生成机器可读汇总（JSON）+ 控制台可读表格
  - 对应：需求 10

## 阶段 6：一键启动与统一验证口径（只走 Nginx 80）

- [ ] 13. 统一验证步骤（生产口径）
  - `docker compose up -d --build`
  - `curl http://localhost/health`
  - `curl http://localhost/api/v1/...`（按接口实际方法/鉴权执行）
  - 容器内诊断才允许：`docker exec <api容器> curl http://localhost:3000/health`
  - 对应：需求 11、12
