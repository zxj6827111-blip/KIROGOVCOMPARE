# GovInsight 第二阶段续做进展说明（2026-04-15）

当前分支：`codex/govinsight-phase1-opus`

## 本轮新增完成项

### 1. 历史 `ai_decision_reports` 协议修复完成
- 文件：
  - `src/services/GovInsightReportProtocol.ts`
  - `scripts/govinsight-phase3-repair-ai-reports.ts`
- 结果：
  - 兼容并修复旧版 narrative 存储形态
  - 历史存量异常报告可自动修复为正式协议 envelope
  - 修复脚本支持幂等重跑

### 2. 管理端“回放审计页”已落地
- 文件：
  - `frontend/src/govinsight/views/ReportReplayAudit.tsx`
  - `frontend/src/govinsight/DashboardApp.tsx`
  - `frontend/src/govinsight/views/ReportGenerator.tsx`
  - `frontend/src/govinsight/components/Layout.tsx`
- 结果：
  - 新增 `/report-audit` 路由
  - 主报告页可跳转到回放审计页
  - 页面可查看协议元信息、有效 `report_payload_v1`、可回放 prompt、存量 payload 告警
  - 管理端鉴权缺失时会明确拦截，不暴露回放能力

### 3. 多城市主报告链路对账脚本已新增并实跑通过
- 文件：
  - `scripts/govinsight-phase2-multicity-reconcile.ts`
  - `package.json`
- 新命令：
  - `npm.cmd run govinsight:phase2:multicity-reconcile -- --year=2024 --regions=717,720,721,2135`
- 对账范围：
  - `gov_open_annual_stats_v2`
  - `report_payload_v1.metricsSnapshot`
  - `Leader Cockpit` 主模型与区县/部门对比总量
  - `ai_decision_reports` 中已存在的 stored payload
- 已验证样本：
  - 南京市（717, 2024）
  - 宿迁市（720, 2024）
  - 淮安市（721, 2024）
  - 南通市（2135, 2024）
- 实跑结果：
  - `samples = 4`
  - `passed = 4`
  - `failed = 0`

### 4. `aiReport.ts` fallback 上下文已进一步后端化
- 文件：
  - `frontend/src/govinsight/utils/aiReport.ts`
- 本轮改动：
  - 扩展前端 `GovInsightBackendReportPayload.metricsSnapshot` 类型，接入后端正式指标字段
  - 新增 `applyBackendPayloadToContext(...)`
  - 当存在有效后端 payload 时，fallback 叙事上下文优先使用后端：
    - `metricsSnapshot`
    - `dataQuality`
    - `riskAssessment`
  - 避免 fallback 叙事继续偷偷依赖前端旧口径 `dataQuality / risk`
- 直接收益：
  - 规则兜底稿与 AI 正式稿在“风险等级、异常判断、核心率值”上更接近后端正式口径
  - 后续继续压缩 `aiReport.ts` 时，前端假算分叉进一步减少

### 5. `ReportGenerator.tsx` 本轮阻塞问题已修复
- 文件：
  - `frontend/src/govinsight/views/ReportGenerator.tsx`
- 结果：
  - 修复因编码污染导致的风险优先级比较类型错误
  - 恢复回放审计入口、状态文案、关键章节标题的可读性

### 6. 正式结果层对账脚本已补齐
- 文件：
  - `scripts/govinsight-phase2-report-result-reconcile.ts`
  - `package.json`
- 新命令：
  - `npm.cmd run govinsight:phase2:report-result-reconcile -- --region=721 --year=2024`
- 校验范围：
  - `ai_decision_reports.content_json` / stored envelope 合法性
  - `report_payload_v1` 与正式正文元信息对齐
  - 风险事项优先级顺序是否与 `riskPrioritySeeds` 一致
  - 整改任务 `sequence / taskType / priority` 是否与骨架一致
- 当前确认的协议边界：
  - `GovInsightReportProtocol.buildFormalNarrativeFromPayload(...)` 当前会将正式正文限制为：
    - `overallJudgments` 最多 4 条
    - `riskItems` 最多 5 条
    - `rectificationTasks` 最多 5 条
  - 因此结果层对账脚本按“协议层当前实际输出上限”验收，而不是按 payload 全量骨架条数硬卡
- 当前直接收益：
  - 能区分“stored 正文可直接验收”与“stored 正文虽合法但内容不完整，需要按 payload 重建后再验收”
  - 解决了仅校验 JSON 结构合法、但未校验正文是否遵守风险顺序和整改骨架的问题

## 本轮验证结果

以下命令已实际执行并通过：

```bash
npm.cmd run typecheck   # frontend
npm.cmd run build
npm.cmd run govinsight:phase1:regression -- --region=721 --year=2024
npm.cmd run govinsight:phase2:multicity-reconcile -- --year=2024 --regions=717,720,721,2135
npm.cmd run govinsight:phase2:report-result-reconcile -- --region=721 --year=2024
```

关键结果：
- `frontend` typecheck 通过
- 主仓 build 通过
- `phase1 regression` 通过
  - `payloadValid = true`
  - `appendixMetricAuditRowCount = 10`
  - `rectificationTaskCount = 7`
- `phase2 multicity reconcile` 通过
  - 南京 / 宿迁 / 淮安 / 南通 2024 全量样本通过
- `phase2 report result reconcile` 通过
  - `samples = 1`
  - `passed = 1`
  - 当前命中有效正式报告样本：淮安市 `721 / 2024`
  - 同时识别出 stored narrative 存量问题：
    - `overallJudgments` 仅 2 条
    - `riskItems` 仅 3 条
    - `rectificationTasks` 仅 3 条
  - 脚本已按 payload 重建后的有效正式正文完成结果层对账

## 本轮主要改动文件

- `frontend/src/govinsight/views/ReportReplayAudit.tsx`
- `frontend/src/govinsight/views/ReportGenerator.tsx`
- `frontend/src/govinsight/utils/aiReport.ts`
- `frontend/src/govinsight/DashboardApp.tsx`
- `frontend/src/govinsight/components/Layout.tsx`
- `scripts/govinsight-phase2-multicity-reconcile.ts`
- `scripts/govinsight-phase2-report-result-reconcile.ts`
- `package.json`

## 仍建议放到下一轮继续处理的事项

### 1. 打印/PDF 页文字编码与展示细节
- `frontend/src/components/print/GovInsightReportPrintView.tsx` 仍存在较多历史乱码文案
- 当前不影响构建与导出主链，但建议下一轮做一次专门的打印页文案收口

### 2. `aiReport.ts` 继续瘦身
- 本轮已把 fallback 上下文改为优先吃后端 payload
- 但前端仍保留较大规模 narrative fallback 生成逻辑
- 下一轮可继续拆成：
  - 纯展示/shape guard
  - fallback-only legacy path

### 3. 回放审计页的管理端入口与验收指引
- 当前已可用
- 下一轮可补：
  - 更明确的内部验收说明
  - 历史协议修复结果筛选/检索

## 当前判断

本轮续做后，以下三点已经成立：

1. 主报告正式链路具备“多城市可回归对账”能力
2. 管理端具备“协议回放审计”能力
3. 前端 fallback 已进一步收口到后端正式口径

因此，可以继续进入下一轮更聚焦的收口工作，而不需要再回到大范围现状摸底。
