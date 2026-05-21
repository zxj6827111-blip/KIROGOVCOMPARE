# P4-5 Performance, Security and Permission Hardening Plan

生成时间：2026-05-21

## 1. 当前分支和 main commit

- 当前工作目录：`E:\Software Development\KIROGOVCOMPARE`
- 当前分支：`codex/p4-performance-security-hardening`
- main commit：`c6a19e348a8d8995d714f2d13126d606e80340dd`
- main 短 hash：`c6a19e3`
- 最近 main 提交：`c6a19e3 Merge pull request #110 from zxj6827111-blip/codex/p4-acceptance-demo-materials`

前置门禁确认：

- 已找到本地 `P4_4_POST_MERGE_HEALTH_CHECK.md`。
- 报告明确写明 P4-4F post-merge health check 通过，P4-4 已完成，建议进入 P4-5。
- 当前仅存在既有 out-of-scope 未跟踪历史报告，本阶段不处理、不暂存、不提交。

## 2. 当前风险面审计

本阶段只读审计了以下入口：

- 认证和权限：`src/middleware/auth.ts`、`src/routes/auth.ts`、`src/routes/users.ts`、`src/routes/admin.ts`
- 任务和导出：`src/routes/jobs.ts`、`src/routes/pdf-jobs.ts`、`src/routes/pdf-export.ts`、`src/services/PdfExportWorker.ts`
- GovInsight：`src/routes/gov-insight.ts`、`src/routes/gov-insight-pdf.ts`
- 数据中心：`src/routes/data-center.ts`
- 前端路由和任务抽屉：`frontend/src/app/returnTo.js`、`frontend/src/app/returnTo.test.js`、`frontend/src/components/tasks/TaskDrawerProvider.js`、`frontend/src/components/JobCenter.js`
- 历史材料：`P4_REAL_SAMPLE_ISSUE_LIST.md`、`P4_REAL_SAMPLE_REGRESSION_REPORT.md`、`P4_DATA_QUALITY_EVIDENCE_REPORT.md`、`P4_DEPLOYMENT_OPERATIONS_REPORT.md`、`P4_ACCEPTANCE_DEMO_MATERIALS_REPORT.md`、`P4_4_POST_MERGE_HEALTH_CHECK.md`、`DEPLOYMENT.md`、`OPERATIONS.md`、`TROUBLESHOOTING.md`

已有基础能力：

- 后端 API 已有 `authMiddleware`、`requirePermission`、区域 `dataScope` 过滤工具。
- `/api/pdf-jobs` 已要求登录，创建、列表、下载、删除、重生成和批量下载均按区域 scope 做了基本过滤。
- `/api/jobs` 已要求登录，删除、取消、重试等破坏性操作要求 `manage_jobs`。
- 用户管理和管理员占位路由要求 `manage_users`。
- 前端 `returnTo` 已拒绝外部 URL、协议 URL、反斜杠、双斜杠和 `/print/` 路径，并已有单测。
- PDF job 已对 failed 返回不可下载、过期文件返回 410，并在前端有可读提示。

主要风险面：

- PDF job 的 `file_path` 来自数据库，下载、批量打包、删除、清理等路径操作目前缺少统一的导出目录边界校验。
- PDF 批量下载只校验数组非空，缺少数量上限、整数清洗和重复去重，真实使用中可能带来异常 SQL 参数、ZIP 资源消耗或不清晰错误。
- `PdfExportWorker` 使用 `path.join(PDF_EXPORTS_DIR, job.file_name)`，依赖创建任务时的文件名清洗；若历史或异常数据污染 `file_name`，仍应增加 worker 侧兜底。
- `TaskDrawerProvider` 活跃时 3 秒轮询，且每次为了跟踪 PDF job 拉取 `/api/pdf-jobs?page=1&limit=100`，多页面或多用户下会放大后端负载。
- `src/routes/data-center.ts` 整体要求登录，但多个详情、指标和 dashboard 接口缺少区域 scope 过滤；`/v2/batches/:batchUuid/retry` 也未要求 `manage_jobs`。
- GovInsight AI job latest 失败时当前只能透传错误，P4-1 已记录 `overrides?.overallJudgments?.filter is not a function`，需要增强可读状态或防崩溃口径，但不改模型协议。
- 同步 PDF 兼容接口和 GovInsight PDF 在 Puppeteer/前端服务不可用时返回 500 原始 message，用户可读性可以最小增强。

## 3. P4-1/P4-2/P4-3/P4-4 遗留问题引用

- P4-1-001：GovInsight 淮安市 2025 latest job `17` 为 failed，错误为 `overrides?.overallJudgments?.filter is not a function`；历史成功 job、存储报告和 PDF 可用。建议 P4-5 做异常场景加固。
- P4-1-002：当前环境缺少 `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript，PDF smoke 像素级能力降级。P4-5 不修改 `scripts/pdf-smoke-baseline.js`，只在报告中准确写明能力边界。
- P4-1-003：TaskDrawer 业务页缺少人工登录视觉确认；P4-5 可做轮询负载和异常提示加固，但不替代人工 UI 验收。
- P4-2/P4-3/P4-4 报告均强调：不改 PDF 主链路、不改 GovInsight 生成协议、不改 schema/migration、不提交日志/PDF/ZIP/截图/HTML dump。
- P4-4F 已确认基础 build/test/smoke/strict-live 通过，但保留既有 JWT_SECRET 测试提示、legacy EJS deprecated warning、前端 bundle/asset size warning。

## 4. 性能风险清单

| 风险 | 当前状态 | P4-5 建议 |
| --- | --- | --- |
| 大文件上传 | 已有文件校验与解析链路，P4-5 不改解析算法 | 仅保留为人工压力/容量验证项 |
| 长表格解析 | P4 真实样本 smoke 已覆盖长表 PDF | 不改解析逻辑，避免引入回归 |
| 大量任务列表 | `/api/jobs` 和 `/api/pdf-jobs` 已分页且 limit capped 100 | 保留分页；前端避免高频拉大页 |
| PDF 长报告导出 | smoke 覆盖普通比对、长表比对、GovInsight PDF | 增强失败时可读错误，不改版式主链路 |
| GovInsight 报告生成 | 有 latest failed 遗留 | 仅增强 latest failed 可读状态或防崩溃，不改协议 |
| 批量下载 | 后端缺少 job_ids 数量上限和清洗 | 增加最小输入上限、去重、整数校验 |
| TaskDrawer 轮询负载 | 活跃 3 秒、空闲 12 秒，PDF 跟踪拉 100 条 | 降低跟踪查询 limit 或按更小窗口查询；保持 UX 可用 |
| 列表分页和筛选 | 多处已有 limit cap | 数据中心部分接口固定大 limit，应保留但加 scope |
| 前端 bundle size warning | P4-4F 记录为既有非阻塞 warning | P4-5 不做 bundle 重构 |
| 并发导出任务 | worker 单任务轮询处理 | 不改队列模型；只增强重复/过期/失败提示 |

## 5. 安全风险清单

| 风险 | 当前状态 | P4-5 建议 |
| --- | --- | --- |
| 未登录访问 | 大多数后台 API 已 auth；GovInsight dashboard 部分公开 | 保留公开 dashboard 边界；敏感 PDF/job/payload 维持 auth |
| 越权访问 | jobs/pdf-jobs 多数有区域过滤；data-center 不完整 | 给 data-center report/detail/dashboard 补最小 scope 校验 |
| 管理员页面权限 | users/admin 已 `manage_users` | 前端只读提示可不作为安全边界；后端已是主边界 |
| 文件下载权限 | pdf-jobs 有 auth + scope | 增加文件路径在导出目录内的边界校验 |
| 导出文件路径安全 | `file_path` 和 `file_name` 未统一防穿越 | 引入本地 helper 做 resolve/relative 校验 |
| trace id/request id 注入 | legacy EJS trace id 已有 pattern 过滤 | 保持现状，不扩大改动 |
| 外链跳转风险 | 前端 print window 使用同源路径；returnTo 已过滤 | 保持；必要时增加回归测试 |
| returnTo 安全 | 已有单测覆盖外链/协议/print | 不作为 P4-5B 优先修复，除非自审发现缺口 |
| service token 使用边界 | 同步 PDF token 5 分钟；BrowserRenderer 日志 redacted | 保持 TTL；不把 token 暴露到日志 |
| legacy EJS deprecated route | 保留旧接口并有 deprecated header/warning | 不删除、不重构；只确保不破坏 |

## 6. 权限风险清单

| 权限面 | 当前状态 | P4-5 建议 |
| --- | --- | --- |
| 普通用户 | 依赖 explicit permissions 与 dataScope | 重点验证只读访问不具备管理操作 |
| 管理员 | 需要 explicit permissions，无 id=1 隐式绕过 | 保持 |
| 只读用户 | 缺少统一角色名，但权限对象可表达 | 用测试覆盖缺少 `manage_jobs` 的 retry/delete 被拒 |
| 区域权限 | jobs/pdf-jobs 多数已过滤 | data-center 补过滤，pdf 文件下载维持过滤 |
| 用户管理权限 | users/admin 已 `manage_users` | 保持并验证 |
| 数据中心访问权限 | 整体登录，但多个接口无 scope | P4-5B 优先补 scope |
| GovInsight 权限 | AI job/payload/PDF 有 auth/scope；公开 dashboard 不要求 auth | 不改变公开 dashboard，确保敏感入口不放宽 |
| 下载权限 | PDF 下载有 auth/scope | 加路径边界和 batch 输入边界 |
| 批量操作权限 | jobs 批量删除有 `manage_jobs`；data-center batch retry 缺少 | 给 data-center retry 加 `manage_jobs` |
| 任务查看权限 | parse/pdf/govinsight job 多数有 scope | 保持并补测试 |

## 7. 异常场景风险清单

| 异常 | 当前状态 | P4-5 建议 |
| --- | --- | --- |
| PDF 任务失败 | 下载返回 400，前端可提示失败 | 增加更可读的失败 message/error_code，不暴露敏感路径 |
| 文件过期 | 返回 410，前端可重新生成 | 保持并加路径非法时的安全错误 |
| 任务重复提交 | GovInsight AI job 已复用 active job；PDF job 未去重 | PDF 不改队列模型，报告说明；可考虑前端提示 |
| backend 重启 | DB job 状态持久化 | 不改架构 |
| frontend 刷新 | TaskDrawer 会拉 recent tasks | 降低轮询负载 |
| 网络中断 | 前端 toast 处理 | 保持 |
| 数据库暂不可用 | 多数返回 500 | 不改全局错误模型 |
| Puppeteer 启动失败 | 返回 500 message | 增强可读提示 |
| 任务队列堆积 | worker 单任务处理，无压力测试 | 不改队列模型，报告列为未覆盖风险 |
| 导出目录不可写 | worker catch failed | 增强 error_message 可读，不改目录策略 |

## 8. 建议加固项

P4-5B 建议按最小变更顺序处理：

1. 新增 PDF 导出文件路径安全 helper，限制下载、批量打包、删除和清理只访问 `data/exports/pdf` 内 PDF 文件。
2. 给 `/api/pdf-jobs/batch-download` 增加 `job_ids` 清洗、整数校验、去重和数量上限，避免大批量 ZIP 放大资源消耗。
3. 给 `PdfExportWorker` 的输出文件名增加兜底清洗，避免异常 `file_name` 形成路径穿越。
4. 给 data-center report/facts/cells/quality/report/dashboard 接口补区域 scope；给 batch retry 补 `manage_jobs`，并确保只 retry 当前用户 scope 内批次。
5. 调低 TaskDrawer PDF 跟踪查询负载，避免每个轮询周期固定拉 100 条。
6. 增强 PDF/Puppeteer 不可用、文件路径异常、GovInsight latest failed 的可读错误/状态，不泄露本地绝对路径或 token。
7. 补充对应后端和前端最小测试，优先覆盖路径安全、batch 输入、data-center scope、TaskDrawer 查询参数、GovInsight latest failed 序列化。

## 9. 不建议本阶段处理的事项

- 不做数据库 schema/migration。
- 不改解析算法、比对算法、GovInsight 模型协议。
- 不做 PDF 版式重构或主链路重写。
- 不删除 legacy EJS，不删除旧接口。
- 不改 `scripts/pdf-smoke-baseline.js`。
- 不做 bundle 拆包或依赖升级。
- 不提交压力测试产物、日志、PDF、ZIP、截图、HTML dump、build/dist/coverage/node_modules。
- 不做 P4 最终总体验收。

## 10. 是否需要新增测试

需要。

建议新增或修改：

- `src/__tests__/pdfJobsRegression.test.ts`：覆盖非法 file_path 被拒、batch job_ids 清洗/上限/非法 id。
- 新增或扩展 data-center 路由测试：覆盖区域 scope 外 report/detail/dashboard 被拒，batch retry 无 `manage_jobs` 被拒。
- `src/__tests__/authPermissions.test.ts` 或新测试：覆盖 `requirePermission('manage_jobs')` 对只读用户拒绝。
- `frontend/src/components/tasks/TaskDrawerProvider.test.js`：覆盖 PDF 轮询 limit 降低或查询行为不再固定拉 100。
- 如实现 GovInsight latest failed 状态增强，补充对应序列化单测。

## 11. 自动验证计划

P4-5B、P4-5C、P4-5E 均执行：

1. `npm.cmd run build`
2. `npm.cmd test`
3. `cd frontend && npm.cmd test -- --runInBand`
4. `cd frontend && npm.cmd run build`
5. `npm.cmd run smoke:pdf`

P4-5C/P4-5D/P4-5E 额外执行：

- `git diff --check`
- `git ls-files --others --exclude-standard`
- staged 清单和 `origin/main...HEAD` 清单边界检查

## 12. strict-live 验证计划

如本地 API `http://127.0.0.1:8787` 和前端 `http://127.0.0.1:3001` 可用，执行：

```text
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

如服务不可用，报告写 `blocked` 和具体原因，不写成 strict-live 通过。

## 13. 不改动边界

本阶段必须遵守：

- 不改数据库 schema/migration，除非人工明确批准。
- 不删除 legacy EJS。
- 不删除旧接口。
- 不破坏 `/api/pdf-jobs`。
- 不破坏 `/api/comparisons/:id/pdf`。
- 不破坏 `/api/gov-insight/report-pdf`。
- 不破坏 `/print/comparison/:id`。
- 不破坏 `/print/govinsight-report/:orgId/:year`。
- 不改 `scripts/pdf-smoke-baseline.js`，除非人工明确批准。
- 不提交真实 `.env`、secret、token。
- 不使用 `git add .`，只使用显式路径暂存。
- 不提交 out-of-scope 历史报告。

## 14. 是否建议进入 P4-5B 实施

建议进入 P4-5B。

理由：

- P4-4F 前置报告已明确放行 P4-5。
- 当前审计已定位到 P4-5 范围内的明确风险点，且可通过最小改动完成。
- 建议实施项集中在路径安全、权限边界、输入上限、轮询负载和异常提示，不需要 schema/migration 或大重构。
- 实施后可以通过现有 build/test/frontend test/frontend build/smoke:pdf/strict-live 门禁验证。
