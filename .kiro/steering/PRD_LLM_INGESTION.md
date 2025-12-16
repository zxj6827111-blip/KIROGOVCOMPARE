# PRD：LLM 解析与入库（A 路线）

> 版本：v3（口径统一版）  
> 日期：2025-12-15  
> 适用仓库：KIROGOVCOMPARE（唯一交付仓库）

## 1. 背景与目标

### 1.1 背景
当前存在“纯前端直连大模型”的原型（GovInfoCompare），能实现解析与展示，但存在 Key 暴露、不可审计、不可复用、不可做任务队列与入库等问题。A 路线要求将“解析与入库”能力后端化，并保持前后端分离。

### 1.2 目标（Phase 1）
在 KIROGOVCOMPARE 中完成后端闭环：
- 上传 PDF（含元数据 regionId/year）
- 计算 file_hash，落盘文件
- 触发 LLM 解析（Provider 可替换，Phase 1 仅 Gemini）
- JSON Schema 校验与重试
- 解析结果入库（版本化、可审计）
- 提供查询与对比 API（供前端接入）

### 1.3 非目标（Phase 1 不做）
- 不做“前端 UI 全量替换”为 GovInfoCompare（作为后续 Phase 3）
- 不做 OCR / 图像识别（仅接收文本或后续再加）
- 不做多模型并行（仅保留扩展点）

## 2. 核心决策（Single Source of Truth）

> 本节为 5 份材料的统一口径；任何变更必须同时更新 PRD/HLD/WORKPLAN/ACCEPTANCE/DELIVERY_SUMMARY。

1) **数据库**：生产环境 **PostgreSQL First**；允许本地开发使用 SQLite（可选）。  
2) **逻辑报告唯一性**：`reports` 以 `(region_id, year)` 唯一（同城同年一份“逻辑报告”）。  
3) **幂等策略**：同城同年同文件幂等，使用 `report_versions` 的 `UNIQUE(report_id, file_hash)`。  
4) **Prompt 管理**：后端可审计的目录结构：`prompts/vN/system.txt + user.txt + schema.json`。  
5) **ID 类型**：API 对外统一 `integer`（regionId/reportId/versionId/jobId 均为整数）。

## 3. 用户故事与功能需求

### 3.1 用户故事
- 作为业务人员：我选择城市与年份，上传年报 PDF，系统自动解析并入库，后续可对比跨年差异。
- 作为管理员：我希望能追溯某份解析结果使用的模型/Prompt 版本，并可重跑生成新版本。
- 作为测试人员：我希望能通过固定的 curl 流程完成冒烟与幂等验证。

### 3.2 功能需求（P0）
- 城市（regions）管理：至少支持“创建/查询列表”
- 上传：支持 multipart 上传 PDF；必须计算 SHA256；必须落盘保存
- 解析：异步 Job（queued/running/succeeded/failed）；失败重试（指数退避，上限 3 次）
- 入库：解析结果写入 report_versions；必须记录 provider/model/prompt_version
- 查询：支持按 regionId/year 查询；支持拉取报告详情（含最新版本）
- 对比：同城跨年对比（years=2023,2024），输出差异摘要 + 结构化差异（最小可用）

### 3.3 非功能需求（P0）
- 安全：LLM Key 仅在后端环境变量；前端不得出现 Key
- 可观测：Job 状态可查询；错误信息需脱敏
- 可替换：Provider 接口抽象；后续可加 OpenAI/Claude 等

## 4. 里程碑（对应 WORKPLAN）

- Phase 1：后端闭环（上传→解析→入库→查询→对比 API）
- Phase 2：前端接真实 API（不要求 UI 迁移）
- Phase 3：将 GovInfoCompare UI 逐步并入（可选）
- Phase 4：加固（权限/审计/批量/后端抽取等）

## 5. 交付物
- 代码：后端 LLM ingestion 模块 + 迁移脚本 + 测试
- 文档：PRD/HLD/WORKPLAN/ACCEPTANCE/DELIVERY_SUMMARY（本套）
- 验收：按 ACCEPTANCE 的命令与用例通过
