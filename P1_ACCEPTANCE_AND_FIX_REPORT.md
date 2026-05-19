# P1 合并前验收补测与小修复报告

## 1. 实际触发过的操作

| 页面 | 操作 | 结果 |
| --- | --- | --- |
| `/comparison/1143` | 点击 `生成 PDF` | 通过。实际调用 `/api/pdf-jobs` 创建任务，Toast 显示“PDF 导出任务已创建”，入口文案为“查看导出任务”。 |
| `/comparison/1143` | 点击 `查看导出任务` | 通过。跳转到 `/jobs?tab=download`。下载 tab 可见新建任务标题。 |
| `/comparison/1143` | 点击 `打印预览` | 通过。打开 `/print/comparison/1143?...`；直接验证 `/print/comparison/1143?autoPrint=false` 时 `body[data-comparison-print-ready=true]` 与 `#comparison-content[data-print-ready=true]` 均正常。 |
| `/history` | 展开地区到行级比对记录并点击 `生成 PDF` | 通过。行级 ExportPanel 创建 PDF 任务，Toast 与任务中心入口正常。 |
| `/history` | 勾选 2 条可用比对记录并点击批量 `生成 PDF (2)` | 通过。创建 2 个 PDF 任务，Toast 显示“成功 2 个，失败 0 个”，未出现前端控制台错误。 |
| `/jobs?tab=download` | 查看下载任务 tab | 通过。URL tab 正确，下载任务页显示本轮任务标题与完成状态。 |

## 2. PDF job_id

| 来源 | job_id | comparison_id | 状态 |
| --- | --- | --- | --- |
| `/comparison/1143` 详情页生成 PDF | `18388` | `1143` | `done`, `file_exists=true` |
| `/comparison/1143` 早前详情页补测生成 PDF | `18387` | `1143` | `done`, `file_exists=true` |
| `/history` 行级生成 PDF | `18389` | `26` | `done`, `file_exists=true` |
| `/history` 批量导出第 1 条 | `18390` | `26` | `done`, `file_exists=true` |
| `/history` 批量导出第 2 条 | `18391` | `25` | `done`, `file_exists=true` |

## 3. 重复入口与隐藏旧按钮风险

- 已检查并移除比对详情页旧的 `下载PDF` / `网页打印` 按钮 DOM，不再用 CSS 隐藏保留。
- 已移除比对历史页行级旧打印按钮和批量旧下载按钮 DOM。
- 关键字检查 `legacy-export`、`comparison-detail-export-wrap`、`网页打印`、`查看任务`、`icon-btn print`、`download-btn` 在 `frontend/src/components` 无残留命中。
- 页面实测旧入口计数为 `0`，不存在键盘导航或屏幕阅读器仍访问隐藏旧按钮的问题，也不存在隐藏按钮占位问题。

## 4. ReportFlowStatusBar 样本验证

| 样本 | 预期 | 实测 |
| --- | --- | --- |
| `/catalog/reports/4877` | 待复核 | 通过。状态显示“待复核”，按钮为“处理问题”；点击后进入勾稽关系校验区域。 |
| `/catalog/reports/4691` | 已发布后可比对 | 通过。状态显示“可比对”，按钮为“生成比对”；点击后进入现有 `/catalog` 业务入口。 |
| `/catalog/reports/966` | 已比对且已有完成导出 | 通过。只读聚合识别到比对 `#1143` 和完成 PDF 任务 `#18388`，状态显示“可导出”，按钮跳转 `/jobs?tab=download`。 |
| `/catalog/reports/4875` | 解析不完整/失败样本不误判 | 通过。样本仅作为保守状态验证，未显示“可比对”或“可导出”；状态仍停留在待复核路径。 |

未找到当前正在 `queued/processing/running` 的解析中报告样本；只读数据库查询只找到 `4875` 这一条 parsed 内容不可靠且最新解析失败的样本。

## 5. “已比对 / 可导出”只读聚合

已实现轻量只读聚合，不改数据库 schema，不新增后端接口：

- 报告详情加载后异步读取 `/api/comparisons/history`，按当前报告 `region_id`、`year` 查找包含当前 `report_id` 的比对。
- 找到比对后再读取 `/api/pdf-jobs?limit=100`，匹配同一 `comparison_id` 且 `status=done`、`file_exists=true` 的完成任务。
- 聚合只增强前端 `report.flow_signals`；失败或无可靠数据时静默降级，不阻塞报告详情页渲染。
- 状态条据此显示：
  - 有比对无完成 PDF：`已比对` / `查看比对`；
  - 有比对且有完成 PDF：`可导出` / `查看导出任务`。

## 6. 修改文件清单

本轮验收补测直接小修：
- `frontend/src/components/ComparisonDetailView.js`
- `frontend/src/components/ComparisonDetailView.css`
- `frontend/src/components/ComparisonHistory.js`
- `frontend/src/components/ComparisonHistory.css`
- `frontend/src/components/ReportDetail.js`
- `frontend/src/components/ReportFlowStatusBar.js`
- `frontend/src/components/ReportFlowStatusBar.test.js`
- `P1_ACCEPTANCE_AND_FIX_REPORT.md`

P1 当前分支仍包含第一轮已完成并通过验证的相关文件：
- `frontend/src/components/JobCenter.js`
- `frontend/src/components/ReportDetail.css`
- `frontend/src/components/ExportPanel.js`
- `frontend/src/components/ExportPanel.css`
- `frontend/src/components/ReportFlowStatusBar.css`
- `frontend/src/components/common/Button.js`
- `frontend/src/components/common/PageHeader.js`
- `frontend/src/components/common/StatusBadge.js`
- `frontend/src/components/common/common-ui.css`
- `P0_FINAL_BASELINE_REPORT.md`
- `P1_REPORT_FLOW_EXPORT_PANEL_REPORT.md`

本轮复用了 P1 第一轮已有公共组件与样式文件：`ExportPanel`、`PageHeader`、`StatusBadge`、`Button`；未做全站替换。

## 7. build/test 结果

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run build` | 通过 |
| `frontend/npm.cmd run build` | 通过；存在既有 webpack asset size warning |
| `npm.cmd test` | 通过，18 suites / 137 tests |
| `frontend/npm.cmd test` | 通过，14 suites / 67 tests |

## 8. 人工验证结果

- `/catalog/reports/4877`：通过，待复核状态和处理问题入口正常。
- `/catalog/reports/4691`：通过，已发布样本显示可比对，生成比对入口走现有目录页。
- `/catalog/reports/966`：通过，已比对/可导出只读聚合生效。
- `/catalog/reports/4875`：通过，解析失败/内容不可靠样本未误判为可比对或可导出。
- `/history`：通过，行级与批量 ExportPanel 真实创建任务，Toast 和任务中心入口正常。
- `/comparison/1143`：通过，生成 PDF、打印预览、查看导出任务均正常。
- `/jobs?tab=download`：通过，下载任务 tab 正确，本轮任务可见。
- `/print/comparison/1143`：通过，print ready 标记正常。

## 9. 风险与回滚方案

- 风险：报告详情页只读聚合依赖 `/comparisons/history` 和 `/pdf-jobs` 的当前返回字段；若接口分页或字段名变化，状态条会保守降级，不影响报告正文。
- 风险：`/pdf-jobs?limit=100` 只能覆盖最近 100 条导出任务；老任务可能不会触发“可导出”。这是 P1 可接受的轻量方案，后续若要全量可靠应进入 P2 或后续阶段设计专门索引/接口。
- 回滚：可回退 `ReportDetail.js` 中 `fetchFlowSignals/loadFlowSignals` 与 `ReportFlowStatusBar.js` 中 `latestComparison/latestCompletedPdfJob` 分支；ExportPanel 回滚则恢复旧按钮，但建议保留本轮移除旧隐藏 DOM 的安全修复。

## 10. 是否建议合并 P1

建议合并 P1。当前没有合并前阻断项。

注意：工作区仍存在本轮未处理的历史未跟踪目录 `.worktrees/*`，与本轮 P1 验收无关，未改动。
