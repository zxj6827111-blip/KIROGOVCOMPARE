# LLM 解析与入库交付总结（A 路线）

> 版本：v3（口径统一版）  
> 日期：2025-12-15

## 1. 本次交付目标
将“年报解析”从纯前端直连大模型改造为后端可控、可审计、可入库的闭环架构（KIROGOVCOMPARE 为唯一交付仓库）。

## 2. 关键设计结论
- 生产 PostgreSQL First，本地可选 SQLite
- reports：同城同年唯一（UNIQUE(region_id, year)）
- 幂等：report_versions 以 (report_id, file_hash) 唯一
- Prompt：prompts/vN（system/user/schema）
- Provider：Phase 1 仅 Gemini，预留扩展

## 3. 验收方式
按 ACCEPTANCE：启动 → health → curl 数据流 → 幂等验证 → 安全扫描。

## 4. 后续建议
- 模型更换：Provider 抽象 + Prompt 版本化 + Schema 校验，确保可控切换
- 解析波动：保留历史 versions，并允许 reparse 形成新版本
