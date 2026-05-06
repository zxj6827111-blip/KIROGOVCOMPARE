# GovInsight 第二阶段进度说明（2026-04-15）
当前分支：`codex/govinsight-phase1-opus`

## 本轮已完成
1. Leader Cockpit 主链路已以后端为主：
   - 新增后端服务 `src/services/GovInsightLeaderCockpitService.ts`
   - 新增接口 `/api/gov-insight/leader-cockpit/model`
   - 新增接口 `/api/gov-insight/leader-cockpit/comparison`
   - 前端 `LeaderCockpit.tsx` 优先消费后端模型，本地 `selectors.ts` 仅保留 fallback
2. `report_payload_v1` 已扩展 `hierarchyAnalysis`：
   - 支持区县/部门覆盖率
   - 支持重点单位摘要
   - 仍然遵守冻结边界，不直接进入主报告正文
3. 主报告链路已正式消费 `hierarchyAnalysis`，但仅作为非正文支撑块：
   - `ReportGenerator.tsx` 已展示“三级监测支撑摘要（非正文）”
   - `GovInsightReportPrintView.tsx` 已追加“支撑附录：三级监测摘要（非正文）”
   - 不改变现有正文目录和正式正文口径
4. 前端类型猜测与口径分叉进一步收口：
   - 新增统一入口 `frontend/src/govinsight/utils/entityClassification.ts`
   - `Layout.tsx`、`DashboardHome.tsx`、`data.ts`、`leader-cockpit/selectors.ts` 已统一走同一套单位分类逻辑
   - 清除了 Leader Cockpit fallback 比对里的额外日志分叉
5. 危险 legacy fallback 已继续收口：
   - 已移除 `LEGACY_FEES_BY_YEAR`
   - 已移除 `LEGACY_2024_OUTCOME_DETAIL`
   - `adapter.ts` 已明确标记为 deprecated，避免继续误用
6. `ai_decision_reports` 协议读取已进一步收口：
   - 新增 `extractGovInsightStoredEnvelope(...)`
   - `/api/gov-insight/ai-report` 现在会统一回传协议元信息、payload 元信息和来源 job 信息
   - 新增 `/api/gov-insight/ai-report/replay`，可返回有效 payload 与可回放 prompt
   - 对历史存量中的“不完整 payload”已支持自动识别并回退到 rebuild，不再让 replay 链路被旧协议脏数据卡住
7. Phase 2 专项验证脚本已补齐：
   - `scripts/govinsight-phase2-leader-cockpit-verify.ts`
   - `scripts/govinsight-phase2-report-protocol-verify.ts`

## 本轮新增文件
1. `frontend/src/govinsight/components/HierarchySupportSummary.tsx`
2. `scripts/govinsight-phase2-report-protocol-verify.ts`

## 本轮重点修改文件
1. `src/routes/gov-insight.ts`
2. `src/services/GovInsightReportProtocol.ts`
3. `src/services/GovInsightReportPayloadService.ts`
4. `frontend/src/govinsight/api.ts`
5. `frontend/src/govinsight/views/ReportGenerator.tsx`
6. `frontend/src/components/print/GovInsightReportPrintView.tsx`
7. `frontend/src/govinsight/utils/entityClassification.ts`
8. `frontend/src/govinsight/components/Layout.tsx`
9. `frontend/src/govinsight/views/DashboardHome.tsx`
10. `frontend/src/govinsight/data.ts`
11. `frontend/src/govinsight/leader-cockpit/selectors.ts`
12. `package.json`

## 验收命令
```bash
npm.cmd run build
npm.cmd run typecheck   # 在 frontend 目录
npm.cmd run govinsight:phase2:leader-cockpit:verify -- --region=721 --year=2024
npm.cmd run govinsight:phase2:report-protocol:verify -- --region=721 --year=2024
```

## 已完成验收结果
1. `npm.cmd run build` 通过
2. `npm.cmd run typecheck` 通过
3. `npm.cmd run govinsight:phase2:leader-cockpit:verify -- --region=721 --year=2024` 通过
   - `city = 淮安市`
   - `newApplications = 3119`
   - `acceptedTotal = 3153`
   - `district total = 10`
   - `department total = 33`
   - `hierarchyAnalysis.districtFocusCount = 10`
   - `hierarchyAnalysis.departmentFocusCount = 10`
4. `npm.cmd run govinsight:phase2:report-protocol:verify -- --region=721 --year=2024` 通过
   - 检测到存量报告存在不完整 stored payload
   - replay 已自动切换为 `rebuilt` 有效 payload
   - `promptLength = 24869`
   - `districtFocusCount = 10`
   - `departmentFocusCount = 10`

## 第二阶段仍未做
1. 未将区县/部门内容直接写入主报告正式正文
2. 未重构 PDF 主链路，只保证新数据流不破坏现有导出
3. 未做 Leader Cockpit 全量 UI 重写
4. 未做全量历史组织时态治理
5. 未做全量人工 mapping
6. 未删除所有 fallback，只将主路径与高风险 legacy 先收口

## 建议作为下一步延续的事项
1. 基于新的 replay 接口补一个管理端审计页或内部验收页
2. 继续压缩 `aiReport.ts` fallback 规模，逐步让前端只做展示和 shape guard
3. 为主报告链路增加 payload/result 对账脚本，覆盖更多城市样本
