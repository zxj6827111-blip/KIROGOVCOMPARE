# P4-5 Performance, Security and Permission Hardening Report

生成时间：2026-05-21

## 1. 修改文件清单

计划与报告：

- `P4_PERFORMANCE_SECURITY_HARDENING_PLAN.md`
- `P4_PERFORMANCE_SECURITY_HARDENING_REPORT.md`

后端加固：

- `src/utils/pdfExportPath.ts`
- `src/routes/pdf-jobs.ts`
- `src/services/PdfExportWorker.ts`
- `src/routes/pdf-export.ts`
- `src/routes/gov-insight-pdf.ts`
- `src/routes/data-center.ts`
- `src/routes/gov-insight.ts`

测试：

- `src/__tests__/pdfJobsRegression.test.ts`
- `src/__tests__/dataCenterPermissions.test.ts`
- `src/__tests__/govInsightJobStatus.test.ts`

前端：

- `frontend/src/components/tasks/TaskDrawerProvider.js`
- `frontend/src/components/tasks/TaskDrawerProvider.test.js`

## 2. 性能加固项

- 将 TaskDrawer 已跟踪 PDF 任务刷新窗口从 `/api/pdf-jobs?page=1&limit=100` 降到 `limit=20`，减少多页面、多用户轮询时的 DB 和响应体负载。
- `/api/pdf-jobs/batch-download` 增加最多 50 个 job id 的输入上限，并在查询前做整数校验和去重，避免异常大批量 ZIP 放大资源消耗。
- 保留 `/api/jobs` 与 `/api/pdf-jobs` 既有分页上限，不做队列模型或列表查询重构。

## 3. 安全加固项

- 新增 `src/utils/pdfExportPath.ts`，统一处理 PDF 导出文件名清洗、导出目录创建、路径归一化和导出目录边界校验。
- `/api/pdf-jobs/:id/download` 在读文件前校验 `file_path` 必须位于合法 PDF 导出目录内；非法路径返回 409 和可读提示，不读盘。
- `/api/pdf-jobs/batch-download` 在 ZIP 打包前校验每个 `file_path` 必须位于合法 PDF 导出目录内；非法或过期文件不会进入 ZIP。
- `/api/pdf-jobs/batch-download` 的 ZIP 内文件名复用 PDF 文件名清洗逻辑，避免旧数据中的 `../`、冒号或路径分隔符进入压缩包入口名。
- `/api/pdf-jobs/:id` 删除接口只删除合法 PDF 导出目录内的文件，避免数据库污染路径导致任意文件删除。
- `PdfExportWorker` 写文件前重新清洗 `file_name` 并校验输出路径，过期清理时只删除合法导出目录内文件。
- 同步 comparison PDF 和 GovInsight PDF 在前端打印服务或 Chrome/Puppeteer 不可用时返回更可读错误，不暴露 token。

## 4. 权限加固项

- `src/routes/data-center.ts` 报告列表增加区域 scope 过滤。
- data-center 批次列表和批次详情按当前用户区域 scope 收紧，scoped 用户只能看到包含可见区域报告的批次内容。
- data-center 批次详情在 scoped 用户没有任何可见版本或任务时返回 `Batch not found`，避免只暴露批次元数据。
- `POST /api/v2/batches/:batchUuid/retry` 增加 `manage_jobs` 权限要求，并且只 retry 当前用户可见区域内的失败任务。
- data-center 报告详情、facts、cells、quality issues、quality flags、report export 入口在查询业务数据前先校验 report 所属区域。
- data-center dashboard 聚合、趋势、排名按当前用户区域 scope 自动加过滤；显式请求 scope 外 `region_id` 返回 403。
- `POST /api/v2/derived/run` 增加 `manage_jobs` 权限要求；scoped 用户必须显式指定自己范围内的 `region_id`。

## 5. 异常场景加固项

- PDF 下载遇到非法 `file_path` 返回 409 `Invalid PDF file path`，提示重新生成，而不是尝试读取任意路径。
- PDF 过期仍保持 410 `File expired` 和 `needs_regeneration=true`。
- PDF worker 失败消息从原始异常最小映射为前端服务不可用、浏览器渲染组件不可用、导出目录不可写、文件名异常等可读场景。
- GovInsight AI job 序列化新增 `isFailed` 和 `readableStatus`，latest failed job 可直接显示“报告生成失败：...”口径，不改模型协议。

## 6. 新增/修改测试

- `src/__tests__/pdfJobsRegression.test.ts`
  - 合法导出目录内 PDF 正常下载。
  - 过期文件返回 410。
  - 导出目录外 file_path 返回 409。
  - 批量下载只打包存在且合法的 PDF。
  - 非法 batch id 和超过 50 个 id 在查询数据库前返回 400。
  - 批量 ZIP 内文件名会清洗异常路径片段和非法字符。
- `src/__tests__/dataCenterPermissions.test.ts`
  - data-center 报告列表按 scope 添加 SQL 过滤。
  - scope 外 report detail 返回 403。
  - batch retry 缺少 `manage_jobs` 返回 403。
  - scoped 用户没有可见版本或任务时不暴露 batch metadata。
  - dashboard 聚合按 scope 添加 SQL 过滤。
- `src/__tests__/govInsightJobStatus.test.ts`
  - latest failed AI report job 返回 `isFailed=true` 和可读 `readableStatus`。
- `frontend/src/components/tasks/TaskDrawerProvider.test.js`
  - 验证 tracked PDF polling 使用 `limit=20`。

## 7. 未改动边界

- 未改数据库 schema/migration。
- 未改 `scripts/pdf-smoke-baseline.js`。
- 未删除 legacy EJS。
- 未删除旧接口。
- 未改解析算法、比对算法、GovInsight 模型协议。
- 未重构 PDF 主链路，保留 `/api/pdf-jobs`、`/api/comparisons/:id/pdf`、`/api/gov-insight/report-pdf`、`/print/comparison/:id`、`/print/govinsight-report/:orgId/:year`。
- 未提交日志、PDF、ZIP、截图、HTML dump、build/dist/coverage/node_modules。
- 未处理 out-of-scope 历史报告。

## 8. 自动验证结果

局部验证：

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npx jest src/__tests__/pdfJobsRegression.test.ts src/__tests__/dataCenterPermissions.test.ts src/__tests__/govInsightJobStatus.test.ts --runInBand` | 通过 | 3 suites，15 tests |
| `cd frontend && npm.cmd test -- TaskDrawerProvider.test.js --runInBand` | 通过 | 1 suite，3 tests |
| `npm.cmd run build` | 通过 | TypeScript build 和 public copy 通过 |

完整验证：

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm.cmd run build` | 通过 | TypeScript build 和 public copy 通过 |
| `npm.cmd test` | 通过 | 21/21 suites，154/154 tests；保留既有 JWT_SECRET、bcrypt 默认密码和 legacy EJS warning |
| `cd frontend && npm.cmd test -- --runInBand` | 通过 | 20/20 suites，98/98 tests |
| `cd frontend && npm.cmd run build` | 通过 | typecheck 和 webpack production build 通过；保留既有 asset/bundle size warning |
| `npm.cmd run smoke:pdf` | 通过 | total 4，passed 4，failed 0，skipped 0，strictLive=false |

## 9. strict-live 结果

本地 API 和前端可用，已执行：

```text
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

如服务不可用，将写 blocked，不写通过。

结果：

- total：4
- passed：4
- failed：0
- skipped：0
- strictLive：true
- API：`http://127.0.0.1:8787`
- Frontend：`http://127.0.0.1:3001`
- 普通比对 PDF、长表比对 PDF、GovInsight PDF、PDF job API 均通过。
- 当前环境仍缺少 `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript，PDF 像素级渲染/diff 检查按既有 smoke 能力降级为 pdfjs 文本、页数、空白页和 ready marker 检查。

## 10. 仍需人工验证事项

- 使用真实登录账号人工复核 TaskDrawer 页面级表现：上传页、任务中心、下载 tab、比对详情。
- 使用普通用户、管理员、区域 scoped 用户、只读用户各一次人工走查：数据中心、PDF 下载、批量下载、任务重试。
- 生产或验收环境仍建议安装 Poppler/ImageMagick/Ghostscript，以补齐 PDF 像素级视觉验证能力。

## 11. 未覆盖风险

- 未做压力测试，不证明高并发 PDF 导出、批量下载或大量任务轮询的容量上限。
- 未改 worker 队列模型；任务堆积仍需通过部署监控和运维策略处理。
- 未改 GovInsight 生成协议；历史 failed job 的根因仍可能需要后续业务阶段修复。
- 未改前端 bundle size warning。
- 未改公开 GovInsight dashboard API 的产品边界，只加固敏感 job/payload/PDF 和 data-center 后台权限。

## 12. 是否建议进入 P4-5C 自审修正

建议进入 P4-5C 自审修正。

理由：

- 修改范围属于 P4-5 性能、安全、权限和异常场景加固。
- 自动验证和 strict-live 均通过。
- 新增权限/安全逻辑已有对应后端或前端测试。
- 未改 schema/migration、PDF smoke 脚本、legacy EJS 删除或 P4 最终总体验收内容。

## 13. P4-5C 自审修正项

- 修正 data-center 批次详情权限边界：区域 scoped 用户如果没有任何可见版本或任务，返回 `Batch not found`，避免暴露批次元数据。
- 修正批量 ZIP 文件名边界：复用 `sanitizePdfExportFileName` 生成 ZIP 内入口名，避免旧数据中异常 `file_name` 进入压缩包路径。
- 清理 `src/routes/pdf-jobs.ts` 中不再使用的 `path` 导入。
- 补充对应回归测试：batch metadata 不泄露、ZIP entry 文件名清洗。

## 14. P4-5C 最终验证结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `npm.cmd run build` | 通过 | TypeScript build 和 public copy 通过 |
| `npm.cmd test` | 通过 | 21/21 suites，154/154 tests；保留既有 JWT_SECRET、bcrypt 默认密码和 legacy EJS warning |
| `cd frontend && npm.cmd test -- --runInBand` | 通过 | 20/20 suites，98/98 tests |
| `cd frontend && npm.cmd run build` | 通过 | typecheck 和 webpack production build 通过；保留既有 asset/bundle size warning |
| `npm.cmd run smoke:pdf` | 通过 | total 4，passed 4，failed 0，skipped 0，strictLive=false |
| `npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001` | 通过 | total 4，passed 4，failed 0，skipped 0，strictLive=true |
| `git diff --check` | 通过 | 无 whitespace error；仅 Git 提示工作区 LF 后续会按本机设置转 CRLF |
| `git ls-files --others --exclude-standard` | 通过 | 未跟踪清单无新增生成物；仅本阶段待提交文件和已知 out-of-scope 历史报告 |

## 15. 生成物排除确认

- smoke 过程中生成的 PDF/ZIP 未进入 Git 暂存区，且未出现在 `git ls-files --others --exclude-standard` 中。
- 未提交 logs、PDF、ZIP、截图、HTML dump、build/dist/coverage/node_modules。
- 未提交真实 `.env`、secret、token。
- 未处理、未暂存已知 out-of-scope 历史报告。

## 16. 是否建议提交

建议进入 P4-5D 本地提交。

理由：

- P4-5C 自审发现的问题已完成最小修正并补充测试。
- 自动验证、PDF smoke 和 strict-live 均通过。
- 修改范围仍限于 P4-5 性能、安全、权限、异常加固及其报告。
- 未改 schema/migration、`scripts/pdf-smoke-baseline.js`、legacy EJS 删除、旧接口删除或 P4 最终总体验收内容。
