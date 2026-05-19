# P1 Report Flow Export Panel Report

## 1. 修改文件清单

新增：

- `frontend/src/components/common/Button.js`
- `frontend/src/components/common/PageHeader.js`
- `frontend/src/components/common/StatusBadge.js`
- `frontend/src/components/common/common-ui.css`
- `frontend/src/components/ReportFlowStatusBar.js`
- `frontend/src/components/ReportFlowStatusBar.css`
- `frontend/src/components/ReportFlowStatusBar.test.js`
- `frontend/src/components/ExportPanel.js`
- `frontend/src/components/ExportPanel.css`

修改：

- `frontend/src/components/ReportDetail.js`
- `frontend/src/components/ReportDetail.css`
- `frontend/src/components/ComparisonDetailView.js`
- `frontend/src/components/ComparisonDetailView.css`
- `frontend/src/components/ComparisonHistory.js`
- `frontend/src/components/ComparisonHistory.css`
- `frontend/src/components/JobCenter.js`

同时已生成基线报告：

- `P0_FINAL_BASELINE_REPORT.md`

本轮未修改后端接口、数据库 schema、PDF 后端、路由体系或权限逻辑。

## 2. 状态条判断逻辑

报告详情页新增 `ReportFlowStatusBar`，只读取现有 `report`、`active_version`、`pending_review_version`、`latest_job` 信息，不新增接口。

判断顺序如下：

1. 存在 `pending_review_version`：展示为 `待复核`，已完成 `已上传 / 已解析`，下一步按钮为 `处理问题`，跳转到勾稽复核区域。
2. `active_version.review_status === 'published'`：展示为 `可比对`，已完成 `已上传 / 已解析 / 待复核 / 待发布 / 已发布`，下一步按钮为 `生成比对`。报告详情接口没有直接提供已比对或导出任务状态，因此不编造 `可导出`。
3. 当前工作版本存在可确认解析内容：展示为 `待发布`，下一步按钮为 `发布工作版本`。
4. 最新解析任务处于 `queued / processing / running`：展示为 `解析中`，不展示可执行下一步。
5. 其他情况：保守展示为 `已上传`，下一步按钮为 `自动解析`。

## 3. ExportPanel 交互说明

新增 `ExportPanel`，当前接入：

- 比对详情页顶部标题区。
- 比对详情页正文操作区。
- 比对历史页展开后的行级操作区。
- 比对历史页批量选择后的批量导出区。

交互规则：

- 正式 PDF 导出仍调用现有 `/api/pdf-jobs` 异步任务接口。
- 原“网页打印”入口在新面板中命名为 `打印预览`，定位为辅助能力。
- PDF 任务创建成功后使用现有 Toast，并提供 `查看导出任务` 操作入口。
- 旧按钮逻辑未删除，仅在 P1 第一轮通过新面板包裹和样式隐藏旧入口，方便回滚。

## 4. 公共组件说明

本轮新增轻量公共组件：

- `PageHeader`：统一标题、副标题、状态标签、主操作区。
- `StatusBadge`：统一状态标签视觉，支持 `neutral / info / success / warning / danger`。
- `Button`：统一主要按钮、次要按钮、幽灵按钮和危险按钮基础样式。

接入范围严格限制在：

- 报告详情页。
- 比对详情页。
- 比对历史页。
- 任务中心下载 tab。

未做全站替换，也未引入大型 UI 库。

## 5. Build / Test 结果

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| `npm.cmd run build` | 通过 | 根目录 TypeScript 构建通过。 |
| `npm.cmd test` | 通过 | 18 个 test suites、137 个 tests 通过；保留既有 `JWT_SECRET` / bcrypt 测试日志。 |
| `frontend/npm.cmd run build` | 通过 | 前端 typecheck 和 production webpack build 通过；仅有既有 bundle size warning。 |
| `frontend/npm.cmd test` | 通过 | 14 个 test suites、65 个 tests 通过，新增状态条判断测试。 |

## 6. 人工验证结果

本地服务：

- 后端：`http://127.0.0.1:8787/api/health` 返回 `ok`，数据库连接正常。
- 前端：`http://127.0.0.1:3001` 可访问。

页面验证：

| 路径 | 结果 | 关键可见信号 |
| --- | --- | --- |
| `/catalog` | 通过 | 年报汇总页正常加载。 |
| `/catalog/reports/4877` | 通过 | `PageHeader`、`StatusBadge`、`ReportFlowStatusBar` 可见；样本展示 `待复核` 与 `处理问题`。 |
| `/history` | 通过 | `PageHeader`、状态标签、`查看导出任务` 可见；展开 `宿迁市 / 沭阳县 / 沭阳县人民政府办公室` 后，行级 `ExportPanel`、`生成 PDF`、`打印预览`、`查看导出任务` 可见。 |
| `/comparison/1143` | 通过 | 比对详情标题区、状态标签、`生成 PDF`、`打印预览`、`查看导出任务` 可见；正文操作区也接入 `ExportPanel`。 |
| `/jobs?tab=download` | 通过 | 任务中心下载 tab 正常加载；下载任务统计、状态标签、下载/重试/删除入口可见。 |

人工验证只读页面和接口，未触发导出、删除、发布、重新生成或批量操作。

## 7. 风险与回滚方案

风险：

- 报告详情接口当前不提供完整比对和导出状态，所以状态条不会主动标记 `可导出`，避免误导用户。
- 比对历史页是树形懒加载结构，行级导出入口只有展开到具体比对记录后才出现。
- 旧按钮逻辑仍保留但被新样式隐藏，短期内 DOM 中会同时存在旧入口和新入口。

回滚方案：

- 移除 `ReportFlowStatusBar` 在 `ReportDetail.js` 的接入即可恢复报告详情页状态条前的行为。
- 移除 `ExportPanel` 在 `ComparisonDetailView.js` / `ComparisonHistory.js` 的接入，并删除对应隐藏旧按钮的 CSS，即可恢复旧导出入口。
- 移除 `PageHeader` / `StatusBadge` / `Button` 在四个页面的接入，即可回退到原页面标题和按钮样式。
- 所有改动均为前端展示层，无需数据库回滚或后端接口回滚。

## 8. 是否建议进入下一轮 P1

建议进入下一轮 P1。

本轮已完成 P1 第一轮限定范围：报告详情流程状态条、ExportPanel 初步统一、轻量公共组件局部收敛，并通过自动验证和关键页面人工验证。下一轮建议优先补齐更精确的“已比对 / 可导出”来源，例如在不改 schema 的前提下，从已有比对历史和 PDF 任务接口做页面级只读聚合展示。
