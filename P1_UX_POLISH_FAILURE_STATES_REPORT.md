# P1 UX Polish Failure States Report

## 1. 修改文件清单

- `frontend/src/utils/errorTranslator.js`
- `frontend/src/components/JobCenter.js`
- `frontend/src/components/JobCenter.css`
- `frontend/src/components/JobDetail.js`
- `frontend/src/components/JobDetail.css`
- `frontend/src/components/ComparisonDetailView.js`
- `frontend/src/components/ComparisonHistory.js`
- `frontend/src/components/UploadReport.js`
- `frontend/src/components/BatchUpload.js`
- `frontend/src/components/ReportDetail.js`
- `frontend/src/components/print/ComparisonPrintView.js`
- `frontend/src/components/common/ToastProvider.js`
- `frontend/src/components/common/ToastProvider.css`
- `frontend/src/govinsight/components/StableChartFrame.tsx`
- `frontend/src/govinsight/components/ReportCharts.tsx`
- `frontend/src/govinsight/views/DashboardHome.tsx`
- `frontend/src/govinsight/views/ReportGenerator.tsx`
- `frontend/src/govinsight/leader-cockpit/components/TrendSwitcher.tsx`
- `frontend/src/govinsight/leader-cockpit/sections/Step2Reasons.tsx`
- `scripts/pdf-smoke-baseline.js`
- `package.json`
- `P1_UX_POLISH_FAILURE_STATES_REPORT.md`

本轮未修改后端接口、数据库 schema、React Router 结构或 `ReportExportService` 架构。

## 2. 失败原因映射表

| 原始错误 / 场景 | 统一友好文案 | 原始错误保留方式 |
| --- | --- | --- |
| `COMPARISON_CONTENT_NOT_READY` | 比对内容尚未生成完成，请稍后重试或重新生成比对。 | 任务列表 `title`、任务详情原始错误折叠区、Toast detail |
| `Failed to fetch comparison data from backend` | 无法读取比对内容，请确认比对是否已生成完成。 | Toast detail、打印页错误详情、任务列表 tooltip |
| `文件过期` / `File expired` / `expired` | 文件已过期，请重新生成。 | 下载任务 tooltip、Toast detail |
| 网络错误、无响应、`500`、`Internal server error` | 服务暂时不可用，请稍后重试。 | Toast detail、任务详情原始错误折叠区 |
| `429` / `quota_exceeded` | 服务调用额度暂时不可用，请稍后重试或联系管理员处理。 | Toast detail、任务详情原始错误折叠区 |
| `400` / `invalid_request` | 任务请求未通过校验，请检查文件内容或重新提交。 | Toast detail、任务详情原始错误折叠区 |

统一入口在 `frontend/src/utils/errorTranslator.js`，任务中心、Toast、打印页和 GovInsight PDF 导出共用同一套映射。

## 3. Recharts Warning 处理方式

- 新增 `StableChartFrame`，通过 `ResizeObserver` 等待外层图表容器真实宽高可用后再挂载内部图表。
- 为本轮触达的 `ResponsiveContainer` 提供稳定 `minWidth`、`minHeight` 和 `initialDimension`，避免 Recharts 3.6 初始 `width(-1)` / `height(-1)` warning。
- 覆盖 `/govinsight` dashboard 的主趋势图、四象限图，报告页 `ReportCharts` 图表，以及 leader cockpit 高频趋势图。
- 未重构 GovInsight 整体布局，只补图表容器尺寸稳定性。

人工复核结果：干净浏览器标签重新加载 `/govinsight` 后，图表节点尺寸为正数，未出现新的 Recharts `width(-1)` / `height(-1)` warning。

## 4. 替换的 alert/confirm

- 任务中心：取消、删除、批量删除、清空、下载任务删除、PDF 重新生成等危险操作改用 `ConfirmDialogProvider`，成功/失败结果走 Toast。
- 任务详情：重试结果提示、取消确认和取消结果提示改为 Toast / ConfirmDialog。
- 上传页：缺少文件、缺少地区、覆盖已有报告确认、上传失败提示改为 Toast / ConfirmDialog。
- 批量上传：文件数量超限、未分配区域、无待处理文件改为 Toast。
- 比对历史：删除、批量导出、批量删除、批量创建确认与结果提示改为 Toast / ConfirmDialog。
- 报告详情：重新解析、删除、解析历史操作、发布版本确认与结果提示改为 Toast / ConfirmDialog。
- GovInsight 报告页：AI 报告任务创建失败、PDF 导出失败改为统一友好 Toast。

保留边界：没有一次性替换全站，只处理本轮高频、低风险路径；危险操作仍需要显式确认。

## 5. PDF Smoke 基线说明

新增本地 smoke 脚本：

```bash
npm run smoke:pdf
```

默认检查 `comparison_id=4670` 和 `comparison_id=1143` 的最新已完成 PDF 导出任务。检查项：

- 文件存在；
- 页数大于 0；
- 空白页为 0；
- 文本不包含 `�`；
- 文本包含比对报告 / 政府信息公开 / 年度报告 / 对比等 print-ready 语义标记。

也可显式指定文件：

```bash
node scripts/pdf-smoke-baseline.js --file=4670=output/4670.pdf --file=1143=output/1143.pdf
```

脚本不新增大型依赖，复用项目已有 `pdfjs-dist`。如通过数据库自动查找最新导出文件，需要先运行根目录 build 生成 `dist/config/database-llm`。

本次 smoke 结果：

| comparison_id | 页数 | 空白页 | 文本 `�` | print ready | 结果 |
| --- | ---: | ---: | --- | --- | --- |
| `4670` | 13 | 0 | 无 | 正常 | 通过 |
| `1143` | 13 | 0 | 无 | 正常 | 通过 |

## 6. Build/Test 结果

- `npm.cmd run build`：通过。
- `frontend/npm.cmd run build`：通过；仅有既有 webpack 资源体积 warning。
- `npm.cmd test`：通过，18 个 test suites / 137 个 tests 全部通过；测试日志中仍有既有 `JWT_SECRET` 与 bcrypt migration warning。
- `frontend/npm.cmd test`：通过，13 个 test suites / 62 个 tests 全部通过。
- `npm.cmd run smoke:pdf`：通过。

## 7. 人工验证结果

- `/jobs?tab=download`：通过。下载任务页正常展示；失败任务显示统一友好文案“无法读取比对内容，请确认比对是否已生成完成。”。
- `/comparison/1143`：通过。比对详情正常加载，PDF/网页打印入口仍可见。
- `/history`：通过。比对结果汇总正常加载，查询、只看问题、一键比对、刷新入口仍可见。
- `/govinsight`：通过。页面正常加载，图表尺寸为正数，干净标签未出现新的 Recharts `width(-1)` / `height(-1)` warning。
- `/print/comparison/1143`：通过。打印页正常加载，`printReady` 标记正常。

## 8. 是否建议合并

建议合并。

理由：本轮变更严格限制在前端 UX polish、图表容器稳定和本地 PDF smoke 基线；自动验证、PDF smoke 和指定页面人工验证均通过。剩余风险主要是未覆盖全站所有历史 `alert/confirm` 与 GovInsight 其他非本轮入口的全部图表，但符合“不一次性替换全站、不做 P2 架构重构”的边界。
