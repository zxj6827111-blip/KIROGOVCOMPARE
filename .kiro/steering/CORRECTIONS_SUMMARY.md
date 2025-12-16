# LLM 解析与入库系统 - 文档修正总结

## 修正清单

本文档记录了对初版方案文档的 5 项关键修正。

---

## 1. ✅ 统一 ID 类型

### 修正内容
- **regions.id**：BIGSERIAL (PostgreSQL) / INTEGER AUTOINCREMENT (SQLite)
- **reports.id**：BIGSERIAL (PostgreSQL) / INTEGER AUTOINCREMENT (SQLite)
- **report_versions.id**：BIGSERIAL (PostgreSQL) / INTEGER AUTOINCREMENT (SQLite)
- **jobs.id**：BIGSERIAL (PostgreSQL) / INTEGER AUTOINCREMENT (SQLite)
- **API 示例**：所有 regionId/reportId/jobId 使用整数（如 1, 123, 456）

### 修正位置
- HLD_LLM_INGESTION.md - 第 3 章 数据库表设计
- HLD_LLM_INGESTION.md - 第 4 章 API 契约（所有示例）

### 影响
- 前端代码中 ID 类型统一为 number
- 数据库查询性能更好（整数索引）
- API 响应体积更小

---

## 2. ✅ 重做幂等策略与约束

### 修正内容

**原方案**：
- reports.file_hash 全局唯一
- 错误码：FILE_HASH_DUPLICATE (409)

**新方案**：
- 取消 file_hash 全局唯一
- 使用组合唯一键：`UNIQUE(region_id, year, file_hash)`
- 错误码：REPORT_ALREADY_EXISTS (409)
- 含义：同城同年同文件只有一条记录

### 处理流程
```
1. 计算 PDF hash
2. 查询 WHERE region_id = ? AND year = ? AND file_hash = ?
3. 若存在：返回已有 reportId（幂等）
4. 若不存在：创建新 report
```

### 修正位置
- HLD_LLM_INGESTION.md - 第 3 章 数据库表设计（UNIQUE 约束）
- HLD_LLM_INGESTION.md - 第 5.4 章 幂等策略
- HLD_LLM_INGESTION.md - 第 4.8 章 错误码定义
- HLD_LLM_INGESTION.md - 第 4.1 章 API 示例（409 响应）

### 影响
- 支持同一文件在不同城市/年份重复上传
- 同城同年同文件自动去重
- 多版本管理更灵活

---

## 3. ✅ 选定 Phase 1 的数据库与迁移语法

### 修正内容

**Phase 1 采用 PostgreSQL**（推荐生产）
```bash
DATABASE_URL=postgresql://user:pass@host:5432/llm_ingestion
npm run db:migrate -- --db=postgres
```

**SQLite 仅用于本地开发/测试**
```bash
DATABASE_URL=sqlite:///./data.db
npm run db:migrate -- --db=sqlite
```

### 数据库差异处理
- PostgreSQL：使用 BIGSERIAL、JSONB、CURRENT_TIMESTAMP
- SQLite：使用 INTEGER AUTOINCREMENT、TEXT (JSON)、CURRENT_TIMESTAMP

### 修正位置
- HLD_LLM_INGESTION.md - 第 3 章 数据库表设计（两种语法并列）
- ACCEPTANCE_LLM_INGESTION.md - 第 4.0 章 数据库选择（新增）
- ACCEPTANCE_LLM_INGESTION.md - 第 4.1 章 本地启动（更新）

### 影响
- 迁移脚本必须支持两种数据库
- 测试环境可用 SQLite 快速验证
- 生产环境必须用 PostgreSQL

---

## 4. ✅ 修正验收启动命令

### 修正内容

**原方案**：
- 命令不完整，缺少数据库初始化
- 没有验证启动成功的方法

**新方案**：
- 完整的前置条件检查
- 详细的启动步骤（5 步）
- 验证启动成功的命令
- 使用 bash 变量保存 ID，便于后续测试

### 修正位置
- ACCEPTANCE_LLM_INGESTION.md - 第 4.1 章 本地启动（完全重写）
- ACCEPTANCE_LLM_INGESTION.md - 第 4.2 章 示例数据流测试（使用变量）

### 影响
- 测试负责人可 100% 复现
- 减少启动失败的排查时间
- 提高文档可用性

---

## 5. ✅ 补齐 Prompt 管理章节

### 修正内容

新增 **Prompt 管理** 完整章节，包括：

1. **Prompt 文件结构**
   ```
   src/prompts/
     ├─ v1/
     │  ├─ system.txt
     │  ├─ user.txt
     │  └─ schema.json
     └─ v2/
        ├─ system.txt
        ├─ user.txt
        └─ schema.json
   ```

2. **Prompt 加载方式**
   - PromptManager 类
   - 从文件系统动态加载
   - 支持版本切换

3. **Prompt 版本变更策略**
   - 版本命名：v1, v2, v3, ...
   - 新上传使用新版本
   - 已解析保留原版本
   - 支持回溯查询

4. **Prompt 示例**
   - system.txt：系统角色定义
   - user.txt：用户提示词模板
   - schema.json：输出格式定义

### 修正位置
- HLD_LLM_INGESTION.md - 第 7.5 章 Prompt 管理（新增）

### 影响
- Prompt 版本可追踪
- 支持 A/B 测试不同 prompt
- 便于迭代优化解析效果
- 解析结果可复现

---

## 修正后的文档一致性检查

| 检查项 | 状态 |
|--------|------|
| ID 类型统一（整数） | ✅ |
| 幂等策略明确（组合唯一键） | ✅ |
| 错误码一致（REPORT_ALREADY_EXISTS） | ✅ |
| 数据库语法完整（PostgreSQL + SQLite） | ✅ |
| API 示例使用正确 ID 类型 | ✅ |
| 启动命令可复现 | ✅ |
| Prompt 管理完整 | ✅ |
| 所有文档交叉引用正确 | ✅ |

---

## 后续验证步骤

### 开发阶段
1. 按 ACCEPTANCE_LLM_INGESTION.md 第 4.1 章启动本地环境
2. 按 第 4.2 章执行完整数据流测试
3. 验证幂等性：重复上传同一文件，确认返回 409 + 已有 reportId
4. 验证 Prompt 版本：查询 report_versions.prompt_version 字段

### 测试阶段
1. 测试 PostgreSQL 迁移脚本
2. 测试 SQLite 迁移脚本
3. 测试 ID 类型在前后端的一致性
4. 测试 Prompt 版本切换

### 上线前
1. 生产环境必须使用 PostgreSQL
2. 验证所有 API 返回的 ID 类型
3. 验证 Prompt 文件加载正确
4. 验证幂等策略在并发下的正确性

---

## 文档版本

| 版本 | 日期 | 修正内容 |
|------|------|---------|
| v1.0 | 2024-01-15 | 初版 |
| v1.1 | 2024-01-15 | 5 项关键修正 |

---

## 相关文档

- PRD_LLM_INGESTION.md - 产品需求
- HLD_LLM_INGESTION.md - 高层设计（已修正）
- ACCEPTANCE_LLM_INGESTION.md - 验收清单（已修正）
- WORKPLAN_LLM_INGESTION.md - 工作计划
- LLM_INGESTION_DELIVERY_SUMMARY.md - 交付物总结
