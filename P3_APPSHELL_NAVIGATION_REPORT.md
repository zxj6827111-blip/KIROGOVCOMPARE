# P3-1 AppShell 与导航 Registry 报告

## 1. 修改文件清单

- `frontend/src/App.js`
- `frontend/src/app/routeRegistry.js`
- `frontend/src/app/returnTo.js`
- `frontend/src/app/returnTo.test.js`
- `frontend/src/components/app/AppShell.js`
- `frontend/src/components/app/AppShell.css`
- `frontend/src/components/CityIndex.js`
- `frontend/src/components/UploadReport.js`
- `frontend/src/components/ReportDetail.js`
- `frontend/src/components/ComparisonDetailView.js`
- `frontend/src/components/JobCenter.js`
- `frontend/src/components/JobDetail.js`

## 2. 改造前导航和页面外壳问题

改造前 `App.js` 同时负责认证后外壳、一级导航、路径匹配、权限入口、详情页返回目标和页面渲染。导航高亮按 pathname 前缀判断，业务分组口径不明确，例如 `/catalog/reports/:id` 与 `/catalog` 混在同一 URL 前缀下，但业务语义更接近问题复核。页面标题区也分散在各页面内部，`ReportDetail`、`ComparisonDetailView`、`ComparisonHistory`、`JobCenter` 已使用 `PageHeader`，但 `/catalog`、`/upload` 仍是各自手写标题。

详情页返回逻辑存在不一致：`ReportDetail` 曾依赖 `window.history.back()`，深链进入时可能返回系统外；`ComparisonDetailView` 和 `JobDetail` 固定返回列表页，无法保留来源上下文。

## 3. AppShell 设计说明

新增 `AppShell` 作为登录后的主应用外壳，只负责：

- 顶部 logo、当前用户和退出；
- 一级导航；
- main 内容区；
- footer。

打印页和登录页仍在 `AppShell` 外部渲染。GovInsight 内部仍使用自己的 `HashRouter` 和内部 Layout，P3-1 没有拆分或统一 React Router。

## 4. route registry 设计说明

新增 `routeRegistry.js`，集中记录：

- `path`
- `title`
- `navLabel`
- `navGroup`
- `permission`
- `fallbackReturnTo`
- `match(pathname)`

导航高亮使用 `navGroup`，不是简单 pathname 完全匹配。registry 目前只服务主应用外壳、返回 fallback 和导航入口，不改变现有 URL。

## 5. 一级导航结构

当前一级导航按业务流程组织：

- 年报工作台：`/catalog`、`/upload`
- 问题复核：`/catalog/reports/:id`、`/issues`
- 比对中心：`/history`、`/comparison/:id`
- 导出中心：`/jobs`、`/jobs?tab=download`、`/jobs/:id`
- 智能治理：`/govinsight`
- 系统管理：`/regions`、`/admin/users`

实际可点击主导航入口分别指向 `/catalog`、`/issues`、`/history`、`/jobs`、`/govinsight`、`/regions`；权限入口按用户权限过滤。

## 6. PageHeader 使用范围

本阶段只小范围收敛标题区：

- `/catalog`：改为 `PageHeader`，保留原页面主体和原有操作入口。
- `/upload`：新增 `PageHeader`，不改上传业务逻辑。
- `/jobs`：沿用现有 `PageHeader`。
- `/history`：沿用现有 `PageHeader`。
- `/comparison/:id`：沿用现有 `PageHeader`，只调整返回 handler。
- `/catalog/reports/:id`：沿用现有 `PageHeader`，只调整安全返回。

未重写页面主体布局，未做全站 CSS 架构大改。

## 7. returnTo 处理策略

新增 `resolveSafeReturnTo(search, fallback)`：

- 优先读取 `returnTo`；
- 只接受同源内部路径；
- 必须以 `/` 开头；
- 禁止完整 URL；
- 禁止协议相对 URL，例如 `//evil.com`；
- 禁止反斜杠；
- 禁止 `/print/*`；
- 非法或为空时返回 registry fallback。

默认 fallback：

- `ReportDetail`：`/catalog`
- `ComparisonDetailView`：`/history`
- `JobDetail`：`/jobs`

P3-1 指定详情入口使用 `returnTo` 记录来源，例如 `/catalog/reports/:id?returnTo=/catalog`、`/jobs/:id?returnTo=/jobs?...`。`/comparison/:id` 深链仍支持安全 fallback 返回 `/history`；`ComparisonHistory` 列表内查看详情继续使用组件内 state，避免丢失筛选、展开和滚动上下文。

## 8. 安全返回测试覆盖

新增 `frontend/src/app/returnTo.test.js`，覆盖：

- `/catalog` 合法；
- `/history?page=1` 合法；
- `https://evil.com` 非法；
- `//evil.com` 非法；
- `\evil` 非法；
- `/print/comparison/4670` 非法；
- 空值非法；
- 编码后的外链非法；
- fallback 生效。

## 9. 兼容的旧入口

以下入口保持兼容：

- `/catalog`
- `/upload`
- `/jobs`
- `/jobs?tab=download`
- `/history`
- `/comparison/:id`
- `/catalog/reports/:id`
- `/govinsight`
- `/issues`
- `/report-maintenance`
- `/regions`
- `/admin/users`

`window.location.href` 在部分既有页面仍保留作为旧入口兼容；本阶段只在 P3-1 目标入口上增加安全 `returnTo` 和主应用内导航。

## 10. 未改动的 URL

以下 URL 保持不变：

- `/catalog`
- `/upload`
- `/jobs`
- `/jobs?tab=download`
- `/history`
- `/comparison/:id`
- `/catalog/reports/:id`
- `/govinsight`
- `/print/comparison/:id`
- `/print/govinsight-report/city_721/2025`
- `/print/govinsight-report/721/2025`

## 11. 对 PDF 打印路由的影响说明

`/print/comparison/:id` 和 `/print/govinsight-report/:orgId/:year` 仍在 `App.js` 认证前短路渲染，不进入 `AppShell`。本阶段没有修改：

- `/api/pdf-jobs`
- `/api/comparisons/:id/pdf`
- `/api/gov-insight/report-pdf`
- `scripts/pdf-smoke-baseline.js`
- legacy EJS 模板
- 打印页面业务逻辑

## 12. build/test/smoke 结果

- `npm.cmd run build`：通过。
- `npm.cmd test`：通过，19 个 test suites、144 个 tests。
- `cd frontend && npm test -- --runInBand`：通过，15 个 test suites、76 个 tests。
- `cd frontend && npm.cmd run build`：通过，`tsc --noEmit` 和 webpack production build 均成功。
- `npm.cmd run smoke:pdf`：通过，summary `total=4`、`passed=3`、`failed=0`、`skipped=3`、`strictLive=false`。
- live backend：`http://127.0.0.1:8787`，`/api/health` 返回 200，database connected。
- live frontend：`http://127.0.0.1:3001`，`/catalog` 返回 200。
- `npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001`：通过，summary `total=4`、`passed=4`、`failed=0`、`skipped=0`、`strictLive=true`。覆盖 comparison PDF baseline、GovInsight `/api/gov-insight/report-pdf`、`/api/pdf-jobs` 创建/下载/失败/过期/batch download，以及前端 GovInsight print 渲染告警检查。

## 13. 人工验证结果

live 浏览器人工验证已完成：

- `/catalog`：通过。进入 AppShell，一级导航正常，“年报工作台”高亮，`PageHeader` 正常，主体无明显错乱。
- `/upload`：通过。进入 AppShell，“年报工作台”高亮，`PageHeader` 正常，单个上传/批量上传入口保留。
- `/jobs`：通过。进入 AppShell，“导出中心”高亮，`PageHeader` 正常，上传任务列表可见。
- `/jobs?tab=download`：通过。进入 AppShell，“导出中心”高亮，URL query 保留，下载任务 tab、统计卡和任务列表正常。
- `/history`：通过。进入 AppShell，“比对中心”高亮，`PageHeader` 正常，列表、筛选、详情入口正常。
- `/history` 行内详情：通过。展开区域后点击行内“查看”，详情仍在 `/history` 组件内展示，“比对中心”保持高亮；点击“返回列表”回到原列表上下文。
- `/comparison/1143`：通过。进入 AppShell，“比对中心”高亮，详情页标题和返回按钮正常；深链返回 fallback 为 `/history`。
- `/catalog/reports/4877`：通过。进入 AppShell，“问题复核”高亮，`PageHeader` 和返回按钮正常；深链返回 fallback 为 `/catalog`，没有调用 `window.history.back()` 返回系统外。
- `/govinsight`：通过。主系统 AppShell 正常，“智能治理”高亮；GovInsight 内部 `HashRouter` 和内部 Layout 正常，内部导航可从全景态势切换到智能辅策。
- `/govinsight#/leader-cockpit`：通过。触发 `body.leader-cockpit-mode` 后，AppShell header/nav/footer 隐藏，main `max-width: none`、`padding: 0`，驾驶舱内容正常。
- `/print/comparison/1143`：通过。不进入 AppShell，不显示主系统导航，页面可用于 PDF 渲染。
- `/print/govinsight-report/city_721/2025`：通过。不进入 AppShell，不显示主系统导航，`data-govinsight-pdf-ready=true`，页面可用于 PDF 渲染。
- `/print/govinsight-report/721/2025`：通过。不进入 AppShell，不显示主系统导航，`data-govinsight-pdf-ready=true`，页面可用于 PDF 渲染。

returnTo 专项验证已完成：

- `/catalog/reports/4877?returnTo=/catalog` 点击返回：通过，回到 `/catalog`。
- `/catalog/reports/4877?returnTo=https://evil.com` 点击返回：通过，未跳外部 URL，回 fallback `/catalog`。
- `/catalog/reports/4877?returnTo=/print/comparison/1143` 点击返回：通过，未进入 print 页面，回 fallback `/catalog`。
- `/comparison/1143?returnTo=/history?page=1` 点击返回：通过，回到 `/history?page=1`。
- `/comparison/1143?returnTo=//evil.com` 点击返回：通过，未跳外部，回 fallback `/history`。

浏览器控制台 error：0。

## 14. 风险和遗留问题

- `CityIndex` 和部分旧页面仍有少量 `window.location.href` 入口，本阶段只收敛 P3-1 指定入口，没有全站替换。
- AppShell 使用现有设计 token 和小范围 CSS，未整理旧 `.header/.nav/.main/.footer` 样式，避免 CSS 架构大改；后续如果确认无引用，可在单独阶段清理。
- `ComparisonHistory` 列表内查看详情继续使用组件内 state，保留筛选、展开和滚动上下文；直接深链 `/comparison/:id` 仍由 App 层安全 fallback 返回 `/history`。
- strict-live smoke 已在本地 live backend/frontend 上通过。
- 新增核心文件已通过显式文件路径纳入 staged 清单，当前无 untracked 文件；后续仍不能使用 `git add .`。
- `frontend/src/components/ComparisonHistory.js` 当前存在 EOL/index 状态噪声：`git diff -- frontend/src/components/ComparisonHistory.js` 为空，因此未纳入本次 staged 提交。

## 15. 是否建议合并

建议进入合并审核。P3-1 自动验证、strict-live smoke 和 live 浏览器人工验证均已通过；代码变更限定在 P3-1 AppShell、导航 registry、PageHeader 小范围收敛和安全返回策略内，未触碰 PDF 后端、数据库 schema、legacy EJS 或 GovInsight 内部路由结构。最终是否 ready to merge 仍应由人工复审确认。
