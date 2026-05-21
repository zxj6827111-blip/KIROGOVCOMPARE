# P4-3B 部署运维与交付能力实施报告

## 1. 修改文件清单

新增文件：

- `P4_DEPLOYMENT_OPERATIONS_PLAN.md`
- `OPERATIONS.md`
- `TROUBLESHOOTING.md`
- `scripts/health-check.js`
- `scripts/diagnostic-bundle.js`
- `P4_DEPLOYMENT_OPERATIONS_REPORT.md`

修改文件：

- `DEPLOYMENT.md`
- `.env.example`
- `package.json`

## 2. 新增文档说明

### 2.1 `DEPLOYMENT.md`

已按当前项目主链路重写，覆盖：

- Node.js 20+、PostgreSQL、Redis、Chrome/Puppeteer 和 PDF 原生视觉工具要求。
- 后端 `dist/index-llm.js`、前端 `scripts/serve-frontend.js` 的当前启动方式。
- 端口说明、环境变量、构建、数据库迁移策略、PM2 部署。
- Docker/Compose 当前旧入口和旧端口风险说明。
- 健康检查、PDF smoke、strict-live、诊断包和回滚建议。

### 2.2 `OPERATIONS.md`

新增日常运维 Runbook，覆盖：

- 日常巡检。
- 一键健康检查。
- 一键 smoke。
- 一键诊断包。
- 数据库连接检查。
- jobs 队列巡检。
- 上传目录、导出目录、日志和临时目录管理。
- PDF renderer/Puppeteer 和原生视觉工具巡检。
- 数据库备份、恢复、回滚。
- TaskDrawer 人工验收流程。
- Git 交付边界。

### 2.3 `TROUBLESHOOTING.md`

新增故障排查手册，覆盖：

- 后端启动、`/api/health`、前端 `/healthz`。
- 登录、权限、CORS。
- 上传解析、任务队列、PDF job、PDF 下载过期、批量下载 ZIP。
- Puppeteer/Chrome、PDF 原生视觉工具。
- TaskDrawer。
- GovInsight 报告生成和 PDF。
- 环境变量、Redis 限流、备份恢复、生成物误入 Git。

## 3. 新增脚本说明

### 3.1 `scripts/health-check.js`

只读健康检查脚本，默认不修改业务数据。

覆盖项：

- Node.js 版本。
- 必要和推荐环境变量键是否存在，不输出 secret 值。
- 后端 `/api/health`。
- 前端 `/healthz`。
- PostgreSQL `SELECT 1`。
- Redis ping，仅 `RATE_LIMIT_STORE=redis` 时检查。
- `data/uploads`、`data/uploads/tmp`、`data/exports/pdf`、`logs`、`tmp` 目录存在性和读写权限。
- jobs 表近 24 小时状态摘要。
- Puppeteer 包和浏览器 executable。
- `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript 可用性。

参数：

- `--json`
- `--strict`
- `--require-services`
- `--skip-network`
- `--api-base=...`
- `--frontend-url=...`
- `--timeout-ms=...`

默认模式下，可选 PDF 原生工具缺失会显示 warning，不阻断本地开发机；严格模式用于部署门禁。

### 3.2 `scripts/diagnostic-bundle.js`

诊断包脚本，支持 dry-run 和实际生成。

默认收集：

- Git 状态、最近提交、diff 文件名、未跟踪清单。
- root/frontend package scripts 与依赖摘要。
- `.env.example`。
- `.env` 键名和 secret 分类，不收集值。
- 目录文件数和大小摘要。
- PDF/native 工具探测。
- `health-check.js --json --skip-network` 输出。
- manifest。

默认排除：

- 真实 `.env` 值。
- secret/token/password/API key。
- 上传原文。
- PDF、ZIP、截图、HTML dump。
- 完整日志。
- 备份包。
- `node_modules`、`dist`、`build`、`coverage`。

实际输出默认位于 `.codex-temp/diagnostics/`，不会进入 Git。

## 4. 环境变量变更

`.env.example` 新增部署运维相关占位变量：

- `PUPPETEER_EXECUTABLE_PATH`
- `PDF_EXPORT_DEBUG`
- `PDF_EXPORT_HYDRATE_WAIT_MS`
- `PDF_EXPORT_PRINT_READY_TIMEOUT_MS`
- `PDF_SMOKE_API_BASE_URL`
- `PDF_SMOKE_FRONTEND_URL`
- `PDF_SMOKE_TIMEOUT_MS`
- `PDF_SMOKE_STRICT_LIVE`
- `PDF_SMOKE_SKIP_LIVE`
- `PDF_SMOKE_TOKEN`
- `OPS_API_BASE_URL`
- `OPS_FRONTEND_URL`
- `OPS_HEALTH_TIMEOUT_MS`
- `OPS_DB_TIMEOUT_MS`

未加入真实 secret 或 token。

## 5. package scripts 变更

`package.json` 新增：

- `ops:health`
- `ops:health:json`
- `ops:diagnostics`
- `ops:diagnostics:dry-run`
- `backup:system`

未修改既有 `smoke:pdf`，未修改 `scripts/pdf-smoke-baseline.js`。

## 6. 健康检查覆盖项

当前覆盖：

- backend health。
- frontend health。
- 数据库连接。
- Redis 配置场景。
- 上传目录可读写。
- 导出目录可读写。
- 日志和临时目录可读写。
- PDF renderer/Puppeteer。
- PDF 原生视觉工具链。
- jobs 队列摘要。
- 环境变量键存在性。

## 7. 诊断包覆盖项

当前覆盖：

- Git 状态。
- 最近提交。
- package 摘要。
- env 键名。
- 目录容量摘要。
- native 工具链探测。
- 健康检查 JSON。
- 可选日志 tail。

诊断包默认不会包含敏感文件或生成物。

## 8. 备份恢复说明

- 保留并暴露 `backup:system` 作为 `scripts/backup-system.ps1` 入口。
- 文档明确备份输出在 `backups/`，不得提交。
- 文档明确旧恢复脚本包含硬编码路径或默认凭据，执行前必须人工审阅。
- 恢复建议以备份包 `RESTORE.md` 和手工流程为主，必须同时恢复数据库和 `data/uploads`。

## 9. 临时文件清理说明

文档已区分：

- 可清理：`.codex-temp/diagnostics`、`tmp`、`output` 临时输出、`logs/pdf-debug-*`、过期 `data/exports/pdf`。
- 谨慎清理：普通 app 日志、`backups`。
- 禁止自动清理：`data/uploads`、当前数据库引用文件、真实 `.env`。

## 10. 自动验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `npm.cmd run build` | 通过 | 后端 TypeScript build 与 public copy 通过 |
| `npm.cmd test` | 通过 | 19 suites，144 tests；仅有既有 JWT_SECRET 测试日志和 legacy EJS warning |
| `cd frontend && npm.cmd test -- --runInBand` | 通过 | 20 suites，97 tests |
| `cd frontend && npm.cmd run build` | 通过 | TypeScript 与 webpack production build 通过；保留既有 asset/bundle size warning |
| `npm.cmd run smoke:pdf` | 通过 | total 4，passed 4，failed 0，skipped 0，strictLive=false |
| `npm.cmd run ops:health` | 通过 | 退出码 0；后端 `/api/health` 和数据库通过；前端生产默认端口 `53002` 未启动，记为 warning；PDF 原生视觉工具缺失记为 warning |
| `npm.cmd run ops:diagnostics:dry-run` | 通过 | 只列出收集范围，不生成文件 |

## 11. strict-live 结果

```powershell
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

结果：通过。

- total：4
- passed：4
- failed：0
- skipped：0
- strictLive：true
- API：`http://127.0.0.1:8787`
- 前端：`http://127.0.0.1:3001`

覆盖：

- comparison `4670` 普通 PDF。
- comparison `1143` 长表格 PDF。
- GovInsight `city_721` PDF。
- pdf-job API 创建、轮询、下载、失败任务不可下载、过期文件 410、批量 ZIP。

工具链说明：

- `pdfjs` 可用。
- `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript 当前不可用。
- 像素级视觉回归按既有 smoke 逻辑降级为文本、页数、空白页和 ready marker 检查。

## 12. 新增脚本验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `node -c scripts/health-check.js` | 通过 | 语法检查通过 |
| `node -c scripts/diagnostic-bundle.js` | 通过 | 语法检查通过 |
| `npm.cmd run ops:health -- --skip-network` | 通过 | 只读检查通过；跳过网络；数据库、目录、Puppeteer 通过；PDF 原生工具缺失为 warning |
| `npm.cmd run ops:health` | 通过 | 后端 health 通过；前端生产 `53002` 未启动为 warning；无 critical failure |
| `npm.cmd run ops:diagnostics:dry-run` | 通过 | dry-run 无生成物 |
| `npm.cmd run ops:diagnostics` | 通过 | 实际生成到 `.codex-temp/diagnostics/kirogovcompare-diagnostic-*`；该目录被 `.gitignore` 排除 |

生成物排除确认：

- 实际诊断包位于 `.codex-temp/diagnostics/`。
- `git ls-files --others --exclude-standard` 未列出诊断包产物。
- smoke 生成或复用的 PDF 位于 `data/exports/pdf`，该目录被 `.gitignore` 排除，未进入 Git。

## 13. 未改动边界

本阶段未做：

- 未改数据库 schema/migration。
- 未改解析算法。
- 未改比对算法。
- 未改 GovInsight 生成逻辑。
- 未改 PDF 后端主链路。
- 未改 `scripts/pdf-smoke-baseline.js`。
- 未删除 legacy EJS。
- 未提交 logs、诊断包、PDF、ZIP、截图、HTML dump、build/dist/coverage/node_modules。
- 未提交真实 `.env`、secret、token。
- 未混入 P4-4/P4-5。

## 14. 风险和遗留问题

1. Docker/Compose 文件仍保留旧入口和端口假设。本轮只在文档中明确风险，未重构容器化配置。
2. 旧恢复脚本仍包含硬编码路径或默认凭据。本轮不做破坏性恢复脚本改造，只通过文档限制使用。
3. PDF 原生视觉工具链是否完整取决于部署机安装情况；脚本会报告 warning。
4. strict-live 依赖本地后端和前端同时可用，如服务未启动会 blocked。
5. TaskDrawer 验收仍需要人工登录浏览器观察，本轮只固化流程。

## 15. 是否建议进入 P4-3C

建议进入 P4-3C。

理由：

- 文档和脚本均属于 P4-3 部署运维交付范围。
- 自动验证、PDF smoke、strict-live 均通过。
- 新增脚本只读/dry-run 验证通过。
- 实际诊断包生成物被 `.gitignore` 排除，未进入 Git。
- 未改业务代码、schema/migration、解析算法、比对算法、GovInsight 生成逻辑、PDF 主链路、`scripts/pdf-smoke-baseline.js` 或 legacy EJS。

## 16. P4-3C 自审修正项

自审检查项：

- `DEPLOYMENT.md` 已覆盖当前 `dist/index-llm.js` 后端入口、`scripts/serve-frontend.js` 前端生产入口、端口、环境变量、PM2、PDF/Puppeteer、smoke 和回滚。
- `OPERATIONS.md` 已覆盖日常巡检、数据库/jobs 巡检、备份、恢复、日志、清理、TaskDrawer 人工验收和 Git 交付边界。
- `TROUBLESHOOTING.md` 已覆盖 PDF、TaskDrawer、上传解析、任务队列、GovInsight、下载过期、权限、CORS、环境变量和备份恢复问题。
- `scripts/health-check.js` 默认只读，不输出 secret 值。
- `scripts/diagnostic-bundle.js` 默认不收集 `.env` 值、上传原文、PDF、ZIP、截图、HTML dump、完整日志或备份包。
- `package.json` 新增脚本命名集中在 `ops:*` 和 `backup:system`。
- `.env.example` 只新增占位变量，没有真实 secret。
- 没有生成物进入 `git ls-files --others --exclude-standard`。
- 未混入 P4-4/P4-5 内容。

本轮自审只做了最小修正：

- `health-check.js` 和 `diagnostic-bundle.js` 对 `your-domain.com`、`example.com` 这类占位 `FRONTEND_URL` 增加本地默认前端地址回退，避免部署巡检误指向占位域名。

## 17. P4-3C 最终验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| `npm.cmd run build` | 通过 | 后端 TypeScript build 与 public copy 通过 |
| `npm.cmd test` | 通过 | 19 suites，144 tests；既有 JWT_SECRET 测试日志和 legacy EJS warning 不影响结果 |
| `cd frontend && npm.cmd test -- --runInBand` | 通过 | 20 suites，97 tests |
| `cd frontend && npm.cmd run build` | 通过 | TypeScript 与 webpack production build 通过；保留既有 asset/bundle size warning |
| `npm.cmd run smoke:pdf` | 通过 | total 4，passed 4，failed 0，skipped 0，strictLive=false |
| `npm.cmd run ops:health` | 通过 | 退出码 0；后端和数据库通过；前端生产 `53002` 未启动为 warning；PDF 原生视觉工具缺失为 warning |
| `npm.cmd run ops:diagnostics:dry-run` | 通过 | dry-run 不生成文件 |
| `git diff --check` | 通过 | 无 whitespace error；仅显示 Windows 换行提示 |
| `git ls-files --others --exclude-standard` | 通过门禁 | 只包含 P4-3 新增文件和已知 out-of-scope 历史报告；未列出诊断包、PDF、ZIP、日志、截图或 build 产物 |

strict-live 已在 P4-3B 执行并通过：

```powershell
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

## 18. 生成物排除确认

- 诊断包实际产物位于 `.codex-temp/diagnostics/`，被 `.gitignore` 排除。
- PDF smoke 生成或复用的 PDF 位于 `data/exports/pdf`，被 `.gitignore` 排除。
- 前端 build 输出位于 `frontend/build`，被 `.gitignore` 排除。
- 后端 build 输出位于 `dist`，被 `.gitignore` 排除。
- 未提交 logs、诊断包、PDF、ZIP、截图、HTML dump、build/dist/coverage/node_modules。

## 19. 是否建议提交

建议进入 P4-3D 本地提交。

理由：

- P4-3C 门禁通过。
- 文档和脚本口径准确。
- 自动验证通过。
- 新增脚本验证通过。
- 无 whitespace error。
- 未跟踪文件中没有新增生成物。
- 文件范围属于 P4-3 部署运维交付能力。
