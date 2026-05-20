# KIROGOVCOMPARE 运维手册

本文档用于日常巡检、备份、恢复、清理、诊断和交付验收。所有脚本默认应在项目根目录执行。

## 1. 日常巡检清单

每日或每次交付前确认：

- 后端 `/api/health` 正常。
- 前端 `/healthz` 正常。
- PostgreSQL 可执行 `SELECT 1`。
- 如 `RATE_LIMIT_STORE=redis`，Redis 可 ping。
- `data/uploads`、`data/uploads/tmp`、`data/exports/pdf`、`logs`、`tmp` 可读写。
- jobs 表没有异常堆积的 `queued` / `running` / `failed`。
- PDF smoke 可运行。
- `logs/` 没有快速增长或反复相同错误。
- `data/exports/pdf` 容量在预期范围内。
- `data/uploads` 已纳入备份。

一键巡检：

```powershell
npm.cmd run ops:health
```

严格部署巡检：

```powershell
npm.cmd run ops:health -- --strict --require-services
```

## 2. 一键 smoke

基础 PDF smoke：

```powershell
npm.cmd run smoke:pdf
```

API 和前端可用时：

```powershell
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

如果 strict-live 失败，先按 `TROUBLESHOOTING.md` 区分：

- API 未启动。
- 前端未启动。
- PDF renderer/Chrome 不可用。
- 测试样本或 jobs 状态不满足。

## 3. 一键诊断包

先查看收集范围：

```powershell
npm.cmd run ops:diagnostics:dry-run
```

生成诊断目录：

```powershell
npm.cmd run ops:diagnostics
```

默认输出在 `.codex-temp/diagnostics/`，不进入 Git。

默认不会收集：

- 真实 `.env` 值。
- secret、token、password、API key。
- 上传原文。
- PDF、ZIP、截图、HTML dump。
- 完整日志。
- 备份包。
- `node_modules`、`dist`、`build`、`coverage`。

如需要最近日志片段：

```powershell
npm.cmd run ops:diagnostics -- --include-logs
```

外发诊断包前，必须人工检查是否含敏感业务信息。

## 4. 数据库连接检查

脚本方式：

```powershell
npm.cmd run ops:health -- --skip-network
```

手工 SQL：

```sql
SELECT 1;

SELECT status, COUNT(*)
FROM jobs
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY status
ORDER BY status;
```

常见状态判断：

- `queued` 少量存在：正常。
- `running` 长时间不变：检查后端 worker 日志。
- `failed` 增长：按 `error_message` 分类排查。
- `done` 但文件不存在：PDF 导出文件可能已被清理，下载会返回 410，需要重新生成。

## 5. 任务队列巡检

关键 jobs 类型：

- 解析任务。
- 比对相关任务。
- `pdf_export`。
- GovInsight 报告任务。

建议巡检 SQL：

```sql
SELECT kind, status, COUNT(*)
FROM jobs
WHERE created_at >= NOW() - INTERVAL '24 hours'
GROUP BY kind, status
ORDER BY kind, status;
```

失败任务抽样：

```sql
SELECT id, kind, status, step_code, step_name, error_message, created_at, finished_at
FROM jobs
WHERE status = 'failed'
ORDER BY finished_at DESC NULLS LAST, created_at DESC
LIMIT 20;
```

P4-3 不修改 jobs 处理逻辑；巡检只用于发现问题。

## 6. 上传和导出目录

核心目录：

- `data/uploads`：业务上传文件，必须备份。
- `data/uploads/tmp`：上传临时文件，可清理历史残留。
- `data/exports/pdf`：PDF 导出文件，可按保留期清理。

不要自动清理 `data/uploads`。数据库中报告版本可能引用其中的路径。

清理 `data/exports/pdf` 后，旧下载链接可能返回：

```json
{
  "error": "File expired",
  "needs_regeneration": true
}
```

这是预期行为，用户可重新生成 PDF。

## 7. PDF renderer/Puppeteer 巡检

检查 Puppeteer 和浏览器：

```powershell
npm.cmd run ops:health
```

建议生产配置：

```env
PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe
PDF_EXPORT_DEBUG=0
PDF_EXPORT_PRINT_READY_TIMEOUT_MS=45000
PDF_EXPORT_HYDRATE_WAIT_MS=1500
```

仅在排查 PDF 渲染问题时启用：

```env
PDF_EXPORT_DEBUG=1
```

启用后会在 `logs/` 写入 debug 截图或 HTML，排查结束应关闭并清理。

## 8. PDF 原生视觉工具

推荐安装：

- Poppler：`pdfinfo`、`pdftoppm`
- ImageMagick：`magick`
- Ghostscript：`gswin64c` / `gs`

检查：

```powershell
where.exe pdfinfo
where.exe pdftoppm
where.exe magick
where.exe gswin64c
```

缺少时不是业务运行 blocker，但会降低 PDF 视觉回归强度。交付验收机建议补齐。

## 9. 日志位置和轮转

常见日志：

- `logs/llm-8787.log`
- `logs/llm-8787.log.err`
- `logs/pdf-debug-*`
- PM2 自身日志

建议：

- 应用日志保留 14-30 天。
- PDF debug 日志、截图、HTML 只保留 3-7 天。
- 使用 PM2 logrotate 或系统 logrotate。
- 日志不要提交到 Git。

## 10. 临时文件清理

可清理：

- `.codex-temp/diagnostics/*`
- `tmp/*`
- `output/*` 中确认不再需要的临时输出
- `logs/pdf-debug-*`
- 超出业务保留期的 `data/exports/pdf/*`

谨慎清理：

- `logs/llm-*.log*`，确认不影响审计后再清理。
- `backups/*`，确认已有异地备份后再清理。

禁止自动清理：

- `data/uploads`
- 当前仍被数据库引用的文件。
- 真实 `.env`。

## 11. 数据库备份

Windows 主入口：

```powershell
npm.cmd run backup:system
```

备份脚本行为：

- 从 `.env` 读取数据库连接。
- 使用 `pg_dump` 生成 SQL dump。
- 复制 `data`、`uploads`、`logs`、`output`、`tmp`。
- 复制 `.env.example` 和 `docker-compose.yml`。
- 生成 `backup-manifest.json` 和 `RESTORE.md`。
- 压缩到 `backups/system-backup-*.zip`。

备份后检查：

- ZIP 文件存在。
- ZIP 大小合理。
- manifest 存在。
- SQL dump 存在。
- `files/data/uploads` 存在或明确当前无上传文件。

`backups/` 不进入 Git。

## 12. 恢复流程

恢复是高风险操作，必须人工确认目标环境、备份来源和停机窗口。

建议流程：

1. 停止后端、前端和 worker。
2. 保留当前 `.env` 和当前数据库快照。
3. 解压备份包到临时目录。
4. 检查 `meta/backup-manifest.json` 和 `meta/RESTORE.md`。
5. 在目标环境配置 `.env`。
6. 用 `psql` 恢复 SQL dump。
7. 将 `files/data` 恢复到项目根目录的 `data`。
8. 如备份包包含其他必要文件，再按需恢复。
9. 启动服务。
10. 运行 `ops:health`。
11. 运行 `smoke:pdf`。
12. 抽查上传、任务中心、比对详情、PDF 下载和 GovInsight。

仓库中的旧恢复脚本包含硬编码路径或默认凭据。执行前必须人工审阅，不要直接用于生产。

## 13. 回滚流程

代码回滚：

1. 记录当前 commit。
2. 停止服务。
3. 切换到上一稳定 commit 或发布包。
4. `npm.cmd install`，必要时 `cd frontend && npm.cmd install`。
5. 重新构建后端和前端。
6. 启动服务。
7. 运行 `ops:health`、`smoke:pdf` 和关键页面抽查。

数据库回滚：

- 仅在确认需要恢复数据时执行。
- 必须使用发布前备份。
- 必须同时恢复数据库和 `data/uploads`。

## 14. TaskDrawer 人工验收

P4-3 固化以下人工验收流程，不改 TaskDrawer 代码：

1. 用管理员账号登录。
2. 打开 `/upload`，确认 TaskDrawer 入口可见。
3. 打开 `/jobs`，确认任务列表、刷新、状态和失败提示可见。
4. 打开 `/jobs?tab=download`，确认 PDF 下载任务、重新生成和过期提示可见。
5. 打开 `/comparison/4670`，确认 PDF 任务入口与 TaskDrawer 状态一致。
6. 如有可用样本，触发一次 PDF 任务，观察 queued/running/done 状态变化。
7. 记录前端 URL、API base、账号角色、浏览器和验收结论。

## 15. 交付前门禁

完整交付前建议执行：

```powershell
npm.cmd run build
npm.cmd test
cd frontend
npm.cmd test -- --runInBand
npm.cmd run build
cd ..
npm.cmd run smoke:pdf
npm.cmd run ops:health
npm.cmd run ops:diagnostics:dry-run
```

如 live 环境可用：

```powershell
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

## 16. Git 交付边界

禁止提交：

- `node_modules`
- `dist`、`build`、`coverage`
- `logs`
- PDF、ZIP、截图、HTML dump
- 诊断包实际产物
- 测试上传文件
- 真实 `.env` 或 secret
- 数据库备份

暂存必须使用显式路径，不使用 `git add .`。
