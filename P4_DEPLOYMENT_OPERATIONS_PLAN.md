# P4-3A 部署运维与交付能力计划

## 1. 当前分支和 main commit

- 当前工作目录：`E:\Software Development\KIROGOVCOMPARE`
- 当前分支：`codex/p4-deployment-operations`
- `main` commit：`27cbec2d507cb43b7e20f92c1ba071fd4b54770b`
- `main` commit 标题：`Merge pull request #108 from zxj6827111-blip/codex/p4-data-quality-evidence`
- 创建分支前已执行：
  - `git fetch origin`
  - `git checkout main`
  - `git pull --ff-only origin main`
  - `git status --short --branch --untracked-files=all`
  - `git log --oneline -10`
  - `git checkout -b codex/p4-deployment-operations`

## 2. 当前部署与运维现状

### 2.1 项目运行入口

- 后端生产入口：`dist/index-llm.js`，`package.json` 中 `start` / `start:prod` 都指向 `node -r dotenv/config dist/index-llm.js`。
- LLM 开发入口：`npm run dev:llm`，默认 `PORT=8787`，`FRONTEND_URL=http://localhost:3001`。
- 后端启动会执行迁移入口 `runMigrations()`，除非设置 `LLM_RUN_MIGRATIONS=0`。
- 后端启动会启动：
  - `llmJobRunner`
  - `GovInsightReportJobWorker`
  - `PdfExportWorker`
  - HTTP API，除非 `LLM_WORKER_ONLY=1`

### 2.2 前端运行方式

- 前端开发入口：`frontend/npm start`，由 `frontend/scripts/dev-server.js` 负责。
- 生产静态前端服务：`scripts/serve-frontend.js`，默认：
  - `FRONTEND_HOST=0.0.0.0`
  - `FRONTEND_PORT=53002`
  - `BACKEND_ORIGIN=http://127.0.0.1:8787`
  - `/healthz` 返回前端健康状态
  - `/api` 代理到后端

### 2.3 现有部署资产

- `DEPLOYMENT.md` 已存在，但偏通用，部分内容仍是旧端口和旧入口，未完整覆盖当前 `index-llm`、前端生产服务、PDF 工具链、TaskDrawer 验收、诊断包、备份恢复和清理策略。
- `Dockerfile` 基于 `node:18-alpine`，只复制 `dist`，启动 `dist/index.js`，与当前 `package.json` 的 Node `>=20` 和生产入口 `dist/index-llm.js` 不完全一致。
- `docker-compose.yml` 提供 PostgreSQL、Redis、app，但 app 端口仍是 `3000`，挂载 `./uploads:/app/uploads` 和 `./exports:/app/exports`，与当前主要数据目录 `data/uploads`、`data/exports/pdf` 不完全一致。
- `ecosystem.config.cjs` 已有 PM2 配置：
  - 后端：`kirogovcompare-backend`，`/opt/KIROGOVCOMPARE/dist/index-llm.js`，`PORT=8787`
  - 前端：`kirogovcompare-frontend`，`scripts/serve-frontend.js`，`FRONTEND_PORT=53002`

### 2.4 环境变量现状

- `.env.example` 已覆盖 PostgreSQL、Redis、文件存储、服务端口、CORS、JWT、管理员 token、OpenAI/GPT-5.5 相关模型配置、限流、PDF export service user。
- 本地 `.env` 存在；本阶段只读取变量名，不读取或暴露真实值。
- `.env.example` 尚未明确列出 PDF 渲染和巡检相关变量，例如 `PUPPETEER_EXECUTABLE_PATH`、`PDF_EXPORT_DEBUG`、`PDF_EXPORT_HYDRATE_WAIT_MS`、`PDF_EXPORT_PRINT_READY_TIMEOUT_MS`、`PDF_SMOKE_*`、`OPS_*`。

### 2.5 健康检查现状

- 后端健康接口：`GET /api/health`，执行 `SELECT 1`，返回数据库连接状态。
- 前端健康接口：`GET /healthz`，由 `scripts/serve-frontend.js` 返回静态服务健康状态。
- 现有脚本：`scripts/llm-health.js`，只检查后端 `/api/health`。
- 当前缺口：没有一键只读脚本同时检查后端、前端、数据库配置完整性、Redis 配置、上传/导出/日志目录可写性、PDF/Puppeteer 工具链、任务队列表状态和 PDF smoke 能力。

### 2.6 文件目录现状

- 代码常量：
  - `DATA_DIR = <projectRoot>/data`
  - `UPLOADS_DIR = data/uploads`
  - `UPLOADS_TMP_DIR = data/uploads/tmp`
  - `PDF_EXPORTS_DIR = data/exports/pdf`
- `StorageService` 也支持 `STORAGE_PATH`，默认 `./uploads`，但当前主上传服务把报告文件落到 `data/uploads/<region>/<year>/...`。
- 日志目录由启动脚本约定为 `logs/`，PDF debug 开启时也会写 `logs/pdf-debug-*`。
- `.gitignore` 已排除 `data/`、`uploads/`、`output/`、`tmp/`、`logs/`、`backups/`、`.codex-temp/`、PDF fixture 等生成物。

### 2.7 数据库与队列现状

- 当前主数据库配置：`src/config/database-llm.ts`，强制 PostgreSQL，要求 `DB_HOST`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`。
- Redis 主要用于限流存储，可通过 `RATE_LIMIT_STORE=redis` 和 `RATE_LIMIT_REDIS_URL` / `REDIS_*` 配置。
- 任务队列主要存在 PostgreSQL `jobs` 表，由 `LlmJobRunner`、`GovInsightReportJobWorker`、`PdfExportWorker` 轮询处理。
- 当前缺口：运维文档没有固定 jobs 表巡检 SQL、失败任务排查口径、PDF job 文件过期处理流程。

### 2.8 PDF/Puppeteer 与视觉工具链现状

- 依赖中包含 `puppeteer`。
- 当前 PDF 主链路：
  - 用户侧比对 PDF：`/api/pdf-jobs` + `PdfExportWorker` + React print page。
  - GovInsight PDF：`/api/gov-insight/report-pdf` + React print page。
  - legacy EJS `PdfExportService` 保留兼容，不删除。
- `BrowserRenderer` 支持 `PUPPETEER_EXECUTABLE_PATH`，并会尝试 Windows Chrome/Edge。
- `scripts/pdf-smoke-baseline.js` 已覆盖 PDF 文本、页数、空白页、ready marker、GovInsight、pdf-job API，并探测 `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript。
- P4-2 报告确认当前验证机缺少 `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript，像素级视觉回归降级。
- 明确边界：不修改 `scripts/pdf-smoke-baseline.js`。

### 2.9 备份、恢复、清理、诊断脚本现状

- `scripts/backup-system.ps1` 已具备系统备份能力：
  - 从 `.env` 读取 DB 配置。
  - 使用 `pg_dump` 备份 PostgreSQL。
  - 复制 `data`、`uploads`、`logs`、`output`、`tmp`。
  - 打包到 `backups/system-backup-*.zip`。
  - 排除真实 `.env`，只复制 `.env.example`。
- 现有恢复脚本存在风险：
  - `scripts/restore_db.py`、`scripts/restore_db_full.ps1`、`scripts/restore_database.bat` 有硬编码旧路径或默认凭据。
  - 恢复脚本会 drop schema/database，属于高风险操作，P4-3 不应自动执行。
- 当前缺口：缺少安全的恢复 Runbook、备份校验步骤、诊断包脚本、日志轮转/临时文件清理 Runbook。

### 2.10 P4-2 交接信息

- `P4_2_POST_MERGE_HEALTH_CHECK.md` 存在，结论允许进入 P4-3。
- P4-2 已知遗留：
  - PDF 原生视觉工具链缺失，需要纳入部署/验收环境清单。
  - GovInsight latest job failed 属于 P4-5，不在 P4-3 修复。
  - TaskDrawer `/upload`、`/jobs`、`/jobs?tab=download` 需要 P4-3 固化人工验收流程。

## 3. 缺口清单

1. `DEPLOYMENT.md` 与当前生产入口、端口、PM2、前端服务、文件目录和 PDF 工具链不完全一致。
2. 缺少独立 `OPERATIONS.md`，没有固定日常巡检、备份恢复、日志轮转、临时文件清理、任务队列、回滚和健康检查操作口径。
3. 缺少独立 `TROUBLESHOOTING.md`，没有系统化覆盖 PDF、TaskDrawer、上传解析、任务队列、GovInsight、下载过期、权限、环境变量问题。
4. `scripts/llm-health.js` 只检查后端 `/api/health`，不足以作为交付巡检脚本。
5. 缺少诊断包脚本，人工排查时容易遗漏 Git 状态、环境变量键名、包版本、目录状态、端口健康、PDF 工具链和 jobs 摘要。
6. `.env.example` 缺少 PDF 渲染和运维巡检相关变量说明。
7. `package.json` 缺少清晰的一键运维命令，例如健康检查、诊断包、备份入口。
8. Docker 文档和当前 Dockerfile/compose 存在入口、Node 版本、端口和目录差异，需要在文档中明确“待校准”而不是误导直接生产使用。
9. 备份脚本已有，但恢复脚本风险高，需要文档标注只在人工确认后执行，并建议从备份包 RESTORE.md 和手工命令恢复。
10. 日志轮转和临时文件清理缺少建议保留期、清理范围和禁止提交说明。
11. PDF 原生视觉工具链缺失没有纳入部署门禁。
12. TaskDrawer 人工验收流程未固化为交付步骤。

## 4. 建议新增/修改文件

P4-3B 建议文件范围：

- 新增/更新 `DEPLOYMENT.md`：重写为当前项目部署指南。
- 新增 `OPERATIONS.md`：日常运维、巡检、备份恢复、清理、回滚。
- 新增 `TROUBLESHOOTING.md`：常见问题排查。
- 新增 `scripts/health-check.js`：只读健康检查脚本。
- 新增 `scripts/diagnostic-bundle.js`：默认不含敏感文件的诊断包脚本，支持 `--dry-run`。
- 修改 `package.json`：增加 `ops:health`、`ops:diagnostics`、`ops:diagnostics:dry-run`、`backup:system` 等脚本。
- 修改 `.env.example`：补充 PDF 和运维脚本相关变量，占位为空或安全默认值。
- 新增 `P4_DEPLOYMENT_OPERATIONS_REPORT.md`：实施报告。

不建议修改：

- 数据库 schema/migration。
- 解析算法、比对算法、GovInsight 生成逻辑。
- PDF 后端主链路。
- `scripts/pdf-smoke-baseline.js`。
- legacy EJS 文件。

## 5. 部署文档结构

`DEPLOYMENT.md` 建议结构：

1. 部署目标和范围。
2. 环境要求：
   - Node.js 20+
   - PostgreSQL 15/16+
   - Redis 7+，按限流配置决定是否必需
   - Chrome/Edge 或 Puppeteer Chromium
   - 可选 PDF 原生视觉工具：Poppler、ImageMagick、Ghostscript
3. 端口说明：
   - 后端 `8787`
   - 前端生产静态服务 `53002`
   - 前端开发 `3001`
   - PostgreSQL `5432`
   - Redis `6379`
4. 安装依赖和构建。
5. 环境变量配置。
6. 数据库准备与迁移策略。
7. 后端启动/停止。
8. 前端启动/停止。
9. PM2 部署。
10. Docker/Compose 现状和注意事项。
11. 健康检查。
12. PDF/Puppeteer 配置。
13. smoke 与 strict-live 验证。
14. 回滚建议。

## 6. 运维文档结构

`OPERATIONS.md` 建议结构：

1. 日常巡检清单。
2. 一键健康检查。
3. 一键 smoke。
4. 一键诊断包。
5. 数据库连接检查。
6. 任务队列巡检。
7. 上传目录和导出目录巡检。
8. PDF renderer/Puppeteer 巡检。
9. 日志位置和日志轮转建议。
10. 临时文件和导出文件清理建议。
11. 数据库备份。
12. 上传文件备份。
13. 恢复流程。
14. 回滚流程。
15. TaskDrawer 人工验收流程。
16. 交付前门禁。

## 7. 故障排查文档结构

`TROUBLESHOOTING.md` 建议结构：

1. 后端无法启动。
2. `/api/health` 失败。
3. 前端 `/healthz` 失败。
4. 登录和权限问题。
5. 上传解析失败。
6. 任务队列卡住。
7. PDF job queued/running 不完成。
8. PDF 下载过期或 410。
9. Puppeteer/Chrome 缺失。
10. PDF 视觉工具缺失导致 smoke 降级。
11. TaskDrawer 不显示或任务不刷新。
12. GovInsight 报告生成失败。
13. GovInsight PDF 失败。
14. 数据库连接池或 Redis 限流问题。
15. 环境变量缺失或 CORS 错误。
16. 回滚和恢复时的风险提示。

## 8. 健康检查脚本设计

建议新增 `scripts/health-check.js`：

- 默认只读，不修改数据库、不写业务数据。
- 支持参数：
  - `--api-base=http://127.0.0.1:8787`
  - `--frontend-url=http://127.0.0.1:53002`
  - `--json`
  - `--timeout-ms=5000`
- 检查项：
  1. Node 版本。
  2. 必要环境变量键是否存在，不输出 secret 值。
  3. 后端 `/api/health`。
  4. 前端 `/healthz`。
  5. PostgreSQL `SELECT 1`，只读。
  6. Redis 配置可读性；如启用 `RATE_LIMIT_STORE=redis`，尝试 ping。
  7. `data/uploads`、`data/uploads/tmp`、`data/exports/pdf`、`logs`、`tmp` 目录存在性和可写性，写入临时 probe 后立即删除。
  8. Puppeteer 依赖是否可加载。
  9. Chrome/Edge/Puppeteer executable 是否可解析。
  10. Poppler/ImageMagick/Ghostscript 是否安装。
  11. jobs 表近 24 小时失败/运行中摘要，只读查询；表不存在时明确 skipped。
- 输出：
  - 人类可读摘要。
  - `--json` 时输出结构化 JSON。
- 退出码：
  - 关键项失败返回 `1`。
  - 可选工具缺失返回 `0`，但状态标为 warning，避免阻断没有视觉工具的开发机。

## 9. 诊断包脚本设计

建议新增 `scripts/diagnostic-bundle.js`：

- 默认生成到 `.codex-temp/diagnostics/kirogovcompare-diagnostic-<timestamp>` 或 `tmp/diagnostics`，最终可选 ZIP。
- 支持：
  - `--dry-run`：只列出将收集的内容，不生成文件。
  - `--out=<dir>`：指定输出目录。
  - `--include-logs`：可选包含最近日志片段，默认不包含完整日志。
  - `--zip`：压缩为 zip。
- 收集内容：
  1. `git status --short --branch --untracked-files=all`
  2. `git log --oneline -10`
  3. `package.json` 和 `frontend/package.json` 的 scripts/dependencies 摘要。
  4. `.env.example`。
  5. `.env` 仅收集键名，不收集值。
  6. 目录状态摘要：`data/uploads`、`data/exports/pdf`、`logs`、`tmp`、`output`、`backups` 文件数和大小。
  7. 健康检查 JSON 输出。
  8. PDF 工具链探测结果。
  9. jobs 表只读摘要，连接失败则记录 blocked。
- 明确排除：
  - `.env` 真实值
  - secret/token
  - `node_modules`
  - `dist/build/coverage`
  - PDF/ZIP/截图/HTML dump
  - 上传原文文件
  - 完整日志
  - 备份包
- 生成物不提交，依赖 `.gitignore` 的 `.codex-temp/`、`tmp/`、`logs/`、`backups/` 排除。

## 10. 备份恢复建议

- 保留 `scripts/backup-system.ps1` 作为 Windows 主备份入口，文档中补充：
  - 执行前确认 `.env` DB 配置。
  - 确认 PostgreSQL client tools 可用。
  - 备份包输出到 `backups/`，不得提交。
  - 备份后至少检查 ZIP 存在、大小合理、manifest 存在。
- 恢复建议以手工 Runbook 为主：
  1. 准备相同版本代码。
  2. 解压备份包到临时目录。
  3. 配置目标 `.env`。
  4. 用 `psql` 恢复 SQL dump。
  5. 恢复 `data/uploads` 和 `data/exports/pdf` 等文件。
  6. 启动后运行 `ops:health`、`smoke:pdf`、关键页面人工验收。
- 不建议在 P4-3 自动修改现有高风险恢复脚本；先在文档中标记它们包含硬编码路径/凭据，执行前必须人工审阅和改参。

## 11. 日志轮转与临时文件清理建议

- 日志：
  - `logs/llm-<port>.log`
  - `logs/llm-<port>.log.err`
  - `logs/pdf-debug-*`，仅 `PDF_EXPORT_DEBUG=1` 时生成
  - PM2 日志由 PM2 管理
- 建议：
  - 生产使用 PM2 logrotate 或系统 logrotate。
  - 普通 app 日志保留 14-30 天。
  - PDF debug 截图/HTML 只在问题排查时开启，保留 3-7 天。
- 清理：
  - `data/exports/pdf` 可按业务保留期清理，但清理后下载会返回 410，需要重新生成。
  - `data/uploads` 是核心业务文件，不做自动清理，必须随数据库一起备份。
  - `tmp/`、`.codex-temp/`、`output/` 可以按临时产物策略清理，但不得提交。

## 12. PDF 原生视觉工具链现状和建议

- 当前 smoke 脚本可在缺少原生工具时降级，但交付环境建议安装并固定：
  - Poppler：`pdfinfo`、`pdftoppm`
  - ImageMagick：`magick`
  - Ghostscript：`gs` / `gswin64c`
- Windows 验收机建议将上述工具加入 `PATH`。
- Linux 验收机建议通过发行版包管理器安装。
- P4-3 不修改 `scripts/pdf-smoke-baseline.js`，只在文档和健康检查中报告工具是否可用。

## 13. TaskDrawer 人工验收固化建议

P4-3B 文档中应固化人工验收流程：

1. 登录管理员账号。
2. 打开 `/upload`，上传或进入上传页，确认 TaskDrawer 入口可见。
3. 打开 `/jobs`，确认任务列表、状态、刷新、失败提示。
4. 打开 `/jobs?tab=download`，确认 PDF 任务、下载、重新生成和过期提示。
5. 打开 `/comparison/4670`，触发或查看 PDF job，确认 TaskDrawer 与任务中心一致。
6. 记录浏览器、账号角色、API base、前端 URL 和观察结论。

该流程只固化验收，不改 TaskDrawer 功能。

## 14. 自动验证计划

P4-3B/P4-3C/P4-3E 按阶段执行：

1. `npm.cmd run build`
2. `npm.cmd test`
3. `cd frontend && npm.cmd test -- --runInBand`
4. `cd frontend && npm.cmd run build`
5. `npm.cmd run smoke:pdf`
6. 如本地后端和前端可用，运行 strict-live：
   `npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001`
7. `npm.cmd run ops:health`
8. `npm.cmd run ops:diagnostics:dry-run`
9. 如生成诊断包，只输出到 `.codex-temp/` 或 `tmp/` 并确认未进入 git。
10. `git diff --check`
11. `git ls-files --others --exclude-standard`

## 15. 不改动边界

P4-3 明确不做：

- 不改数据库 schema/migration，除非人工明确批准。
- 不改解析算法。
- 不改比对算法。
- 不改 GovInsight 生成逻辑。
- 不改 PDF 后端主链路。
- 不改 `scripts/pdf-smoke-baseline.js`，除非人工明确批准。
- 不删除 legacy EJS。
- 不提交 logs、诊断包、PDF、ZIP、截图、HTML dump、build/dist/coverage/node_modules。
- 不提交真实 `.env`、secret、token。
- 不使用 `git add .`。
- 不混入 P4-4/P4-5。

## 16. 是否建议进入 P4-3B 实施

建议进入 P4-3B。

理由：

- P4-2 合并后健康检查已确认 `main` 可进入 P4-3。
- 当前缺口主要是文档、只读巡检脚本、诊断包脚本和 package scripts，风险低且符合 P4-3 目标。
- 可在不触碰业务功能、schema、解析/比对算法、GovInsight 生成逻辑、PDF 主链路和 legacy EJS 的前提下完成。
- 自动验证路径明确，生成物可通过 `.gitignore` 和门禁检查排除。
