# P0 合并前补丁报告

日期：2026-05-19  
分支：`codex/p0-frontend-ux-print-fixes`  
范围：仅处理 `P0_ACCEPTANCE_REPORT.md` 中的合并前事项；未进入 P1，未做 AppShell、ExportPanel、公共组件或全站重构。

## 1. 修改文件清单

本轮新增/修改：

- `frontend/src/components/print/GovInsightReportPrintView.tsx`
- `P0_MERGE_FIX_REPORT.md`

本轮清理确认：

- `src/services/SegmentedAnnualReportParse.ts`：已清理，当前无 diff。
- `src/__tests__/segmentedAnnualReportParse.test.ts`：已清理，当前无 diff。

当前 `git diff --name-only` 中保留的代码文件均属于 P0 frontend / UX / print / PDF 范围：

- `frontend/src/App.css`
- `frontend/src/App.js`
- `frontend/src/components/ComparisonDetailView.js`
- `frontend/src/components/ComparisonHistory.js`
- `frontend/src/components/JobCenter.css`
- `frontend/src/components/JobCenter.js`
- `frontend/src/components/print/GovInsightReportPrintView.tsx`
- `frontend/src/govinsight/tailwind.css`
- `src/routes/comparison-history.ts`
- `src/routes/pdf-export.ts`
- `src/routes/pdf-jobs.ts`
- `src/services/PdfExportService.ts`
- `src/services/PdfExportWorker.ts`
- `src/views/comparison_report.ejs`

## 2. orgId 兼容问题根因

`/api/gov-insight/annual-data` 后端已经支持两种查询方式：

- 真实 `org_id`，例如 `city_721`。
- 数字 `region_id`，例如 `721`。

但 `GovInsightReportPrintView.tsx` 之前的打印页逻辑在拿到 records 后仍然用传入参数做严格过滤：

```ts
records.filter((item) => item.org_id === orgId)
```

因此 `/print/govinsight-report/721/2025` 会出现：

- 后端 annual-data 可以按 `region_id=721` 返回 `org_id=city_721` 的记录；
- 前端又用 `item.org_id === "721"` 过滤；
- 结果自身记录为空，页面显示“未找到可导出的年度数据”。

`ReportGenerator.tsx` 和 `/api/gov-insight/report-pdf` 已检查：

- `ReportGenerator` 使用 `entity.id` 生成打印 URL 和 PDF 请求，正常情况下传的是 `city_721` 这类真实 `org_id`。
- `/api/gov-insight/report-pdf` 后端用 `parseRegionId` 支持 `city_721` 和 `721`，但它生成的前端打印 URL 会保留原始 `org_id` 参数，所以仍依赖前端打印页兼容数字参数。

## 3. 具体修复方式

在 `GovInsightReportPrintView.tsx` 中新增局部解析逻辑：

- 先对传入 `orgId` 做精确 `org_id` 匹配。
- 如果传入值可解析出数字，优先尝试 `city_${id}`。
- 再根据 records 中的 `region_id`、`org_id`、`city_region_id` 提取数字并匹配。
- 多候选时优先保持原始精确匹配，其次使用系统实际记录里的 `city_${id}`，最后才取首个候选。
- 后续 `fetchAIReport`、`fetchAIReportPayload`、`fetchAnnualReportSummary` 和 `EntityProfile.id` 均使用解析后的真实 `org_id`。

保留原有错误行为：解析不到任何候选时仍显示“未找到可导出的年度数据”。

## 4. 非 P0 文件改动是否已清理

已清理。

原验收报告中提到的两个非 P0 文件属于上传解析链路，不属于本轮 frontend / UX / print / PDF 合并范围：

- `src/services/SegmentedAnnualReportParse.ts`
- `src/__tests__/segmentedAnnualReportParse.test.ts`

处理过程：

- 先执行 `git status --short` 和 `git diff --name-only` 确认二者存在差异。
- 判断差异内容为 segmented annual report parse 的语义修复和测试，不属于 P0 合并范围。
- `git restore` 因 `.git/index.lock` 创建权限问题失败，随后用手工反向补丁恢复这两个文件。
- 复核 `git diff -- src/services/SegmentedAnnualReportParse.ts src/__tests__/segmentedAnnualReportParse.test.ts` 无输出。

## 5. build / test 结果

已执行并通过：

- `npm.cmd run build`：通过。
- `frontend/npm.cmd run build`：首次因 TS target 不支持展开 `Map.keys()` iterator 失败；修复为 `Array.from(candidates.keys())` 后通过。
- `npm.cmd test`：通过，18 个 test suites / 136 个 tests。存在既有 `JWT_SECRET` 和 bcrypt 安全提示日志，不影响测试结果。
- `frontend/npm.cmd test`：通过，13 个 test suites / 62 个 tests。

## 6. 人工验证结果

服务状态：

- `http://127.0.0.1:8787/api/health` 返回 `{"status":"ok","database":"connected"}`。
- `http://127.0.0.1:3001/catalog` 返回 200。

页面验证：

| 页面 | 结果 | 关键证据 |
| --- | --- | --- |
| `/print/govinsight-report/city_721/2025` | 通过 | `#govinsight-report-print` 存在，`data-govinsight-pdf-ready="true"`，标题为 `淮安市_2025_政务公开智能辅策报告`。 |
| `/print/govinsight-report/721/2025` | 通过 | `#govinsight-report-print` 存在，`data-govinsight-pdf-ready="true"`，不再出现“未找到可导出的年度数据”。 |
| `/print/comparison/4670` | 通过 | `#comparison-content[data-print-ready="true"]`，无 `.gov-dashboard-root` 污染。 |
| `/print/comparison/1143` | 通过 | `#comparison-content[data-print-ready="true"]`，长表格打印页正常显示。 |
| `/jobs?tab=download` | 通过 | 下载摘要显示：可下载 3、生成中 0、失败 1、已过期 5。 |

人工验证期间未捕获新的浏览器 console error。

## 7. 是否建议合并

建议合并。

P0 合并前唯一阻断项，即 GovInsight 打印页纯数字 `orgId` 兼容问题，已修复并通过验证。非 P0 范围的 segmented annual report parse 改动也已从本分支清理。

## 8. 合并前是否仍有阻断项

无阻断项。

仍建议放入后续 P1/P2 的事项：

- GovInsight 图表初始容器尺寸 warning。
- 任务中心失败原因的人类可读化，例如将 `COMPARISON_CONTENT_NOT_READY` 显示为“比对内容未就绪”。
- 打印页调试日志的源码编码可读性清理。
- PDF 长报告视觉回归自动化。

