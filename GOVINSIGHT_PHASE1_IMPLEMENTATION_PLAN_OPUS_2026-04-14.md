# GovInsight 第一阶段实施任务清单与编码方案（吸收 OPUS 审查意见版）

文档日期：2026-04-14  
适用范围：GovInsight 第一阶段实施  
依据材料：
1. `GOVINSIGHT_CURRENT_STATE_AUDIT_2026-04-14.md`
2. `GOVINSIGHT_AIREPORT_BACKENDIZATION_PLAN_2026-04-14.md`
3. `GOVINSIGHT_UNIT_TYPE_PARENT_YEAR_FOUNDATION_PLAN_2026-04-14.md`
4. `GOVINSIGHT_FOUNDATION_FREEZE_SUPPLEMENT_2026-04-14.md`
5. `GOVINSIGHT_FULL_PROJECT_REVIEW_2026-04-14.md`

---

## 0. 实施完成状态更新（2026-04-15）

### 0.1 当前结论

第一阶段已按冻结范围完成最小闭环实现，且已通过底座、payload、Worker、前端消费、协议落库和回归脚本验收。

### 0.2 已完成任务包

1. 任务包 A：已完成
2. 任务包 B：已完成
3. 任务包 C：已完成
4. 任务包 D：已完成
5. 任务包 E：已完成
6. 任务包 F：已完成
7. 任务包 G：已完成

### 0.3 已完成的关键结果

1. `/api/gov-insight/ai-report/save` 已补 `authMiddleware`，前端保存请求已补 Bearer token。
2. `canonical_units`、`canonical_unit_mapping_overrides`、`gov_open_annual_stats_v2` 已落地并可重复 bootstrap。
3. `report_payload_v1` 已补齐 `metadataSeeds / riskPrioritySeeds / rectificationTaskSkeleton / appendixSkeleton / contentBoundaries`。
4. Worker 已改为支持 payload 驱动生成，并在生成前后执行 payload / narrative / envelope 校验。
5. `ai_decision_reports` 新协议已统一为 `gov_insight_ai_report_v1 + govInsightFormalReportV2 envelope`。
6. 首批 3 条高风险 unknown 样本已纳入 frozen override，`blocked_unknown_unit_type` 已清零。
7. 前端 `aiReport.ts` 已优先消费后端 payload 的附件骨架和数据质量结果，打印页保持兼容。
8. 对账、验证、回归脚本已补齐，并已验证通过。

### 0.4 当前验收结果摘要

1. `gov_open_annual_stats_v2` 当前状态：`official = 3963`，`preview = 5`，`blocked_unknown_unit_type = 0`。
2. `report_payload_v1` 样本校验通过，风险 seed 5 条，整改骨架 7 条，附件指标 10 条。
3. `region=721, year=2024` 的 v1/v2 原始指标对账全量一致。
4. 前端运行时回归已确认附件一首项来源字段为后端口径 `app_new`。

### 0.5 第一阶段仍保留到第二阶段处理的事项

1. 区县 / 部门直接进入主报告正文。
2. Leader Cockpit 全量后端规则切换。
3. PDF 导出主链重构。
4. 全量 legacy 清理。
5. 全量历史组织时态治理。

---

## 一、实施范围摘要

### 1.1 本轮要做

1. 立即修复 `/api/gov-insight/ai-report/save` 缺少 `authMiddleware` 的安全问题。
2. 建立 `canonical_units` 底座，并预留 `effective_from_year / effective_to_year`。
3. 建立 `gov_open_annual_stats_v2` 正式结果表，承载 `official / preview / blocked_*`。
4. 建立后端 `metrics_snapshot_v1` 与 `data_quality_v1` 计算输出。
5. 建立最小版 `report_payload_v1`，让后端可构造正式 AI 输入上下文。
6. 改造 GovInsight Worker，使其支持从 `report_payload_v1` 构造 prompt，并统一 AI 报告存储协议。
7. 前端停止新增业务规则分叉，优先收口类型猜测和保存协议。
8. 补充 v1 旧视图到 `stats_v2` 的对账与验收入口。

### 1.2 本轮不做

1. 不做区县/部门直接进入主报告正文。
2. 不做 Leader Cockpit 全量重构，但接口设计必须考虑未来统一。
3. 不做 PDF 导出链路大改，只保证新数据流不破坏现有打印页和 PDF 导出。
4. 不做全量历史组织时态治理，只预留有效期字段。
5. 不做全量人工 mapping，只支持高风险边界实体人工覆盖入口。
6. 不做全量 legacy 删除，只做 deprecated 标记、冻结和绕行。

### 1.3 OPUS 补充要求已吸收的实现原则

1. `/ai-report/save` 立即补认证，同时补前端保存请求的鉴权头。
2. 停止前端三套以上 `isDistrictName / 类型猜测` 继续分叉，统一到单一 helper。
3. `adapter.ts` 标记 deprecated，避免继续被误用。
4. Leader Cockpit 不再被排除在规则统一范围外，第一阶段先统一其类型识别入口。
5. PDF 导出依赖前端打印页渲染，第一阶段所有改动均需保持打印页兼容。
6. `ai_decision_reports` 存储协议第一阶段收口，至少补足 `payload_version / prompt_version / output_schema_version / protocol_version`。

---

## 二、第一阶段任务拆分

## 任务包 A：立即修复项

| 项目 | 内容 | 主文件 | 是否必须第一阶段完成 | Definition of Done |
| --- | --- | --- | --- | --- |
| A1 | 修复 `/ai-report/save` 缺少认证 | `src/routes/gov-insight.ts` | 是 | 写接口必须带 `authMiddleware`，未登录返回 401 |
| A2 | 修复前端保存请求未带 Bearer token | `frontend/src/govinsight/api.ts` | 是 | 已登录保存报告可继续成功，未登录保存被拒绝 |
| A3 | 标记 `adapter.ts` deprecated | `frontend/src/govinsight/services/adapter.ts` | 是 | 文件顶部和运行时均明确告知废弃，不再作为新逻辑参考 |
| A4 | 收口前端类型猜测入口 | `frontend/src/govinsight/utils/entityClassification.ts`、`frontend/src/govinsight/data.ts`、`frontend/src/govinsight/leader-cockpit/selectors.ts`、`frontend/src/govinsight/views/DashboardHome.tsx` | 是 | 三处不再各自维护后缀判断 |

## 任务包 B：底座落地

| 项目 | 内容 | 主文件 | 是否必须第一阶段完成 | Definition of Done |
| --- | --- | --- | --- | --- |
| B1 | 建 `canonical_units` | `src/db/migrations-llm.ts` | 是 | 表结构含 `unit_type / parent_region_id / city_region_id / mapping_version / mapping_source / confidence / effective_*` |
| B2 | 建人工覆盖入口 | `src/db/migrations-llm.ts` | 是 | 至少有 `canonical_unit_mapping_overrides` 支撑高风险样本人工修正 |
| B3 | 实现底座回填服务 | `src/services/CanonicalUnitsService.ts` | 是 | 可按规则+override 生成 canonical 结果 |

## 任务包 C：正式消费层 v2

| 项目 | 内容 | 主文件 | 是否必须第一阶段完成 | Definition of Done |
| --- | --- | --- | --- | --- |
| C1 | 建 `gov_open_annual_stats_v2` 正式表 | `src/db/migrations-llm.ts` | 是 | 表结构包含原始指标、底座字段、审计字段、状态字段 |
| C2 | 实现 `official / preview / blocked_*` 物化逻辑 | `src/services/GovInsightStatsV2Service.ts` | 是 | 能按冻结决策表选择 `source_report_version_id` 和 `materialize_status` |
| C3 | 绑定版本与快照字段 | `src/services/GovInsightStatsV2Service.ts` | 是 | 每行写入 `stats_snapshot_at / metric_version / mapping_version` |

## 任务包 D：指标与校验后端化

| 项目 | 内容 | 主文件 | 是否必须第一阶段完成 | Definition of Done |
| --- | --- | --- | --- | --- |
| D1 | 建 `metrics_snapshot_v1` | `src/services/GovInsightReportPayloadService.ts` | 是 | 后端可输出首页指标和同比所需核心字段 |
| D2 | 建 `data_quality_v1` | `src/services/GovInsightReportPayloadService.ts` | 是 | 后端可输出勾稽、异常、警告、一致性摘要 |
| D3 | 输出 scorecards 所需字段 | `src/services/GovInsightReportPayloadService.ts` | 是 | 前端后续可直接消费 scorecards |

## 任务包 E：最小 payload 与 worker 改造

| 项目 | 内容 | 主文件 | 是否必须第一阶段完成 | Definition of Done |
| --- | --- | --- | --- | --- |
| E1 | 建 `report_payload_v1` 类型与服务 | `src/services/GovInsightReportProtocol.ts`、`src/services/GovInsightReportPayloadService.ts` | 是 | 后端可构造最小正式报告 payload |
| E2 | Worker 支持 payload 驱动 | `src/services/GovInsightReportJobWorker.ts` | 是 | `prompt_text` 为空时可由 `report_payload_json` 构造 prompt |
| E3 | 统一 `ai_decision_reports` 存储协议 | `src/db/migrations-llm.ts`、`src/services/GovInsightReportJobWorker.ts`、`src/routes/gov-insight.ts` | 是 | 落库时带版本字段和协议 envelope |

## 任务包 F：前端收口

| 项目 | 内容 | 主文件 | 是否必须第一阶段完成 | Definition of Done |
| --- | --- | --- | --- | --- |
| F1 | AI 任务创建优先走后端 payload | `frontend/src/govinsight/views/ReportGenerator.tsx`、`src/routes/gov-insight.ts` | 是 | 前端 AI 生成不再必须先拼 raw prompt |
| F2 | 保持打印页兼容 | `frontend/src/components/print/GovInsightReportPrintView.tsx`、`frontend/src/govinsight/utils/aiReport.ts` | 是 | 旧 envelope 与新 envelope 都能正常渲染 |
| F3 | 停止新增前端业务计算分叉 | `frontend/src/govinsight/*` | 是 | 新改动不再引入新的本地业务规则入口 |

## 任务包 G：对账与验收

| 项目 | 内容 | 主文件 | 是否必须第一阶段完成 | Definition of Done |
| --- | --- | --- | --- | --- |
| G1 | v1 旧视图与 v2 原始指标对账脚本 | `scripts/govinsight-phase1-reconcile.ts` 或等价实现 | 是 | 至少支持 `region_id + year` 对账 |
| G2 | 典型样本对账 | 样本清单按底座冻结方案执行 | 是 | 覆盖 city / district / department / town_street / functional_zone 边界样本 |
| G3 | official / preview / blocked 决策表验证 | 服务层或脚本 | 是 | 边界版本场景可复现验证 |

---

## 三、任务与影响文件

| 任务包 | 主要文件 |
| --- | --- |
| A | `src/routes/gov-insight.ts`、`frontend/src/govinsight/api.ts`、`frontend/src/govinsight/services/adapter.ts`、`frontend/src/govinsight/utils/entityClassification.ts`、`frontend/src/govinsight/data.ts`、`frontend/src/govinsight/leader-cockpit/selectors.ts`、`frontend/src/govinsight/views/DashboardHome.tsx` |
| B | `src/db/migrations-llm.ts`、`src/services/CanonicalUnitsService.ts` |
| C | `src/db/migrations-llm.ts`、`src/services/GovInsightStatsV2Service.ts` |
| D | `src/services/GovInsightReportProtocol.ts`、`src/services/GovInsightReportPayloadService.ts` |
| E | `src/routes/gov-insight.ts`、`src/services/GovInsightReportJobWorker.ts`、`src/services/GovInsightReportProtocol.ts` |
| F | `frontend/src/govinsight/views/ReportGenerator.tsx`、`frontend/src/govinsight/api.ts`、`frontend/src/govinsight/utils/aiReport.ts` |
| G | `scripts/govinsight-phase1-reconcile.ts`、验收说明文档 |

---

## 四、每个任务的输入 / 输出

| 任务 | 输入 | 输出 |
| --- | --- | --- |
| `canonical_units` | `regions`、人工 override | `region_id -> unit_type / parent_region_id / city_region_id` 正式底座 |
| `gov_open_annual_stats_v2` | `reports`、`report_versions`、`fact_*`、`canonical_units` | 带 `materialize_status` 的正式消费层 |
| `metrics_snapshot_v1` | `stats_v2` 当前年/上年 | 首页指标、同比、占比、纠错率、结转率 |
| `data_quality_v1` | `stats_v2`、一致性结果、派生风险 | 勾稽状态、异常警告、质量摘要 |
| `report_payload_v1` | `metrics_snapshot_v1`、`data_quality_v1`、report 元信息 | Worker 可直接消费的最小正式 payload |
| `ai_decision_reports` 协议 | payload、模型输出 | 带版本信息、可审计、可兼容解析的统一落库存档 |

---

## 五、风险点与回退策略

| 风险点 | 影响 | 回退策略 |
| --- | --- | --- |
| `/ai-report/save` 补认证后前端保存失败 | 打印 / PDF 前保存受影响 | 同步补前端 Authorization header；打印页保留本地 fallback |
| 前端类型分类统一后局部展示变化 | Dashboard / Leader Cockpit 某些节点分类变化 | 仅先统一 helper，不大改 UI 逻辑；保留 legacy 类型映射 |
| `stats_v2` 第一次物化口径与旧视图不完全一致 | 影响对账 | 第一阶段必须保留 v1 与 v2 并行，对账后再切消费源 |
| Worker 改为支持 payload 后 prompt 行为变化 | AI 生成结果可能出现差异 | 保留 `prompt_text` 兼容路径，Worker 支持双路径运行 |
| 新协议 envelope 影响前端读取 | 历史报告展示异常 | 前端 `normalizeReportData` 同时兼容旧裸 JSON、新 envelope、旧 narrative envelope |

---

## 六、对账与验收方式

### 6.1 指标对账

1. 对 `gov_open_annual_stats` 与 `gov_open_annual_stats_v2` 的原始指标做逐字段对账。
2. 优先对账字段：
   - `app_new`
   - `app_carried_over`
   - `app_carried_forward`
   - `outcome_public`
   - `outcome_partial`
   - `outcome_not_open`
   - `outcome_unable`
   - `outcome_ignore`
   - `outcome_other`
   - `rev_total`
   - `rev_corrected`
   - `lit_total`
   - `lit_corrected`

### 6.2 样本验收

1. 至少覆盖 city / district / department / town_street / functional_zone 的典型样本。
2. 至少覆盖以下边界：
   - 新区
   - 高新区
   - 开发区
   - 管委会
   - 镇街
   - 复合名称

### 6.3 链路回归

1. 登录态生成 AI 报告成功。
2. 前端保存报告成功。
3. 打印页能读取新旧协议并正常渲染。
4. PDF 导出不因新协议或新 payload 中断。

---

## 七、建议的提交顺序（Commit Plan）

1. `fix(govinsight): protect ai-report save endpoint and auth-aware frontend save`
2. `refactor(govinsight): centralize frontend entity classification and deprecate adapter`
3. `feat(govinsight): add canonical_units and stats_v2 foundation schema`
4. `feat(govinsight): add canonical unit sync and stats_v2 materialization services`
5. `feat(govinsight): add metrics_snapshot_v1 data_quality_v1 and report_payload_v1`
6. `feat(govinsight): support payload-driven report jobs and unified ai_decision_reports envelope`
7. `refactor(govinsight): switch report generator ai path toward backend payload`
8. `chore(govinsight): add reconciliation tooling and acceptance notes`

---

## 八、当前建议的最小实施顺序

1. 先完成任务包 A，立即消除安全和分叉风险。
2. 再完成任务包 B + C，形成正式底座和正式消费层。
3. 然后完成任务包 D + E，打通后端 payload 和 Worker。
4. 最后推进任务包 F + G，收口前端消费并完成对账验收。

---

## 九、当前轮次的编码优先级

### 9.1 本轮优先落地

1. A1 / A2 / A3 / A4
2. B1 / B2 / B3
3. C1 / C2 / C3
4. D1 / D2
5. E1 / E2 / E3 的最小闭环

### 9.2 第二阶段处理

1. 区县 / 部门直接进入主报告正文
2. Leader Cockpit 全量后端指标切换
3. PDF 导出链路大改
4. legacy 全量清理
5. 历史组织时态治理全面启用
