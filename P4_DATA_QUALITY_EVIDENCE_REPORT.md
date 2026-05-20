# P4-2A 数据质量与证据链最小增强报告

## 1. 修改文件清单

新增文件：

- `frontend/src/utils/evidenceViewModel.js`
- `frontend/src/utils/evidenceViewModel.test.js`
- `frontend/src/govinsight/utils/sourceStatus.ts`
- `frontend/src/govinsight/utils/sourceStatus.test.ts`
- `P4_DATA_QUALITY_EVIDENCE_REPORT.md`

修改文件：

- `frontend/src/components/ConsistencyCheckView.js`
- `frontend/src/components/ConsistencyCheckView.css`
- `frontend/src/components/ConsistencyCheckView.test.js`
- `frontend/src/components/ReportDetail.js`
- `frontend/src/components/ReportDetail.css`
- `frontend/src/components/ReportDetail.test.js`
- `frontend/src/components/ComparisonDetailView.js`
- `frontend/src/govinsight/views/ReportGenerator.tsx`
- `frontend/src/components/print/GovInsightReportPrintView.tsx`
- `frontend/src/components/print/GovInsightReportPrintView.css`

未处理且保持 out-of-scope 的未跟踪文件：

- `P3-5_POST_MERGE_HEALTH_CHECK.md`
- `P3_FINAL_ACCEPTANCE_REPORT.md`
- `P4_1_PRE_MERGE_CHECK_REPORT.md`
- `P4_1_POST_MERGE_HEALTH_CHECK.md`

## 2. 增强内容说明

### 2.0 阶段 A 补齐

阶段 A 复核发现：`ConsistencyCheckView` 中纯 `NOT_ASSESSABLE` 分组原先会命中 `group.hasOnlyNotAssessable` 空状态分支，导致分组内 item 不继续渲染，从而绕过“证据说明”。

本轮已做最小修复：

- 保留纯 `NOT_ASSESSABLE` 分组的“暂无可评估规则”提示。
- 当该分组仍有 item 时，继续渲染 item card 和统一 evidence helper。
- `NOT_ASSESSABLE` item 可显示字段路径、保守风险原因、来源线索或 fallback。
- 不改变 `displayNo`、`problemCount`、筛选逻辑、定位按钮和主勾稽编号语义。

新增测试覆盖：纯 `NOT_ASSESSABLE` 分组仍能看到“证据说明”，并能看到结构化字段路径。

### 2.1 统一 evidence 展示 helper

新增 `frontend/src/utils/evidenceViewModel.js`，只消费现有 check item、evidence、source path 和 comparison 数据，不依赖任何新增后端字段。

helper 输出统一字段：

- `summary`
- `reasonLabel`
- `severity`
- `fieldPath`
- `originalValue`
- `parsedValue`
- `comparedValue`
- `sourceRefs`

支持的克制型复核提示包括：

- 缺表
- 表头不足或识别不足
- 数字为空
- `0` 与空值的人工复核差异
- 不适用
- 跨页
- 表三疑似拆格或片段化
- 长表格尾部截断风险

当没有更详细证据时，前端显示“暂无更详细来源，仅保留结构化字段路径”，不伪造页码、表格、原文或 OCR 证据。

### 2.2 ConsistencyCheckView

在 `FAIL`、`UNCERTAIN`、`NOT_ASSESSABLE` 项中新增“证据说明”区域，展示统一 evidence 摘要、字段路径、原始值、解析值、比对值、来源引用和风险原因。

保持不变：

- 原有左值、右值、差额展示
- 定位按钮
- 筛选逻辑
- `displayNo`
- reconciliation `problemCount`
- 主勾稽编号口径

### 2.3 ReportDetail

在问题定位后的 focus banner 中复用同一个 evidence helper，显示：

- 字段路径
- 原始值
- 解析值
- 比对值
- 风险原因

保持不变：

- 表格主渲染结构
- `data-cell-path`
- 高亮逻辑
- badge 逻辑
- 定位流程

### 2.4 ComparisonDetailView

只补充“差异来源说明”，说明当前差异来自已有解析结构和现有比对结果；没有页码或表格来源时不虚构来源。

未改动：

- 比对算法
- similarity 计算
- 章节 diff 逻辑
- PDF 生成接口

### 2.5 GovInsight 展示与打印

新增 `frontend/src/govinsight/utils/sourceStatus.ts`，在 ReportGenerator 和 GovInsight 打印页展示现有来源字段的可读摘要：

- `payloadSource`
- `materializeStatus`
- `sourceJobId`
- `sourceReportVersionId`
- `dataQuality`

未改动 GovInsight 数据生成、模型协议、后端接口和 PDF 主链路。

## 3. 未改动边界

本轮未做以下改动：

- 未改数据库 schema。
- 未新增 migration。
- 未改解析算法。
- 未改比对算法。
- 未改模型 prompt 主协议。
- 未改 PDF 后端主链路。
- 未改 `scripts/pdf-smoke-baseline.js`。
- 未删除 legacy EJS。
- 未删除旧接口。
- 未改 `/api/pdf-jobs`。
- 未改 `/api/comparisons/:id/pdf`。
- 未改 `/api/gov-insight/report-pdf`。
- 未把 quality、visual、structure 提示并入主勾稽编号。
- 未改变 reconciliation `problemCount`。
- 未改变 `displayNo`。
- 未提交、未 push、未 merge。

## 4. 自动验证结果

| 验证项 | 结果 | 说明 |
| --- | --- | --- |
| focused frontend tests | 通过 | 4 suites，16 tests；包含纯 `NOT_ASSESSABLE` 分组证据说明回归 |
| `npm.cmd run build` | 通过 | 后端 TypeScript build 与 public copy 通过 |
| `npm.cmd test` | 通过 | 19 suites，144 tests |
| `cd frontend && npm.cmd test -- --runInBand` | 通过 | 20 suites，97 tests |
| `cd frontend && npm.cmd run build` | 通过 | TypeScript 与 webpack production build 通过；仅保留既有 bundle/asset size warning |
| `npm.cmd run smoke:pdf` | 通过 | total 4，passed 4，failed 0，skipped 0，strictLive=false |
| `git diff --check` | 通过 | 无 whitespace error；仅显示当前 Windows 换行提示 |

PDF smoke 工具可用性说明：当前环境仍缺少 `pdfinfo`、`pdftoppm`、ImageMagick、Ghostscript，smoke 使用 pdfjs 文本、页数、空白页和 ready marker 检查。该限制与 P4-1 一致，本轮未修改 smoke 脚本。

## 5. strict-live 结果

执行：

```powershell
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

结果：通过。阶段 B strict-live 已在本地 API `127.0.0.1:8787` 与前端 `127.0.0.1:3001` 可用时执行，没有跳过。

- total 4
- passed 4
- failed 0
- skipped 0
- strictLive=true

覆盖项：

- comparison `4670` PDF
- comparison `1143` 长表格 PDF
- GovInsight `city_721` PDF
- pdf-job API

## 6. 真实样本复测结果

### 6.1 API 与数据状态复测

| 样本 | 结果摘要 |
| --- | --- |
| report `4691` / version `4314` | detail/checks HTTP 200；checks total 43，PASS 42，NOT_ASSESSABLE 1，FAIL 0；withEvidence 43 |
| report `4839` / version `4405` | detail/checks HTTP 200；checks total 44，FAIL 2，NOT_ASSESSABLE 1；vision review 1，结论 `source_table_anomaly` |
| report `4837` / version `4457` | detail/checks HTTP 200；checks total 45，PASS 44，NOT_ASSESSABLE 1，FAIL 0；withEvidence 45 |
| report `3670` | detail/checks HTTP 200；current version `3448`；checks total 44，FAIL 5，NOT_ASSESSABLE 1；withEvidence 44 |
| report `4304` | detail/checks HTTP 200；current version `3964`；checks total 43，FAIL 3，NOT_ASSESSABLE 1；withEvidence 43；vision review 1 |
| comparison `4670` | HTTP 200；region 淮安市；2024 vs 2025；similarity 51；status `异常(规范性文件|结转)` |
| comparison `1143` | HTTP 200；region 清江浦区工业和信息化局；2024 vs 2025；similarity 0；status `正常` |
| GovInsight `city_721` / `721`, year `2025` | annual/report/payload/PDF HTTP 200；`payloadSource=stored`，`materializeStatus=preview`，`sourceJobId=16`，`sourceReportVersionId=4319`；numeric 与 canonical orgId 均兼容 |

确认点：

- `NOT_ASSESSABLE` 未被改写为 `FAIL`。
- quality / visual / structure 信息仍是辅助提示，不进入 reconciliation `problemCount`。
- 真实样本 checks 均保留现有 evidence 或结构化字段路径，前端 helper 只做展示归一化。
- GovInsight `city_721` 与 `721` 的 PDF 路径仍可用。

### 6.2 页面可见抽查

本轮用本地前端 `127.0.0.1:3001` 与本地 API `127.0.0.1:8787` 做只读页面抽查。

| 页面 | 抽查结果 |
| --- | --- |
| `/catalog/reports/3670` | 可进入勾稽关系页；可见“证据说明”；点击定位后 focus banner 显示字段路径、原始值、解析值、比对值、风险原因；定位按钮数 39 |
| `/comparison/4670` | 可见“差异来源说明”；未改动比对算法或 PDF 导出入口 |
| `/print/govinsight-report/city_721/2025` | 可见“来源状态”；显示已保存 payload、预览/辅助口径、任务 16、版本 4319 和数据质量摘要 |
| `/print/govinsight-report/721/2025` | 可见“来源状态”；numeric orgId 打印路径仍兼容 |

阶段 B 页面抽查补充确认：

- `/catalog/reports/3670` 的 focus banner 同时包含字段路径、原始值、解析值、比对值和风险原因。
- `/comparison/4670` 只补充差异来源说明，未改变比对状态、重复率或 diff 算法。
- GovInsight print 只展示 `payloadSource`、`materializeStatus`、`sourceJobId`、`sourceReportVersionId` 和 `dataQuality` 摘要，未修复 latest job failed 根因。

## 7. P4-1 遗留问题处理情况

| P4-1 问题 | 本轮处理 |
| --- | --- |
| `P4-1-001` GovInsight 最新 job `17` failed | 未修复生成失败根因，仍留给 P4-5；本轮只把已有 `payloadSource`、`materializeStatus`、`sourceJobId`、`sourceReportVersionId`、`dataQuality` 做可读展示，使人工复核能区分“当前展示来自已存 payload”与“最新 job 状态” |
| `P4-1-002` PDF 原生视觉工具缺失 | 未改 smoke 脚本，未安装工具；本报告继续明确降级验证限制，建议 P4-3 纳入部署/验收环境清单 |
| `P4-1-003` TaskDrawer 认证后业务页人工可视化确认 | 未改 TaskDrawer；本轮通过可写临时浏览器会话补充了报告页、比对页、GovInsight print 页面可见性抽查，但 `/upload`、`/jobs`、`/jobs?tab=download` 的人工 TaskDrawer 验证仍建议 P4-3 或人工审核阶段补做 |

## 8. 剩余风险

1. 本轮 evidence helper 是展示层归一化，不新增后端证据存储，也不补齐缺失的页码、表格坐标或 OCR 原文。
2. 如果后端 item 只返回结构化 path 而没有 source/evidence，前端只能显示字段路径和“暂无更详细来源”的保守提示。
3. 表头不足、跨页、拆格、长表格截断等提示是基于现有字段、path、reason 和 evidence 的保守识别，不替代解析算法修复。
4. GovInsight latest job `17` 仍为 failed，错误 `overrides?.overallJudgments?.filter is not a function`，本轮未修复该生成链路问题。
5. 当前验证机缺少 PDF 原生视觉工具，PDF 视觉像素级回归能力仍不足。

## 9. 是否建议提交

建议人工审核后提交。

理由：

- 改动集中在前端展示层和 helper。
- 未改 schema、解析算法、比对算法、模型协议或 PDF 后端主链路。
- 自动测试、构建、PDF smoke、strict-live 均通过。
- 真实样本 API 与页面抽查覆盖了报告页、比对页、GovInsight numeric/canonical 打印路径。

提交前建议人工重点复核：

- `frontend/src/utils/evidenceViewModel.js` 的提示口径是否足够克制。
- `ReportDetail` focus banner 的视觉密度是否可接受。
- GovInsight “来源状态”文案是否符合客户演示口径。

## 10. 是否建议进入 P4-3

不建议在当前未提交、未审核状态下直接进入 P4-3。

建议顺序：

1. 人工审核 P4-2A diff 与本报告。
2. 如无异议，再提交并按项目流程合并。
3. 合并后再进入 P4-3，优先处理 PDF 原生视觉工具链、TaskDrawer 人工验收固化和部署/验收环境清单。
