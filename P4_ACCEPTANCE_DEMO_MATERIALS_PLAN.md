# P4-4A 客户演示与验收材料计划

## 1. 当前基线

- 当前分支：`codex/p4-acceptance-demo-materials`
- main commit：`3f394e63901bb2e6648021960a0c939597d39cd5`
- 分支创建依据：已执行 `git fetch origin`、切回 `main`、`git pull --ff-only origin main` 后从最新 main 创建。
- 当前工作区已知无关未跟踪文件：`P3-5_POST_MERGE_HEALTH_CHECK.md`、`P3_FINAL_ACCEPTANCE_REPORT.md`、`P4_1_PRE_MERGE_CHECK_REPORT.md`、`P4_1_POST_MERGE_HEALTH_CHECK.md`、`P4_2_POST_MERGE_HEALTH_CHECK.md`、`P4_3_POST_MERGE_HEALTH_CHECK.md`。本阶段不处理、不暂存、不提交。

## 2. P4-4 阶段目标

P4-4 只交付客户演示与验收材料，不做业务代码开发，不修改部署运维脚本，不修改数据库、解析、比对、GovInsight 生成逻辑、PDF 后端主链路或 legacy EJS。目标是形成一套客户能看懂、领导能接受、专家能验收、项目成员能复用的材料体系。

## 3. 现有材料和报告盘点

| 材料 | 当前作用 | P4-4 引用方式 |
| --- | --- | --- |
| `API.md` | 说明当前 report-based compare 主线、认证方式和已下线 legacy compare 接口边界 | 用于用户手册和专家问答中的接口/边界口径 |
| `README_PG.md` | 本地 PostgreSQL 设置说明 | 只作为环境背景，不作为客户演示主材料 |
| `frontend/README.md` | 前端启动、构建和功能概览 | 用于确认前端本地地址与基础功能入口 |
| `P4_REAL_SAMPLE_REGRESSION_REPORT.md` | P4-1 真实样本全链路回归证据 | 引用真实样本、PDF、GovInsight、权限边界和 TaskDrawer 观察结果 |
| `P4_REAL_SAMPLE_ISSUE_LIST.md` | P4-1 遗留问题清单 | 引用 GovInsight latest job、PDF 原生视觉工具、TaskDrawer 人工复核等边界 |
| `P4_DATA_QUALITY_EVIDENCE_REPORT.md` | P4-2 数据质量与证据链展示增强报告 | 引用证据说明、来源状态、NOT_ASSESSABLE、GovInsight 来源字段口径 |
| `P4_DEPLOYMENT_OPERATIONS_REPORT.md` | P4-3 部署运维与交付能力报告 | 引用运维、诊断、健康检查、备份恢复、TaskDrawer 人工验收流程 |
| `DEPLOYMENT.md` | 当前部署指南 | 用户手册和验收标准只引用，不新增/修改部署脚本 |
| `OPERATIONS.md` | 日常巡检、备份、恢复、清理和交付门禁 | 用户手册和专家问答引用运维边界 |
| `TROUBLESHOOTING.md` | 常见故障排查 | 用户手册 FAQ 和演示失败兜底话术引用 |
| `P4_1_POST_MERGE_HEALTH_CHECK.md`、`P4_2_POST_MERGE_HEALTH_CHECK.md`、`P4_3_POST_MERGE_HEALTH_CHECK.md` | 合并后健康检查与遗留风险 | 作为验收材料中的历史健康证据和风险边界 |

## 4. 当前功能入口盘点

前端入口来自 `frontend/src/App.js`，主要用户路径包括：

- 登录：未认证用户进入 `Login`。
- 年报目录与报告详情：`/catalog`、`/catalog/reports/:reportId`。
- 年报上传：`/upload`。
- 任务中心与任务详情：`/jobs`、`/jobs/:versionId`。
- 比对历史与比对详情：`/history`、`/comparison/:comparisonId`。
- 问题列表与报告维护：`/issues/*`、`/report-maintenance`。
- 地区与用户管理：`/regions`、`/admin/users`。
- 数据中心：`/datacenter`、`/datacenter/reports/:reportId`。
- GovInsight：`/govinsight/*`。
- PDF/打印视图：`/print/comparison/:comparisonId`、`/print/govinsight-report/:orgId/:year`。

后端主入口来自 `src/app-llm.ts`，主要 API 模块包括 health、auth、users、regions、jobs、reports、comparisons、pdf-jobs、data-center、report-maintenance、gov-insight、gov-insight-pdf、ai 以及 legacy compare retired 防线。

## 5. 客户演示材料缺口

当前已有技术验证报告，但缺少面向客户现场演示的材料：

- 缺少 5 分钟领导版、15 分钟专家版和完整流程版演示脚本。
- 缺少演示前准备、推荐样本、演示数据要求和失败兜底话术。
- 缺少对“不建议现场演示项”的明确说明，例如 GovInsight latest job 重新生成失败根因尚未纳入本阶段修复。
- 缺少把上传、解析、复核、发布、比对、证据链、PDF、GovInsight、TaskDrawer 串成连续业务故事的讲解稿。

## 6. 专家验收材料缺口

当前报告能证明技术验证结果，但缺少专家问答型材料：

- 缺少系统检查与人工复核关系的统一口径。
- 缺少解析错误、异常样本、数据质量风险、证据链追溯、PDF 可追溯性的标准回答。
- 缺少 GovInsight 指标来源、TaskDrawer 作用、权限控制、备份恢复、回滚、扩展地区年份的问答。
- 缺少系统边界和不承诺事项，容易在验收中被误解为 P4-5 已完成。

## 7. 用户手册缺口

当前缺少面向业务用户的统一操作草稿：

- 缺少从登录到年报维护、上传、解析任务、复核、发布、比对、证据链查看、PDF 导出、任务中心的端到端操作说明。
- 缺少批量下载是否支持的保守说明，需要以现有任务中心和 P4-3 批量 ZIP 证据为边界。
- 缺少 GovInsight 操作入口、权限角色说明、常见问题、异常处理建议和运维材料引用。

## 8. 验收标准材料缺口

当前缺少可以直接用于验收签字的标准材料：

- 功能、数据、真实样本、异常样本、证据链、PDF、GovInsight、TaskDrawer、权限、运维验收标准未汇总到同一文件。
- 性能与安全边界需要明确只引用现有能力与后续 P4-5，不把加固写成已完成。
- 缺少不通过判定、验收证据材料清单和验收人签字/确认建议字段。

## 9. 计划新增材料清单

| 文件 | 面向对象 | 用途 |
| --- | --- | --- |
| `P4_ACCEPTANCE_CRITERIA.md` | 客户验收负责人、专家、项目经理 | 形成可签字的验收标准与不通过判定 |
| `P4_DEMO_SCRIPT.md` | 演示讲解人、项目经理、售前/交付人员 | 形成领导版、专家版和完整业务流程演示脚本 |
| `P4_USER_MANUAL_DRAFT.md` | 业务用户、客户管理员、项目成员 | 形成可复用的用户操作手册草稿 |
| `P4_EXPERT_REVIEW_QA.md` | 专家组、客户技术负责人、项目答辩人 | 形成验收答疑和系统边界统一口径 |
| `P4_ACCEPTANCE_DEMO_MATERIALS_REPORT.md` | 项目负责人、代码审核人、人工合并人 | 汇总 P4-4 材料产出、验证结果、边界和剩余风险 |

## 10. 每份材料预期内容结构

### `P4_ACCEPTANCE_CRITERIA.md`

- 验收范围和不改动边界。
- 功能验收、数据验收、真实样本验收、异常样本验收。
- 数据质量与证据链、PDF、GovInsight、TaskDrawer/任务中心、权限、运维验收。
- 性能与安全验收的引用边界。
- 不通过判定、证据材料清单、签字/确认建议字段。

### `P4_DEMO_SCRIPT.md`

- 5 分钟领导演示版。
- 15 分钟专家评审版。
- 完整业务流程演示版。
- 上传/解析/复核/发布、比对、证据链、PDF、GovInsight、TaskDrawer 与任务中心专项演示。
- 演示前准备、演示数据、推荐样本、失败兜底话术和高风险项。

### `P4_USER_MANUAL_DRAFT.md`

- 登录、年报维护、上传、解析任务、复核、发布、比对。
- 证据链查看、PDF 导出、任务中心、批量下载、GovInsight。
- 权限和角色、常见问题、注意事项、异常处理建议、运维材料引用。

### `P4_EXPERT_REVIEW_QA.md`

- 系统检查与人工检查关系。
- 解析错误、数据质量风险、证据链、PDF 可追溯、异常样本处理。
- 防误判、GovInsight 指标来源、TaskDrawer/任务中心、数据安全、权限、备份恢复、回滚、扩展。
- 与传统人工比对的价值、系统边界和不承诺事项。

### `P4_ACCEPTANCE_DEMO_MATERIALS_REPORT.md`

- 新增材料清单、用途、对象、场景、功能映射。
- 引用的 P4-1/P4-2/P4-3 证据。
- 未改动边界、自动验证结果、遗留事项。
- 自审修正项、最终验证结果、生成物排除确认和是否建议提交。

## 11. 与 P4-1/P4-2/P4-3 产物的引用关系

- P4-1 提供真实样本链路、样本编号、PDF/GovInsight/权限/TaskDrawer 观察证据，以及遗留问题边界。
- P4-2 提供数据质量与证据链展示、GovInsight 来源状态、真实样本复测和 evidence 展示边界。
- P4-3 提供部署、运维、健康检查、诊断包、备份恢复、TaskDrawer 人工验收、PDF 原生工具链降级说明。
- P4-4 不重复实现这些能力，只把已有证据转换成客户演示、专家问答、用户操作和验收标准材料。

## 12. 自动验证计划

P4-4B 实施后执行：

- `git diff --name-only`
- `git diff --check`
- `npm.cmd run build`
- `npm.cmd test`
- `frontend` 目录执行 `npm.cmd test -- --runInBand`
- `frontend` 目录执行 `npm.cmd run build`
- `npm.cmd run smoke:pdf`
- 如果本地 API `http://127.0.0.1:8787` 和前端 `http://127.0.0.1:3001` 可用，再执行 strict-live；如不可用，报告为 blocked，不写成通过。

P4-4C 与 P4-4E 会重复关键验证，并额外检查未跟踪文件、暂存区、diff 文件范围和禁止项。

## 13. 不改动边界

本阶段不做以下事项：

- 不做业务代码开发。
- 不新增或修改部署运维脚本，除非只是引用 P4-3 已有材料；本计划不需要改脚本。
- 不做性能、安全、权限加固。
- 不改数据库 schema/migration。
- 不改解析算法、比对算法、GovInsight 生成逻辑。
- 不改 PDF 后端主链路。
- 不改 `scripts/pdf-smoke-baseline.js`。
- 不删除 legacy EJS。
- 不提交 logs、诊断包、PDF、ZIP、截图、HTML dump、build/dist/coverage/node_modules。
- 不提交真实 `.env`、secret、token。
- 不使用 `git add .`，只显式暂存 P4-4 允许文件。
- 不自动 merge，不进入 P4-4F，直到人工确认 P4-4 已合并到 main。

## 14. 是否建议进入 P4-4B 实施

建议进入 P4-4B。

理由：

- 当前 main 已同步，P4-4 分支已创建。
- 已有 P4-1/P4-2/P4-3 报告和运维文档足够支撑客户演示与验收材料编写。
- P4-4 计划新增文件均为文档，未触及业务代码、部署脚本、数据库、PDF 主链路或 GovInsight 生成逻辑。
- 后续可以通过 diff 文件范围、构建、测试、PDF smoke 和 strict-live/blocked 口径完成门禁。
