# 前端、体验与打印导出整改计划

计划日期：2026-05-19  
边界：本计划只针对前端一致性、用户体验和报告打印导出稳定性。P0 优先低风险、高收益；P1 做结构性改造；P2 做深层重构与测试体系。

## P0：低风险、高收益、快速落地

### P0-01 补齐 CSS 变量兼容层

- 目标：消除 15 类未定义 CSS 变量造成的样式失效。
- 涉及文件：`frontend/src/App.css`。
- 修改方式：在 `:root` 中新增旧 token alias，例如 `--bg-app: var(--color-bg-secondary)`、`--bg-surface: var(--color-bg-main)`、`--text-main: var(--color-text-primary)`、`--success`、`--warning`、`--danger`。
- 验收标准：静态扫描未定义变量从 15 类下降到仅剩运行时动态变量，如 `--pdf-total-pages`。
- 回归测试方式：`frontend npm run build`；重点打开 `/catalog`、`/upload`、`/jobs`、`/catalog/reports/:id`。
- 风险与回滚方案：低风险；若颜色变化不符合预期，回滚 alias 或改为更接近旧色值。

### P0-02 收敛 GovInsight print reset 作用域

- 目标：避免 GovInsight 的 print CSS 影响比对打印页和主应用打印。
- 涉及文件：`frontend/src/govinsight/tailwind.css`。
- 修改方式：将 `@media print` 中 `html/body/main/nav/header/footer/table` 等规则尽量限定到 `.gov-dashboard-root` 或 `#printable-report`，避免全局 `table` 和 `main` reset。
- 验收标准：GovInsight 页面打印仍可隐藏导航；比对打印页的 `@page comparison-landscape` 不被覆盖。
- 回归测试方式：生成或打开 `/print/govinsight-report/:orgId/:year`、`/print/comparison/:id`，检查页面方向和表格布局。
- 风险与回滚方案：中低风险；如果 GovInsight 浏览器打印退化，回滚该 CSS 并改为只在专用 print root 挂 class。

### P0-03 新增统一 Toast 与 Confirm 基础组件

- 目标：为替换 82 个 `alert` 和 22 个 `confirm` 建立公共能力。
- 涉及文件：新增 `frontend/src/components/common/ToastProvider.*`、`ConfirmDialogProvider.*`；接入 `frontend/src/App.js`。
- 修改方式：先提供 provider 和 hook，不批量替换全部业务调用；优先替换 PDF 导出成功/失败、下载失败、文件过期、表单校验失败。
- 验收标准：新组件可在任意页面调用；被替换操作不再触发浏览器原生弹窗。
- 回归测试方式：前端单测覆盖 Toast/Confirm；手动验证 `/history` 创建 PDF 任务、`/jobs?tab=download` 下载失败提示。
- 风险与回滚方案：低风险；保留旧 `alert` 调用不动，问题时只回滚 provider 接入和少量替换点。

### P0-04 梳理并标记 PDF 导出入口

- 目标：让团队明确当前推荐链路和旧链路，避免继续向旧 EJS PDF 扩展。
- 涉及文件：`src/routes/pdf-jobs.ts`、`src/services/PdfExportWorker.ts`、`src/routes/pdf-export.ts`、`src/services/PdfExportService.ts`、`src/views/comparison_report.ejs`、`src/routes/comparison-history.ts`、`src/routes/comparisons.ts`。
- 修改方式：增加代码注释和运行日志，标记 `/api/pdf-jobs` 为比对推荐链路，`PdfExportService`/EJS 为 legacy；不删除接口。
- 验收标准：代码搜索能明确看出主链路与 legacy 链路；前端入口不主动调用 legacy 链路。
- 回归测试方式：创建比对 PDF 任务、下载 PDF、批量 ZIP；确认旧接口仍可兼容调用。
- 风险与回滚方案：低风险；只加注释/日志和前端入口文案，不改生成逻辑。

### P0-05 比对 PDF 等待字体加载

- 目标：降低中文字体加载导致的表格宽度和分页抖动。
- 涉及文件：`src/routes/pdf-export.ts`、`src/services/PdfExportWorker.ts`。
- 修改方式：在 `waitForSelector(PRINT_READY_SELECTOR)` 后增加 `document.fonts.ready` 等待，与 GovInsight PDF 的处理保持一致。
- 验收标准：PDF 生成不因字体等待超时；中文标题和表格字体稳定。
- 回归测试方式：生成一份比对 PDF，检查文件大小、首页标题、表格页布局。
- 风险与回滚方案：低风险；若老浏览器环境不支持 `document.fonts`，使用 `document.fonts ? document.fonts.ready : Promise.resolve()`。

### P0-06 任务中心下载 tab 增强状态说明

- 目标：降低 PDF 文件过期、生成中、不可批量下载时的误解。
- 涉及文件：`frontend/src/components/JobCenter.js`、`JobCenter.css`。
- 修改方式：在下载 tab 顶部显示可下载数、生成中数、过期数；批量下载前用页面内提示替代 `alert`。
- 验收标准：用户可在批量下载前看到哪些任务不可下载；过期文件有“重新生成”入口。
- 回归测试方式：模拟 done/running/failed/expired 状态；验证批量下载按钮禁用和提示。
- 风险与回滚方案：低风险；只改展示，不改 `/api/pdf-jobs` 协议。

## P1：结构性改造

### P1-01 建立 AppShell 与导航 registry

- 目标：统一主应用导航、返回路径、权限可见性和页面标题。
- 涉及文件：`frontend/src/App.js`、`Logo.js`、各一级页面入口。
- 修改方式：将当前手写 `renderContent` 路由表整理为 route registry，AppShell 负责 header/nav/main/footer，详情页通过 `returnTo` 明确返回目标。
- 验收标准：所有一级页面从 registry 渲染；`ReportDetail` 不再依赖裸 `window.history.back()`。
- 回归测试方式：手动验证 `/catalog`、`/upload`、`/jobs`、`/history`、`/govinsight`、深链报告详情。
- 风险与回滚方案：中风险；保持 URL 不变，先只重排路由配置，不引入 React Router。

### P1-02 统一 Button、StatusBadge、DataTable、PageHeader

- 目标：解决按钮、状态 badge、表格、页面 header 风格割裂。
- 涉及文件：`CityIndex.js`、`JobCenter.js`、`ComparisonHistory.js`、`ReportMaintenance.js`、`ReportDetail.js`、对应 CSS。
- 修改方式：新增 `frontend/src/components/common/*`；先在低风险列表页接入，再逐步替换复杂报告详情。
- 验收标准：主按钮、危险按钮、次按钮、状态 badge 在核心页面视觉一致；重复 `.primary-btn`、`.status-badge` 使用下降。
- 回归测试方式：前端 build；页面截图对比；列表页操作 smoke test。
- 风险与回滚方案：中风险；逐页替换，每页可独立回滚。

### P1-03 建立导出中心 ExportPanel

- 目标：统一比对 PDF、GovInsight PDF、网页打印、批量下载入口。
- 涉及文件：`ComparisonDetailView.js`、`ComparisonHistory.js`、`ReportGenerator.tsx`、`JobCenter.js`。
- 修改方式：新增 `ExportPanel`，内部显示推荐导出方式、任务状态、打印预览、历史任务链接。
- 验收标准：用户从比对详情和 GovInsight 报告页看到一致的导出操作模型。
- 回归测试方式：创建单个 PDF 任务、GovInsight 同步 PDF、网页打印 fallback、批量下载。
- 风险与回滚方案：中风险；保留原按钮作为 fallback，先以新面板包裹旧逻辑。

### P1-04 抽统一 BrowserRenderer / PDF renderer

- 目标：减少 `pdf-export.ts`、`PdfExportWorker.ts`、`gov-insight-pdf.ts` 中重复 Puppeteer 逻辑。
- 涉及文件：新增 `src/services/report-export/BrowserRenderer.ts`；改造三个 PDF 路由/worker。
- 修改方式：抽 `findFrontendUrl`、`launchBrowser`、`injectAuth`、`waitReady`、`waitFonts`、`stabilizeCharts`、`pdfOptions`。
- 验收标准：比对同步 PDF、比对异步 PDF、GovInsight PDF 共用基础 renderer；行为不变。
- 回归测试方式：分别生成三类 PDF；检查页数、标题、文件大小和日志。
- 风险与回滚方案：中高风险；先抽无行为变化的 helper，再切一条链路，保留旧实现。

### P1-05 长表格分页策略

- 目标：提高 table_2/table_3/table_4 和 GovInsight 长表格在 PDF 中的稳定性。
- 涉及文件：`ComparisonPrintView.css`、`GovInsightReportPrintView.css`、`GovDataTable.css`、`TableViews.js`。
- 修改方式：按表格类型定义分页策略：可断页表格允许 `break-inside: auto`，小卡片和标题块才 `avoid`；避免全表整体 `avoid`。
- 验收标准：长 table_3 不截断，不产生大面积空白页；标题不孤行。
- 回归测试方式：长表格样本 PDF 视觉检查；PDF 文本检查无 `null/undefined`。
- 风险与回滚方案：中风险；仅在 print root 下改规则，保留屏幕表格样式。

## P2：深层重构与测试体系

### P2-01 统一路由体系

- 目标：消除主应用手写 pushState 与 GovInsight HashRouter 的双路由体系。
- 涉及文件：`frontend/src/App.js`、`frontend/src/index.js`、`frontend/src/govinsight/DashboardApp.tsx`、`Layout.tsx`。
- 修改方式：引入统一 React Router 结构，GovInsight 改为主路由子树，保留旧 hash URL 重定向兼容。
- 验收标准：所有页面可深链；浏览器返回一致；权限与导航高亮一致。
- 回归测试方式：端到端路由 smoke test；常用深链回归。
- 风险与回滚方案：高风险；需要单独里程碑和完整回归，短期不建议立即做。

### P2-02 统一 ReportExportService 架构

- 目标：让所有报告导出都走统一 job、renderer、adapter、下载中心。
- 涉及文件：`src/routes/pdf-jobs.ts`、`src/routes/gov-insight-pdf.ts`、`src/routes/pdf-export.ts`、`src/services/PdfExportWorker.ts`、`PdfExportService.ts`。
- 修改方式：新增 `report_exports` 抽象或复用 `jobs` 扩展字段；比对、GovInsight、legacy EJS 都实现 adapter。
- 验收标准：所有导出任务在同一中心可见；同步导出可转任务；失败原因统一。
- 回归测试方式：PDF 单导出、批量导出、过期重生成、权限过滤、GovInsight 目录页码。
- 风险与回滚方案：高风险；保留旧接口并做兼容层，按报告类型逐步迁移。

### P2-03 视觉回归与 PDF 回归测试

- 目标：把 UI 一致性和 PDF 分页稳定性纳入自动化。
- 涉及文件：新增 Playwright/Puppeteer 测试脚本、PDF 渲染检查脚本、测试 fixtures。
- 修改方式：建立核心页面截图基线和 PDF 样本矩阵；对 PDF 页数、关键文本、截图做断言。
- 验收标准：CI 或本地命令可生成报告，明确指出视觉/PDF 差异。
- 回归测试方式：`frontend npm run build` 后运行浏览器 smoke；PDF 样本生成并检查。
- 风险与回滚方案：中风险；测试先作为非阻塞报告运行，稳定后再进入 gate。

### P2-04 CSS 架构迁移

- 目标：从“全局 CSS + 组件 CSS + Tailwind 混合”迁移到明确分层。
- 涉及文件：`frontend/src/App.css`、`frontend/src/components/*.css`、`frontend/src/govinsight/tailwind.css`。
- 修改方式：建立 `tokens.css`、`base.css`、`components.css`、`print.css`；旧页面逐步迁移，Tailwind 只在 GovInsight 或全站统一配置中使用。
- 验收标准：全局选择器数量显著下降；重复 class 降低；print CSS 独立。
- 回归测试方式：静态扫描 + 页面截图 + 打印预览。
- 风险与回滚方案：高风险；必须按页面迁移，每次只改一个模块。

## 建议执行顺序

1. 先做 P0-01、P0-02、P0-04、P0-05：这些直接降低样式和 PDF 风险，改动面小。
2. 再做 P0-03、P0-06：改善用户反馈，减少浏览器原生弹窗。
3. P1 从 `ExportPanel` 和公共 `StatusBadge/Button` 开始，因为收益最容易被用户感知。
4. P2 暂不立即启动，等 P0/P1 让链路稳定后再做路由和导出服务统一。

## 是否建议立即进入代码整改

建议立即进入 P0 代码整改，但不建议直接做 P1/P2 大改。

理由：

- P0 的变量 alias、print reset scope、字体等待、入口标记都是低风险且能明显降低当前不稳定性的事项。
- P1 涉及组件抽象和导出中心，会影响多页面交互，应在 P0 完成并验证后单独排期。
- P2 属于架构迁移，需要测试样本和验收基线先到位。

