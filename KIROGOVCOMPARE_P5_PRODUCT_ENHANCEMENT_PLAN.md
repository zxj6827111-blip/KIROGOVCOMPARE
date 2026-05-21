# KIROGOVCOMPARE P5 产品增强阶段计划（CodeGraph 审计修订版）

生成时间：2026-05-21

适用仓库：`E:\Software Development\KIROGOVCOMPARE`

## 一、修订结论

经过 CodeGraph 索引检查和本地代码结构核对，P5 不能再按“从零建设批量化、Data Center、GovInsight、领导驾驶舱、权限体系”的方式推进。

当前系统已经具备一批产品化骨架：

```text
批量上传已有入口
批量比对已有入口
批次表和任务表已有基础
PDF job / JobCenter / TaskDrawer 已经成型
Data Center v2 已有 API、页面和 schema
GovInsight 已有 payload、protocol、job worker、print/PDF 链路
Leader Cockpit 已有前端、后端 service 和 feature flag
权限和 dataScope 已经横向进入多个路由
P4 已有交付、验收、运维、安全和 PDF 验证基线
```

所以 P5 的正确定位是：

```text
不是重建系统；
不是新增一堆平行模块；
而是基于已有骨架做产品化闭环、口径治理、真实样本验收和交付标准化。
```

一句话：

> P5 要把现有“能用的功能链路”收敛成“客户可验收、可复制交付、可持续运营的数据产品”。

---

## 二、CodeGraph 索引状态

本轮分析先检查了项目 CodeGraph 索引状态。

```text
Files indexed: 427
Total nodes: 5397
Total edges: 12986
Database size: 13.23 MB
Backend: native (better-sqlite3)

Nodes by kind:
- class: 41
- component: 24
- constant: 605
- file: 427
- function: 1903
- import: 1312
- interface: 317
- method: 364
- route: 156
- type_alias: 193
- variable: 55

Languages:
- typescript: 250
- javascript: 122
- tsx: 48
- python: 7
```

结论：索引覆盖足够，适合用于 P5 现有能力审计、模块边界判断和重复建设识别。

---

## 三、当前系统结构判断

### 1. 前端结构

当前前端不是简单页面集合，而是已经形成业务分区。

| 模块 | 现有入口 | 说明 |
| --- | --- | --- |
| 主应用路由 | `frontend/src/App.js` | 已挂载 `/upload`、`/jobs`、`/history`、`/datacenter`、`/govinsight/*` |
| 导航注册 | `frontend/src/app/routeRegistry.js` | 已有年报工作台、问题复核、比对中心、导出中心、智能治理、系统管理 |
| 批量上传 | `frontend/src/components/UploadReport.js`、`BatchUpload.js` | 已有单个/批量上传切换和批量上传组件 |
| 比对中心 | `frontend/src/components/ComparisonHistory.js` | 已有一键比对、批量操作、PDF 导出入口 |
| 导出中心 | `frontend/src/components/JobCenter.js` | 已承载 PDF job、下载、批量下载等能力 |
| 任务抽屉 | `frontend/src/components/tasks/TaskDrawerProvider.js` | 已被上传、比对、报告详情、维护、GovInsight 等模块引用 |
| Data Center 页面 | `frontend/src/components/datacenter/*` | 已有报告列表和详情页 |
| GovInsight | `frontend/src/govinsight/*` | 已有智能治理模块和多个视图 |
| Leader Cockpit | `frontend/src/govinsight/leader-cockpit/*` | 已有驾驶舱 UI、步骤页、风险规则、导出素材基础 |

### 2. 后端结构

| 模块 | 现有入口 | 说明 |
| --- | --- | --- |
| 应用装配 | `src/app-llm.ts` | 挂载 auth、users、regions、jobs、reports、comparisons、data-center、gov-insight、pdf-jobs |
| 年报上传 | `src/services/ReportUploadService.ts` | 已处理 report、version、job、batch UUID 等上传链路 |
| 解析任务 | `src/services/LlmJobRunner.ts`、`ParseRunService.ts` | 已有 LLM 解析、materialize、checks 后续链路 |
| 批次服务 | `src/services/data-center/IngestionBatchService.ts` | 已有 ingestion batch 创建、统计刷新、GovInsight stats 刷新联动 |
| 比对接口 | `src/routes/comparison-history.ts`、`llm-comparisons.ts` | 已有创建、历史、批量相关逻辑 |
| PDF job | `src/routes/pdf-jobs.ts` | 已有创建、列表、下载、批量下载、安全校验 |
| Data Center | `src/routes/data-center.ts` | 已有 `/v2/reports`、`/v2/batches`、batch retry、derived run |
| GovInsight | `src/routes/gov-insight.ts`、`gov-insight-pdf.ts` | 已有 annual data、报告 job、AI report replay、leader-cockpit API、PDF |
| 权限 | `src/middleware/auth.ts`、`src/utils/dataScope.ts` | 已在 Data Center、PDF、GovInsight、jobs、reports 等多处复用 |

### 3. 数据结构

| 能力 | 已有基础 | P5 判断 |
| --- | --- | --- |
| 地区 | `regions` | 不应再“新增 regions 表” |
| 年报 | `reports`、`report_versions` | 不应再设计平行 year_reports，除非 P5-1 证明必要 |
| 任务 | `jobs` | 批量解析、PDF、materialize 等应继续复用 jobs |
| 批次 | `ingestion_batches`、`jobs.ingestion_batch_id`、`report_versions.ingestion_batch_id` | 优先复用，不默认新增 batch_jobs |
| 指标字典 | `metric_dictionary` | P5-3 应做口径治理，不是从零建指标库 |
| 单元格证据 | `cells` | P5-3 应补证据下钻和可读 UI |
| 事实表 | `fact_active_disclosure`、`fact_application`、`fact_legal_proceeding` | P5-3 应扩口径前先审计覆盖率 |
| 质量问题 | `quality_issues` | P5-5 可作为问题闭环来源之一 |
| 派生指标 | `derived_unit_year_metrics`、`derived_region_year_metrics` | P5-3/P5-6 应复用 |

---

## 四、P5 总体定位

P5 的目标不是“更多功能”，而是形成以下产品能力：

```text
批量项目交付能力
结构化数据资产能力
可信报告生成能力
问题复核整改闭环能力
领导汇报展示能力
标准化部署和验收能力
多项目复制能力
```

P5 应优先解决的问题：

```text
已有批量上传能不能形成批次级验收闭环？
已有 Data Center 能不能被业务人员读懂和导出？
GovInsight 报告数字能不能稳定追溯到结构化数据？
问题能不能从“发现”进入“整改闭环”？
领导驾驶舱能不能基于真实数据解释风险？
每个新能力能不能被 feature flag 和权限控制？
每轮改动能不能不破坏 P4 已验收链路？
```

---

## 五、P5 禁止重复建设清单

以下事项默认禁止，除非 P5-1 审计报告给出明确证据并经过人工确认。

| 禁止重复建设项 | 原因 | 正确做法 |
| --- | --- | --- |
| 新建第二套批量上传入口 | `/upload` + `BatchUpload` 已存在 | 增强现有批量上传体验 |
| 新建 `/batch` 大中心 | `/upload`、`/jobs`、`/history`、`/datacenter` 已分担批量链路 | 先做跨入口闭环和导航串联 |
| 新建 `regions` 表 | `regions` 已是核心表 | 只增强字段、层级、导入或治理 |
| 默认新增 `batch_jobs` / `batch_job_items` | 已有 `ingestion_batches` 和 `jobs.ingestion_batch_id` | 先复用现有批次和任务模型 |
| 重建 Data Center schema | 已有指标字典、cells、fact、quality、derived 表 | 做口径治理、证据下钻、产品化页面 |
| 重建 PDF 导出系统 | `pdf-jobs`、`JobCenter`、`PdfExportWorker` 已存在 | 增强批量导出和失败反馈 |
| 重建 GovInsight 报告链路 | 已有 payload、protocol、job worker、PDF | 做数据绑定和质量校验 |
| 新建第二套领导驾驶舱 | `leader-cockpit` 已存在 | 增强真实数据、样本量、导出和权限 |
| 新建独立权限体系 | auth/dataScope 已横切多个路由 | 扩展现有权限矩阵 |
| 另写一套部署运维文档 | P4 已有 DEPLOYMENT/OPERATIONS/TROUBLESHOOTING | 增量维护现有文档 |

---

## 六、P5 硬性边界

### 1. 不破坏 P4 稳定链路

P5 每轮必须保护：

```text
年报工作台
单份上传
批量上传基础功能
年报详情
复核发布
比对中心
比对详情
普通 comparison PDF
长表 comparison PDF
GovInsight PDF
legacy EJS
print routes
PDF job API
JobCenter / TaskDrawer
Data Center 基础列表和详情
权限和 dataScope
```

### 2. 不随意扩大技术边界

```text
不做大重构
不删除旧接口
不随意改 schema
不新增重依赖
不把 OCR 接成默认主流程
不把 AI 生成文本当作事实源
不绕开现有 jobs/batch/PDF/dataScope
```

### 3. schema 改造必须先提案

涉及数据库时，必须先输出 schema proposal，说明：

```text
已有表是否可复用
为什么现有表不够
新增表/字段的业务必要性
SQLite 和 PostgreSQL 是否同步
迁移脚本
回滚说明
旧数据兼容
对 Data Center / GovInsight / PDF / 权限的影响
```

没有人工确认，不得直接改 schema。

---

## 七、P5 推荐阶段

```text
P5-1 现有能力基线审计与路线图
P5-2 批量项目闭环收敛
P5-3 Data Center 产品化
P5-4 GovInsight 可信报告引擎
P5-5 问题复核与整改闭环 MVP
P5-6 Leader Cockpit 增强
P5-7 解析/OCR 样本驱动增强
P5-8 产品化交付治理
```

---

## 八、P5-1 现有能力基线审计与路线图

### 阶段定位

P5-1 是 plan-only 阶段，不写功能代码，不改数据库，不新增依赖。

它的目标不是写愿景，而是基于真实代码回答：

```text
已有能力在哪里？
哪些能力只是半成品？
哪些能力可以直接复用？
哪些能力缺 UI？
哪些能力缺 API？
哪些能力缺测试？
哪些能力缺真实样本验收？
哪些能力不能重复建设？
P5-MVP 先做哪几个闭环？
```

### 必须审计的本地入口

```text
frontend/src/App.js
frontend/src/app/routeRegistry.js
frontend/src/components/UploadReport.js
frontend/src/components/BatchUpload.js
frontend/src/components/ComparisonHistory.js
frontend/src/components/JobCenter.js
frontend/src/components/tasks/TaskDrawerProvider.js
frontend/src/components/datacenter/*
frontend/src/govinsight/*
frontend/src/govinsight/leader-cockpit/*
src/app-llm.ts
src/routes/reports.ts
src/routes/jobs.ts
src/routes/comparison-history.ts
src/routes/pdf-jobs.ts
src/routes/data-center.ts
src/routes/gov-insight.ts
src/routes/gov-insight-pdf.ts
src/services/ReportUploadService.ts
src/services/data-center/IngestionBatchService.ts
src/services/DerivedMetricsService.ts
src/services/GovInsightReportPayloadService.ts
src/services/GovInsightLeaderCockpitService.ts
src/middleware/auth.ts
src/utils/dataScope.ts
migrations/postgres/012_datacenter_phase1.sql
migrations/postgres/013_datacenter_derived.sql
P4_FINAL_ACCEPTANCE_REPORT.md
DEPLOYMENT.md
OPERATIONS.md
TROUBLESHOOTING.md
```

### 输出物

```text
P5_EXISTING_CAPABILITY_BASELINE.md
P5_DUPLICATE_BUILD_AVOIDANCE.md
P5_PRODUCT_ROADMAP.md
P5_REQUIREMENT_PRIORITY_MATRIX.md
P5_SCOPE_CONTROL.md
P5_MVP_DEFINITION.md
P5_1_PRODUCT_ROADMAP_REPORT.md
```

### 验收标准

P5-1 完成后必须明确：

```text
哪些功能已实现
哪些功能半实现
哪些功能仅前端存在
哪些功能仅后端存在
哪些功能已有 schema
哪些功能已有测试
哪些功能需要真实样本验收
哪些需求会重复建设
哪些需求必须降级或改名
是否建议进入 P5-2
```

---

## 九、P5-2 批量项目闭环收敛

### 阶段定位

P5-2 不叫“新增批量导入”。当前系统已经可以批量导入年报。

P5-2 的正确目标是：

```text
把已有批量上传、批量解析、批量比对、批量导出，收敛成一个可验收的批量项目闭环。
```

### 复用入口

```text
/upload
/jobs
/history
/datacenter
BatchUpload.js
ComparisonHistory.js
JobCenter.js
TaskDrawerProvider.js
ReportUploadService.ts
IngestionBatchService.ts
data-center.ts
pdf-jobs.ts
```

### 需要补齐的能力

```text
批量上传结果汇总
批次 ID 可见和可追踪
批次详情：成功/失败/跳过/处理中
失败文件原因可读
失败任务可筛选
失败任务按权限重试
地区/年份识别后的批量人工修正
批量比对创建结果统计
批量比对跳过原因说明
批量 PDF 导出进入 JobCenter
批量下载遵守 dataScope 和文件过期规则
批量项目验收报告
```

### 不做事项

```text
不默认新建 /batch 大中心
不默认新增 batch_jobs 表
不重写上传链路
不重写任务中心
不绕开 PDF job
不绕开 TaskDrawer
```

### 输出物

```text
P5_BATCH_PROJECT_CLOSURE_DESIGN.md
P5_BATCH_GAP_REPORT.md
P5_BATCH_SCHEMA_DECISION.md
P5_2_BATCH_PROJECT_CLOSURE_REPORT.md
```

### 验收标准

```text
一次导入一批年报
能看到批次级汇总
能定位每个失败项
能按权限重试失败项
能批量生成比对
能看到创建/跳过/失败统计
能批量导出 PDF 或导出任务
能下载批量结果
单份上传和单份比对不回归
PDF smoke 和 strict-live 不回归
```

---

## 十、P5-3 Data Center 产品化

### 阶段定位

P5-3 不是从零建 Data Center。当前已经有 Data Center API、页面、指标字典、cells、事实表、quality issues 和 derived metrics。

P5-3 应该做：

```text
把技术型 Data Center 变成业务可读、可导出、可追溯、可支撑报告和驾驶舱的数据资产中心。
```

### 复用入口

```text
/datacenter
frontend/src/components/datacenter/*
src/routes/data-center.ts
src/services/DerivedMetricsService.ts
src/services/data-center/MaterializeService.ts
migrations/postgres/012_datacenter_phase1.sql
migrations/postgres/013_datacenter_derived.sql
```

### 重点能力

```text
指标字典业务化说明
指标口径版本
单位-年度指标明细
地区-年度汇总指标
单地区多年趋势
多地区同年度横向对比
指标证据下钻
数据质量标签
指标明细导出
区域汇总导出
GovInsight 复用指标
Leader Cockpit 复用指标
```

### 不做事项

```text
不重建 Data Center schema
不默认新增第二套指标仓库
不绕开 existing cells/fact/derived 表
不把 AI 生成文本写入事实指标
不做没有证据来源的排行榜
```

### 输出物

```text
P5_DATACENTER_PRODUCT_SPEC.md
P5_INDICATOR_GOVERNANCE.md
P5_TRACEABILITY_DESIGN.md
P5_DATACENTER_SCHEMA_DECISION.md
P5_3_DATACENTER_PRODUCTIZATION_REPORT.md
```

### 验收标准

```text
业务人员能理解指标含义
选择地区能看多年趋势
选择多个地区能横向对比
点击指标能看到证据
数据质量状态可见
可导出指标明细
可导出区域汇总
GovInsight 能消费 Data Center 指标
dataScope 用户不能越权查看地区数据
```

---

## 十一、P5-4 GovInsight 可信报告引擎

### 阶段定位

当前 GovInsight 已经有 payload、protocol、job worker、报告打印和 PDF 链路。

P5-4 的重点不是“换 prompt”，而是：

```text
让报告数字来自结构化数据，让报告结论可校验，让 PDF 输出可追溯。
```

### 复用入口

```text
/govinsight
/print/govinsight-report/:orgId/:year
src/routes/gov-insight.ts
src/routes/gov-insight-pdf.ts
src/services/GovInsightReportPayloadService.ts
src/services/GovInsightReportProtocol.ts
src/services/GovInsightReportJobWorker.ts
frontend/src/components/print/GovInsightReportPrintView.tsx
```

### 重点能力

```text
报告类型配置
章节配置
结构化 payload 绑定
数字引用校验
指标不存在校验
地区/年份不存在校验
风险结论一致性校验
问题清单和正文一致性校验
PDF/print route 回归
历史失败 job 可读反馈
```

### 不做事项

```text
不新建第二套报告生成服务
不让 AI 自由编指标
不把模型输出当作最终事实
不绕开现有 GovInsight PDF
不破坏历史报告读取
```

### 输出物

```text
P5_GOVINSIGHT_TRUSTED_REPORT_ENGINE.md
P5_REPORT_TEMPLATE_MATRIX.md
P5_REPORT_QUALITY_CONTROL.md
P5_4_GOVINSIGHT_REPORT_ENGINE_REPORT.md
```

### 验收标准

```text
报告关键数字有来源
报告引用指标存在
报告地区和年份存在
AI 输出经过质量校验
PDF 导出正常
print route 正常
不同地区报告不是模板化复制
GovInsight 不影响 comparison PDF
```

---

## 十二、P5-5 问题复核与整改闭环 MVP

### 阶段定位

当前系统已有问题展示、consistency、quality issues、vision review、ReportDetail 问题卡片等基础。

P5-5 的目标是从这些现有问题来源中抽象出一个轻量整改闭环，而不是一上来做完整 OA 工作流。

### 复用入口

```text
/issues
/catalog/reports/:reportId
/comparison/:comparisonId
src/routes/issues-summary.ts
src/routes/consistency.ts
src/services/ConsistencyCheckService.ts
quality_issues
frontend/src/components/IssueList.js
frontend/src/components/ReportDetail.js
frontend/src/components/TableIssueSummary.js
```

### MVP 流程

```text
发现问题
人工确认
生成整改项
填写整改建议
标记责任单位
记录整改状态
提交整改反馈
复核通过或退回
归档
导出问题清单
```

### 不做事项

```text
不做复杂 OA 审批流
不做消息中心重构
不做跨组织协同平台
不做复杂附件库
不绕开现有问题编号和证据体系
```

### 输出物

```text
P5_REVIEW_RECTIFICATION_MVP.md
P5_ISSUE_SOURCE_MAPPING.md
P5_AUDIT_TRAIL_DESIGN.md
P5_5_REVIEW_WORKFLOW_REPORT.md
```

### 验收标准

```text
能从现有问题生成整改项
能人工确认和关闭
能记录整改状态
能保留操作日志
能导出问题清单
能按地区权限隔离
不影响原有问题展示和比对流程
```

---

## 十三、P5-6 Leader Cockpit 增强

### 阶段定位

Leader Cockpit 已经存在，P5-6 不新建驾驶舱。

P5-6 的目标是：

```text
让已有驾驶舱基于 Data Center 和 GovInsight 后端数据稳定展示，具备样本量护栏、口径解释、证据入口和汇报素材导出。
```

### 复用入口

```text
/govinsight/leader-cockpit
frontend/src/govinsight/leader-cockpit/*
src/services/GovInsightLeaderCockpitService.ts
src/routes/gov-insight.ts
REACT_APP_FEATURE_LEADER_COCKPIT
```

### 重点能力

```text
总体态势
高风险单位
风险指标解释
年度趋势
地区横向对比
数据质量提醒
整改进度概览
专题分析入口
汇报素材导出
```

### 不做事项

```text
不新建第二套 cockpit
不默认使用前端本地重算作为正式数据
不展示无真实数据支撑的假图
不做没有最小样本量的排名
不绕开 feature flag
```

### 输出物

```text
P5_LEADER_COCKPIT_ENHANCEMENT.md
P5_RISK_DASHBOARD_GOVERNANCE.md
P5_TOPIC_ANALYSIS_DESIGN.md
P5_6_LEADER_COCKPIT_REPORT.md
```

### 验收标准

```text
授权用户可访问
未授权用户不可访问
指标来自后端
样本量和口径可见
风险排名可解释
可跳转证据或 Data Center
可导出汇报素材
```

---

## 十四、P5-7 解析/OCR 样本驱动增强

### 阶段定位

当前系统已有 PDF 解析、VisionReview、OcrCorrection、source gate 和复杂样本回归基础。

P5-7 不能为了技术完整性直接上重型 OCR。它必须由真实样本驱动。

### 进入条件

满足以下条件之一才建议进入：

```text
真实客户扫描件比例高
文本型 PDF 解析无法覆盖关键验收样本
复杂表格错误影响 Data Center 可信度
已有异常样本池可稳定复现问题
```

### 重点能力

```text
PDF 类型识别
低置信度标记
OCR 与文本解析结果对照
OCR 原文保存
人工复核后发布
修正记录可追溯
复杂表格回归集
```

### 不做事项

```text
不全量 OCR 替代文本解析
不让 OCR 结果直接污染主数据
不引入没有样本验证的重依赖
不把 OCR 错误直接送入 GovInsight
```

### 输出物

```text
P5_PARSER_OCR_SAMPLE_SET.md
P5_PARSER_CONFIDENCE_DESIGN.md
P5_COMPLEX_TABLE_REGRESSION_SET.md
P5_7_PARSER_OCR_REPORT.md
```

---

## 十五、P5-8 产品化交付治理

### 阶段定位

完整产品化能力可以后置，但治理要求必须从 P5-1 开始前置。

P5-8 不等于完整 SaaS。当前阶段优先做项目级交付治理。

### 前置治理

```text
feature flag 命名规范
权限矩阵
dataScope 规则
演示数据规范
验收样本规范
部署文档增量维护
版本说明规范
回滚说明规范
```

### 可做能力

```text
项目级配置
功能开关
授权提示
演示数据
验收材料
运维手册
版本记录
升级说明
回滚说明
```

### 暂缓能力

```text
完整 SaaS 多租户
在线授权服务器
复杂计费系统
客户门户
跨客户集中运维平台
多租户数据库隔离
```

### 输出物

```text
P5_PRODUCTIZATION_GOVERNANCE.md
P5_FEATURE_FLAG_AND_PERMISSION_MATRIX.md
P5_DELIVERY_PACKAGE_STANDARD.md
P5_8_PRODUCTIZATION_REPORT.md
```

---

## 十六、P5-MVP 修订版

P5-MVP 不包括从零建设平台，而包括五个闭环。

| 顺序 | MVP 能力 | 当前基础 | P5 要补齐 |
| ---: | --- | --- | --- |
| 1 | 现有能力基线审计 | CodeGraph 可索引，模块入口清晰 | 能力地图、重复建设清单、缺口矩阵 |
| 2 | 批量项目闭环 | BatchUpload、ingestion_batches、jobs、PDF job | 批次详情、失败闭环、批量比对/导出验收 |
| 3 | Data Center 产品化 | metric_dictionary、cells、fact、derived、API、页面 | 业务口径、趋势横比、证据下钻、导出 |
| 4 | GovInsight 可信报告 | payload、protocol、job worker、PDF | 数据绑定、质量校验、报告类型和章节 |
| 5 | 问题整改闭环 MVP | issues、consistency、quality issues | 人工确认、整改状态、日志、导出 |

默认不纳入 P5-MVP：

```text
完整 SaaS
在线授权服务器
重型 OCR 平台
完整 PPT 自动生成
复杂 OA 流程
全新 /batch 大中心
第二套 Data Center
第二套驾驶舱
```

---

## 十七、需求优先级矩阵字段

P5-1 的 `P5_REQUIREMENT_PRIORITY_MATRIX.md` 必须包含：

```text
需求编号
需求名称
所属阶段
当前实现状态：已实现 / 半实现 / 仅前端 / 仅后端 / 缺失
现有代码入口
复用策略
是否可能重复建设
需求描述
客户价值
商业价值
交付价值
开发成本
技术风险
是否需要 schema 改造
是否需要新增依赖
是否需要 feature flag
是否影响 P4 稳定链路
是否涉及权限或 dataScope
是否需要真实样本验证
优先级：must / should / could / won't
建议实施阶段
人工确认事项
备注
```

优先级定义：

```text
must：P5-MVP 不做就不成立
should：价值明确，排在 must 后
could：有价值，但短期不是关键路径
won't：当前阶段明确不做，用于控制范围
```

---

## 十八、统一验证要求

每个 P5 开发阶段完成后至少执行：

```text
npm.cmd run build
npm.cmd test
cd frontend && npm.cmd test -- --runInBand
cd frontend && npm.cmd run build
npm.cmd run smoke:pdf
```

live 环境可用时执行：

```text
npm.cmd run smoke:pdf -- --strict-live --api-base=http://127.0.0.1:8787 --frontend-url=http://127.0.0.1:3001
```

涉及数据库时额外验证：

```text
SQLite migration 测试或兼容说明
PostgreSQL migration 测试
旧数据兼容
回滚说明
```

涉及权限时额外验证：

```text
管理员
普通用户
只读用户
区域 dataScope 用户
未登录用户
无权限用户
越权访问
下载权限
批量操作权限
```

涉及页面时至少 spot check：

```text
/upload
/jobs
/history
/datacenter
/govinsight
/catalog/reports/:id
/comparison/:id
```

涉及 PDF 时至少验证：

```text
ordinary comparison PDF
long-table comparison PDF
GovInsight PDF
PDF job API
batch download
expired/missing file
print route
legacy EJS
```

---

## 十九、分支和提交规则

每个 P5 阶段独立分支。

建议分支：

```text
codex/p5-product-roadmap
codex/p5-batch-project-closure
codex/p5-datacenter-productization
codex/p5-govinsight-trusted-report
codex/p5-review-rectification-mvp
codex/p5-leader-cockpit-enhancement
codex/p5-parser-ocr-sample-hardening
codex/p5-productization-governance
```

流程：

```text
从最新 origin/main 新建分支
先审计/计划
再开发
再测试
再报告
人工审核
精确 git add
commit
push
PR
合并 main
合并后健康检查
再进入下一阶段
```

暂存规则：

```text
禁止 git add .
只允许 git add -- <明确文件路径>
提交前检查 git diff --cached --name-only
提交前检查 git diff --name-only origin/main...HEAD
```

---

## 二十、P5-1 启动提示词

以下提示词用于启动 P5-1。注意：当前只做 plan-only 审计，不做实现。

```text
你现在接手 KIROGOVCOMPARE 年报比对系统的 P5 产品增强阶段。

当前只允许做 P5-1：现有能力基线审计与路线图。

P5 的定位不是从零建设平台，而是基于当前已经存在的批量上传、批量比对、Data Center、GovInsight、Leader Cockpit、PDF job、TaskDrawer、权限和 dataScope，做产品化闭环收敛。

硬性限制：
1. 不开发代码；
2. 不修改数据库 schema；
3. 不新增依赖；
4. 不提交；
5. 不 push；
6. 不 merge；
7. 不启动 P5-2；
8. 不重复建设已有模块；
9. 只做审计、路线图、需求分级、范围控制和 MVP 定义。

请从最新 origin/main 新建分支：

codex/p5-product-roadmap

执行并记录：

git fetch origin
git checkout main
git pull --ff-only origin main
git status --short --branch --untracked-files=all
git log --oneline -20
git checkout -b codex/p5-product-roadmap

必须审计：
1. frontend/src/App.js
2. frontend/src/app/routeRegistry.js
3. frontend/src/components/UploadReport.js
4. frontend/src/components/BatchUpload.js
5. frontend/src/components/ComparisonHistory.js
6. frontend/src/components/JobCenter.js
7. frontend/src/components/tasks/TaskDrawerProvider.js
8. frontend/src/components/datacenter/*
9. frontend/src/govinsight/*
10. frontend/src/govinsight/leader-cockpit/*
11. src/app-llm.ts
12. src/routes/reports.ts
13. src/routes/jobs.ts
14. src/routes/comparison-history.ts
15. src/routes/pdf-jobs.ts
16. src/routes/data-center.ts
17. src/routes/gov-insight.ts
18. src/routes/gov-insight-pdf.ts
19. src/services/ReportUploadService.ts
20. src/services/data-center/IngestionBatchService.ts
21. src/services/DerivedMetricsService.ts
22. src/services/GovInsightReportPayloadService.ts
23. src/services/GovInsightLeaderCockpitService.ts
24. src/middleware/auth.ts
25. src/utils/dataScope.ts
26. migrations/postgres/012_datacenter_phase1.sql
27. migrations/postgres/013_datacenter_derived.sql
28. P4_FINAL_ACCEPTANCE_REPORT.md
29. DEPLOYMENT.md
30. OPERATIONS.md
31. TROUBLESHOOTING.md

输出以下文件：
1. P5_EXISTING_CAPABILITY_BASELINE.md
2. P5_DUPLICATE_BUILD_AVOIDANCE.md
3. P5_PRODUCT_ROADMAP.md
4. P5_REQUIREMENT_PRIORITY_MATRIX.md
5. P5_SCOPE_CONTROL.md
6. P5_MVP_DEFINITION.md
7. P5_1_PRODUCT_ROADMAP_REPORT.md

P5_EXISTING_CAPABILITY_BASELINE.md 必须说明：
1. 当前 main commit；
2. 当前分支；
3. CodeGraph 索引状态；
4. 审计范围；
5. 已实现能力；
6. 半实现能力；
7. 仅前端能力；
8. 仅后端能力；
9. 已有 schema 能力；
10. 已有测试；
11. 可复用入口；
12. 需要补齐的闭环缺口。

P5_DUPLICATE_BUILD_AVOIDANCE.md 必须列出：
1. 禁止重复建设项；
2. 已有代码入口；
3. 为什么不能重建；
4. 正确增强方式；
5. 如确需重建，必须满足的证据和审批条件。

P5_PRODUCT_ROADMAP.md 必须按以下阶段编写：
1. P5-1 现有能力基线审计与路线图；
2. P5-2 批量项目闭环收敛；
3. P5-3 Data Center 产品化；
4. P5-4 GovInsight 可信报告引擎；
5. P5-5 问题复核与整改闭环 MVP；
6. P5-6 Leader Cockpit 增强；
7. P5-7 解析/OCR 样本驱动增强；
8. P5-8 产品化交付治理。

P5_REQUIREMENT_PRIORITY_MATRIX.md 必须包含：
需求编号、需求名称、所属阶段、当前实现状态、现有代码入口、复用策略、是否可能重复建设、客户价值、商业价值、交付价值、开发成本、技术风险、是否需要 schema、是否需要依赖、是否需要 feature flag、是否影响 P4 稳定链路、是否涉及权限/dataScope、是否需要真实样本验证、优先级、建议阶段、人工确认事项。

P5_SCOPE_CONTROL.md 必须包含：
允许范围、暂缓范围、禁止范围、禁止重复建设清单、P4 基线守护清单、schema 审批规则、新依赖审批规则、AI 报告边界、OCR 边界、feature flag 规则、权限/dataScope 规则、每阶段验收策略。

P5_MVP_DEFINITION.md 必须明确：
1. P5-MVP 包含：基线审计、批量项目闭环、Data Center 产品化、GovInsight 可信报告、问题整改闭环 MVP；
2. P5-MVP 不包含：完整 SaaS、在线授权服务器、重型 OCR、完整 PPT 自动生成、复杂 OA、全新 /batch 大中心、第二套 Data Center、第二套驾驶舱；
3. 每项 MVP 的现有基础、缺口、验收标准。

P5_1_PRODUCT_ROADMAP_REPORT.md 必须包含：
1. 当前 main commit；
2. 当前分支；
3. git status；
4. 审计范围；
5. 已识别现有能力；
6. 已识别重复建设风险；
7. 推荐 P5-MVP；
8. 推荐完整 P5 路线；
9. 高风险事项；
10. 需要人工确认事项；
11. 是否建议进入 P5-2；
12. 未验证事项。

完成后只回传摘要、git status、当前分支、当前 commit、是否建议进入 P5-2。

不要提交。
不要 push。
等待人工审核。
```

---

## 二十一、最终判断

P5 不是把 KIROGOVCOMPARE 做成另一个新系统，而是把现有系统的核心链路产品化：

```text
已有批量导入 -> 批量项目闭环
已有 Data Center -> 数据资产中心
已有 GovInsight -> 可信报告引擎
已有问题展示 -> 整改闭环
已有 Leader Cockpit -> 真实数据驾驶舱
已有 P4 材料 -> 标准化交付体系
```

最重要的原则：

```text
先复用，再增强；
先闭环，再扩张；
先真实样本，再做能力包装；
先守住 P4，再进入 P5。
```
