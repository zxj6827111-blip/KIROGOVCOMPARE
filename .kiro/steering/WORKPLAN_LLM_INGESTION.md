# WORKPLAN：LLM 解析与入库系统（A 路线）

> 版本：v3（口径统一版）  
> 日期：2025-12-15

## 0. 开工前提
- 5 份 steering 文档（本套）合并到主干后，才允许进入实现分支开发
- 任何“核心决策”变更必须先改文档，再改代码（防止 CODEX/KIRO 跑偏）

## 1. 分支与 PR 策略

```
main
  ├─ steering/llm-ingestion-v3   # 文档分支（仅 .md），合并后删除
  └─ feat/llm-ingestion-v1       # 实现分支（Phase 1 起）
```

## 2. Phase 1：后端闭环（目标：可验收）

### 2.1 数据库与迁移（P0）
- [ ] migrations：提供 PostgreSQL + SQLite 两套 schema（与 HLD 3.1/3.2 一致）
- [ ] 迁移脚本支持 `--db=postgres|sqlite` 参数
- [ ] 冒烟：重复迁移可执行（幂等）

DoD：
- 能创建 regions/reports/report_versions/jobs
- 外键/索引存在
- `UNIQUE(reports.region_id, reports.year)` 与 `UNIQUE(report_versions.report_id, file_hash)` 生效

### 2.2 文件存储（P0）
- [ ] FileUploadService：
  - 校验 PDF/大小
  - 计算 SHA256(file_hash)
  - 落盘：`data/uploads/{regionId}/{year}/{file_hash}.pdf`
  - 返回 storage_path + file_name + file_size + file_hash

### 2.3 Prompt 管理（P0）
- [ ] prompts 目录结构落地（与 HLD 5 一致）
- [ ] PromptManager：按 PROMPT_VERSION 读取 system/user/schema
- [ ] schema.json 进入严格校验

### 2.4 LLM Provider（P0）
- [ ] LLMProvider 接口
- [ ] GeminiProvider（Phase 1 唯一实现）
- [ ] ProviderFactory（按 LLM_PROVIDER 环境变量选择）

### 2.5 解析与重试（P0）
- [ ] LLMParseService：组装提示词 → 调用 Provider → Schema 校验 → 重试（指数退避）
- [ ] 失败写 jobs.error_code/error_message（脱敏）

### 2.6 幂等与版本化（P0）
- [ ] reports：regionId+year 不存在则创建
- [ ] report_versions：
  - 已有同 file_hash → 409 + REPORT_ALREADY_EXISTS（不新建 job）
  - 不存在 → 新建 job → 成功后写入 version，并置为 active

### 2.7 API（P0）
- [ ] regions：POST/GET
- [ ] reports：POST/GET(list)/GET(detail)
- [ ] jobs：GET
- [ ] compare：GET

### 2.8 测试（P0）
- [ ] 单测：Provider/Prompt/Schema/幂等
- [ ] 集成：按 ACCEPTANCE 的 curl 流程跑通

## 3. Phase 2：前端接 API（P1）
- [ ] 前端移除直连 Gemini（停用 geminiService.ts）
- [ ] 改为调用 /api/reports /api/jobs /api/reports/compare

## 4. Phase 3：UI 渐进迁移（P2）
- [ ] 选择性移植 GovInfoCompare 组件（ReportDetail/ComparisonView/WordGenerator）
- [ ] UI/样式统一

## 5. 风险与控制
- 文档一致性：合并前必须跑 grep 校验（见 ACCEPTANCE）
- Key 泄露：构建产物扫描（见 ACCEPTANCE）
- 解析波动：版本化 + 可回溯（report_versions）
