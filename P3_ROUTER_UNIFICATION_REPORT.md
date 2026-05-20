# P3 Router Unification Report

## 1. 修改文件清单

- `frontend/src/index.js`
- `frontend/src/App.js`
- `frontend/src/app/govInsightRoutes.js`
- `frontend/src/app/govInsightRoutes.test.js`
- `frontend/src/govinsight/DashboardApp.tsx`
- `frontend/src/govinsight/components/Layout.tsx`
- `frontend/src/govinsight/views/DashboardHome.tsx`
- `frontend/src/govinsight/leader-cockpit/LeaderCockpit.tsx`
- `P3-1_POST_MERGE_HEALTH_CHECK.md`
- `P3_ROUTER_UNIFICATION_PLAN.md`
- `P3_ROUTER_UNIFICATION_REPORT.md`

纳入本次提交的审计/计划文件：

- `P3-1_POST_MERGE_HEALTH_CHECK.md`
- `P3_ROUTER_UNIFICATION_PLAN.md`

未修改：

- PDF 后端、数据库 schema、legacy EJS、`scripts/pdf-smoke-baseline.js`。
- `frontend/src/app/routeRegistry.js`、`frontend/src/app/returnTo.js`、`frontend/src/app/returnTo.test.js`。

## 2. P3-1 合并后健康检查摘要

P3-1 合并后已基于最新 `origin/main` 完成健康检查，并输出 `P3-1_POST_MERGE_HEALTH_CHECK.md`。当时确认：

- `main` 包含 P3-1 merge commit。
- 工作区在建 P3-2 分支前无 P3-1 遗留修改。
- `ComparisonHistory.js` EOL/index 噪声未继续影响 main。
- build/test/frontend build/PDF smoke/strict-live 均通过。

## 3. 主系统 React Router 改造说明

`frontend/src/index.js` 在根部引入 `BrowserRouter`。`frontend/src/App.js` 删除手写 `pushState`/`popstate`/`renderContent` if 链，改为：

- 顶层 `Routes` 区分 print routes 与登录后应用。
- 登录后应用通过 `AuthenticatedApp` 管理主系统 routes。
- 页面参数由 `useParams` 读取。
- query 与返回路径由 `useLocation` 读取，继续交给既有 `returnTo` 安全解析。
- 页面跳转统一通过 `useNavigate` 包装后的 `navigate` 函数。

主系统已覆盖：

- `/catalog`
- `/upload`
- `/jobs`
- `/jobs/:versionId`
- `/history`
- `/comparison/:comparisonId`
- `/catalog/reports/:reportId`
- `/issues/*`
- `/report-maintenance`
- `/regions`
- `/admin/users`
- `/datacenter`
- `/datacenter/reports/:reportId`
- `/govinsight/*`

## 4. AppShell 与 Router 关系说明

`AppShell` 不创建 Router。`AuthenticatedApp` 从 React Router 读取：

- `location.pathname`
- `location.search`
- `navigate`

然后向 `AppShell` 传入：

- `currentPath`
- `navigate`
- `user`
- `onLogout`

导航高亮仍由 `routeRegistry` 的 `getRouteForPath` / `getNavGroupForPath` / `navGroup` 控制，P3-1 导航语义未改变。

## 5. 登录页、认证态、权限逻辑说明

- `authChecked` 前仍显示 loading。
- 非 print route 且无 `user` 时渲染 `Login`，不进入 `AppShell`。
- 登录成功后仍跳转 `/catalog`。
- 本阶段未新增“登录后跳回原 URL”的行为。
- 权限判断仍由 `routeRegistry` 与 `AppShell` 读取 `user.permissions` 完成。
- `/regions`、`/admin/users` 的导航可见性和高亮语义保持 P3-1 逻辑。

## 6. print routes 隔离说明

顶层 print routes：

- `/print/comparison/:comparisonId`
- `/print/govinsight-report/:orgId/:year`

它们位于认证应用 route 之外，因此：

- 不需要登录。
- 不进入 `AppShell`。
- 不显示主导航/header/footer。
- 未修改 print view。
- 未修改 ready marker。
- 未修改 PDF 后端与 PDF smoke 脚本。

## 7. GovInsight HashRouter 迁移说明

`frontend/src/govinsight/DashboardApp.tsx` 已移除内部 `HashRouter`，改为复用主应用 `BrowserRouter` 下的子路由：

- index
- `portrait`
- `operations`
- `risk`
- `policy`
- `benchmark`
- `report`
- `leader-cockpit`

`Layout.tsx` 中的 `NavLink`、`navigate`、`location.pathname` 判断已改为适配 `/govinsight/*`。`DashboardHome.tsx` 与 `LeaderCockpit.tsx` 的跳转不再误跳主系统根路径。

## 8. 旧 `/govinsight#/*` URL 兼容策略

新增 `frontend/src/app/govInsightRoutes.js`：

- `resolveGovInsightLegacyHash(pathname, hash)` 将旧 hash URL 转为 browser route。
- `/govinsight#/report` -> `/govinsight/report`
- `/govinsight#/leader-cockpit` -> `/govinsight/leader-cockpit`
- `/govinsight#/report?year=2025` -> `/govinsight/report?year=2025`

兼容跳转在 `DashboardApp.tsx` 中使用 `navigate(target, { replace: true })`，避免浏览器后退循环。

## 9. 新 `/govinsight/*` URL 清单

- `/govinsight`
- `/govinsight/portrait`
- `/govinsight/operations`
- `/govinsight/risk`
- `/govinsight/policy`
- `/govinsight/benchmark`
- `/govinsight/report`
- `/govinsight/leader-cockpit`

未知 `/govinsight/*` 子路径会 replace 到 `/govinsight`。

## 10. returnTo / fallbackReturnTo 迁移说明

`returnTo` 逻辑未重写，继续复用：

- `resolveRouteReturnTo`
- `resolveSafeReturnTo`
- `appendReturnTo`

已保留既有安全策略：

- 拒绝外链。
- 拒绝 `//evil.com`。
- 拒绝反斜杠路径。
- 拒绝 `/print/*`。
- 未传或非法时使用 fallback。

页面返回逻辑现在由 React Router `navigate(returnTo)` 执行，不再直接操作 `window.history.pushState`。

## 11. 新增或调整测试说明

新增 `frontend/src/app/govInsightRoutes.test.js`，覆盖：

- `/govinsight#/report` 转 `/govinsight/report`。
- `/govinsight#/leader-cockpit` 转 `/govinsight/leader-cockpit`。
- `/govinsight#/report?year=2025` 转 `/govinsight/report?year=2025`。
- `/govinsight/report` 与 `/govinsight/leader-cockpit` 的 `navGroup` 仍为 `NAV_GROUPS.GOVINSIGHT`。

既有 `returnTo.test.js` 未改动，继续覆盖外链、protocol-relative、反斜杠、`/print/*` 拒绝。

## 12. build/test/smoke/strict-live 结果

第一段主系统 React Router 化后：

- `npm.cmd run build` passed。
- `npm.cmd test` passed，19 suites / 144 tests。
- `cd frontend && npm test -- --runInBand` passed，15 suites / 76 tests。
- `cd frontend && npm.cmd run build` passed。
- `npm.cmd run smoke:pdf` passed，4/4。

第二段 GovInsight 迁移后：

- `cd frontend && npm test -- --runInBand` passed，16 suites / 82 tests。
- `cd frontend && npm.cmd run build` passed。

总体验证：

- `npm.cmd run build` passed。
- `npm.cmd test` passed，19 suites / 144 tests。
- `cd frontend && npm test -- --runInBand` passed，16 suites / 82 tests。
- `cd frontend && npm.cmd run build` passed。
- `npm.cmd run smoke:pdf` passed，4/4。
- `npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001` passed，4/4。

## 13. 人工验证结果

使用本地 live frontend/backend 与浏览器自动化完成只读验证。

主系统：

- `/catalog`：AppShell 正常，导航高亮“年报工作台”。
- `/upload`：AppShell 正常，导航高亮“年报工作台”。
- `/jobs`：AppShell 正常，导航高亮“导出中心”。
- `/jobs?tab=download`：URL query 保留，导航高亮“导出中心”。
- `/jobs/4460?returnTo=/jobs?tab=download`：任务详情打开，返回后回到 `/jobs?tab=download`。
- `/history`：AppShell 正常，导航高亮“比对中心”。
- `/comparison/1143?returnTo=/history`：比对详情打开，返回后回到 `/history`。
- `/catalog/reports/4877?returnTo=/catalog`：报告详情打开，精确点击“返回上一层”后回到 `/catalog`。
- `/issues`：AppShell 正常，导航高亮“问题复核”。
- `/report-maintenance`：AppShell 正常，页面保留自身 `?year=2025` 行为，导航高亮“问题复核”。
- `/regions`：AppShell 正常，导航高亮“系统管理”。
- `/admin/users`：AppShell 正常，导航高亮“系统管理”。

浏览器历史：

- `/catalog -> /jobs -> /history` 后退到 `/jobs`、再后退到 `/catalog`、前进到 `/jobs` 正常。
- GovInsight 内部 `/govinsight -> /govinsight/operations -> /govinsight/report` 后退/前进正常。

GovInsight：

- `/govinsight` 正常打开，主导航高亮“智能治理”。
- `/govinsight/report` 正常打开，主导航高亮“智能治理”。
- `/govinsight/leader-cockpit` 正常打开，`body.leader-cockpit-mode` 生效。
- `/govinsight#/report` replace 到 `/govinsight/report`。
- `/govinsight#/leader-cockpit` replace 到 `/govinsight/leader-cockpit`。
- `/govinsight#/report?year=2025` replace 到 `/govinsight/report?year=2025`。
- GovInsight 内部导航 `/operations`、`/report` 正常切换。
- `/govinsight/report` 子导航仅高亮“智能辅策”，主导航高亮“智能治理”。

print routes：

- `/print/comparison/1143`：不进入 AppShell，不显示主导航，不显示登录页，`data-print-ready=true`。
- `/print/govinsight-report/city_721/2025`：不进入 AppShell，不显示主导航，不显示登录页，`data-govinsight-pdf-ready=true`。
- `/print/govinsight-report/721/2025`：不进入 AppShell，不显示主导航，不显示登录页，`data-govinsight-pdf-ready=true`。

## 14. 风险和遗留问题

- `App.js` 改动较集中，虽然行为已验证，但仍建议提交前重点 review 路由匹配顺序和 wrapper 参数传递。
- GovInsight 已从 HashRouter 迁移到主 Router，旧 hash URL 通过 replace 兼容；如外部仍有更复杂 hash 片段，需要后续按真实链接补充样本。
- LeaderCockpit 仍在 AppShell 子树内渲染，现有 CSS/`body.leader-cockpit-mode` 能隐藏/压制主应用外壳；本阶段未做 CSS 架构改造。

## 15. 是否建议合并

建议进入提交审核。当前自动验证、strict-live PDF smoke、浏览器路由验证均通过；未触碰禁止范围内的 PDF 后端、数据库 schema、legacy EJS、P2 smoke 脚本或 TaskDrawer。
