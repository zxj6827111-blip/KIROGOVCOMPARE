# UI 一致性审计

审计日期：2026-05-19  
审计范围：`frontend/src` 与本轮点名的前端入口、组件、CSS 文件。静态统计排除了 `node_modules`、`dist`、`build`、`coverage`、`.worktrees`。

## 一、量化结果

| 指标 | 结果 | 说明 |
| --- | ---: | --- |
| CSS 文件数量 | 34 | 仅统计 `frontend/src/**/*.css` |
| 全局选择器命中 | 32 | 包括 `body`、`table`、`th`、`td`、`input`、`main`、`nav`、`header`、`footer` 等 |
| 重复 class 名称 | 153 类 | 以“同名 class 出现在多个 CSS 文件”为准，需人工区分复用意图与冲突 |
| 未定义 CSS 变量 | 15 类 | 多数为旧设计变量，如 `--bg-app`、`--bg-surface`、`--text-main` |
| 前端 inline style | 137 处 | `JobCenter.js` 24、`CityIndex.js` 17、`ReportDetail.js` 13 最集中 |

CSS 体量最大的文件：

| 文件 | 行数 | 风险 |
| --- | ---: | --- |
| `frontend/src/components/print/GovInsightReportPrintView.css` | 2154 | PDF 专用样式复杂，分页规则多，回归成本高 |
| `frontend/src/components/GovDataTable.css` | 1412 | 表格、问题高亮、内容页共享，容易被全局表格规则影响 |
| `frontend/src/components/ReportDetail.css` | 1418 | 报告详情主页面，含 `@media print` 与表格局部规则 |
| `frontend/src/components/ReportMaintenance.css` | 814 | 维护页抽屉、筛选、表格自成体系 |
| `frontend/src/components/ComparisonHistory.css` | 768 | 比对结果列表与导出操作样式独立 |
| `frontend/src/components/ConsistencyCheckView.css` | 843 | 问题管理、质量提示、状态 badge 独立 |

## 二、页面样式体系分布

### 旧版 CSS 页面

这些页面主要依赖组件级 `.css` 文件和 `App.css` 全局变量：

| 页面 / 功能 | 入口 | 样式文件 |
| --- | --- | --- |
| 主应用框架、顶部导航 | `frontend/src/App.js` | `frontend/src/App.css` |
| 年报目录 / 城市索引 | `frontend/src/components/CityIndex.js` | `CityIndex.css` |
| 批量上传 | `frontend/src/components/BatchUpload.js` | `BatchUpload.css` |
| 报告详情 / 发布复核 | `frontend/src/components/ReportDetail.js` | `ReportDetail.css`、`GovDataTable.css`、`ConsistencyCheckView.css` |
| 比对历史 | `frontend/src/components/ComparisonHistory.js` | `ComparisonHistory.css` |
| 比对详情 | `frontend/src/components/ComparisonDetailView.js` | `ComparisonDetailView.css` |
| 任务中心 | `frontend/src/components/JobCenter.js` | `JobCenter.css` |
| 报告维护 | `frontend/src/components/ReportMaintenance.js` | `ReportMaintenance.css` |
| 区域管理 | `frontend/src/components/RegionsManager.js` | `RegionsManager.css` |
| 用户管理 | `frontend/src/components/UserManagement.js` | 复用 `JobCenter.css`，且文件内还有内联 `<style>` |
| 数据中心 | `frontend/src/components/datacenter/*.js` | `DataCenter*.css` |

### Tailwind 页面

这些页面主要使用 Tailwind utility class，由 `frontend/src/govinsight/DashboardApp.tsx` 引入 `frontend/src/govinsight/tailwind.css`：

| 页面 / 功能 | 入口 | 特征 |
| --- | --- | --- |
| GovInsight 总览 | `frontend/src/govinsight/views/DashboardHome.tsx` | Tailwind 布局、卡片、图表 |
| 精准画像 / 履职效能 / 风险 / 制度 / 对标 | `frontend/src/govinsight/views/*.tsx` | Tailwind + Recharts |
| 智能辅策报告 | `frontend/src/govinsight/views/ReportGenerator.tsx` | Tailwind 密集，静态扫描命中 153 处 utility class |
| GovInsight 内部 Layout | `frontend/src/govinsight/components/Layout.tsx` | Tailwind 导航、实体选择器、HashRouter 子路由 |
| Leader Cockpit | `frontend/src/govinsight/leader-cockpit/**/*.tsx` | Tailwind + modal/drawer 组件 |

### 混合使用页面

| 文件 | 混合点 | 风险 |
| --- | --- | --- |
| `frontend/src/components/ComparisonDetailView.js` | 导入 `ComparisonDetailView.css`，同时大量使用 Tailwind-like class | 表格、打印、页面态可能受双体系影响 |
| `frontend/src/components/print/ComparisonPrintView.js` | 导入 `ComparisonDetailView.css` 和 `ComparisonPrintView.css`，同时使用 utility class | 打印页继承屏幕态比对样式，存在打印污染风险 |
| `frontend/src/components/TableViews.js` | 导入 `GovDataTable.css`，同时使用 utility class 和 inline style | 内容页、比对页、打印页共用表格组件，样式影响面大 |
| `frontend/src/components/RegionsManager.js` | `RegionsManager.css` + Tailwind-like class | 管理页 UI 风格与主 App 按钮/表格不完全一致 |
| `frontend/src/components/UserManagement.js` | 复用 `JobCenter.css`，文件内内联 `<style>` | 低复用但高耦合，后续改 JobCenter 可能误伤用户管理 |

## 三、全局样式污染点

### `frontend/src/App.css`

确认存在以下全局规则：

- `*` reset 全局 margin/padding/box-sizing。
- `body` 全局字体、背景、行高。
- `h2`、`p` 全局标题和段落样式。
- `input, select, textarea` 全局表单样式。
- `table`、`th`、`td`、`tr:hover td` 全局表格样式。
- `@media print` 全局隐藏 `.header`、`.nav`、`.footer`，并重置 `.main`。

影响：

- GovInsight 与打印页虽然有局部 class，但仍可能继承 `App.css` 的 `body`、`table`、`th`、`td`、`p`。
- 所有业务表格默认会获得同一 hover、padding、uppercase 表头规则，导致 `GovDataTable.css`、`ComparisonPrintView.css`、PDF 表格需用更强选择器覆盖。
- 全局 `@media print` 与 `govinsight/tailwind.css`、两套 print view CSS 的 `@page`/print reset 并存，增加打印链路不确定性。

### `frontend/src/govinsight/tailwind.css`

确认存在 `@media print` 下的全局规则：

- `html, body` 被设为 `210mm`、`297mm`。
- `nav, header, footer` 全局隐藏。
- `main` 和 `main > div` 全局重置。
- `table` 全局 `break-inside: avoid`。
- `@page { size: A4 portrait; margin: 0; }`。

影响：

- 该文件只由 GovInsight 模块引入，但 webpack 打包后 CSS 仍可能进入同一页面样式表；打印时如果不严格限定 `.gov-dashboard-root`，会影响主应用打印、比对打印页和 EJS/React 打印页。
- `table { break-inside: avoid !important; }` 对长表格不友好，容易让长表格整体挤压或产生空白页。

### 打印专用 CSS

| 文件 | 污染点 |
| --- | --- |
| `ComparisonPrintView.css` | 同时定义全局 `@page` 和 `@media print html, body`，但主体基本围绕 `.comparison-print-page` |
| `GovInsightReportPrintView.css` | 顶层定义 `:root` PDF 变量和全局 `@page`，但组件主体用 `.pdf-document-shell` 收敛 |
| `ReportDetail.css` | 含 `@media print`，需要确认是否仍用于页面打印 |
| `ComparisonDetailView.css` | 含 `@media print`，又被 `ComparisonPrintView.js` 直接导入 |

## 四、重复 class 与设计变量问题

### 高风险重复 class

| class | 出现文件数 | 风险 |
| --- | ---: | --- |
| `.active` | 12 | 各页面语义不同，未来抽公共组件或样式压缩后容易互相覆盖 |
| `.error` | 10 | 错误态视觉不统一，颜色、间距、字体可能不同 |
| `.alert` | 6 | 页面内提示与浏览器 alert 混用，语义和视觉割裂 |
| `.progress-fill` | 5 | 上传、任务、维护等进度条样式分散，动效和颜色不一致 |
| `.status-badge` | 5 | 任务、报告、比对状态 badge 没有统一状态字典 |
| `.primary-btn` / `.btn-primary` | 4 / 3 | 主按钮命名和状态不统一 |
| `.card` | 3 | 卡片语义过宽，容易与页面 section 混淆 |

### 未定义变量

集中缺口：

- 背景：`--bg-app`、`--bg-secondary`、`--bg-surface`、`--bg-surface-hover`
- 文字：`--text-main`、`--text-muted`
- 语义色：`--success`、`--warning`、`--danger`、`--secondary`
- 边框：`--border-color`
- 圆角：`--radius-full`

影响：

- 浏览器遇到无 fallback 的 `var(--xxx)` 会让对应属性失效，导致页面退回默认样式。
- 不同页面已在使用旧 token 名称，但 `App.css` 定义的是 `--color-bg-main`、`--color-text-primary`、`--primary` 等新 token，说明设计 token 迁移不完整。

## 五、问题清单

| 编号 | 问题 | 涉及文件 | 影响范围 | 修复建议 | 适合低风险先修 |
| --- | --- | --- | --- | --- | --- |
| UI-01 | 全局 `table/th/td/tr:hover` 规则污染业务表格和打印表格 | `App.css` | 全站表格、报告详情、比对、打印页 | 先新增 scoped 表格基类，逐步把全局表格规则收敛到 `.app-table`；短期给 print root 增加强隔离 | 否，需分阶段 |
| UI-02 | `govinsight/tailwind.css` 的 print reset 作用域过大 | `govinsight/tailwind.css` | GovInsight 打印、比对打印、主应用打印 | 将 `@media print` 中 `html/body/main/nav/header/footer/table` 规则收敛到 `.gov-dashboard-root` 或专用 print root | 是 |
| UI-03 | 旧 token 与新 token 并存，15 类 CSS 变量未定义 | `App.css`、多个组件 CSS | 按钮、卡片、表格、提示色 | 在 `:root` 补兼容 alias，后续再迁移调用方 | 是 |
| UI-04 | `active/error/alert/status-badge/progress-fill` 等 class 名称重复且语义不统一 | 多个组件 CSS | 导航、状态、任务、错误提示 | 建立 `ui-*` 公共命名和状态字典，旧 class 保留兼容期 | P1 |
| UI-05 | `UserManagement.js` 复用 `JobCenter.css` 且内联大量样式 | `UserManagement.js`、`JobCenter.css` | 用户管理、任务中心 | 抽公共管理页表格/表单样式或单独 `UserManagement.css` | 是 |
| UI-06 | 137 处 inline style 分散在关键页面 | `JobCenter.js`、`CityIndex.js`、`ReportDetail.js` 等 | 响应式、打印、主题一致性 | 先替换布局型和状态型 inline style，保留动态宽度/颜色等必要场景 | P1 |
| UI-07 | 主应用使用手写 pushState 路由，GovInsight 使用 HashRouter 子路由 | `App.js`、`DashboardApp.tsx` | 导航高亮、浏览器返回、深链、打印路径 | P1 先建 AppShell 和 route registry，P2 再统一路由体系 | P1/P2 |
| UI-08 | 旧版 CSS 与 Tailwind 视觉语言不同 | `App.css`、`govinsight/tailwind.css`、GovInsight views | 主业务与智能治理模块切换割裂 | 先统一 token：颜色、字体、按钮、表格、卡片、间距；不立即重写全部页面 | P1 |
| UI-09 | 打印页导入屏幕态 CSS | `ComparisonPrintView.js` 导入 `ComparisonDetailView.css` | 比对 PDF 导出 | 去掉不必要屏幕态依赖或建立 `comparison-shared.css` 明确共享范围 | P1 |
| UI-10 | 多处表格/按钮/卡片组件没有公共抽象 | `CityIndex`、`JobCenter`、`ComparisonHistory`、`ReportMaintenance` | 列表页和管理页 | 抽 `Button`、`StatusBadge`、`DataTable`、`EmptyState`、`PageHeader` | P1 |

## 六、建议先修范围

低风险优先顺序：

1. 在 `App.css` `:root` 补旧 token alias：`--bg-app`、`--bg-surface`、`--text-main`、`--success` 等。
2. 将 `govinsight/tailwind.css` 的 print reset 收敛到 `.gov-dashboard-root`，避免影响非 GovInsight 打印。
3. 为原生 `alert`/`confirm` 改造做准备：先新增统一 `Toast`、`ConfirmDialog` 设计，不批量替换业务逻辑。
4. 把 `UserManagement.js` 从 `JobCenter.css` 中拆出，降低管理页样式耦合。
5. 给打印页 root 增加稳定隔离约定：`.comparison-print-page`、`.pdf-document-shell` 内的表格和字体规则优先级固定。

