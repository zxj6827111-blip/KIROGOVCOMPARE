# KIROGOVCOMPARE Data Center Renovation Plan v2.2.1

**Version**: 2.2.1 (Engineering Review Revised - Consistency Patch)  
**Date**: 2026-01-13  
**Scope**: 政务公开年报三张标准表（主动公开 / 依申请 / 复议诉讼）数据中心建设

---

## Diff Summary（与 v2.2 的差异摘要）

### v2.2.1 修订点（一致性与实施性补强）

#### P0 必须修改
1. **§6. 批次命名解耦**：将 `ingestion_batches.batch_id` 改为 `batch_uuid`，外键统一命名为 `ingestion_batch_id`，规避“自增 ID”与“UUID”在同一字段名下的语义冲突。
2. **§5.2 指标字典唯一性**：修正 `metric_dictionary` 的唯一键为 `(metric_key, version)`，并明确使用 `deprecated_at IS NULL` 锁定唯一活动版本，以支持版本化治理需求。
3. **§3/§11. 版本生效机制统一**：删除 `is_active=true` 的冗余表述，明确 `reports.active_version_id` 为全局唯一真源，简化状态维护逻辑。
4. **§4.4 DDL 兼容性原则**：显式声明 DDL 示例采用 PG 抽象类型，SQLite 实现需遵循对应的映射规则（如 `JSONB` → `TEXT`）。

#### P1 建议补强
5. **§8.2 API 白名单声明**：明确 `tableName` 参数的有效枚举范围（`active_disclosure`, `application`, `legal_proceeding`），防止非法表名注入。
6. **§12. Phase 2 落表边界**：补充 Derived/Benchmark 的实现路径建议，允许 Phase 2 采用视图或物化视图作为过渡。

---

## 1. 背景与现状
*(保持 v2.2 内容，略)*

---

## 2. 改造总体目标
*(保持 v2.2 内容，略)*

---

## 3. 总体架构

### 数据流

1. **Ingest**: 批量上传文件 → 创建 `ingestion_batches` (获得 `batch_uuid`) → 逐个创建 `reports` → 触发 Parse Job。
2. **Parse**: LLM 解析 → 生成初始 `report_versions` (JSON) → **更新 `reports.active_version_id` 指向该版本**。
3. **Materialize**: 监听 Version 变更 → 异步展平 JSON 到 `fact_*` 和 `cells` 表。
4. **Quality Check**: 基于事实表运行 SQL 规则 → 生成 `quality_issues`。
5. **Benchmark**: 基于派生数据计算分位数、趋势。
6. **Correction**: 用户在 UI 修改数据 → 生成新 `report_versions` → 触发新的 Materialize 流程。

---

## 4. 数据模型设计

### 4.1 核心表预览

| 表名 | 关键字段 | 说明 |
|------|------|------|
| **reports** | `id`, `active_version_id` (FK) | 报告主体，`active_version_id` 为唯一生效指针 |
| **report_versions** | `id`, `report_id`, `ingestion_batch_id` (FK), `version_type` | 版本记录，通过 `ingestion_batch_id` 关联批次 |
| **ingestion_batches** | `id`, `batch_uuid` | 导入批次主表，`batch_uuid` 对外暴露 |

### 4.2 核心事实表与证据链

#### cells（证据链核心）
```sql
CREATE TABLE cells (
    id                  SERIAL PRIMARY KEY,
    version_id          INTEGER NOT NULL REFERENCES report_versions(id),
    table_id            TEXT NOT NULL,            -- 'active_disclosure' | 'application' | 'legal_proceeding'
    row_key             TEXT NOT NULL,
    col_key             TEXT NOT NULL,
    cell_ref            TEXT NOT NULL,            -- "{table_id}:{row_key}:{col_key}"
    value_raw           TEXT,
    value_num           NUMERIC,
    value_semantic      TEXT NOT NULL,            -- 'ZERO'|'EMPTY'|'NA'|'TEXT'|'NUMERIC'
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(version_id, cell_ref)
);
```

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
    
    -- 保证同一版本号下的 key 唯一，且同一 key 只有一个活动版本 (需配合部分索引或索引下推检查)
    UNIQUE(metric_key, version)
);

-- 索引：快速定位活动版本
CREATE INDEX idx_metric_dict_active ON metric_dictionary(metric_key) WHERE deprecated_at IS NULL;
```

### 5.4 口径治理机制

- **版本递增**：变更同一 `metric_key` 时，必须插入新行并递增 `version`。
- **活动标记**：插入新版本时，旧版本的 `deprecated_at` 必须同步更新为当前时间。
- **追溯性**：报告生成时，必须在记录中关联具体的 `metric_dictionary.id` (Row ID)，而非仅记录 `version` 数字。

---

## 6. 批次导入（Ingestion Batches）

### 6.1 表结构设计

```sql
CREATE TABLE ingestion_batches (
    id              SERIAL PRIMARY KEY,       -- 内部自增 ID，用于 FK 关联
    batch_uuid      UUID NOT NULL UNIQUE,     -- 对外业务 ID，用于 API 路由
    created_by      INTEGER,
    note            TEXT,
    status          TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 6.2 关联设计

- **jobs/report_versions**：增加字段 `ingestion_batch_id INTEGER REFERENCES ingestion_batches(id)`。
- **命名规范**：禁止在 Jobs 表中使用 `batch_id` 命名引用的 `ingestion_batches.id`，一律使用 `ingestion_batch_id`。

---

## 7. 任务编排（Job System）
*(保持 v2.2 内容，略)*

---

## 8. 页面/功能规划

### 8.2 Facts（三表指标）

- **API 参数限制**：`tableName` 必须在白名单范围内，严禁动态拼接非受控字符串。
- **tableName 白名单**：
  - `active_disclosure`：主动公开事实数据
  - `application`：依申请事实数据
  - `legal_proceeding`：复议诉讼事实数据

---

## 9. API 清单

### Data Center API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/batches/:batchUuid` | 获取批次详情（通过 UUID 查询） |
| POST | `/api/v2/batches/:batchUuid/retry` | 重试该批次中的失败任务 |
| GET | `/api/v2/reports/:reportId/facts/:tableName` | tableName ∈ {`active_disclosure`, `application`, `legal_proceeding`} |

### Version Control API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/reports/:reportId/versions` | 版本列表 |
| POST | `/api/v1/reports/:reportId/versions/:versionId/activate` | 激活指定版本（更新 `reports.active_version_id`） |

---

## 10. 报告工厂（Report Factory）
*(保持 v2.2 内容，略)*

---

## 11. 验收与回归测试

### 11.1 版本留痕验收

- **生效指针验证**：检查 `reports` 表。执行“激活新版本”后，`active_version_id` 应立即更新。
- **无 redundancy 验证**：确认 `report_versions` 表中不包含 `is_active` 字段，避免双真源同步冲突。

---

## 12. 里程碑与排期

### Phase 2: 质量与统计 API

- **[NEW] 派生数据落地**：
  - **实现原则**：Derived 指标（如同比、环比）与 Benchmark（分位数）允许在 Phase 2 采用 **数据库视图 (View)** 或 **物化视图 (Materialized View)** 快速落地，或使用专门的指标计算表。
  - **验收边界**：不要求全量物理落表，但 API 返回的数据必须支持索引优化，且计算口径符合指标字典定义。

- **三表聚合指标验收示例**：
  - 全市依申请本年新收总计 (SUM)
  - 全市复议纠正率 P50 分位数 (Benchmark)
  - 诉讼纠正率异常预警名单 (TopN)

---

## 13. 风险与对策总览

| 风险类别 | 风险 | 对策 |
|----------|------|------|
| **技术** | 字段命名混淆 | 区分 `*_id` (自增) 与 `*_uuid/key` (业务)，API 使用业务键 |
| **技术** | 跨库 DDL 失败 | 应用层统一抽象迁移框架，SQLite/PG 类型映射模板化 |
| **业务** | 字典无法版本化 | 唯一键改为 (Key, Version)，deprecated_at 锁定活动行 |

---

*文档版本：v2.2.1 | 最后更新：2026-01-13 | 作者：Data Center Team*
