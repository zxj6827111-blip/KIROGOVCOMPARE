# P3-4 UI Components and CSS Architecture Report

## 1. 修改文件清单

- `frontend/src/App.js`
- `frontend/src/App.css`
- `frontend/src/components/app/AppShell.js`
- `frontend/src/components/common/common-ui.css`
- `frontend/src/components/common/Button.js`（继续复用，无行为改动）
- `frontend/src/components/common/StatusBadge.js`（继续复用，无行为改动）
- `frontend/src/components/common/PageHeader.js`（继续复用，无行为改动）
- `frontend/src/components/common/DataTable.js`
- `frontend/src/components/common/EmptyState.js`
- `frontend/src/components/common/ErrorState.js`
- `frontend/src/components/common/Modal.js`
- `frontend/src/components/common/common-ui.test.js`
- `frontend/src/components/JobCenter.js`
- `frontend/src/components/ComparisonHistory.js`
- `frontend/src/components/CompareFailureModal.js`
- `frontend/src/components/CompareFailureModal.css`
- `frontend/src/components/ReportDetail.css`
- `frontend/src/components/print/GovInsightReportPrintView.css`
- `frontend/src/styles/tokens.css`
- `frontend/src/styles/base.css`
- `frontend/src/styles/components.css`
- `frontend/src/styles/print.css`

## 2. CSS 架构审计

P3-4 前主要问题集中在 `frontend/src/App.css`：设计 token、base reset、主系统兼容布局、全局 input/select/textarea、全局 table/th/td、全局 print 规则混在同一文件中。由于 React 单页应用 CSS 全局生效，这些规则可能影响 GovInsight Tailwind 页面、comparison print 页面和 GovInsight print 页面。

审计后确认：

- `App.css` 中的全局 `table/th/td` 已移除，不再作为全站默认表格样式。
- `ReportDetail.css` 原有裸 `table`、`td`、`tr:last-child td` 已收窄到 `.report-detail`。
- `ReportDetail.css` 原有打印隐藏 `.actions` 已收窄到 `.report-detail .actions`。
- `GovInsightReportPrintView.css` 的 PDF 专用变量从全局 `:root` 收窄到 `.pdf-document-shell, .pdf-loading`。
- GovInsight Tailwind 已禁用 preflight，本阶段保留该边界，并补充 AppShell 路由 class 避免主系统兼容表单样式覆盖 GovInsight 页面。

## 3. tokens/base/components/print 设计

- `styles/tokens.css`：集中保存颜色、字体、阴影、半径、兼容 token。保留既有变量名如 `--bg-app`、`--text-main`、`--border-color`，避免破坏历史页面。
- `styles/base.css`：只保留全局最低限度规则，包括 box sizing、body 字体/背景、表单字体继承、滚动条和 `.app/.app-loading`。
- `styles/components.css`：承载 `kc-*` 公共组件样式，包括 Button、StatusBadge、PageHeader、DataTable、EmptyState、ErrorState、Modal。
- `styles/print.css`：只处理主系统 AppShell 打印隐藏和主系统打印容器复位，全部限定在 `.main-system-scope` 下，避免影响独立 print routes。

## 4. 公共组件收敛说明

本阶段采用渐进收敛，不重写全站页面。公共组件样式统一进入 `kc-*` 命名空间，避免继续增加裸元素选择器。

已接入代表性页面：

- `JobCenter` 使用 `DataTable` 和 `EmptyState` 承载上传解析任务表、下载任务表和空状态。
- `ComparisonHistory` 使用 `DataTable`、`EmptyState`、`ErrorState` 承载历史表格、空状态和加载错误。
- `CompareFailureModal` 使用 `Modal`、`DataTable`、`EmptyState`、`Button` 承载失败任务弹窗。

## 5. Button/StatusBadge/PageHeader/DataTable/EmptyState/ErrorState/Modal 收敛说明

- Button：沿用已有 `Button.js`，样式迁移到 `styles/components.css`。
- StatusBadge：沿用已有 `StatusBadge.js`，样式迁移到 `styles/components.css`。
- PageHeader：沿用已有 `PageHeader.js`，样式迁移到 `styles/components.css`。
- DataTable：新增 `components/common/DataTable.js`，提供 `kc-data-table` 和横向滚动容器。
- EmptyState：新增 `components/common/EmptyState.js`，统一空状态标题、描述、操作区。
- ErrorState：新增 `components/common/ErrorState.js`，统一错误状态标题、说明、操作区。
- Modal：新增 `components/common/Modal.js`，统一弹窗背景、头部、关闭按钮、主体、底部区域。
- 测试：新增 `common-ui.test.js` 覆盖公共组件基础渲染和 Modal 关闭行为。

## 6. print 样式隔离说明

主系统打印规则移动到 `styles/print.css` 并限定在 `.main-system-scope` 内，仅隐藏主系统 AppShell、TaskDrawer、Toast、ConfirmDialog 和通用 Modal。

独立打印路由仍在 `AuthenticatedApp` 外：

- `/print/comparison/:id`
- `/print/govinsight-report/:orgId/:year`

浏览器检查确认两个 print route 均没有 `.app-shell`、`.main-system-scope`、`.task-drawer-trigger`。

## 7. GovInsight 样式边界说明

GovInsight 继续由 `.gov-dashboard-root` 承载 Tailwind 区域，`tailwind.config.js` 保持 `preflight: false`。本阶段新增 AppShell 路由 class：

- `/govinsight*` 下 AppShell 根节点带 `app-shell--govinsight`。
- 主系统兼容 input/select/textarea 样式限定为 `.main-system-scope:not(.app-shell--govinsight)`。

这样主系统兼容表单样式不会继续覆盖 GovInsight 页面，GovInsight 自身 Tailwind classes 仍由 `.gov-dashboard-root` 内部控制。

## 8. 防污染策略

- 不再使用 `App.css` 裸 `table/th/td`。
- 主系统打印隐藏规则限定在 `.main-system-scope`。
- TaskDrawer、Toast、ConfirmDialog、Modal 等由 Provider 渲染在 AppShell 兄弟层级的浮层，打印隐藏规则使用真实全局类名 `.task-drawer-trigger/.task-drawer/.ui-toast-viewport/.ui-confirm-backdrop/.kc-modal-backdrop`。
- ReportDetail 页面表格和打印隐藏规则限定在 `.report-detail`。
- GovInsight PDF 变量限定在 `.pdf-document-shell, .pdf-loading`。
- GovInsight AppShell 区域使用 `app-shell--govinsight`，避免主系统兼容表单规则覆盖。
- 公共组件统一使用 `kc-*` 前缀。

## 9. 未改动的业务逻辑

未改动后端接口、数据库 schema、PDF 生成服务、PDF smoke 脚本、legacy EJS、旧接口和 Router 结构。

未改动以下受保护路径：

- `/api/pdf-jobs`
- `/api/comparisons/:id/pdf`
- `/api/gov-insight/report-pdf`
- `/print/comparison/:id`
- `/print/govinsight-report/:orgId/:year`
- `scripts/pdf-smoke-baseline.js`

P3-5 范围内的剩余 `alert/confirm` 未在本阶段替换。

## 10. build/test/smoke/strict-live 结果

- `git diff --check`：通过。
- CSS 变量静态检查：39 个 CSS 文件，104 个变量定义，1112 个变量使用，未定义变量 0。
- `npm.cmd run build`：通过。
- `npm.cmd test`：通过，19 suites / 144 tests。
- `cd frontend && npm test -- --runInBand`：通过，18 suites / 87 tests。
- `cd frontend && npm.cmd run build`：通过。
- `npm.cmd run smoke:pdf`：通过，4/4，strictLive=false。
- `npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001`：通过，4/4，strictLive=true。
- 审核修正后复验：`git diff --check`、`cd frontend && npm test -- --runInBand common-ui.test.js`、`cd frontend && npm.cmd run build` 均通过。

## 11. 人工验证结果

本地浏览器只读观察：

- `/catalog`：可打开，AppShell 可见，TaskDrawer 触发按钮可见。
- `/upload`：可打开，AppShell 可见，TaskDrawer 触发按钮可见。
- `/jobs`：可打开，表格可见，TaskDrawer 触发按钮可见。
- `/jobs?tab=download`：可打开，下载任务表格可见，TaskDrawer 触发按钮可见。
- `/history`：可打开，历史表格可见，TaskDrawer 触发按钮可见。
- `/govinsight`：可打开，`.gov-dashboard-root` 可见，AppShell 带 `app-shell--govinsight`。
- `/govinsight/report`：可打开，GovInsight 报告页可见，AppShell 带 `app-shell--govinsight`。
- `/govinsight/leader-cockpit`：可打开，`.gov-dashboard-root` 可见，`.task-drawer-trigger` 为 0。
- `/print/comparison/4670`：可打开，`.comparison-print-page` 可见，AppShell/TaskDrawer 为 0。
- `/print/govinsight-report/city_721/2025`：可打开，14 个 `.pdf-page`，AppShell/TaskDrawer 为 0。
- `/print/govinsight-report/721/2025`：可打开，14 个 `.pdf-page`，AppShell/TaskDrawer 为 0。

说明：`/comparison/:id` 和 `/catalog/reports/:id` 的打印/PDF 主链路已由 smoke 和 strict-live 覆盖，未做业务逻辑改动。

## 12. 风险和遗留问题

- 本阶段没有逐页替换所有旧页面 class，仅先完成架构边界和代表性公共组件接入，避免变成全站重写。
- `alert/confirm` 仍有遗留，按计划留给 P3-5。
- 部分页面仍有页面级表格样式，但已避免从 `App.css` 继续全局污染。
- smoke 环境缺少 `pdfinfo/pdftoppm/ImageMagick/Ghostscript`，像素级渲染检查降级；pdfjs 文本和页数检查通过。

## 13. 是否建议合并

建议进入提交审核。当前修改保持在 P3-4 范围内，自动验证和 live 观察均通过，未触碰受保护后端接口、数据库 schema、legacy EJS 或 PDF smoke 脚本。
