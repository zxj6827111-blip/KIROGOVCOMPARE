# P3-2 React Router Unification Plan

Date: 2026-05-20
Branch: `codex/p3-router-unification`
Scope: P3-2 only

## 1. 当前路由结构审计

当前主应用路由集中在 `frontend/src/App.js`：

- `currentPath` 由 `window.location.pathname + window.location.search` 初始化。
- `popstate` 监听器手动同步浏览器前进 / 后退。
- `navigate(path)` 手动调用 `window.history.pushState({}, '', path)`。
- `/` 通过 `useEffect` 手动跳到 `/catalog`。
- `/print/comparison/:id` 和 `/print/govinsight-report/:orgId/:year` 在认证之前短路渲染，不进入 `AppShell`。
- 未认证时所有非 print route 渲染 `Login`，登录成功后固定进入 `/catalog`。
- 认证后由 `renderContent()` 里的一串 `if` / `startsWith` 手写匹配页面。
- `AppShell` 作为登录后外壳，接收 `currentPath` 和 `navigate`，并使用 `routeRegistry` 计算导航高亮。

当前已有 `react-router-dom@7.12.0`，GovInsight 内部已经使用 `Routes`、`Route`、`NavLink`、`useNavigate`、`useLocation`，但它被包在自己的 `HashRouter` 中。

## 2. 当前 App.js 手写路由问题

- 主系统和 GovInsight 有两套路由模型：主系统是手写 `pushState`，GovInsight 是独立 `HashRouter`。
- `App.js` 中路径解析、参数提取、重定向、返回逻辑和页面渲染混在一起，后续增加页面容易继续扩大 `if` 链。
- `currentPath` 不包含 `hash`，无法统一处理 `/govinsight#/*` 到 `/govinsight/*` 的迁移。
- 手写 `navigate` 与组件内部的 `window.location.href` 并存，会导致部分页面跳转整页刷新。
- `popstate` 只覆盖浏览器按钮，不覆盖 hash route 到 browser route 的转换。
- 动态参数通过 `pathname.split('/')` 提取，缺少 React Router 的 `useParams` 约束。

## 3. 当前 routeRegistry 可复用部分

`frontend/src/app/routeRegistry.js` 应继续复用为导航和页面元数据来源：

- `key`、`path`、`title`、`navLabel`、`navGroup`、`icon` 可继续服务 `AppShell`。
- `fallbackReturnTo` 可继续服务详情页返回。
- `permission` / `permissionsAny` 可继续服务导航显隐。
- `match(pathname)` 可继续作为 active route / active nav group 的兼容入口。
- `appendReturnTo()` 可保留，用于构造安全返回链接。

不建议在 P3-2 把所有页面组件直接塞进 `routeRegistry`，因为当前页面需要注入 `navigate`、`onBack`、`onSelectReport` 等不同 props。P3-2 更稳妥的做法是：React Router route config 负责渲染，`routeRegistry` 继续负责导航元数据和 fallback。

可小范围补充：

- 对 `/govinsight/*` 的 match 继续保持。
- 如需要，可新增纯数据字段 `routerPath` 或 `aliases`，但不把 registry 改成复杂页面工厂。

## 4. React Router 目标结构

目标是用一个 `BrowserRouter` 管住整个前端：

- `frontend/src/index.js`：在根部包 `<BrowserRouter>`。
- `frontend/src/App.js`：改为使用 `Routes` / `Route` / `Navigate` / `useNavigate` / `useLocation`。
- 顶层 route 分三类：
  - print route：不需要认证、不进入 `AppShell`；
  - authenticated app route：进入 `AppShell`；
  - fallback route：未知路径回 `/catalog`。

建议结构：

```jsx
<Routes>
  <Route path="/print/comparison/:comparisonId" element={<ComparisonPrintRoute />} />
  <Route path="/print/govinsight-report/:orgId/:year" element={<GovInsightPrintRoute />} />
  <Route path="/*" element={<AuthenticatedApp />} />
</Routes>
```

`AuthenticatedApp` 内部再渲染：

```jsx
<AppShell ...>
  <Routes>
    <Route index element={<Navigate to="/catalog" replace />} />
    <Route path="/catalog" element={<CatalogRoute />} />
    <Route path="/catalog/reports" element={<CatalogRoute />} />
    <Route path="/catalog/reports/:reportId" element={<ReportDetailRoute />} />
    <Route path="/upload" element={<UploadReport />} />
    <Route path="/jobs" element={<JobCenterRoute />} />
    <Route path="/jobs/:versionId" element={<JobDetailRoute />} />
    <Route path="/history" element={<ComparisonHistoryRoute />} />
    <Route path="/comparison/:comparisonId" element={<ComparisonDetailRoute />} />
    <Route path="/issues/*" element={<IssueListRoute />} />
    <Route path="/report-maintenance" element={<ReportMaintenanceRoute />} />
    <Route path="/regions" element={<RegionsManager />} />
    <Route path="/admin/users" element={<UserManagement />} />
    <Route path="/datacenter" element={<DataCenterReportsListRoute />} />
    <Route path="/datacenter/reports/:reportId" element={<DataCenterReportDetailRoute />} />
    <Route path="/govinsight/*" element={<GovInsightModule />} />
    <Route path="*" element={<Navigate to="/catalog" replace />} />
  </Routes>
</AppShell>
```

## 5. AppShell 与 Router 的关系

`AppShell` 继续作为登录后主应用外壳，不包 print route 和 login state。

建议迁移方式：

- `AppShell` 不自己创建 Router。
- `AppShell` 可继续接收 `currentPath` 与 `navigate`，由 `AuthenticatedApp` 从 `useLocation()` / `useNavigate()` 生成，降低改动面。
- 或小范围改为 `AppShell` 内部使用 `useLocation` / `useNavigate`，删除手写 URL 解析 props。推荐第二步再做，不作为 P3-2 的必要条件。
- 导航高亮继续通过 `getNavGroupForPath(location.pathname)`，避免改变 P3-1 导航语义。
- `getPrimaryNavTarget()` 继续处理只有 `manage_users` 权限时系统管理入口落到 `/admin/users` 的逻辑。

## 6. 登录页、认证态、权限逻辑处理方案

认证边界：

- 保留当前语义：print route 在认证检查之后仍可先短路渲染，不要求登录。
- 非 print route 先等待 `authChecked`。
- `!user` 时渲染 `Login`，不进入 `AppShell`。
- 登录成功后保持当前行为：进入 `/catalog`。如要支持登录后回原始 URL，应另开明确小任务，因为这会改变现有登录体验。

权限边界：

- 保留 P3-1 语义：`routeRegistry` 的权限主要用于导航显隐。
- P3-2 不新增直接访问 `/regions`、`/admin/users` 的硬拦截，避免改变现有权限行为。
- 后续如果要做 route guard，应单独设计并验证管理页直达行为。

## 7. print routes 隔离方案

必须继续把以下 route 放在 `AppShell` 和登录态之外：

- `/print/comparison/:comparisonId`
- `/print/govinsight-report/:orgId/:year`

实现要点：

- 顶层 `Routes` 中先声明 print routes。
- print route wrappers 使用 `useParams()` 读取参数。
- `orgId` 用 `decodeURIComponent` 等价处理，继续兼容 `city_721` 和 `721`。
- `year` 转 `Number`，保持当前 `GovInsightReportPrintView` props 形态。
- 不修改 `ComparisonPrintView`、`GovInsightReportPrintView` 的打印布局和 PDF ready marker。
- 不修改 `/api/comparisons/:id/pdf`、`/api/pdf-jobs`、`/api/gov-insight/report-pdf`。

## 8. GovInsight 从 HashRouter 迁移到主路由子树的方案

当前 `frontend/src/govinsight/DashboardApp.tsx` 自带 `HashRouter`，内部路径是：

- `#/`
- `#/portrait`
- `#/operations`
- `#/risk`
- `#/policy`
- `#/benchmark`
- `#/report`
- `#/leader-cockpit`

P3-2 目标结构：

- 移除 `DashboardApp.tsx` 里的 `HashRouter`。
- `GovInsightModule` 作为 `/govinsight/*` 下的子树。
- 内部 routes 改为相对 route：
  - index -> `DashboardHome`
  - `portrait`
  - `operations`
  - `risk`
  - `policy`
  - `benchmark`
  - `report`
  - `leader-cockpit`
  - `*` -> `/govinsight`
- `Layout.tsx` 中的 `NavLink` 和 `navigate()` 从 hash-root 语义改成 `/govinsight/*` 语义。
- `DashboardHome.tsx` 的 `navigate('/portrait')` 改为 `/govinsight/portrait` 或相对 `portrait`。
- `LeaderCockpit.tsx` 的 `navigate('/')` 改为 `/govinsight` 或相对返回。
- `Layout.tsx` 里用 `location.pathname` 判断子模块时，需要从 `/govinsight/report` 归一化出 `/report`，否则现有 `sectionLabels['/report']` 和 `isLeaderCockpitRoute` 判断会失效。

## 9. 旧 /govinsight#/* URL 兼容策略

必须保留旧 hash URL：

- `/govinsight#/report`
- `/govinsight#/leader-cockpit`
- 其他 `/govinsight#/<subpath>`

建议新增一个小型兼容 helper 或组件：

- 在 `/govinsight/*` 入口挂载时读取 `location.hash`。
- 如果 hash 形如 `#/report`，使用 `navigate('/govinsight/report', { replace: true })`。
- 如果 hash 形如 `#/leader-cockpit`，使用 `navigate('/govinsight/leader-cockpit', { replace: true })`。
- 使用 `replace: true`，避免浏览器后退回旧 hash URL 后再次循环跳转。
- 保留 hash 内 query，例如 `#/report?year=2025` 应变成 `/govinsight/report?year=2025`。
- 非 GovInsight hash 不处理。

这部分建议加单元测试，避免未来误删兼容逻辑。

## 10. 新 /govinsight/* URL 设计

新 URL 映射：

- `/govinsight` -> GovInsight 首页
- `/govinsight/portrait` -> 精准画像
- `/govinsight/operations` -> 履职效能
- `/govinsight/risk` -> 法治风险
- `/govinsight/policy` -> 制度供给
- `/govinsight/benchmark` -> 横向对标
- `/govinsight/report` -> 智能辅策
- `/govinsight/leader-cockpit` -> 领导驾驶舱
- `/govinsight/*` 未知子路径 -> replace 到 `/govinsight`

导航高亮：

- 主导航仍由 `routeRegistry` 的 `govinsight.match(pathname)` 覆盖 `/govinsight/*`。
- GovInsight 内部 tabs 用 `NavLink` 匹配 `/govinsight/<subpath>`。
- `/govinsight/leader-cockpit` 继续隐藏普通子导航，保持当前 `isLeaderCockpitRoute` 体验。

## 11. returnTo / fallbackReturnTo 迁移策略

`frontend/src/app/returnTo.js` 可以继续保留：

- `resolveSafeReturnTo()` 已拒绝外部 URL、协议相对 URL、反斜杠、空值和 `/print/*`。
- `resolveRouteReturnTo()` 已通过 `routeRegistry.fallbackReturnTo` 提供页面 fallback。
- React Router 迁移后，详情页的 `onBack` 从 `window.location.href` / 手写 `navigate` 改成 `useNavigate()` 调用即可。

建议：

- 保留 `returnTo` query 参数，不改 URL contract。
- 在 wrapper route 中用 `useLocation().search` 替代 `window.location.search`。
- 继续用 `appendReturnTo()` 构造从列表页到详情页的返回来源。
- 继续拒绝 `/print/*` 作为返回目标。
- 为 `/govinsight#/*` 兼容 helper 添加测试，但不把旧 hash 放入普通 returnTo 的推荐路径。

## 12. 浏览器前进后退验证策略

开发完成后必须验证：

- AppShell 主导航：`/catalog` -> `/jobs` -> `/history`，浏览器后退 / 前进能恢复页面。
- 列表到详情：`/catalog` -> `/catalog/reports/:id?returnTo=...`，返回按钮回到原列表 URL。
- 任务中心：`/jobs?tab=download` -> `/jobs/:id?returnTo=...`，返回后 tab 仍是 download。
- 比对详情：`/history` -> `/comparison/:id?returnTo=/history`，返回后仍在 `/history`。
- GovInsight：`/govinsight` -> `/govinsight/report` -> `/govinsight/leader-cockpit`，浏览器后退 / 前进正常。
- 旧 hash：直接打开 `/govinsight#/report` 后 URL 被 replace 成 `/govinsight/report`，后退不循环。
- print：直接打开 print URL 不出现 AppShell，不要求登录。

## 13. 预计修改文件清单

预计必须修改：

- `frontend/src/index.js`：引入 `BrowserRouter`。
- `frontend/src/App.js`：移除手写 `pushState` / `popstate`，改用 React Router route wrappers。
- `frontend/src/govinsight/DashboardApp.tsx`：移除 `HashRouter`，改成 `/govinsight/*` 子树。
- `frontend/src/govinsight/components/Layout.tsx`：调整 `NavLink`、`navigate()` 和子路径判断。
- `frontend/src/govinsight/views/DashboardHome.tsx`：调整内部跳转目标。
- `frontend/src/govinsight/leader-cockpit/LeaderCockpit.tsx`：调整退出跳转目标。
- `frontend/src/app/returnTo.js`：如需要，补充 Router 场景 helper 或 hash 兼容 helper。
- `frontend/src/app/returnTo.test.js` 或新增 `frontend/src/app/govInsightLegacyHash.test.js`：补充兼容测试。

预计可能小范围修改：

- `frontend/src/app/routeRegistry.js`：补充 route path 元数据或保持不动。
- `frontend/src/components/app/AppShell.js`：可选择继续接收 props，或改用 Router hooks。
- `frontend/src/components/CityIndex.js`：修复 `replaceState` 生成 URL 末尾多余空格，并考虑用 Router navigate 统一跳转。
- `frontend/src/components/JobCenter.js`、`JobDetail.js`、`ReportDetail.js`、`ComparisonDetailView.js`、`ComparisonHistory.js`、`IssueList.js`：仅在必要时把 route 跳转从 `window.location.href` 收敛到注入式 `navigate`，不改业务逻辑。

## 14. 不改动清单

P3-2 不改：

- 不做 TaskDrawer。
- 不做导出中心体验统一。
- 不做 CSS 架构大改。
- 不改 PDF 后端。
- 不改数据库 schema。
- 不删除 legacy EJS。
- 不删除旧 hash URL 兼容。
- 不删除 `/jobs`。
- 不删除 `/api/pdf-jobs`。
- 不破坏 `/api/comparisons/:id/pdf`。
- 不破坏 `/api/gov-insight/report-pdf`。
- 不破坏 `/print/comparison/:id`。
- 不破坏 `/print/govinsight-report/:orgId/:year`。
- 不改 P2 smoke 脚本。
- 不提交 `node_modules`、`dist`、`build`、`coverage`、`logs`、PDF、ZIP、截图、HTML dump。
- 不使用 `git add .`。

## 15. 测试计划

自动验证：

- `npm.cmd run build`
- `npm.cmd test`
- `cd frontend && npm test -- --runInBand`
- `cd frontend && npm.cmd run build`
- `npm.cmd run smoke:pdf`
- 如 live 环境可用：`npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001`

建议新增或补充的前端测试：

- hash 兼容 helper：`/govinsight#/report` -> `/govinsight/report`。
- hash 兼容 helper：`/govinsight#/leader-cockpit` -> `/govinsight/leader-cockpit`。
- `returnTo` 继续拒绝 `/print/*` 和外部 URL。
- route registry 对 `/govinsight/report`、`/govinsight/leader-cockpit` 仍识别为 GovInsight nav group。

## 16. 人工验证清单

需要人工或浏览器验证的页面：

- `/catalog`
- `/upload`
- `/jobs`
- `/jobs?tab=download`
- `/jobs/:id`
- `/history`
- `/comparison/:id`
- `/catalog/reports/:id`
- `/issues`
- `/report-maintenance`
- `/regions`
- `/admin/users`
- `/govinsight`
- `/govinsight#/report`
- `/govinsight#/leader-cockpit`
- `/govinsight/report`
- `/govinsight/leader-cockpit`
- `/print/comparison/:id`
- `/print/govinsight-report/city_721/2025`
- `/print/govinsight-report/721/2025`

页面检查点：

- 登录后页面进入 `AppShell`。
- print 页面不出现 `AppShell`。
- 主导航高亮正确。
- GovInsight 主导航和内部子导航高亮正确。
- PageHeader / 返回按钮能回到安全 `returnTo`。
- 浏览器前进 / 后退不会白屏或跳错模块。
- 旧 hash URL 只做兼容跳转，不丢失目标页面。
- `/jobs?tab=download` 的 tab 状态不丢失。

## 17. 风险与回滚方案

最高风险：

1. GovInsight 从 `HashRouter` 移到 `/govinsight/*` 后，内部 `NavLink`、`useNavigate`、`useLocation` 的路径语义会从 hash root 变为全局 browser path，容易出现 `/report`、`/leader-cockpit` 跳到主系统根路径的问题。
2. print route 必须继续绕过登录和 `AppShell`，否则 PDF renderer 会拿到错误页面或缺少 ready marker。
3. `returnTo` 与组件内 `window.location.href` 混用可能导致返回链路、`/jobs?tab=download`、浏览器后退历史栈出现细节回归。

回滚方案：

- P3-2 应保持前端小范围改动，不触碰后端、数据库、P2 smoke、legacy EJS。
- 若开发后出现路由回归，直接 revert P3-2 分支上的前端路由改动即可回到 P3-1 的手写路由模型。
- print/PDF 如出现回归，优先回滚 `App.js` 顶层 route 结构和 GovInsight route 迁移，不改 PDF 后端。
- 合并前必须重新跑完整测试和 strict-live smoke，且确认工作区无构建产物、PDF、ZIP、截图、HTML dump。

## 建议

建议进入开发，但按两段提交节奏推进：

1. 先改主系统 React Router 与 print/login/AppShell 边界，确保主路由和 PDF smoke 不回归。
2. 再迁移 GovInsight HashRouter 到 `/govinsight/*`，并专门验证旧 hash URL 兼容和 GovInsight 内部导航。

这两个步骤仍属于 P3-2，不进入 P3-3。
