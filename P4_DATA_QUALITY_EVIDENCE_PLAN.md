# P4-2 数据质量与证据链增强计划

## 1. 阶段基线

- 阶段分支：`codex/p4-data-quality-evidence`
- 分支来源：已从最新 `origin/main` 同步后创建，`main` 当前包含 `b41fa13 Merge pull request #107 from zxj6827111-blip/codex/p4-real-sample-regression`
- 当前状态：本文件为 P4-2 第一份计划产物；尚未开发、尚未提交、尚未 push
- 现有未跟踪文件：`P3-5_POST_MERGE_HEALTH_CHECK.md`、`P3_FINAL_ACCEPTANCE_REPORT.md`、`P4_1_PRE_MERGE_CHECK_REPORT.md`、`P4_1_POST_MERGE_HEALTH_CHECK.md`，本阶段不处理、不暂存

## 2. 当前证据链现状

### 2.1 年报解析链路

当前解析结果主要落在 `report_versions.parsed_json`，关键结构为：

- `sections[type=table_2].activeDisclosureData`
- `sections[type=table_3].tableData`
- `sections[type=table_4].reviewLitigationData`
- 正文章节 `content`

现有解析过程已经具备部分证据表：

- `parse_runs`：记录 provider、model、prompt/schema/parser/source gate 配置、状态、错误、gate 结果。
- `source_snapshots`：已有 `source_type`、`source_path`、`page_number`、`table_index`、`table_id`、`row_index`、`col_index`、`row_header`、`col_header`、`cell_text`、`normalized_text`、`bbox_json`、`metadata_json`。
- `source_gate_results`：已有 source gate 状态、warning/blocker/uncertain 数量和 `result_json`。
- `cells`：已有 `cell_ref`、`value_raw`、`value_num`、`value_semantic`、`page_number`、`bbox_json`、`confidence`。

因此，P4-2 第一轮不需要新增数据库 schema。更合理的最小增强是：把这些已有字段通过接口和前端展示串起来，让复核人员看到“原始值是什么、解析值是什么、位置在哪里、为什么提示风险”。

### 2.2 勾稽校验链路

当前主证据载体是 `report_consistency_items.evidence_json`，服务层类型已包含：

- `paths`
- `leftPaths`
- `rightPaths`
- `values`
- `textMatches`

后端 `/api/reports/:id/checks` 会返回 `evidence`，前端当前消费链路包括：

- `ConsistencyCheckView`：展示左值、右值、差额和来源路径。
- `ReportDetail`：读取 `/reports/:id/checks`，把 evidence path 转成内容页高亮和定位。
- `ComparisonDetailView` / `ComparisonPrintView`：读取 cross-year check issue 的 `leftPaths/rightPaths/paths`，用于比对页和 PDF 中的问题高亮。
- `qualityIssueAdapter` / `issueAggregation`：已经把 `visual/structure/quality` 与主勾稽问题分域处理，质量提示不应进入 reconciliation 的核心编号与 `problemCount` 口径。

现状不足：

- `evidence_json.values` 中有 rule-specific 信息，但缺少统一可读的 `source/original/parsed/compared/reason/severity` 说明层。
- 缺表、表头识别失败、空值、`0`、`不适用`、跨页、表三疑似拆格、长表尾部截断等问题，有部分规则提示，但口径不统一。
- 前端目前更擅长定位到字段路径，不擅长解释“为什么这个字段被判定为风险”。

### 2.3 比对链路

比对任务在 `LlmJobRunner` 中读取左右报告 active version 的 `parsed_json`，生成：

- `comparison_results.diff_json`
- `comparisons.similarity`
- `comparisons.check_status`

前端 `ComparisonDetailView` 会重新对 section 和表格做展示层 diff，并显示重复率、`check_status`、表二/三/四差异表。

现状不足：

- `check_status` 目前是可读摘要，例如 `异常(规范性文件|结转)`，但没有结构化解释“哪个字段、旧值、新值、来源路径、是否来自解析异常”。
- PDF 报告可显示差异和高亮，但问题说明还没有统一的 evidence detail。

### 2.4 GovInsight 链路

GovInsight 当前已有较完整的来源字段：

- 前端 API 类型已有 `sourceJobId`、`sourceReportVersionId`、`payloadSource`、`materializeStatus`。
- 后端 payload 已有 `metricsSnapshot`、`dataQuality`、`riskAssessment`、`metadataSeeds.evidenceBasis`。
- GovInsight PDF 封面已展示“数据来源”和“审阅提示”。

现状不足：

- 指标卡、风险判断和结论之间还缺少面向客户的“指标来源解释”。
- P4-1 发现 latest job `17` failed，错误为 `overrides?.overallJudgments?.filter is not a function`；当前存储报告和 PDF 可用，但最新任务失败会影响演示可信度。
- 此问题涉及异常加固，主修复应归 P4-5；P4-2 只建议先把 payload/evidence/status 的可追溯信息展示清楚。

## 3. P4-1 问题清单引用

P4-2 以 `P4_REAL_SAMPLE_ISSUE_LIST.md` 和 `P4_REAL_SAMPLE_REGRESSION_REPORT.md` 为输入，引用以下问题：

1. `P4-1-001`：GovInsight 淮安市 2025 最新生成 job 失败，`/api/gov-insight/ai-report/jobs/latest?org_id=city_721&year=2025` 返回 latest job failed，错误为 `overrides?.overallJudgments?.filter is not a function`。P4-2 只做证据链和 payload 字段形态审计/展示，不直接做 P4-5 异常加固。
2. `P4-1-002`：PDF smoke 缺少原生视觉工具，只能降级到 pdfjs 文本、页数、空白页检查。P4-2 不改 `scripts/pdf-smoke-baseline.js`，只在验证计划中标注该限制。
3. `P4-1-003`：TaskDrawer 认证后业务页可视化点击仍需人工确认。P4-2 可把 TaskDrawer 证据展示纳入人工复测项，但不把浏览器环境固化作为本阶段开发内容。

`P4_1_POST_MERGE_HEALTH_CHECK.md` 显示 P4-1 已合并并通过 build/test/frontend build/pdf smoke/strict-live；P4-2 可启动，但须人工审核计划后再开发。

## 4. 需要增强的页面、接口、报告

### 4.1 页面

第一轮建议只增强以下页面：

- `frontend/src/components/ConsistencyCheckView.js`
  - 在每条 FAIL/UNCERTAIN/NOT_ASSESSABLE 项中显示统一的证据摘要。
  - 保留现有左值、右值、差额、定位按钮。

- `frontend/src/components/ReportDetail.js`
  - 内容页 focus banner 增加“证据说明”：字段路径、原始值/解析值/比对值、风险原因。
  - 保持现有定位与高亮，不改表格渲染主结构。

- `frontend/src/components/ComparisonDetailView.js`
  - 在差异摘要或表格差异区域补充差异来源说明：旧年字段、新年字段、旧值、新值、来源报告版本。
  - 不改变比对算法，不改变 PDF 主链路。

- `frontend/src/govinsight/views/ReportGenerator.tsx`
  - 在报告生成页或报告预览区补充 payload 来源状态：`payloadSource`、`materializeStatus`、`sourceJobId`、`sourceReportVersionId`。
  - 对 dataQuality warnings 做更明确的客户可读提示。

- `frontend/src/components/print/GovInsightReportPrintView.tsx`
  - 只考虑在 PDF 已有“数据来源/审阅提示”附近补充 payload 来源与数据质量摘要。
  - 不改变 PDF adapter、worker、legacy EJS。

### 4.2 接口

第一轮建议只增强现有接口返回，不新增必须依赖的新表：

- `/api/reports/:id/checks`
  - 在 `evidence` 中补充统一的展示层派生字段，例如 `summary`、`severity`、`reasonLabel`、`sourceRefs`。
  - 优先由后端从已有 `evidence_json`、`source_snapshots`、`cells`、`source_gate_results` 派生。
  - 若风险较高，也可先在前端 adapter 派生，后端接口保持兼容。

- `/api/reports/:id/parse-history`
  - 当前已返回 parse run 与 source gate 摘要。
  - P4-2 可考虑补充“最近 source gate issue 摘要”，但不修改 schema。

- `/api/comparisons/:id`
  - 若现有详情接口已返回左右内容和 `diff_json`，第一轮只在前端展示层补充来源解释。
  - 暂不调整 `comparison_results.diff_json` 持久结构。

- `/api/gov-insight/ai-report`、`/api/gov-insight/ai-report/payload`
  - 现有 payload 中已有 `dataQuality`、`riskAssessment`、`sourceJobId/sourceReportVersionId`。
  - 第一轮优先展示已有字段；如要新增字段，只在返回 JSON 中派生，不改表。

### 4.3 报告

- Comparison PDF：只增强问题说明文字和证据摘要，不改 `/api/pdf-jobs` 主链路，不改 `scripts/pdf-smoke-baseline.js`。
- GovInsight PDF：只增强来源说明和数据质量摘要，不改 print adapter，不改 legacy EJS。
- 阶段文档：后续开发完成后输出 `P4_DATA_QUALITY_EVIDENCE_REPORT.md`，列明改动、验证、真实样本结果和未改边界。

## 5. 不改 schema 前提下可增强的字段或展示

建议定义一个展示层 evidence view model，不直接要求数据库新增列：

```ts
type EvidenceViewModel = {
  source: 'parsed_json' | 'source_snapshots' | 'source_gate' | 'cells' | 'comparison' | 'govinsight_payload';
  table?: 'table_2' | 'table_3' | 'table_4';
  fieldPath?: string;
  cellRef?: string;
  pageNumber?: number | null;
  rowLabel?: string | null;
  colLabel?: string | null;
  originalValue?: string | number | null;
  parsedValue?: string | number | null;
  comparedValue?: string | number | null;
  semantic?: 'ZERO' | 'EMPTY' | 'NA' | 'TEXT' | 'NUMERIC';
  reasonCode?: string;
  reasonLabel?: string;
  severity?: 'blocker' | 'high' | 'medium' | 'low' | 'info';
  confidence?: 'high' | 'medium' | 'low' | null;
};
```

该结构只作为接口派生字段或前端 view model，不要求落库。来源映射：

- `fieldPath`：来自 `evidence.paths/leftPaths/rightPaths`
- `cellRef/originalValue/semantic/pageNumber`：优先来自 `cells` 或 `source_snapshots`
- `parsedValue/comparedValue`：来自 `report_consistency_items.left_value/right_value/delta` 或 comparison 左右值
- `reasonCode/reasonLabel`：来自 `evidence.values.reason`、`source_gate_results.result_json.issues[].reason`、规则 `check_key`
- `severity`：按规则派生，不改 `auto_status`

## 6. 证据链最小闭环设计

P4-2 最小闭环定义：

1. 解析来源：能说明数据来自哪个报告版本、哪个解析任务、哪个表、哪个字段，若可用则包含页码/单元格原文。
2. 结构化结果：能说明系统解析出的值是什么，`0`、空值、`不适用` 分别按语义显示。
3. 校验判断：能说明规则表达式、左值、右值、差额、容差、状态。
4. 风险解释：能用一句业务语言说明为什么需要复核。
5. 定位动作：在报告内容页或比对页能定位到对应字段；不能定位时明确显示“暂无页面级定位，仅有结构化字段路径”。
6. 报告输出：PDF 中至少保留问题说明、字段路径、值对比和风险提示，不要求做到浏览器同等交互。

最小用户可见文案示例：

- 缺表：`未识别到表三结构化数据，但正文中存在第三部分标题，建议核对 PDF 原表是否跨页或表头未识别。`
- 表头识别失败：`字段路径存在，但来源表头不足，当前值仅可作为待复核解析结果。`
- 数字为空：`该字段为空，无法确认是否为 0；不纳入确定性合计判断。`
- 0 与空值：`0 表示原表明确填 0；空值表示原表未给出可确认数字。`
- 不适用：`原表语义为不适用，不等同于 0，建议按业务口径复核。`
- 表格跨页：`疑似跨页表格，页尾/页首字段可能需要人工核对。`
- 表三疑似拆格：`表三行列结构存在拆格或错位迹象，建议优先核对该行明细与总计。`
- 长表尾部截断：`长表尾部字段缺少来源匹配，可能存在截断或未抽取完整。`

## 7. 数据质量提示设计

数据质量提示不替代勾稽 FAIL，不直接扩大 `problemCount` 口径。建议分三类：

- `数据缺失`：缺表、字段缺失、数字为空、source value not found。
- `结构风险`：表头识别失败、跨页、拆格、长表尾部截断、行列错位。
- `语义风险`：`0` 与空值混淆、`不适用` 与 0 混淆、文本说明与表格数字冲突。

展示原则：

- 勾稽问题继续用“问题编号 + 定位”主导。
- 数据质量提示使用“复核提示”口径，不抢占主问题编号。
- 对客户报告使用克制语气：`需复核`、`来源不足`、`建议核对原表`，避免直接写成系统确定性错误。
- 对人工复核页展示更完整：reason code、来源字段、原始值、解析值、页码/行列。

## 8. 风险分级与展示口径

建议 P4-2 第一轮只做展示层风险分级，不改 `auto_status` 与数据库状态：

| 等级 | 触发示例 | 展示口径 | 是否阻断 |
|---|---|---|---|
| high | 缺关键表、source gate blocker、高置信来源值与解析值冲突 | `高风险，建议先复核后使用结论` | 不新增阻断逻辑，沿用现有发布门禁 |
| medium | 表头不完整、跨页/拆格疑似、较多空值或 `/` | `中风险，建议人工核对原表` | 不阻断 |
| low | 单个字段来源不完整、PDF 视觉验证降级 | `低风险，作为复核提示` | 不阻断 |
| info | payloadSource、materializeStatus、sourceJobId 等来源说明 | `来源说明` | 不阻断 |

与现有状态映射：

- `FAIL`：仍表示规则确定异常。
- `UNCERTAIN`：表示需要人工复核。
- `NOT_ASSESSABLE`：表示缺少足够输入，不应显示为确定问题。
- quality/visual/structure：默认作为复核提示展示，不纳入主勾稽编号和 reconciliation `problemCount`。

## 9. 自动验证计划

计划获批后，最小自动验证建议：

1. 后端单测
   - `npm.cmd test -- --runInBand consistencyChecks.test.ts`
   - 如新增 evidence view model helper，补充 focused unit tests。

2. 前端单测
   - `cd frontend && npm.cmd test -- --runInBand ConsistencyCheckView.test.js`
   - 如修改 issue adapter，追加 `issueAggregation.test.js` / `qualityIssueAdapter.test.js`。

3. 构建检查
   - `npm.cmd run build`
   - `cd frontend && npm.cmd run build`

4. PDF smoke
   - `npm.cmd run smoke:pdf`
   - 如本地 API/frontend 可用，再运行 strict-live；但不改 `scripts/pdf-smoke-baseline.js`。

5. 回归边界检查
   - `git diff --name-only`
   - 确认未修改数据库 migration、legacy EJS、旧接口删除逻辑、PDF worker/adapter 主链路。

## 10. 真实样本复测计划

计划获批并完成最小增强后，复测以下样本：

| 样本 | 目标 |
|---|---|
| report `4691` / version `4314` | 普通解析样本，确认无误报和证据展示不干扰正常报告 |
| report `4839` / version `4405` | 缺表/异常样本，确认 NOT_ASSESSABLE、缺表、发布阻断说明可读 |
| report `4837` / version `4457` | 表三复杂样本，确认表三字段定位和复核提示不引入噪音 |
| report `3670` | 既有 open issue 样本，确认问题编号、focus banner、badge、高亮仍一致 |
| report `4304` | table4 稳定样本，确认表四证据说明不破坏现有展示 |
| comparison `4670` | 异常比对样本，确认差异来源说明与 PDF 输出可读 |
| comparison `1143` | 长表格/PDF 样本，确认长表展示不新增截断回归 |
| GovInsight `city_721` / `721`, year `2025` | 确认 payloadSource、materializeStatus、sourceJobId/sourceReportVersionId 和数据质量说明可读 |

人工复测补充：

- 登录后检查 `/upload`、`/jobs`、`/jobs?tab=download`、`/comparison/4670` 的 TaskDrawer 可视化状态。
- 查看报告内容页定位：focus banner、`data-cell-path` 高亮、badge 编号、tooltip/证据说明是否一致。
- 查看 PDF：Comparison PDF 和 GovInsight PDF 至少能看到问题说明和数据来源，不要求本阶段做像素级基线。

## 11. 不改动边界

P4-2 第一轮明确不做：

- 不改数据库 schema，除非人工确认。
- 不删除 legacy EJS。
- 不删除旧接口。
- 不破坏 `/api/pdf-jobs`、`/api/comparisons/:id/pdf`、`/api/gov-insight/report-pdf`。
- 不改 `scripts/pdf-smoke-baseline.js`，除非人工确认。
- 不做 P4-3 PDF 视觉工具链固化。
- 不做 P4-4 大范围 UX 重构。
- 不做 P4-5 异常恢复和 job failure 加固主修复。
- 不改解析模型策略、prompt 主协议、数据库迁移和比对算法。
- 不提交、不 push，直到人工审核通过。

## 12. 是否建议开始修改

建议开始 P4-2 最小增强，但必须在本计划人工审核通过后进行。

推荐第一批修改顺序：

1. 增加 evidence 展示层 helper：统一把 `evidence_json`、`left_value/right_value/delta`、`source_gate` reason 映射成可读说明。
2. 先改 `ConsistencyCheckView`：让复核人员在问题卡片里直接看到“为什么判定有问题”。
3. 再改 `ReportDetail` focus banner：让定位后的内容页也能看到同一套证据说明。
4. 视风险再改 `ComparisonDetailView` 和 PDF print view：只补说明，不改导出链路。
5. 最后补 GovInsight 的来源状态展示：显示 payload 来源、物化状态、来源任务/版本和 dataQuality 摘要。

不建议第一轮直接修改数据库、比对算法或 PDF 主链路。当前最小价值点是把已有证据字段变成客户和人工复核人员能读懂的证据闭环。
