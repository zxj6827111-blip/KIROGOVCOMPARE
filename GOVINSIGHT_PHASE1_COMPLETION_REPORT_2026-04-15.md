# GovInsight 第一阶段完成报告（吸收 OPUS 审查意见版）

文档日期：2026-04-15  
当前分支：`codex/govinsight-phase1-opus`

---

## 一、完成结论

GovInsight 第一阶段已按冻结范围完成实现，并已形成“底座 -> 正式消费层 -> payload -> Worker -> 前端消费 -> 验收脚本”的最小闭环。

本轮完成内容严格控制在第一阶段边界内，未展开以下第二阶段事项：
1. 区县 / 部门直接进入主报告正文
2. Leader Cockpit 全量重构
3. PDF 导出主链重写
4. 全量历史组织时态治理
5. 全量 legacy 清理

---

## 二、本轮完成项

### 2.1 安全与分叉收口

1. `src/routes/gov-insight.ts`
   已为 `/api/gov-insight/ai-report/save` 增加 `authMiddleware`。
2. `frontend/src/govinsight/api.ts`
   已为 `saveAIReport()` 增加 Bearer token 透传。
3. `frontend/src/govinsight/services/adapter.ts`
   已标记 deprecated，避免继续作为新链路参考。
4. `frontend/src/govinsight/utils/entityClassification.ts`
   已作为统一分类 helper 落地，Dashboard / Leader Cockpit / tree 构建优先复用。

### 2.2 正式分析底座

1. `src/db/migrations-llm.ts`
   已新增：
   - `canonical_units`
   - `canonical_unit_mapping_overrides`
   - `gov_open_annual_stats_v2`
2. `src/services/CanonicalUnitsService.ts`
   已实现规则识别、manual override 覆盖、`city_region_id` 回填及 frozen seed 写入。
3. `scripts/govinsight-phase1-bootstrap.ts`
   已支持一键执行：
   - migration
   - frozen override seed
   - canonical_units sync
   - `gov_open_annual_stats_v2` materialize

### 2.3 指标、校验与 payload

1. `src/services/GovInsightReportProtocol.ts`
   已定义：
   - `metrics_snapshot_v1`
   - `data_quality_v1`
   - `report_payload_v1`
   - AI report envelope 协议
   - narrative / payload / envelope 校验函数
2. `src/services/GovInsightReportPayloadService.ts`
   已实现：
   - 指标快照
   - 数据质量校验
   - 风险评级
   - metadata seed
   - 风险优先级 seed
   - 整改任务骨架
   - 附件骨架
   - content boundaries

### 2.4 Worker 与正式存储协议

1. `src/services/GovInsightReportJobWorker.ts`
   已支持：
   - 从 `report_payload_json` 自动构造 prompt
   - request_config 自动携带 response schema
   - 模型输出 narrative 校验
   - 存储 envelope 完整性校验
2. `src/routes/gov-insight.ts`
   已统一：
   - AI job 创建
   - payload 获取
   - AI report 保存
   - AI report 读取
3. `ai_decision_reports`
   新写入协议已统一为：
   - `protocol_version = gov_insight_ai_report_v1`
   - `payload_version = report_payload_v1`
   - `prompt_version = gov_insight_backend_prompt_v1`
   - `output_schema_version = govInsightFormalReportV2`
   - `content_json` 为 formal envelope

### 2.5 前端消费收口

1. `frontend/src/govinsight/views/ReportGenerator.tsx`
   AI 生成已优先使用后端 payload。
2. `frontend/src/govinsight/utils/aiReport.ts`
   已改为优先消费后端：
   - scorecards
   - dataQuality
   - appendixSkeleton
   - metadata seeds
   - risk / rectification skeleton fallback
3. `frontend/src/components/print/GovInsightReportPrintView.tsx`
   已保持打印页兼容新旧协议。

---

## 三、首批 frozen override 结果

本轮已将以下高风险边界样本纳入 frozen override：

1. `1084` `泗阳棉花原种场` -> `department`
2. `1085` `泗阳农场` -> `department`
3. `2348` `启东市国家统计局启东调查` -> `department`

处理后结果：
1. `blocked_unknown_unit_type = 0`
2. 上述样本在 `canonical_units` 中均为 `manual_override`
3. 上述样本对应 `gov_open_annual_stats_v2` 全部进入 `official`

---

## 四、验收命令

已新增标准命令：

```bash
npm run govinsight:phase1:bootstrap
npm run govinsight:phase1:verify -- --region=721 --year=2024
npm run govinsight:phase1:reconcile -- --region=721 --year=2024
npm run govinsight:phase1:regression -- --region=721 --year=2024
```

本轮实际执行并通过：

```bash
npm.cmd run build
npm.cmd run typecheck   # in frontend
node -r ts-node/register/transpile-only scripts/govinsight-phase1-bootstrap.ts
node -r ts-node/register/transpile-only scripts/govinsight-phase1-verify.ts --region=721 --year=2024
node -r ts-node/register/transpile-only scripts/govinsight-phase1-reconcile.ts --region=721 --year=2024
node -r ts-node/register/transpile-only scripts/govinsight-phase1-regression.ts --region=721 --year=2024
```

---

## 五、当前状态摘要

### 5.1 数据层结果

1. `gov_open_annual_stats_v2`
   - `official = 3963`
   - `preview = 5`
   - `blocked_unknown_unit_type = 0`
2. `canonical_units`
   - `department = 1252`
   - `town_street = 505`
   - `functional_zone = 86`
   - `district = 49`
   - `city = 7`
   - `province = 3`
   - `unknown = 7`

说明：
`canonical_units` 中仍有 7 个 `unknown`，但已不再形成当前用户可见链路中的 `blocked_unknown_unit_type` 阻塞，这部分留待第二阶段继续治理。

### 5.2 payload 结果

以 `region=721, year=2024` 为样本：
1. payload 校验通过
2. 风险 seed = 5
3. 整改任务骨架 = 7
4. 附件指标骨架 = 10
5. 附件边界 = 4
6. 附件补数项 = 7

### 5.3 前端回归结果

以 `region=721, year=2024` 为样本：
1. rule-based report 的附件一来源字段已为后端口径 `app_new`
2. normalized report 的附件一来源字段已为后端口径 `app_new`
3. 前端 reconciliation checks 已与后端 payload 对齐

---

## 六、已知保留项

以下事项明确留到第二阶段，不视为第一阶段未完成：

1. 区县 / 部门直接进入主报告正文
2. Leader Cockpit 全量后端化
3. PDF 导出主链重构
4. 历史组织变更时态全面启用
5. 前端 legacy 逻辑全量删除

---

## 七、建议的下一步

如果进入第二阶段，建议顺序如下：

1. 清理剩余 `canonical_units.unknown` 并扩展人工映射治理清单
2. 将 Leader Cockpit 的核心指标与风险判断切到后端 payload / metrics 服务
3. 设计区县 / 部门专题 payload，并评估何时进入主报告正文
4. 逐步清理 `frontend/src/govinsight/data.ts` 中 legacy 2024 outcome detail 和 legacy fees fallback
5. 推进正式 AI 成文链路的 prompt/version 审计与历史回放能力
