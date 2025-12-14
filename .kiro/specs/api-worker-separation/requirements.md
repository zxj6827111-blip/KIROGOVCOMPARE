# requirements.md
# API 与 Worker 分离 + Python 表格解析引擎 - 需求文档（最终收口版）

## 0. 术语与系统边界

- **Nginx**：系统对外唯一入口（80），托管前端静态文件，并将 `/api/v1/*` 与 `/health` 反代到 API 容器。
- **API 进程**：只负责 Express 路由（`/api/v1/*`）与健康检查（`/health`），处理上传与入队，**不执行任何后台处理**，**不提供静态文件服务**。
- **Worker 进程**：只消费队列任务，执行 PDF 解析、表格提取（调用 Python）、结果落库；**不启动 HTTP Server**。
- **队列**：Redis + BullMQ，用于削峰填谷，保证并发上来只排队不崩。
- **表格主引擎**：Python + pdfplumber，用于无网格线 PDF 三张核心表提取。
- **三张核心表**：  
  - 表2：主动公开政府信息情况  
  - 表3：收到和处理政府信息公开申请情况  
  - 表4：政府信息公开行政复议、行政诉讼情况  

## 需求 1：API 与 Worker 进程分离

**用户故事：** 作为系统，我需要将 API 与后台处理彻底解耦，避免解析任务拖垮对外服务。

1.1 WHEN 启动 API 进程 THEN 系统 SHALL 仅启动 HTTP Server，并暴露 `/api/v1/*` 与 `/health`。  
1.2 WHEN 启动 API 进程 THEN 系统 SHALL 禁止注册任何队列 processors（不得消费任务）。  
1.3 WHEN 启动 Worker 进程 THEN 系统 SHALL 仅注册队列 processors 并消费任务，禁止启动 HTTP Server。

## 需求 2：并发参数可配置（并发可控）

2.1 WHEN Worker 启动 THEN 系统 SHALL 支持通过环境变量 `WORKER_CONCURRENCY` 控制并发。  
2.2 WHEN 并发压力增大 THEN 系统 SHALL 通过队列排队吸收压力，API 响应能力不应显著劣化。

## 需求 3：Docker Compose 部署配置（唯一生产口径）

**用户故事：** 作为运维人员，我希望一条命令启动完整系统，并且对外只暴露 Nginx 入口。

3.1 WHEN 使用 docker compose 启动 THEN 系统 SHALL 启动 Nginx、API、Worker、Redis、Postgres。  
3.2 WHEN 启动成功 THEN 系统 SHALL 仅对宿主机暴露 Nginx 80 端口。  
3.3 WHEN API/Worker 访问 Redis/Postgres THEN 系统 SHALL 通过容器内网络连接（不依赖宿主机端口暴露）。  
3.4 WHEN Nginx 启动 THEN 系统 SHALL 托管前端静态文件，并将 `/api/v1/*` 与 `/health` 反代到 API 容器。

## 需求 4：数据库迁移脚本（幂等）

4.1 WHEN 容器启动 THEN 系统 SHALL 自动执行幂等迁移脚本（基于 `migrations/` 目录或等价机制）。  
4.2 WHEN 迁移已应用 THEN 系统 SHALL 跳过该迁移（幂等）。  
4.3 WHEN 迁移失败 THEN 系统 SHALL 输出错误日志并以非零退出码退出，阻止应用继续启动。

## 需求 5：Python 表格解析引擎集成（主链路）

5.1 WHEN Worker 处理任务 THEN 系统 SHALL 调用 `python/extract_tables_pdfplumber.py` 解析三张核心表。  
5.2 WHEN Python 输出 THEN 系统 SHALL 输出与前端渲染兼容的 canonical tables 结构（rows/columns/cells）。  
5.3 WHEN Python 失败 THEN 系统 SHALL 记录错误与 issues，并在结果中标记表格 `completeness=failed`，禁止用示例数据兜底。

## 需求 6：Python 环境与依赖管理

6.1 WHEN 构建镜像 THEN 系统 SHALL 安装 `python/requirements.txt` 内依赖（至少包含 pdfplumber）。  
6.2 WHEN Worker 调用 Python THEN 系统 SHALL 设置超时（`PY_TABLE_TIMEOUT_MS`）并捕获 stderr。

## 需求 7：禁止生成示例表格数据（强制）

7.1 WHEN 表格解析失败或为空 THEN 系统 SHALL 返回空/部分表格并附带 issues。  
7.2 WHEN 表格解析失败或为空 THEN 系统 SHALL 禁止填充示例数据或默认表格（不得污染生产输出）。

## 需求 8：表格完整性判定标准（指标驱动 + 前端展示）

8.1 WHEN Python 输出每张表 THEN 系统 SHALL 计算并输出指标：  
- nonEmptyCells/totalCells、nonEmptyRatio  
- matchedRows/expectedRows、rowMatchRate  
- numericParseRate  
- confidence（0~1）  
- completeness（complete/partial/failed）

8.2 WHEN completeness != complete THEN 前端 SHALL 显著展示 warning/banner，并允许查看 issues。  
8.3 WHEN 完整性判定 THEN 系统 SHALL 禁止仅凭“行列骨架齐全”判定 complete。

## 需求 9：表格模板规范与 rowKey/colKey 对齐（固定对齐）

9.1 WHEN 系统解析表2（主动公开政府信息情况）THEN rowKey/colKey SHALL 对齐 schema 中对应表定义（sec2_art20_*）。  
9.2 WHEN 系统解析表3（申请处理情况）THEN rowKey/colKey SHALL 对齐 schema 中 `sec3_requests`。  
9.3 WHEN 系统解析表4（复议诉讼情况）THEN rowKey/colKey SHALL 对齐 schema 中 `sec4_review_litigation`。  
9.4 WHEN 前端跨年比对 THEN 系统 SHALL 基于固定 rowKey 进行稳定对齐，避免 diff 漂移。

## 需求 10：回归测试脚本（至少 3 份样例 PDF）

10.1 WHEN 执行回归脚本 THEN 系统 SHALL 对至少 3 份样例 PDF 输出每张表的：  
nonEmptyCells/totalCells、matchedRows/expectedRows、confidence、completeness、issues（前若干条）。  
10.2 WHEN 回归失败 THEN 系统 SHOULD 在 CI/本地输出可读报告，便于定位问题。

## 需求 11：Docker Compose 一键启动与验证（验收口径统一）

11.1 WHEN 执行 `docker compose up -d --build` THEN 系统 SHALL 在合理时间内启动成功。  
11.2 WHEN 验证服务健康 THEN 验收脚本 SHALL 使用 `http://localhost/health`（走 Nginx 80）。  
11.3 WHEN 验证 API 可用 THEN 验收脚本 SHALL 使用 `http://localhost/api/v1/...`（走 Nginx 80）。  
11.4 WHEN 内部诊断需要访问 API 3000 THEN ONLY 使用 `docker exec <api容器> curl http://localhost:3000/health`。

## 需求 12：API 路由前缀统一（/api/v1）

12.1 WHEN API 提供路由 THEN 系统 SHALL 统一使用 `/api/v1/` 前缀。  
12.2 WHEN Nginx 反代 THEN 系统 SHALL 将 `/api/v1/*` 透传到 API 容器的 `/api/v1/*`。  
12.3 WHEN 前端访问 API THEN 前端 SHALL 使用相对路径 `/api/v1/...`（同源），避免硬编码 `http://localhost`。

## 需求 13：文件共享存储（uploads volume）

13.1 WHEN API 保存上传文件 THEN 文件 SHALL 写入 `/app/uploads`。  
13.2 WHEN Worker 读取 PDF THEN Worker SHALL 通过同一个共享 volume 访问 `/app/uploads`。  
13.3 WHEN 部署使用 compose THEN 系统 SHALL 使用命名 volume `uploads:/app/uploads` 作为生产口径（避免 bind mount 权限差异）。
