# KIROGOVCOMPARE 故障排查手册

排查原则：

- 先运行只读检查，不直接改数据。
- 不输出或外发 secret、token、真实 `.env`。
- 不直接执行旧恢复脚本，除非已人工确认风险。
- 不通过修改 schema、解析算法、比对算法、GovInsight 生成逻辑或 PDF 主链路来绕过问题。

## 1. 快速定位

先执行：

```powershell
npm.cmd run ops:health
npm.cmd run ops:diagnostics:dry-run
```

如果需要收集诊断：

```powershell
npm.cmd run ops:diagnostics
```

默认诊断包不含真实 `.env` 值、上传文件、PDF、ZIP、截图、HTML dump、完整日志和备份包。

## 2. 后端无法启动

常见现象：

- 进程启动后立即退出。
- `/api/health` 连接失败。
- `logs/llm-8787.log.err` 有错误。

检查：

```powershell
npm.cmd run ports:llm
npm.cmd run ops:health -- --skip-network
```

重点看：

- `DB_HOST`、`DB_NAME`、`DB_USER`、`DB_PASSWORD` 是否存在。
- `PORT` 是否被占用。
- Node.js 是否为 20+。
- `JWT_SECRET` 生产环境是否设置。
- `CORS_ALLOWED_ORIGINS` 是否包含前端域名。

处理：

- 端口占用：停止旧进程或调整 `PORT`。
- 数据库不可达：先恢复 PostgreSQL 服务和网络，再启动后端。
- 环境变量缺失：补 `.env`，不要把真实 `.env` 提交。

## 3. `/api/health` 失败

后端健康接口会执行数据库 `SELECT 1`。

检查：

```powershell
npm.cmd run health:llm
npm.cmd run ops:health -- --api-base=http://127.0.0.1:8787
```

可能原因：

- PostgreSQL 未启动。
- DB 主机、端口、用户名、密码、库名错误。
- 防火墙或容器网络不通。
- 数据库连接数耗尽。

处理：

- 先用数据库客户端执行 `SELECT 1`。
- 检查 `logs/llm-8787.log.err`。
- 修正 `.env` 后重启后端。

## 4. 前端 `/healthz` 失败

检查：

```powershell
npm.cmd run ops:health -- --frontend-url=http://127.0.0.1:53002
```

可能原因：

- 前端生产服务未启动。
- `frontend/build/index.html` 不存在。
- `FRONTEND_PORT` 被占用。
- `BACKEND_ORIGIN` 配错导致 API 代理失败。

处理：

```powershell
cd frontend
npm.cmd run build
cd ..
node scripts/serve-frontend.js
```

如果部署在 PM2，检查：

```bash
pm2 status
pm2 logs kirogovcompare-frontend
```

## 5. 登录、权限或 CORS 问题

现象：

- 登录后接口 401/403。
- 浏览器控制台出现 CORS 错误。
- 管理员权限缺失。

检查：

- `JWT_SECRET` 是否与后端一致且未变化。
- `CORS_ALLOWED_ORIGINS` 是否包含前端实际 origin。
- `TRUST_PROXY` 是否符合反向代理部署。
- 管理员密码是否来自 `ADMIN_INITIAL_PASSWORD`。

管理员重置：

```powershell
node -r ts-node/register/transpile-only scripts/reset_admin_password_pg.ts
```

不要把管理员密码写入文档或提交记录。

## 6. 上传解析失败

现象：

- 上传接口失败。
- jobs 中解析任务 failed。
- 文件保存后无法解析。

检查：

- `REPORT_UPLOAD_MAX_BYTES` 是否足够。
- `data/uploads` 和 `data/uploads/tmp` 是否可写。
- 原文格式是否支持。
- LLM 相关变量是否存在：`LLM_PROVIDER`、`LLM_MODEL`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`。
- jobs 表 `error_message`。

只读 SQL：

```sql
SELECT id, kind, status, step_code, step_name, error_message, created_at, finished_at
FROM jobs
WHERE status = 'failed'
ORDER BY finished_at DESC NULLS LAST, created_at DESC
LIMIT 20;
```

P4-3 不调整解析算法。若是解析质量问题，应进入对应业务阶段处理。

## 7. 任务队列卡住

现象：

- jobs 长时间停留在 `queued` 或 `running`。
- TaskDrawer 状态不刷新。

检查：

```sql
SELECT kind, status, COUNT(*)
FROM jobs
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY kind, status
ORDER BY kind, status;
```

再查长时间运行任务：

```sql
SELECT id, kind, status, step_code, step_name, started_at, updated_at, error_message
FROM jobs
WHERE status IN ('queued', 'running')
ORDER BY created_at ASC
LIMIT 30;
```

可能原因：

- 后端 worker 未启动。
- 数据库连接异常。
- LLM 或 PDF renderer 阻塞。
- 单个任务耗时过长。

处理：

- 检查后端进程和日志。
- 重启 worker 所在后端进程。
- 不要直接改 jobs 状态，除非已有明确恢复方案。

## 8. PDF job queued/running 不完成

检查：

- 后端日志是否有 `PdfExportWorker` 错误。
- 前端打印 URL 是否可访问。
- `FRONTEND_URL` 是否指向正确前端。
- `PUPPETEER_EXECUTABLE_PATH` 是否有效。
- Chrome/Edge 是否可启动。

运行：

```powershell
npm.cmd run ops:health
npm.cmd run smoke:pdf
```

常见原因：

- 前端服务不可访问。
- Puppeteer 没有可用浏览器。
- 打印页没有 ready marker。
- 字体或资源加载超时。

处理：

- 修正 `FRONTEND_URL`。
- 安装 Chrome/Edge 或设置 `PUPPETEER_EXECUTABLE_PATH`。
- 排查时临时设置 `PDF_EXPORT_DEBUG=1`，完成后关闭。

## 9. PDF 下载过期或 410

现象：

```json
{
  "error": "File expired",
  "needs_regeneration": true
}
```

含义：

- jobs 记录存在，且状态为 done。
- 但 `file_path` 指向的 PDF 文件已不存在。

处理：

- 让用户点击重新生成。
- 或通过任务中心重新生成。
- 检查 `data/exports/pdf` 是否被清理。

这是可恢复状态，不代表数据库损坏。

## 10. 批量下载 ZIP 失败

检查：

- 所选 job 是否均为 `done`。
- 对应 PDF 文件是否存在。
- 用户是否有对应区域权限。
- 服务器磁盘空间是否足够。

如果所有文件已过期，接口会提示没有可下载文件，需要重新生成 PDF。

## 11. Puppeteer/Chrome 缺失

现象：

- PDF 生成失败。
- smoke 中 Puppeteer warning。
- 日志出现 executable not found。

检查：

```powershell
npm.cmd run ops:health
where.exe chrome
where.exe msedge
```

处理：

- 安装 Chrome 或 Edge。
- 设置：

```env
PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
```

Linux 服务器还需确认 sandbox 依赖和字体。

## 12. PDF 视觉工具缺失

现象：

- `smoke:pdf` 通过，但 capability notes 提示像素级检查降级。
- `ops:health` 中 `pdfinfo`、`pdftoppm`、`magick`、`gswin64c` 为 warning。

处理：

- Windows 安装 Poppler、ImageMagick、Ghostscript 并加入 `PATH`。
- Linux 使用系统包管理器安装。
- 重开终端后再运行 `npm.cmd run smoke:pdf`。

缺少这些工具不阻断基础功能，但降低 PDF 版式回归强度。

## 13. TaskDrawer 不显示或不刷新

检查路径：

- `/upload`
- `/jobs`
- `/jobs?tab=download`
- `/comparison/4670`

检查项：

- 用户已登录。
- `/api/pdf-jobs` 返回 200。
- 浏览器没有 401/403。
- TaskDrawer 未被当前路由禁用。
- 网络请求没有被 CORS 或代理拦截。

处理：

- 先确认登录态和权限。
- 在 `/jobs` 看任务中心是否正常。
- 再确认 TaskDrawer 与任务中心状态是否一致。
- P4-3 只固化验收流程，不改 TaskDrawer 代码。

## 14. GovInsight 报告生成失败

现象：

- latest job failed。
- 已存报告或 PDF 仍可打开。
- 日志出现模型输出或 payload 字段错误。

检查：

- `GOV_INSIGHT_REPORT_PROVIDER`
- `GOV_INSIGHT_REPORT_MODEL`
- `GOV_INSIGHT_REPORT_OPENAI_API_MODE`
- `GOV_INSIGHT_REPORT_TIMEOUT_MS`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- latest job `error_message`

P4-2 已知：GovInsight 淮安市 2025 latest job `17` failed，但历史成功 job、存储报告和 PDF 可用。该生成根因属于 P4-5，不在 P4-3 修复。

## 15. GovInsight PDF 失败

检查：

```powershell
npm.cmd run smoke:pdf
```

再检查：

- `/api/gov-insight/report-pdf?org_id=city_721&year=2025`
- 前端 `/print/govinsight-report/city_721/2025`
- `FRONTEND_URL`
- Puppeteer/Chrome
- 打印页 ready marker

如果 API 返回非 PDF，查看响应文本前 300 字和后端日志。

## 16. 环境变量问题

不要在日志或工单中粘贴完整 `.env`。

可安全提供：

```powershell
npm.cmd run ops:diagnostics
```

诊断包只记录 `.env` 键名，不记录值。

高风险变量：

- `JWT_SECRET`
- `ADMIN_BOOTSTRAP_TOKEN`
- `ADMIN_INITIAL_PASSWORD`
- `OPENAI_API_KEY`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `DB_PASSWORD`
- `PDF_SMOKE_TOKEN`

## 17. Redis 限流异常

如果设置：

```env
RATE_LIMIT_STORE=redis
```

则 Redis 不可用时会影响限流存储。当前 rate limiter 在 Redis store 异常时会记录 warning 并允许请求，但生产仍应修复 Redis。

检查：

```powershell
npm.cmd run ops:health
```

确认：

- `RATE_LIMIT_REDIS_URL` 或 `REDIS_HOST`、`REDIS_PORT`。
- Redis 服务运行。
- 网络和防火墙允许访问。

## 18. 备份失败

运行：

```powershell
npm.cmd run backup:system
```

常见原因：

- 缺少 `.env`。
- DB 变量缺失。
- PostgreSQL client tools 未安装或不在 PATH。
- `pg_dump` 无法连接数据库。
- `backups/` 不可写。

处理：

- 安装 PostgreSQL client tools。
- 确认 `.env` DB 配置。
- 确认目标磁盘空间。

## 19. 恢复失败

恢复前必须确认：

- 备份包来自可信环境。
- SQL dump 存在。
- 目标 `.env` 正确。
- 已停机并保留当前快照。
- 已准备回退方案。

旧恢复脚本包含硬编码路径或默认凭据，不建议直接运行。优先按备份包中的 `RESTORE.md` 手工恢复。

## 20. 生成物误入 Git

检查：

```powershell
git status --short --branch --untracked-files=all
git ls-files --others --exclude-standard
```

不应提交：

- logs
- diagnostic bundle
- PDF、ZIP、截图、HTML dump
- build/dist/coverage/node_modules
- 真实 `.env`
- 数据库备份

暂存必须使用显式路径，不使用 `git add .`。
