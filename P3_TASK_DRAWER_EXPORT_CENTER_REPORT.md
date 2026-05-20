# P3-3 TaskDrawer / 导出中心 / 任务体验统一报告

日期：2026-05-20
分支：`codex/p3-task-drawer-export-center`
基线：`origin/main` at `e02b3b1 P3-2 unify app routing with React Router`

## 1. 修改文件清单

P3-3 修改范围限定在前端任务体验层，未改数据库 schema、未改 PDF 后端主链路、未改 `scripts/pdf-smoke-baseline.js`。

- `frontend/src/App.js`
  - 在认证后的 AppShell 内挂载全局 `TaskDrawerProvider`。
  - print routes 仍保持在 `AuthenticatedApp` 之外，不进入 AppShell，也不挂载 TaskDrawer。
  - `/govinsight/leader-cockpit` 全屏态禁用 TaskDrawer，避免破坏 cockpit 全屏边界。
- `frontend/src/components/tasks/TaskDrawerProvider.js`
  - 新增全局 TaskDrawer、任务模型归一化、轮询刷新、下载/重试/跳转动作。
  - 支持 `disabled` 边界，用于 Leader Cockpit 全屏页关闭抽屉入口和抽屉渲染。
- `frontend/src/components/tasks/TaskDrawerProvider.css`
  - 新增 TaskDrawer 和浮动触发按钮样式。
  - 在 `body.leader-cockpit-mode` 下隐藏 TaskDrawer 相关节点，作为全屏态 CSS 兜底。
- `frontend/src/components/tasks/TaskDrawerProvider.test.js`
  - 新增过期 PDF 任务提示与重新生成动作测试。
  - 新增 disabled 状态测试，覆盖 Leader Cockpit 不渲染任务抽屉入口。
- `frontend/src/components/UploadReport.js`
  - 上传成功或已存在任务返回后接入解析任务跟踪，不再强制跳转任务中心。
- `frontend/src/components/BatchUpload.js`
  - 批量上传成功后批量接入解析任务跟踪，不再强制跳转任务中心。
- `frontend/src/components/ComparisonDetailView.js`
  - 单个 comparison PDF 导出创建后接入 PDF 任务跟踪。
- `frontend/src/components/ComparisonHistory.js`
  - 单个导出和批量导出创建后接入 PDF 任务跟踪。
- `frontend/src/components/ReportDetail.js`
  - 年报重新解析任务创建后接入解析任务跟踪。
- `frontend/src/components/ReportMaintenance.js`
  - 年报维护页重新解析任务创建后接入解析任务跟踪。
- `frontend/src/govinsight/views/ReportGenerator.tsx`
  - GovInsight AI 报告任务创建或复用后接入 AI 报告任务跟踪。

阶段报告文件：

- `P3-2_POST_MERGE_HEALTH_CHECK.md`
- `P3_TASK_DRAWER_EXPORT_CENTER_REPORT.md`

## 2. 当前任务体验问题

P3-3 前，上传解析、PDF 导出、批量导出、GovInsight AI 报告生成分别在各自页面用 Toast、loading 或任务中心提示表达状态。用户创建长任务后常需要跳转 `/jobs` 或 `/jobs?tab=download` 才能确认进度，当前上下文容易丢失；失败、完成、过期、下载动作也分散在不同页面。

## 3. TaskDrawer 设计说明

新增全局 TaskDrawer，作为 AppShell 内的右侧任务抽屉：

- 默认通过右下角浮动按钮打开。
- 创建任务后自动打开抽屉，并保留当前页面上下文。
- 抽屉内展示解析任务、PDF 导出任务、GovInsight AI 报告任务。
- 抽屉使用现有 API 轮询刷新，不引入大型状态管理框架。
- 抽屉提供任务中心、下载、重新生成、详情页等直接动作。
- `/jobs` 和 `/jobs?tab=download` 仍保留为完整任务中心。
- Leader Cockpit 全屏页通过路由级 `disabled` 和 `body.leader-cockpit-mode` CSS 兜底关闭 TaskDrawer，保持 P3-2 的全屏边界。

## 4. 任务状态模型说明

TaskDrawer 使用统一前端模型，不改后端 schema：

- `type`
  - `parse`：上传/重新解析任务。
  - `pdf`：PDF 导出和批量导出任务。
  - `govinsight`：GovInsight AI 报告生成任务。
- `status`
  - `queued`
  - `running`
  - `succeeded`
  - `failed`
  - `expired`
  - `cancelled`
- `progress`
  - 优先使用后端返回进度；没有进度时根据状态给出合理展示。
- `failureReason`
  - 解析任务复用现有 `translateJobError`。
  - PDF 任务优先展示 `error_message` / `failure_reason` / `last_error`。
  - GovInsight 任务优先展示 `error` / `message`。
- `actions`
  - 完成 PDF：下载。
  - 过期或失败 PDF：重新生成。
  - 解析任务：任务中心或详情页。
  - GovInsight：报告页或重新打开抽屉查看进度。

## 5. 与 `/jobs`、`/jobs?tab=download` 的关系

TaskDrawer 是轻量全局进度入口，不替代任务中心：

- `/jobs` 继续作为完整解析任务中心。
- `/jobs?tab=download` 继续作为下载任务中心。
- TaskDrawer 中的“任务中心”动作会跳转到对应入口。
- PDF 完成任务可在 TaskDrawer 直接下载，也可进入 `/jobs?tab=download`。
- 批量导出仍使用现有下载中心语义，TaskDrawer 只提供创建后的即时可见进度。

## 6. Toast + TaskDrawer 协同说明

创建任务后不再强制跳转：

- Toast 继续负责即时反馈。
- TaskDrawer 负责持续进度和后续动作。
- 上传、批量上传、PDF 导出、批量导出、GovInsight AI 报告生成都会在任务创建后打开 TaskDrawer。
- Toast 中保留“查看任务”或“查看进度”动作，用户可主动跳转或重新打开抽屉。

## 7. 解析任务接入说明

接入位置：

- 上传页：`UploadReport.js`
- 批量上传：`BatchUpload.js`
- 年报详情重新解析：`ReportDetail.js`
- 年报维护重新解析：`ReportMaintenance.js`

接入方式：

- 复用上传/解析接口返回的 `job_id` / `version_id`。
- 调用 `trackParseJob` 写入 TaskDrawer。
- 不改 `/jobs` 页面，不改解析接口，不改后端任务表。
- 上传和批量上传创建任务后不再自动跳转 `/jobs`。

## 8. PDF 导出任务接入说明

接入位置：

- 比对详情：`ComparisonDetailView.js`
- 比对历史：`ComparisonHistory.js`

接入方式：

- 复用现有 `/pdf-jobs` 创建结果。
- 单个导出和批量导出都调用 `trackPdfJob`。
- TaskDrawer 中完成任务可直接下载。
- 失败或过期任务可提示重新生成，使用现有 `/pdf-jobs/:id/regenerate`。
- 未改 `/api/pdf-jobs`、`/api/comparisons/:id/pdf`、PDF renderer、PDF smoke 脚本。

## 9. AI 报告任务接入说明

接入位置：

- `frontend/src/govinsight/views/ReportGenerator.tsx`

接入方式：

- GovInsight AI 报告创建或复用任务后调用 `trackGovInsightJob`。
- TaskDrawer 使用现有 `/gov-insight/ai-report/jobs/:jobId` 查询任务状态。
- 未改 `/api/gov-insight/report-pdf`。
- 未改 GovInsight PDF print routes。

## 10. 失败、过期、完成状态处理

- 失败：
  - 抽屉展示可读失败原因。
  - 解析任务使用既有错误翻译。
  - PDF 和 GovInsight 优先展示后端返回的错误字段。
- 过期：
  - PDF 文件过期时显示“文件已过期”。
  - 提供“重新生成”动作。
- 完成：
  - PDF 完成后显示“下载”。
  - 解析完成后可进入任务中心或报告详情。
  - GovInsight 完成后可进入报告页。

## 11. 未改动的后端接口

本阶段未改动后端接口和数据库 schema。以下接口保持原状：

- `/api/pdf-jobs`
- `/api/pdf-jobs/:id/download`
- `/api/pdf-jobs/:id/regenerate`
- `/api/comparisons/:id/pdf`
- `/api/gov-insight/report-pdf`
- `/api/gov-insight/ai-report/jobs/:jobId`
- `/api/jobs`
- `/api/jobs/task/:jobId`

## 12. 未改动的 URL

以下 URL 保持可用或隔离：

- `/jobs`
- `/jobs?tab=download`
- `/comparison/:id`
- `/history`
- `/upload`
- `/govinsight/report`
- `/govinsight/leader-cockpit`
- `/print/comparison/:id`
- `/print/govinsight-report/:orgId/:year`

## 13. build/test/smoke/strict-live 结果

P3-2 合并后健康检查已通过，并生成 `P3-2_POST_MERGE_HEALTH_CHECK.md`。P3-3 当前分支验证结果：

- `npm.cmd run build`：通过。
- `npm.cmd test`：通过，19 个 test suites / 144 个 tests。
- `cd frontend && npm test -- --runInBand`：通过，17 个 test suites / 83 个 tests。
- `cd frontend && npm.cmd run build`：通过。
- `cd frontend && npm.cmd run typecheck`：通过。
- `npm.cmd run smoke:pdf`：通过，4/4。
- `npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001`：通过，4/4。
- `git diff --check`：无 whitespace error；仅有 Windows 工作区 CRLF 提示。

## 14. 人工 / live 验证结果

已在 live frontend `http://127.0.0.1:3001` 上做只读 UI 验证：

- `/jobs`
  - AppShell 正常。
  - TaskDrawer 触发按钮存在。
  - 页面仍显示解析任务中心。
- `/jobs?tab=download`
  - AppShell 正常。
  - TaskDrawer 触发按钮存在。
  - 下载任务中心仍显示 ready / running / failed / expired 等统计。
- TaskDrawer 打开验证
  - 抽屉可打开。
  - 可展示近期解析任务和 PDF 导出任务。
  - PDF 完成任务显示“下载”动作。
  - 解析失败任务展示可读失败原因。
  - 抽屉内保留“任务中心”入口。
- `/govinsight/leader-cockpit`
  - 已修复 TaskDrawer 全局浮动按钮进入 cockpit 全屏态的问题。
  - 路由级禁用 TaskDrawer，同时 CSS 在 `body.leader-cockpit-mode` 下兜底隐藏。
- `/print/comparison/4670`
  - 未进入 AppShell。
  - 未出现 TaskDrawer 触发按钮。
  - print root 正常。
- `/print/govinsight-report/city_721/2025`
  - 未进入 AppShell。
  - 未出现 TaskDrawer 触发按钮。
  - GovInsight 报告内容正常渲染。

未在本轮额外手动创建新的上传样本或 GovInsight AI 报告样本，以避免引入不必要业务数据；对应创建路径已通过代码接入、前端测试、PDF smoke 与 strict-live PDF 链路验证覆盖。建议人工审核时再按真实业务样本点一次上传和 GovInsight 生成流程。

## 15. 风险和遗留问题

- TaskDrawer 当前基于轮询，不是 WebSocket / SSE；这符合 P3-3 的最小实现边界。
- GovInsight AI 报告任务主要覆盖当前会话创建后的跟踪；历史 GovInsight 任务没有做全局任务列表聚合。
- Leader Cockpit 下 TaskDrawer 已禁用；该页如果未来需要任务反馈，应单独设计 cockpit 内部通知，不应复用全局浮动入口。
- P3-5 范围内的 `alert` / `confirm` 清理没有在本阶段处理。
- P3-4 范围内的 CSS 架构收敛没有在本阶段处理。
- P3-3 没有改后端 schema，因此后端任务字段如果存在历史不一致，TaskDrawer 通过前端归一化做兼容展示。

## 16. 是否建议合并

建议重新进入人工提交审核。当前 P3-3 已完成全局 TaskDrawer、解析任务、PDF 导出任务、GovInsight AI 报告任务接入，并保留 `/jobs`、`/jobs?tab=download`、PDF print routes、Leader Cockpit 全屏边界和 P3-2 Router 行为。

根据阶段规则，当前不提交、不 push、不创建 PR。等待人工审核通过后，再精确 `git add` 本阶段文件、确认 staged 文件、commit、push，并准备 PR。
