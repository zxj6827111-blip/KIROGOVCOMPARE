# KIROGOVCOMPARE 部署指南

本文档面向部署和交付人员，覆盖当前 `index-llm` 主链路。P4-3 只固化部署运维能力，不修改业务功能、数据库 schema、解析/比对算法、GovInsight 生成逻辑或 PDF 主链路。

## 1. 部署范围

当前系统包含：

- 后端 API：`dist/index-llm.js`
- 前端静态服务：`scripts/serve-frontend.js`
- PostgreSQL：主业务数据库和 jobs 队列表
- Redis：限流存储可选项，`RATE_LIMIT_STORE=redis` 时需要
- PDF 渲染：Puppeteer + Chrome/Edge/Chromium
- PDF 验收：`npm run smoke:pdf`

## 2. 环境要求

必需：

- Node.js 20+
- npm
- PostgreSQL 15/16+
- Git
- Chrome、Edge 或 Puppeteer Chromium

按配置需要：

- Redis 7+：当 `RATE_LIMIT_STORE=redis` 时必需
- PM2：生产进程托管推荐

PDF 视觉验收建议安装：

- Poppler：提供 `pdfinfo`、`pdftoppm`
- ImageMagick：提供 `magick`
- Ghostscript：Windows 为 `gswin64c`，Linux/macOS 通常为 `gs`

缺少上述 PDF 原生工具时，`smoke:pdf` 仍可使用 `pdfjs-dist` 做文本、页数、空白页和 ready marker 检查，但像素级视觉能力会降级。

## 3. 端口说明

| 服务 | 默认端口 | 说明 |
| --- | ---: | --- |
| 后端 API | `8787` | `PORT=8787`，健康接口 `/api/health` |
| 前端开发服务 | `3001` | 本地开发和 strict-live 常用 |
| 前端生产静态服务 | `53002` | `scripts/serve-frontend.js` 默认端口 |
| PostgreSQL | `5432` | 由 `DB_PORT` 控制 |
| Redis | `6379` | 由 `REDIS_PORT` 控制 |

## 4. 初次部署

在项目根目录执行：

```powershell
npm.cmd install
cd frontend
npm.cmd install
cd ..
```

创建 `.env`：

```powershell
Copy-Item .env.example .env
```

然后编辑 `.env`，至少确认：

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `PORT`
- `FRONTEND_URL`
- `JWT_SECRET`
- `CORS_ALLOWED_ORIGINS`
- `OPENAI_API_KEY`
- `PUPPETEER_EXECUTABLE_PATH`，如生产机没有随 Puppeteer 下载的浏览器

生产环境必须设置强随机 `JWT_SECRET`，不要使用空值或开发占位值。

## 5. 构建

后端：

```powershell
npm.cmd run build
```

前端：

```powershell
cd frontend
npm.cmd run build
cd ..
```

后端 build 会复制静态 public 文件。前端 build 输出在 `frontend/build`。

## 6. 数据库准备

应用启动时会执行统一迁移入口 `runMigrations()`，实际 schema 由当前代码保证幂等创建和修补。

部署前先确认 PostgreSQL 可连接：

```powershell
npm.cmd run ops:health -- --skip-network
```

如果要禁止某个进程自动跑迁移，可设置：

```env
LLM_RUN_MIGRATIONS=0
```

只建议在多实例部署中由一个明确进程负责迁移。P4-3 不新增或修改 migration。

## 7. 后端启动和停止

本地或单机启动：

```powershell
$env:PORT="8787"
npm.cmd run start:prod
```

Windows 辅助脚本：

```powershell
npm.cmd run start:llm
npm.cmd run health:llm
npm.cmd run stop:llm
```

`start:llm` 会将日志写到 `logs/llm-8787.log` 和 `logs/llm-8787.log.err`。

## 8. 前端生产静态服务

构建后启动：

```powershell
$env:FRONTEND_HOST="0.0.0.0"
$env:FRONTEND_PORT="53002"
$env:FRONTEND_BUILD_DIR="E:\Software Development\KIROGOVCOMPARE\frontend\build"
$env:BACKEND_ORIGIN="http://127.0.0.1:8787"
node scripts/serve-frontend.js
```

健康检查：

```powershell
Invoke-WebRequest http://127.0.0.1:53002/healthz
```

前端静态服务会把 `/api` 代理到 `BACKEND_ORIGIN`。

## 9. PM2 部署

仓库已有 `ecosystem.config.cjs`，默认 `/opt/KIROGOVCOMPARE` 路径：

```bash
pm2 start ecosystem.config.cjs
pm2 status
pm2 logs kirogovcompare-backend
pm2 logs kirogovcompare-frontend
pm2 save
```

如部署路径不是 `/opt/KIROGOVCOMPARE`，先调整 `ecosystem.config.cjs` 中的 `cwd`、`FRONTEND_BUILD_DIR` 和 `BACKEND_ORIGIN`。

## 10. Docker/Compose 注意事项

仓库存在 `Dockerfile` 和 `docker-compose.yml`，但当前文件仍保留早期入口和端口假设：

- `Dockerfile` 使用 `node:18-alpine`，当前 `package.json` 要求 Node.js 20+。
- `Dockerfile` 默认启动 `dist/index.js`，当前主入口是 `dist/index-llm.js`。
- `docker-compose.yml` app 默认端口为 `3000`，当前主后端端口通常是 `8787`。
- compose 挂载 `uploads`、`exports`，当前主业务文件主要位于 `data/uploads` 和 `data/exports/pdf`。

结论：当前 Docker/Compose 可作为参考，不建议未经校准直接用于生产。

## 11. 文件目录

| 目录 | 用途 | 是否提交 |
| --- | --- | --- |
| `data/uploads` | 上传原文和解析来源文件 | 不提交 |
| `data/uploads/tmp` | 上传临时文件 | 不提交 |
| `data/exports/pdf` | PDF 导出文件 | 不提交 |
| `logs` | 本地启动和 PDF debug 日志 | 不提交 |
| `tmp` | 临时输出 | 不提交 |
| `output` | 历史或临时 PDF 输出 | 不提交 |
| `backups` | 系统备份包 | 不提交 |
| `.codex-temp` | 诊断包和本地临时产物 | 不提交 |

`.gitignore` 已覆盖这些目录。不要把 PDF、ZIP、截图、HTML dump、日志、诊断包、真实 `.env` 提交到 Git。

## 12. 健康检查

默认只读检查：

```powershell
npm.cmd run ops:health
```

JSON 输出：

```powershell
npm.cmd run ops:health:json
```

指定地址：

```powershell
npm.cmd run ops:health -- --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:53002
```

部署门禁可使用严格模式：

```powershell
npm.cmd run ops:health -- --strict --require-services
```

默认模式会把 PDF 原生工具缺失、前端未启动等可选项显示为 warning；严格模式会把要求在线的服务失败作为门禁失败。

## 13. PDF 渲染配置

常用变量：

```env
PUPPETEER_EXECUTABLE_PATH=
PDF_EXPORT_DEBUG=0
PDF_EXPORT_HYDRATE_WAIT_MS=1500
PDF_EXPORT_PRINT_READY_TIMEOUT_MS=45000
FRONTEND_URL=http://localhost:3001
```

生产建议：

- 固定 Chrome/Edge/Chromium 版本。
- 如系统没有 Puppeteer 自带浏览器，设置 `PUPPETEER_EXECUTABLE_PATH`。
- 仅排查问题时设置 `PDF_EXPORT_DEBUG=1`，因为它可能在 `logs/` 写入截图和 HTML。
- 确认 `FRONTEND_URL` 指向可访问的前端打印页面。

## 14. Smoke 验证

基础 PDF smoke：

```powershell
npm.cmd run smoke:pdf
```

本地 live 服务可用时执行 strict-live：

```powershell
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

strict-live 会要求本地 API 和前端都可访问，并覆盖 comparison PDF、长表格 PDF、GovInsight PDF 和 pdf-job API。

## 15. 诊断包

先 dry-run：

```powershell
npm.cmd run ops:diagnostics:dry-run
```

生成诊断包目录：

```powershell
npm.cmd run ops:diagnostics
```

默认输出到 `.codex-temp/diagnostics/kirogovcompare-diagnostic-*`，不会收集真实 `.env` 值、secret、上传原文、PDF、ZIP、截图、HTML dump、完整日志、备份包或 `node_modules`。

如需最近日志片段：

```powershell
npm.cmd run ops:diagnostics -- --include-logs
```

日志片段仍可能包含业务上下文，外发前应人工复核。

## 16. 回滚建议

代码回滚：

1. 确认当前 release commit。
2. 停止前端和后端进程。
3. 切回上一稳定 commit 或发布包。
4. 重新安装依赖并构建。
5. 启动服务。
6. 运行 `ops:health`、`smoke:pdf` 和关键页面人工验收。

数据回滚：

- 优先使用发布前数据库和文件备份恢复。
- 不要直接运行仓库中的旧恢复脚本，除非已人工确认路径、凭据和破坏性操作。
- 恢复必须同时考虑 PostgreSQL dump 和 `data/uploads`，否则数据库中的文件路径可能指向不存在的文件。

## 17. 交付前最小门禁

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

如果本地 API 和前端可用，再执行 strict-live：

```powershell
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```
