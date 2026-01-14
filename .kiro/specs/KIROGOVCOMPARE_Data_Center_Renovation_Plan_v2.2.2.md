# KIROGOVCOMPARE Data Center Renovation Plan v2.2.2

**Version**: 2.2.2 (Engineering Review Revised - Index & Migration Patch)  
**Date**: 2026-01-13  
**Scope**: 政务公开年报三张标准表（主动公开 / 依申请 / 复议诉讼）数据中心建设

---

## Diff Summary（与 v2.2.1 的差异摘要）

### v2.2.2 修订点（约束强化与交付规范）

#### P0 必须修改
1. **§5.2 指标字典唯一性约束强化**：将 `metric_dictionary` 的活动版本索引改为 **部分唯一索引（Partial Unique Index）**，强制保证每个 `metric_key` 只有一个 `deprecated_at IS NULL` 的记录。补充了跨数据库实现（PG Unique Index vs SQLite 触发器/应用校验）的建议。

#### P1 建议补强
2. **§12. Phase 1 交付规范**：明确 Phase 1 交付物应包含 **PG 和 SQLite 两套 Migration 脚本** 或 **一致性生成工具**，确保开发环境（SQLite）与生产环境（PG）的 DDL 严格对齐。

---

## 1. 背景与现状
*(保持 v2.2 内容，略)*

---

## 2. 改造总体目标
*(保持 v2.2 内容，略)*

---

## 3. 总体架构
*(保持 v2.2.1 内容，略)*

---

## 4. 数据模型设计

### 4.1 核心表预览
*(保持 v2.2.1 内容，略)*

### 4.2 核心事实表与证据链
*(保持 v2.2.1 内容，略)*

### 4.3 兼容性 DDL 原则

> **重要**：文档中的 DDL 示例以 PostgreSQL 为基准。在 SQLite 实施时需遵循以下类型映射原则：

| PG 类型 | SQLite 映射类型 | 说明 |
|------|------|------|
| `SERIAL PRIMARY KEY` | `INTEGER PRIMARY KEY AUTOINCREMENT` | 自增主键 |
| `UUID` | `TEXT` | 存储为 UUID 格式字符串 |
| `JSONB` / `JSON` | `TEXT` | 应用逻辑完成 JSON 编解码 |
| `TIMESTAMP` | `TEXT` | 使用 `datetime('now')` |
| `NUMERIC` | `REAL` | 浮点数处理 |

---

## 5. 指标字典（Metric Dictionary）

### 5.2 表结构设计

```sql
CREATE TABLE metric_dictionary (
    id                  SERIAL PRIMARY KEY,
    metric_key          TEXT NOT NULL,
    version             INTEGER NOT NULL DEFAULT 1,
    display_name        TEXT NOT NULL,
    formula_sql_or_expr TEXT,
    source_table        TEXT NOT NULL,          -- 'facts' | 'derived' | 'cells'
    deprecated_at       TIMESTAMP,              -- NULL 表示当前活动版本
    
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 保证同一版本号下的 key 唯一
    UNIQUE(metric_key, version)
);

-- 强制唯一约束：确保每个 key 只有一个活动版本
-- PostgreSQL: 
CREATE UNIQUE INDEX idx_metric_dict_active_unique ON metric_dictionary(metric_key) WHERE deprecated_at IS NULL;

-- SQLite: 
-- 若版本支持部分索引 (>= 3.8.0): 
-- CREATE UNIQUE INDEX idx_metric_dict_active_unique ON metric_dictionary(metric_key) WHERE deprecated_at IS NULL;
-- 若不支持，则必须通过触发器 (Trigger) 或应用层事务逻辑强制校验：
-- SELECT COUNT(*) FROM metric_dictionary WHERE metric_key = ? AND deprecated_at IS NULL 应始终 <= 1
```

### 5.4 口径治理机制
*(保持 v2.2.1 内容，略)*

---

## 6. 批次导入（Ingestion Batches）
*(保持 v2.2.1 内容，略)*

---

## 7. 任务编排（Job System）
*(保持 v2.2 内容，略)*

---

## 8. 页面/功能规划
*(保持 v2.2.1 内容，略)*

---

## 9. API 清单
*(保持 v2.2.1 内容，略)*

---

## 10. 报告工厂（Report Factory）
*(保持 v2.2 内容，略)*

---

## 11. 验收与回归测试
*(保持 v2.2.1 内容，略)*

---

## 12. 里程碑与排期

### Phase 1: 数据下沉（Materialize）

- **交付物要求（P1 补强）**：
  - 必须同时提供 `migrations/pg/*.sql` 与 `migrations/sqlite/*.sql`。
  - 或提供一套基于抽象层（如 Knex）生成的双库兼容脚本。
  - **原则**：严禁直接在 SQLite 环境手动执行 PG DDL 示例。

*(其他 Phase 1 条目保持，略)*

### Phase 2: 质量与统计 API
*(保持 v2.2.1 内容，略)*

---

## 13. 风险与对策总览
*(保持 v2.2.1 内容，略)*

---

*文档版本：v2.2.2 | 最后更新：2026-01-13 | 作者：Data Center Team*
