# 政府信息公开智能辅策系统现状审计报告

> 审计时间：2026-04-14  
> 审计目标：在**不直接大改业务逻辑**的前提下，摸清当前系统的整体结构、现有数据、报告生成链路、程序计算与模型生成边界、区县/部门数据可用性，以及后续改造的优先顺序。  
> 审计方法：基于代码、SQL 迁移、接口实现、前端规则层、当前 Postgres 实例的只读核查。  
> 说明：本轮未修改业务逻辑；个别结论如涉及业务语义推断，会明确标注“推断”或“不确定”。

---

## 一、系统概览

当前项目不是单一“报告生成器”，而是一个混合系统，同时承载了以下能力：

1. 年报上传、解析、入库
2. 结构化事实物化与质检
3. 旧版对比/诊断报告生成
4. GovInsight 智能辅策正式报告生成
5. 领导驾驶舱/区县部门对比的预研分析

### 1.1 项目结构概览

| 目录/模块 | 作用 |
| --- | --- |
| `src/` | Node + TypeScript 后端，负责上传、解析、入库、物化、API、后台任务、PDF 导出 |
| `frontend/src/govinsight/` | GovInsight 前端，含大屏、画像、风险分析、正式辅策报告、领导驾驶舱 |
| `data/uploads/` | 原始上传文件落盘目录 |
| `data/exports/` | 导出产物目录 |
| `src/db/migrations-llm.ts` | LLM/入库相关表、事实表、物化视图、AI 报告任务表定义 |
| `src/views/` | 旧版 EJS 模板，主要服务 comparison/report-factory 链路 |
| `docs/`、`.kiro/specs/` | 历史设计文档、改造方案草稿 |

### 1.2 前后端组成

- 后端入口：`src/index-llm.ts`
- 后端应用装配：`src/app-llm.ts`
- 前端 GovInsight 入口：`frontend/src/govinsight/DashboardApp.tsx`
- 正式辅策页：`frontend/src/govinsight/views/ReportGenerator.tsx`

### 1.3 当前并存的三套主要链路

#### A. GovInsight 正式“智能辅策报告”链路

- 以结构化年度统计数据 + 年报摘要 + 上年同期数据为输入
- 前端规则层先算指标、勾稽、评分卡、附件
- 再把上下文拼成 prompt 交给模型生成结构化正文 JSON
- 最后前端归一化、打印和导出 PDF

#### B. 旧版 comparison / report-factory 链路

- 以 facts / derived / cells 为基础
- 使用 `report-factory` 生成 Markdown/HTML 报告
- 使用 EJS 模板生成对比类页面/导出

#### C. 领导驾驶舱预研链路

- 面向区县/部门对比、风险分层、排序和画像
- 当前规则主要在前端实现
- 与正式辅策报告链路并未统一

### 1.4 现状总判断

当前系统已经具备“解析入库 + 结构化事实 + 程序算指标 + AI 生成正文 + 前端渲染/PDF”的雏形，但还不是一个真正后端化、可治理、可版本化的“规则驱动 + 数据计算 + AI 成文”架构。

真正的瓶颈不是“有没有数据”，而是：

1. 单位层级口径不统一
2. 正式规则层主要在前端
3. 正式报告上下文只覆盖单实体，未纳入区县/部门清单与画像
4. 旧链路、兼容链路、预研链路并存

---

## 二、报告生成相关代码位置

### 2.1 正式 GovInsight 辅策报告链路

| 文件 | 作用 | 关键结论 |
| --- | --- | --- |
| `src/routes/gov-insight.ts` | GovInsight 数据接口、年报摘要、AI 报告任务创建/查询/保存 | 正式报告依赖 `gov_open_annual_stats`、`report_versions.raw_text`、`ai_decision_reports` |
| `src/routes/gov-insight-pdf.ts` | 正式报告 PDF 导出 | 不是 Markdown 转 PDF，而是前端打印页 + Puppeteer 导出 |
| `src/services/GovInsightReportJobWorker.ts` | AI 报告后台任务执行 | 只消费 `prompt_text` 与 `system_instruction`，把模型输出 JSON 包成 envelope 后落库 |
| `frontend/src/govinsight/views/ReportGenerator.tsx` | 正式报告页面 | 登录时走 AI 后台任务，未登录时走规则稿 fallback |
| `frontend/src/govinsight/utils/aiReport.ts` | 正式报告核心规则层 | 指标、勾稽、评分卡、风险等级、附件、fallback、prompt、sanitize 全在这里 |
| `frontend/src/govinsight/api.ts` | 前端 API 封装 | `annual-data`、`annual-report-summary`、`ai-report` 的消费层 |

### 2.2 上传解析入库链路

| 文件 | 作用 | 关键结论 |
| --- | --- | --- |
| `src/routes/reports.ts` | 上传、发布、重跑、人工修订、维护接口 | 年报发布后才会形成正式 active version |
| `src/services/ReportUploadService.ts` | 创建 `reports`/`report_versions`、落盘原文件、创建 parse job | 新上传版本默认 `pending_review`，不会自动成为正式版本 |
| `src/services/LlmJobRunner.ts` | parse/materialize/checks 任务执行器 | parse 写 `parsed_json`，materialize 写 facts/cells，并在必要时刷新 stats 视图 |
| `src/services/SegmentedAnnualReportParse.ts` | 按章节分段、修复 canonical sections | parse 输出不是随意 JSON，而是被修到规范结构 |
| `src/services/MaterializeService.ts` | 从 `parsed_json` 抽取 table_2/3/4 到事实表 | 当前结构化核心来源是表二/表三/表四 |
| `src/services/data-center/MaterializeService.ts` | materialize 封装层 | 实际仍调用根级 `MaterializeService` |
| `src/services/ConsistencyCheckService.ts` | 一致性校验并入库 | 有独立 checks 体系，但正式辅策报告未直接复用全部结果 |
| `src/services/GovInsightStatsService.ts` | 刷新 `gov_open_annual_stats` | 这是正式报告结构化数据更新的关键节点 |
| `src/db/migrations-llm.ts` | 事实表、派生表、AI 任务表、物化视图定义 | `gov_open_annual_stats` 的层级口径问题在这里定型 |

### 2.3 旧链路 / 兼容逻辑 / 预研逻辑

| 文件 | 作用 | 问题 |
| --- | --- | --- |
| `src/services/report-factory/ReportFactoryService.ts` | 旧版 Markdown/HTML 报告工厂 | 与 GovInsight 正式报告并存 |
| `src/services/ReportFactoryService.ts` | 另一版报告工厂实现 | 存在重复/并行实现 |
| `src/views/comparison_report.ejs` | 旧版 EJS 报告模板 | 非 GovInsight 正式模板，但仍可执行 |
| `frontend/src/govinsight/data.ts` | 前端数据适配 | 有 `LEGACY_FEES_BY_YEAR`、`LEGACY_2024_OUTCOME_DETAIL` 等兼容兜底 |
| `frontend/src/govinsight/utils/aiReport.ts` | AI 报告归一化与兼容 | 同时兼容 normalized report、stored envelope、raw narrative、legacy summary 格式 |
| `frontend/src/govinsight/leader-cockpit/selectors.ts` | 领导驾驶舱实体分类与比较 | 仍在用名称后缀推断区县/部门 |

### 2.4 与报告生成直接相关的核心文件清单

- `src/index-llm.ts`
- `src/app-llm.ts`
- `src/routes/gov-insight.ts`
- `src/routes/gov-insight-pdf.ts`
- `src/routes/reports.ts`
- `src/services/GovInsightReportJobWorker.ts`
- `src/services/GovInsightStatsService.ts`
- `src/services/LlmJobRunner.ts`
- `src/services/ReportUploadService.ts`
- `src/services/SegmentedAnnualReportParse.ts`
- `src/services/MaterializeService.ts`
- `src/services/data-center/MaterializeService.ts`
- `src/services/ConsistencyCheckService.ts`
- `src/db/migrations-llm.ts`
- `frontend/src/govinsight/views/ReportGenerator.tsx`
- `frontend/src/govinsight/utils/aiReport.ts`
- `frontend/src/govinsight/data.ts`
- `frontend/src/govinsight/leader-cockpit/selectors.ts`
- `frontend/src/govinsight/leader-cockpit/riskPolicy.ts`
- `frontend/src/govinsight/leader-cockpit/riskRuleSet.ts`
- `frontend/src/govinsight/leader-cockpit/utils/stats.ts`

---

## 三、现有数据资产清单

## 3.1 当前数据库真实覆盖情况

以下为本次只读核查得到的当前真实数据：

### `regions` 层级分布

| level | 数量 |
| --- | --- |
| 1 | 4 |
| 2 | 58 |
| 3 | 820 |
| 4 | 1027 |

### `reports` 中有 `active_version_id` 的层级分布

| level | 数量 |
| --- | --- |
| 2 | 30 |
| 3 | 711 |
| 4 | 3227 |

### `report_versions.review_status`

| 状态 | 数量 |
| --- | --- |
| `published` | 4011 |
| `pending_review` | 8 |

### active report 年份分布

| 年份 | 数量 |
| --- | --- |
| 2025 | 817 |
| 2024 | 933 |
| 2023 | 816 |
| 2022 | 742 |
| 2021 | 656 |
| 2020 | 3 |
| 2019 | 1 |

### `gov_open_annual_stats` 的 `org_type`

当前只有两类：

- `city`
- `district`

没有 `department`

### `gov_open_annual_stats` 按年份/类型分布

| 年份 | city | district |
| --- | --- | --- |
| 2025 | 4 | 813 |
| 2024 | 7 | 926 |
| 2023 | 6 | 810 |
| 2022 | 5 | 737 |
| 2021 | 4 | 652 |
| 2020 | 3 | 0 |
| 2019 | 1 | 0 |
| `NULL` | 55 | 811 |

### `gov_open_annual_stats WHERE year IS NULL`

- 总数：`866`

这说明物化视图把“没有 active 年度报告的 region”也带进了正式消费视图。

### 事实表覆盖率

| 层级 | active reports | application facts | active disclosure facts | legal facts |
| --- | --- | --- | --- | --- |
| level 2 | 30 | 30 | 30 | 30 |
| level 3 | 711 | 708 | 711 | 708 |
| level 4 | 3227 | 3216 | 3217 | 3226 |

结论：底层结构化事实数据并不稀缺，尤其 level 3/4 覆盖很高。

### AI 报告使用情况

| 表 | 数量 |
| --- | --- |
| `ai_decision_reports` | 3 |
| `gov_insight_report_jobs` | 7 |

结论：正式 AI 辅策报告链路目前仍处于很早期阶段，使用量较低。

---

## 3.2 数据存储资产总表

| 数据资产 | 来源 | 存储位置 | 关键字段 | 是否可直接用于计算 | 是否可直接用于生成报告 | 主要问题 |
| --- | --- | --- | --- | --- | --- | --- |
| `reports` | 上传、原始导入 | DB: `reports` | `region_id`、`year`、`unit_name`、`active_version_id` | 否 | 间接 | 只是主表，不含正文事实 |
| `report_versions` | 解析前后版本管理 | DB: `report_versions` | `storage_path`、`raw_text`、`parsed_json`、`provider`、`model`、`prompt_version`、`review_status` | 部分可 | 是，摘要/回溯/调试可用 | 正文、表格、原文混在一起，跨版本兼容复杂 |
| `report_version_parses` | parse 历史记录 | DB | `provider`、`model`、`output_json` | 否 | 否 | 更偏审计日志 |
| `fact_active_disclosure` | table_2 物化 | DB | `category`、`made_count`、`repealed_count`、`valid_count`、`processed_count`、`amount` | 是 | 间接 | 需要二次聚合 |
| `fact_application` | table_3 物化 | DB | `applicant_type`、`response_type`、`count` | 是 | 间接 | 粒度丰富，但正式报告未直接消费 |
| `fact_legal_proceeding` | table_4 物化 | DB | `case_type`、`result_type`、`count` | 是 | 间接 | 细粒度 legal 结果未完整进入正式链路 |
| `cells` | 表格单元格留痕 | DB | `table_id`、`row_key`、`col_key`、`value_raw`、`value_num`、`normalized_value` | 不宜直接用于正式指标 | 否 | 更适合审计和追溯 |
| `gov_open_annual_stats` | facts 聚合视图 | 物化视图 | `org_id`、`org_name`、`org_type`、`parent_id`、`year` + table2/3/4 核心字段 | 是 | 是 | `org_type` 只有 `city/district`，并混入 `year = null` |
| `derived_unit_year_metrics` | 数据中心派生指标 | DB | `quality_issue_count_*`、`application_total`、`legal_total`、`derived_risk_score` | 是 | 当前正式报告未用 | 与 GovInsight 正式链路脱节 |
| `derived_region_year_metrics` | 数据中心区域派生指标 | DB | `report_count`、`materialize_succeeded`、`application_total`、`legal_total`、`derived_risk_*` | 是 | 当前正式报告未用 | 与正式报告链路隔离 |
| `ai_decision_reports` | AI 报告持久化 | DB | `region_id`、`year`、`content_json`、`model_used` | 否 | 是 | 当前可能混存多种报告格式 |
| `gov_insight_report_jobs` | AI 正式报告任务表 | DB | `prompt_text`、`system_instruction`、`request_config`、`status` | 否 | 间接 | 无独立 `prompt_version` |

---

## 3.3 按层级的数据资产清单

### 地市层

| 项目 | 现状 |
| --- | --- |
| 是否存在 | 是 |
| 主要来源 | 年报解析后的 table_2/3/4 |
| 主要存储位置 | `reports`、`report_versions`、`fact_*`、`gov_open_annual_stats` |
| 是否可直接用于计算 | 是 |
| 是否已进入正式报告链路 | 是 |
| 主要问题 | 城市覆盖数量偏少；年份覆盖不完整；同一视图中混入 `year = null` 行 |

### 区县层

| 项目 | 现状 |
| --- | --- |
| 是否存在 | 是，但与开发区/镇街混杂 |
| 主要来源 | 年报解析后的 table_2/3/4 |
| 主要存储位置 | `reports`、`report_versions`、`fact_*`、`gov_open_annual_stats` |
| 是否可直接用于计算 | 底层基本可以 |
| 是否已进入正式报告链路 | 单实体可以，但城市总报告中未形成区县专题 |
| 主要问题 | `org_type` 被压成 `district`；层级与名称口径混乱 |

### 部门层

| 项目 | 现状 |
| --- | --- |
| 是否存在 | 是，而且数量很大 |
| 主要来源 | 年报解析后的 table_2/3/4 |
| 主要存储位置 | `reports`、`report_versions`、`fact_*`、`gov_open_annual_stats` |
| 是否可直接用于计算 | 底层 facts 基本可以 |
| 是否已进入正式报告链路 | 不能作为“部门层”稳定接入 |
| 主要问题 | 在物化视图中也被标成 `district`；无独立部门类型 |

---

## 3.4 当前可直接消费的正式报告字段

GovInsight 正式链路当前真正直接依赖的核心结构化字段，来自 `gov_open_annual_stats`：

### 单位识别字段

- `org_id`
- `org_name`
- `org_type`
- `parent_id`
- `year`

### 主动公开 / 规范性文件 / 行政行为字段

- `reg_published`
- `reg_active`
- `reg_abolished`
- `doc_published`
- `doc_active`
- `doc_abolished`
- `action_licensing`
- `action_punishment`
- `action_force`
- `fees_amount`

### 依申请公开与争议字段

- `app_new`
- `app_carried_over`
- `app_carried_forward`
- `source_natural`
- `outcome_public`
- `outcome_partial`
- `outcome_not_open`
- `outcome_unable`
- `outcome_ignore`
- `outcome_other`
- `outcome_unable_no_info`
- `outcome_unable_need_creation`
- `outcome_unable_unclear`
- `outcome_not_open_state_secret`
- `outcome_not_open_law_forbidden`
- `outcome_not_open_danger`
- `outcome_not_open_process`
- `outcome_not_open_internal`
- `outcome_not_open_third_party`
- `outcome_not_open_enforcement`
- `outcome_not_open_admin_query`
- `outcome_complaint`
- `outcome_ignore_repeat`
- `outcome_publication`
- `outcome_massive`
- `outcome_confirm`
- `outcome_overdue_correction`
- `outcome_overdue_fee`
- `outcome_other_reasons`
- `rev_total`
- `rev_corrected`
- `lit_total`
- `lit_corrected`

---

## 3.5 当前哪些字段能支撑同比、占比、勾稽、排序、风险标签

### 可以较可靠支撑的字段

- 同比/排序：`app_new`、`rev_total`、`lit_total`
- 占比：`app_new`、`app_carried_over`、`app_carried_forward`、`outcome_public`、`outcome_partial`、`outcome_unable`、`outcome_unable_no_info`、`outcome_not_open`、`rev_total`、`rev_corrected`、`lit_total`、`lit_corrected`
- 勾稽：`app_new`、`app_carried_over`、`app_carried_forward`、`outcome_*` 结果总量及明细项
- 风险标签：通过上述字段派生出的 `carryForwardRate`、`substantiveRate`、`unableRate`、`noInfoShareInUnable`、`revRate`、`litRate`、`overallCorrectionRate`

### 只能展示、不宜直接作为正式计算依据的字段

- `org_type`
  - 当前层级口径不可靠
- `org_name` 后缀推断
  - 只适合作为前端临时分类线索，不适合作为正式分析口径
- `raw_text` 与 `annualReportSummary.highlights/problemSnippets/improvements`
  - 适合辅助成文，不适合严肃数值计算
- 前端 `sources.legal`
  - 是 `newReceived - naturalCount` 的派生值，不是后端标准字段
- 前端 `fees.amount` 的历史兜底
  - 2020-2024 可能走 `LEGACY_FEES_BY_YEAR`
- 前端 legal 明细中的 `maintained/other/pending`
  - 当前从 stats view 转换时直接填 0，不应视为真实结构化值

---

## 3.6 重要补充：底层 facts 比正式报告当前使用的更丰富

### `fact_application`

保留了更细的申请主体分类：

- `natural_person`
- `legal_person_commercial`
- `legal_person_research`
- `legal_person_social`
- `legal_person_legal`
- `legal_person_other`
- `total`

### `fact_legal_proceeding`

保留了更细的结果分类：

- `maintain`
- `correct`
- `other`
- `unfinished`
- `total`

结论：底层结构化事实比正式报告当前暴露出来的字段丰富，当前瓶颈不在“底层没结构化”，而在“正式消费层压缩过度、层级口径失真、未形成稳定多实体输入”。

---

## 四、当前报告生成链路说明

## 4.1 正式“智能辅策报告”的真实生成流程

### 阶段 1：原始年报进入系统

- PDF/HTML/TXT/MD 上传后，由 `ReportUploadService` 创建 `reports` 与 `report_versions`
- 新版本默认 `pending_review`
- 原始文件落盘到 `data/uploads/<region>/<year>/...`

### 阶段 2：LLM 解析原始年报

- `LlmJobRunner.processParseJob` 调用 provider.parse
- 解析结果再经过 `SegmentedAnnualReportParse.normalizeAnnualReportOutputFromSource`
- 输出被修复为 canonical `sections` 结构
- 最终写回 `report_versions.parsed_json` 与 `report_versions.raw_text`

### 阶段 3：结构化物化

- `processMaterializeJob` 调用 materialize
- `MaterializeService` 从 `parsed_json` 提取：
  - 表二 -> `fact_active_disclosure`
  - 表三 -> `fact_application`
  - 表四 -> `fact_legal_proceeding`
  - 同时写 `cells`

### 阶段 4：刷新 GovInsight 正式消费视图

- 当版本已发布或当前就是 active version 时，刷新 `gov_open_annual_stats`

### 阶段 5：前端加载正式报告所需输入

#### 结构化年度数据

- `GET /api/gov-insight/annual-data`
- 来源：`gov_open_annual_stats`

#### 年报摘要

- `GET /api/gov-insight/annual-report-summary`
- 来源：`report_versions.raw_text`
- 若 `raw_text` 为空，则回读 `storage_path`
- 再用规则提取：
  - `highlights`
  - `problemSnippets`
  - `improvements`
  - `sections.proactiveDisclosure`
  - `sections.requestDisclosure`
  - `sections.platformConstruction`
  - `sections.supervision`
  - `sections.problems`
  - `sections.improvements`

### 阶段 6：前端构造正式报告上下文

`aiReport.ts` 会构造 `ReportContextPayload`，包含：

- 当前年度指标快照
- 上年同期快照
- 风险等级与风险标签
- top signals
- data warnings
- comparison notes
- annual report summary
- data quality

### 阶段 7：程序先算指标，再喂给模型

正式报告不是让模型自己读原始 facts 去口算。

真实做法是：

1. 前端规则层先把核心数值、评分卡、勾稽、风险标签、附件都算出来
2. 再由前端把 `ReportContextPayload` 序列化进 prompt
3. 后端只负责创建任务、调用模型、校验 JSON、落库

### 阶段 8：AI 生成结构化正文 JSON

模型输出的目标结构包括：

- `metadata`
- `overallJudgments`
- `riskItems`
- `confirmedFacts`
- `prudentAnalyses`
- `unansweredQuestions`
- `rectificationTasks`
- `closing`
- `notes`

### 阶段 9：AI 结果落库

`GovInsightReportJobWorker` 把模型返回 JSON 包装成：

```json
{
  "_reportFormat": "govInsightFormalReportV2",
  "narrative": { ... }
}
```

然后写入 `ai_decision_reports.content_json`

### 阶段 10：前端再做一次归一化和兜底

`normalizeReportData` 会处理多种情况：

- 已经是 normalized formal report
- 是 stored envelope
- 是 raw narrative
- 是 legacy summary
- 如果不匹配，退回规则稿 fallback

并且它还会：

- 再次 sanitize AI 输出
- 重新生成 `scorecards`
- 重新生成 `dataQuality`
- 重新生成 `appendices`

### 阶段 11：打印与 PDF 导出

- 打印：打开前端打印路由
- PDF：`gov-insight-pdf.ts` 启动 Puppeteer 打开前端打印页，再 `page.pdf()`

结论：当前 GovInsight 正式链路**不是**“先生成 Markdown 再转 PDF”。

---

## 4.2 流程说明表

| 阶段 | 输入 | 程序处理 | 模型参与 | 输出 |
| --- | --- | --- | --- | --- |
| 上传入库 | PDF/HTML/TXT/MD | 写 `reports`、`report_versions`、原文件落盘 | 否 | 候选版本 |
| 解析 | 原文件 | LLM parse + 分段修复 + 稳定化 | 是 | `parsed_json`、`raw_text` |
| 物化 | `parsed_json` | 提取 table_2/3/4 -> facts/cells | 否 | `fact_*`、`cells` |
| 聚合 | facts | 刷新 `gov_open_annual_stats` | 否 | 年度结构化视图 |
| 摘要 | `raw_text` | 规则提取摘要 | 否 | `AnnualReportSummary` |
| 报告上下文 | 结构化数据 + 摘要 + 上年同期 | 计算指标、勾稽、评分、附件、fallback | 否 | `ReportContextPayload` |
| 正文生成 | `ReportContextPayload` | prompt 拼装 | 是 | narrative JSON |
| 报告归一化 | AI JSON / fallback | sanitize + merge + 补齐 | 否 | 正式报告对象 |
| 导出 | 正式报告对象 | 打印页渲染 / Puppeteer | 否 | PDF |

---

## 4.3 用户关注的关键判断

| 判断项 | 当前答案 |
| --- | --- |
| 程序先算指标再喂给模型 | 是 |
| 模型自己读原始数据后生成指标 | 否 |
| 模板硬编码 | 有，主要在 fallback 和静态整改任务里 |
| 多段 prompt 拼接 | 有，本质是前端拼上下文 JSON + 输出约束 |
| 生成后再二次替换/纠偏 | 有，`normalizeReportData` 会 sanitize/fallback |
| 先生成 Markdown 再转 PDF | 否，GovInsight 正式链路不是这样 |

---

## 4.4 首页指标、总体判断、风险事项、整改任务、附件分别由谁生成

| 内容 | 生成方 |
| --- | --- |
| 首页指标 | 程序 |
| 评分卡 | 程序 |
| 数据质量校验 | 程序 |
| 附件口径说明 / 使用边界 / 补数建议 | 程序 |
| 总体判断 | AI 为主，程序 fallback + sanitize |
| 风险事项 | AI 为主，程序有默认优先级与 fallback 风险项 |
| 整改任务 | AI 为主，程序有静态 fallback 任务表 |
| 结语/说明 | AI 为主，程序兜底 |

---

## 4.5 当前区县/部门数据是否已进入正式报告生成链路

结论：**底层数据存在，但没有以“真正三级口径”进入城市总报告的正式上下文。**

当前 `ReportContextPayload` 只覆盖：

- 当前实体
- 上年同期
- 年报摘要

它不包含：

- 下属区县清单
- 下属部门清单
- 单位分布
- 排序结果
- 重点单位画像

因此：

- 可以对“某个区县/某个部门”单独生成单体报告
- 不能稳定地在“地市总报告”中形成区县/部门章节、榜单、画像和排序

---

## 五、程序计算与模型生成的边界现状

## 5.1 边界总表

| 内容 | 当前归属 | 说明 |
| --- | --- | --- |
| 新收申请数、受理总量、结转率、实质公开率、无法提供占比 | 程序化 | 在 `buildMetricsSnapshot` 中直接算出 |
| 同比、占比、复议纠正率、诉讼纠正率、整体纠正占比 | 程序化 | 均在前端规则层计算 |
| 勾稽关系校验 | 程序化 | `buildDataQualityStatus` 负责 |
| 风险等级 / 风险标签 | 程序化 | `determineRating` 负责正式报告风险级别 |
| 首页 scorecards | 程序化 | `buildScorecards` 负责 |
| 附件中的口径说明 / 使用边界 / 补数建议 | 程序化 | `buildAppendix*` 负责 |
| metadata 正式文风表达 | 半程序化半模型化 | AI 写，程序 sanitize/fallback |
| overallJudgments | 半程序化半模型化 | AI 写，异常时强制退回 fallback |
| riskItems | 半程序化半模型化 | AI 写，优先级与 fallback 风险项由程序控制 |
| 重点风险事项排序 | 半程序化半模型化 | 程序有默认优先级，AI 可改内容但排序仍受枚举规则约束 |
| rectificationTasks 字段 | 半程序化半模型化 | AI 生成，程序用 fallback 静态任务结构兜底 |
| confirmedFacts | 半程序化半模型化 | AI 生成，但 data quality 不通过时强制回退程序稿 |
| 原文摘要 | 程序化 | 由规则从 `raw_text` 提取，不走 AI |
| PDF 导出 | 程序化 | 前端渲染 + Puppeteer |

---

## 5.2 已经程序化的部分

### 指标计算

当前由程序直接计算的核心指标包括：

- `newReceived`
- `acceptedTotal`
- `carryForwardRate`
- `substantiveRate`
- `unableRate`
- `noInfoShareInUnable`
- `revRate`
- `litRate`
- `overallCorrectionRate`

### 勾稽关系

程序当前做的主要勾稽包括：

1. 受理总量 = 上年结转 + 本年新收
2. 办理结果合计 + 结转下年 = 受理总量
3. 不予公开子项合计 = 不予公开总量
4. 无法提供子项合计 = 无法提供总量
5. 不予处理子项合计 = 不予处理总量
6. 其他处理子项合计 = 其他处理总量

### 风险等级

正式报告中的 `A/B/C` 级风险标签，目前由程序规则决定：

- 数据异常 -> `B` 且“需先复核数据”
- 低纠错、低结转 -> `A`
- 高纠错或高结转 -> `C`
- 其他中间状态 -> `B`

### 附件与边界

附件里的以下内容全部是程序化生成：

- 指标审计表
- 勾稽校验表
- 使用边界
- 不适用范围
- 建议补充的数据清单

---

## 5.3 半程序化、半模型化的部分

以下内容由 AI 生成，但受程序强约束和 fallback 控制：

- `metadata`
- `overallJudgments`
- `riskItems`
- `confirmedFacts`
- `prudentAnalyses`
- `unansweredQuestions`
- `rectificationTasks`
- `closing`
- `notes`

约束方式包括：

1. prompt 明确 JSON schema
2. system instruction 强制“只返回合法 JSON”
3. 前端再次 sanitize
4. 不合格时使用 fallback
5. 数据勾稽异常时直接压制 AI 的事实层内容

---

## 5.4 主要依赖模型自由生成的部分

相对更依赖模型表达能力的部分包括：

- 正式机关文风
- 综合判断的语言组织
- 风险事项的成文表达
- 审慎分析语气
- 整改任务的细节措辞
- 结语与提示性文字

但需要注意：这些内容虽然“看起来像全文 AI 生成”，实际上是建立在大量程序规则约束之上的。

---

## 5.5 当前最危险、最容易出错的部分

### 1. 层级口径

这是最危险的，不是 AI 出错，而是基础数据口径错了：

- `gov_open_annual_stats` 只有 `city/district`
- 非 city 的大量实体都被标成 `district`
- 其中混有区县、部门、镇街、开发区

### 2. AI 报告存储格式混杂

当前 `ai_decision_reports` 里可能混有：

- stored envelope
- normalized report
- legacy 兼容格式

这也是为什么 `normalizeReportData` 逻辑复杂。

### 3. 正式规则层在前端

这会限制：

- 批量生成
- 服务化复用
- 规则版本管理
- 审计与追溯

### 4. fallback 内容的“拟正式感”

当前规则稿和静态整改任务写得比较像正式定稿，容易造成“看起来已经高度智能化”，但本质上仍包含明显模板/兜底成分。

---

## 六、区县/部门数据可用性评估

## 6.1 现有系统里是否已经有区县、部门两层数据

结论：**有，而且数量很大。**

从当前库中可直接看到很多被标成 `district` 的 `level 4` 实体，其实是：

- 镇街：如 `白蒲镇`
- 区县部门：如 `崇川区财政局`
- 区县政府办公室：如 `崇川区人民政府办公室`
- 区县委办局：如 `崇川区发展和改革委员会`
- 泛化部门名：如 `财政局`、`城管局`

因此，当前问题不是“没有区县/部门数据”，而是“区县/部门数据没有被按稳定口径组织”。

---

## 6.2 这些数据是否结构化

### 底层 facts 层

是，结构化程度较高：

- table_2 -> `fact_active_disclosure`
- table_3 -> `fact_application`
- table_4 -> `fact_legal_proceeding`

### 正式报告消费层

部分结构化，但不够用：

- `gov_open_annual_stats` 已聚合出核心年度指标
- 但它没有稳定表达部门层

### 结论

- 底层 facts：是
- 正式报告消费层：部分是
- 稳定三级分析口径：否

---

## 6.3 字段口径是否统一

结论：**不统一，而且是当前最大障碍。**

主要错位有三层：

### 1. `regions.level` 的业务语义不干净

根据数据库样本观察：

- `level 3` 混有区县、开发区、市级部门、街道
- `level 4` 混有镇街、区县部门等

说明：这是基于样本和现有表现的推断，代码中没有更完整的业务定义文档，故对“每个 level 的官方语义”仍有不确定性。

### 2. `gov_open_annual_stats` 只按 `level <= 2 ? city : district` 二分

这意味着：

- 只要不是 city，就一律变成 `district`
- 部门、镇街、开发区都没有单独类型

### 3. 领导驾驶舱又用名称后缀推断区县/部门

例如：

- `区/县/开发区/高新区` -> district
- `局/委员会/委/办/中心/院/馆/所/署/厅` -> department

这与后端 `level/org_type` 不是同一套口径。

---

## 6.4 是否足以支持重点分析需求

| 分析能力 | 当前底层数据是否足够 | 当前正式链路是否已支持 | 主要阻塞 |
| --- | --- | --- | --- |
| 单位申请量分布 | 基本足够 | 未正式接入主报告 | 层级口径混乱；无城市级子单位榜单输入 |
| 单位结转率比较 | 基本足够 | 未正式接入主报告 | 有字段但无统一比较服务 |
| 单位“不掌握相关信息”占比比较 | 基本足够 | 未正式接入主报告 | 有字段但未形成正式单位级清单/排序输出 |
| 单位复议诉讼分布 | 部分足够 | 未正式接入主报告 | totals/corrected 有，但更细 legal 结果未暴露到正式视图 |
| 单位高风险画像 | 部分足够 | 仅领导驾驶舱预研型支持 | 风险规则未后端统一化，单位类型不稳定 |

---

## 6.5 如果现在不能稳定支持，原因是什么

不是单一原因，而是多个问题叠加：

1. 不是“没数据”
2. 是“有数据但层级散”
3. 是“有数据但字段口径乱”
4. 是“有数据但没按三级结构进入正式报告上下文”
5. 是“有数据但当前规则层不在后端、难以形成可治理输出”

---

## 6.6 如果后续接入，建议以什么形式进入报告

建议按顺序接入，不要一上来直接塞进主报告正文。

### 建议顺序

#### 第一层：附件清单 / 单独监测表

优点：

- 风险最低
- 最容易校验口径
- 不会过早污染主报告定稿风格

#### 第二层：风险单位画像清单

建议做法：

- 系统先生成结构化画像卡片
- AI 再为每个重点单位生成 2-3 段摘要

#### 第三层：主报告正文专题章节

前提：

- 单位层级口径稳定
- 指标分母稳定
- 风险排序逻辑稳定
- 清单和画像已跑通

---

## 七、当前核心问题清单

## 7.1 数据层问题

### 问题 1：`gov_open_annual_stats` 把组织目录和年度事实混在一起

由于 `regions LEFT JOIN reports`，没有 active 年度报告的 region 也会进入视图，造成 `year IS NULL` 仍入正式消费视图。

当前库中这样的行有：

- `866` 条

直接影响：

- `/orgs` 会混入无效年度事实口径
- `/years` 理论上可能带出 `NULL`

### 问题 2：正式消费视图过于扁平

当前视图只保留了“够大屏展示”的一组扁平指标，但不适合支撑三级分析和单位画像。

---

## 7.2 字段映射问题

### 问题 1：底层丰富字段被压缩

- `fact_application` 的申请主体细分未进入正式链路
- `fact_legal_proceeding` 的 `maintain/other/unfinished` 未进入正式链路

### 问题 2：前端存在派生替代字段

- `legalCount = newReceived - naturalCount`
- 部分 legal 结果细项被直接填 0

这些做法会让“展示层字段”与“底层结构化字段”产生错位。

---

## 7.3 口径一致性问题

这是当前最严重的问题之一：

1. 物化视图：只有 `city/district`
2. 前端树：直接相信 `org_type`
3. 领导驾驶舱：再用名称后缀猜区县/部门
4. 实际 `regions.level 3/4`：混有多种实体类型

结论：当前没有统一的“地市—区县—部门”正式口径。

---

## 7.4 指标计算问题

当前正式报告的指标计算是存在的，但主要在前端而不是后端：

- 指标公式不容易统一复用
- 不利于后台批量生成
- 不利于规则版本管理
- 不利于对外提供稳定服务接口

---

## 7.5 AI prompt 问题

当前 prompt 设计方向总体正确，但存在结构性缺陷：

1. prompt 构建在前端，不利于服务化治理
2. `gov_insight_report_jobs` 没有独立 `prompt_version`
3. 模型输入只看单实体上下文，不看城市下属单位分布/排序/画像
4. 规则和事实仍以大段自然语言 + JSON 上下文拼装，不是标准化 rule manifest

---

## 7.6 模板结构问题

当前正式报告模板并不是单一模板，而是被拆散在多处：

- 前端规则层
- AI prompt
- AI 输出 sanitize/fallback
- 打印页/PDF 导出

这导致“模板治理”不等于改一份模板文件，而是要同时理解：

1. 规则生成结构
2. prompt 输出结构
3. sanitize 约束结构
4. 打印渲染结构

---

## 7.7 区县/部门数据未被利用的问题

当前最可惜的地方在于：

- 底层其实已经有大量 `level 3/4` facts
- 领导驾驶舱已经能做一些单位级比较
- 但正式辅策报告没有把这些单位级数据组织成正式输入

因此瓶颈不是“采不到”，而是“没有形成正式城市总报告的数据上下文结构”。

---

## 7.8 哪些问题会直接影响“规则驱动 + 数据计算 + AI 成文”改造路线

影响最大的四个基础问题是：

1. 单位层级类型没有 canonical 口径
2. 正式报告上下文没有统一后端指标服务
3. AI 报告存储格式不单一
4. 旧链路、兼容逻辑、预研链路边界不清

---

## 八、建议的下一步改造路线

## 8.1 总体判断

当前系统：

- **不适合直接无痛切换**为完整的新架构
- **但适合在现有链路上分阶段演进**

第一刀不应该先改模板或 prompt 文案。

第一刀应该先改：

1. 层级口径
2. 指标服务底座
3. 正式输入 schema

---

## 8.2 第一阶段：必须先做什么

目标：先把“数据与规则底座”做实。

### 1. 建立统一单位维表口径

建议明确 canonical `unit_type`，至少区分：

- `city`
- `district`
- `department`
- `town_street`
- `functional_zone`

不能再依赖：

- `level <= 2 ? city : district`

### 2. 重建 GovInsight 正式消费视图或服务

建议新增 `gov_open_annual_stats_v2` 或直接做后端聚合服务，不建议继续在现视图上叠补丁。

必须做到：

1. 排除 `year IS NULL`
2. 保留 `region_id`
3. 明确 `unit_type`
4. 明确 `parent_region_id`
5. 补齐单位比较所需分子分母字段
6. 暴露更多申请主体/争议细项

### 3. 抽出后端指标服务和规则服务

把以下能力从前端搬到后端：

- 同比/占比
- 勾稽
- 风险标签
- 排序
- 整改任务结构骨架
- 附件审计表

前端只负责展示。

### 4. 固化正式报告输入 schema

把 AI 输入从“前端临时拼的 context JSON”升级为后端统一生成的 `report_payload_v1`。

---

## 8.3 第二阶段：再做什么

目标：让三级分析先以结构化输出进入系统。

### 1. 先接入区县清单与部门清单

推荐形式：

- 附件清单
- 单独监测表
- 风险单位画像清单

### 2. 统一风险规则

正式报告与领导驾驶舱不要再分别维护半重叠规则。

需要统一：

- 字段口径
- 分母口径
- 样本保护
- 阈值
- 排序依据

### 3. 给 AI 报告链增加版本化能力

至少引入：

- prompt version
- rule version
- metrics version
- output schema version

### 4. 清理 `ai_decision_reports` 混合格式

至少统一成一种正式存储协议。

---

## 8.4 第三阶段：最后做什么

目标：真正升级成“规则驱动 + 数据计算 + AI 成文”。

### 1. 主报告改成“系统先出骨架，AI 只写成文层”

### 2. 区县/部门专题章节进入主报告正文

### 3. 重点单位画像变成可批量生产的正式产物

### 4. 批量化、定时化、审计追踪、历史回溯比对再上

---

## 8.5 当前系统是否适合直接改造成目标架构

### 结论

**不适合直接改造成完整目标架构，但适合分阶段演进。**

原因不是功能太差，而是基础口径还没统一：

- 数据存在
- facts 覆盖高
- 正式链路雏形也已存在

真正不成熟的地方是：

- 口径
- 规则位置
- 存储协议
- 多实体输入结构

---

## 8.6 如果适合演进，第一刀应该先改哪里

第一刀建议改：

### `单位层级口径 + 正式消费层`

而不是：

- 先改报告模板
- 先改 prompt 文案
- 先改 PDF 样式

因为如果底层 `city/district/department` 口径不稳，后面所有智能生成都会建立在错误分层之上。

---

## 8.7 区县/部门数据应该何时接入

建议时点：

1. 第一阶段完成单位口径和指标底座之后
2. 先以附件/监测表接入
3. 再进入重点单位画像
4. 最后进入主报告正文专题

不建议当前直接进入主报告正文。

---

## 8.8 主报告、区县清单、部门清单、重点单位画像谁来生成

| 产物 | 系统直接生成 | AI 成文 |
| --- | --- | --- |
| 主报告首页指标、评分卡、风险等级、勾稽、附件 | 必须系统生成 | 否 |
| 主报告总体判断、风险阐释、综合结语 | 系统先给事实骨架 | 适合 AI 写 |
| 区县清单 | 必须系统生成 | 最多 AI 写一句总述 |
| 部门清单 | 必须系统生成 | 最多 AI 写一句总述 |
| 重点单位画像 | 画像字段和标签必须系统生成 | 可由 AI 生成简短诊断段落 |

---

## 九、最应该优先处理的 3 个问题

### 1. 重建单位层级口径

当前 `gov_open_annual_stats` 把部门、镇街、开发区都压成 `district`，这是所有三级分析失真的根源。

### 2. 把核心指标与规则从前端抽到后端

现在“规则驱动”主要在前端 `aiReport.ts`，不适合作为未来架构底座。

### 3. 统一正式报告输入/输出协议

当前 `ai_decision_reports` 可能混有 envelope、normalized report、legacy 兼容路径，后续很难做批量化、审计追踪和版本管理。

---

## 十、为了支撑“规则驱动 + 数据计算 + AI 成文”架构，当前系统已经具备的条件 / 仍然缺失的条件

## 10.1 已具备

- 已有完整上传、解析、物化、发布链路
- 已有稳定事实表：
  - `fact_active_disclosure`
  - `fact_application`
  - `fact_legal_proceeding`
- 已有单元格留痕 `cells`，可追溯
- 已有正式报告 AI 后台任务机制
- 已有“程序算指标 + AI 生成正文 + 前端渲染/PDF”的雏形
- 已有一定的数据质检与一致性校验能力
- 已有大量 `level 3/4` 数据，区县/部门不是空白

## 10.2 部分具备

- 多层级数据覆盖已存在，但层级语义不统一
- 风险规则已存在，但分散在正式报告与领导驾驶舱两套逻辑里
- 派生指标表已存在，但尚未进入正式 GovInsight 主链路
- AI prompt 已强约束 JSON 输出，但缺少统一版本治理
- 正式报告已能 fallback 兜底，但 fallback 仍带明显模板化和静态任务痕迹

## 10.3 尚缺失

- 统一的 `unit_type` / `parent_region_id` / 三级实体口径
- 面向正式报告的后端指标服务
- 面向正式报告的后端规则服务
- 区县/部门进入城市总报告的标准化输入结构
- 统一、单一、可演进的 AI 报告存储协议
- prompt/rule/metrics/output 的版本管理
- 将旧 report-factory 链、GovInsight 正式链、领导驾驶舱预研链彻底划清边界
- 能稳定支撑“地市—区县—部门”三级比较、排序、画像的正式数据底座

---

## 附：可直接交接给下一位 AI 的重点结论

1. 当前系统**不是没有区县/部门数据**，而是区县/部门数据被错误压成了 `district`。
2. 当前正式报告已经具备“程序算指标 + AI 成文”的雏形，但规则层主要在前端，不适合作为长期底座。
3. 当前最危险的问题不是 prompt，而是：
   - `gov_open_annual_stats` 的层级口径
   - `year = null` 行进入正式消费视图
   - 前后端实体分类规则不统一
4. 底层 facts 覆盖率很高，后续改造瓶颈不在“数据缺失”，而在“口径统一与正式接入”。
5. 下一步改造的第一刀不应该先改模板，而应先重建：
   - 单位层级口径
   - 正式消费视图 / 服务
   - 后端指标与规则服务

---

## 附：本轮审计未做的事情

- 未直接重构业务逻辑
- 未改动正式报告模板
- 未改动 AI prompt 生成逻辑
- 未修改现有事实表或物化视图定义
- 未清理旧版链路

本轮工作性质是：**摸底、梳理、下结论、给出可执行改造顺序。**
