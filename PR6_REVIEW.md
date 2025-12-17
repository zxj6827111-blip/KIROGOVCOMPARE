# PR #6 审查意见（修复后复审）

**PR**：Add stub LLM job runner and parse storage  
**状态**：✅ **已修正，可合并**  
**评分**：92/100

---

## 审查结果

### ✅ 通过项
- ✅ 功能完整：Job Runner 和 Stub Provider 实现正确
- ✅ 数据库迁移：report_version_parses 表设计合理
- ✅ 验收脚本：LLM_PARSE_STUB_TEST.sh 完整可用
- ✅ 代码质量：结构清晰，错误处理完整
- ✅ 安全检查：无 Key 泄露
- ✅ **修复验证**：两项问题已完全修正

### 🔴 之前的问题（已修正）
1. ✅ **error_code 字段更新** - 已修正
2. ✅ **parsed_json 字段类型一致性** - 已修正

---

## 🔍 修复验证

### 1. error_code 字段更新 ✅

**修复前**：
```typescript
querySqlite(
  `UPDATE jobs SET status = 'failed', error_message = ${sqlValue(message)}, finished_at = datetime('now') WHERE id = ${sqlValue(job.id)};`
);
```

**修复后**（commit 670aef6）：
```typescript
querySqlite(
  `UPDATE jobs SET status = 'failed', error_code = 'STUB_PARSE_FAILED', error_message = ${sqlValue(message)}, finished_at = datetime('now') WHERE id = ${sqlValue(job.id)};`
);
```

**验证**：✅ 完美
- error_code 现在设置为 'STUB_PARSE_FAILED'
- 符合 HLD 第 4.8 章错误码定义
- 与 ACCEPTANCE 要求一致

---

### 2. claimNextJob() 逻辑优化 ✅

**修复前**（复杂的 CTE 查询）：
```typescript
const rows = querySqlite(`
  WITH next_job AS (
    SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1
  ),
  updated AS (
    UPDATE jobs SET status = 'running', started_at = datetime('now')
    WHERE id IN (SELECT id FROM next_job)
    RETURNING *
  )
  SELECT updated.id, updated.report_id, updated.version_id, rv.storage_path, rv.file_hash
  FROM updated
  LEFT JOIN report_versions rv ON rv.id = updated.version_id;
`);
```

**修复后**（简化的两步查询）：
```typescript
const updatedJobs = querySqlite(`
  UPDATE jobs
  SET status = 'running', started_at = datetime('now')
  WHERE id = (
    SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1
  )
  RETURNING id, report_id, version_id;
`);

const jobRow = updatedJobs[0];
const versionRow = querySqlite(
  `SELECT storage_path, file_hash FROM report_versions WHERE id = ${sqlValue(jobRow.version_id)} LIMIT 1;`
)[0];
```

**优点**：
- ✅ 逻辑更清晰，易于维护
- ✅ 正确处理 null 情况（versionRow?.storage_path）
- ✅ 避免复杂 CTE 在 SQLite 中的潜在问题
- ✅ 性能相同或更好

---

### 3. SQLite stdin 修复 ✅

**修复前**：
```typescript
const output = execFileSync('sqlite3', ['-json', SQLITE_DB_PATH, sql], { encoding: 'utf-8' }).trim();
```

**修复后**（commit 670aef6）：
```typescript
const output = execFileSync('sqlite3', ['-json', SQLITE_DB_PATH], { encoding: 'utf-8', input: sql }).trim();
```

**优点**：
- ✅ 使用 stdin 传递 SQL，避免命令行长度限制
- ✅ 更安全（SQL 不在进程参数中）
- ✅ 支持更大的 SQL 语句

---

### 4. parsed_json 字段类型一致性 ✅

**SQLite**（migrations-llm.ts）：
```sql
parsed_json TEXT NOT NULL,  -- ✅ 保持 TEXT
```

**PostgreSQL**（migrations-llm.ts）：
```sql
parsed_json JSONB NOT NULL,  -- ✅ 使用 JSONB
```

**report_version_parses 表**（002_report_version_parses.sql）：
```sql
output_json TEXT NOT NULL,  -- ✅ SQLite 用 TEXT
```

**验证**：✅ 完全一致
- SQLite：TEXT（JSON 字符串）
- PostgreSQL：JSONB（原生 JSON 类型）
- 与 report_versions 表保持一致

---

### 5. Job Runner 启动 ✅

**src/index-llm.ts**：
```typescript
import { llmJobRunner } from './services/LlmJobRunner';

// 启动 Job Runner
llmJobRunner.start();
```

**验证**：✅ 完美
- 正确导入 LlmJobRunner
- 在迁移后启动
- 时机正确

---

## 📊 与文档的一致性

| 检查项 | 文档要求 | 当前实现 | 状态 |
|--------|---------|---------|------|
| Job 状态机 | queued/running/succeeded/failed | ✅ | ✅ |
| error_code 更新 | 失败时更新 | ✅ | ✅ |
| error_code 值 | STUB_PARSE_FAILED | ✅ | ✅ |
| parsed_json 存储 | 版本化存储 | ✅ | ✅ |
| parsed_json 类型 | TEXT(SQLite)/JSONB(PG) | ✅ | ✅ |
| report_version_parses 表 | 新增表 | ✅ | ✅ |
| 验收脚本 | 完整可用 | ✅ | ✅ |
| SQLite stdin | 安全传递 SQL | ✅ | ✅ |

---

## 🟢 建议改进（可选，不阻塞合并）

### 1. 添加重试机制（P1）

当前 Job 失败后直接标记为 failed，建议后续添加重试：

```typescript
private async processJob(job: QueuedJob): Promise<void> {
  try {
    // ... 解析逻辑
  } catch (error: any) {
    const retryCount = job.retry_count || 0;
    if (retryCount < job.max_retries) {
      // 重试
      querySqlite(
        `UPDATE jobs SET status = 'queued', retry_count = ${retryCount + 1} WHERE id = ${sqlValue(job.id)};`
      );
    } else {
      // 失败
      querySqlite(
        `UPDATE jobs SET status = 'failed', error_code = 'MAX_RETRIES_EXCEEDED', error_message = ${sqlValue(error.message)}, finished_at = datetime('now') WHERE id = ${sqlValue(job.id)};`
      );
    }
  }
}
```

### 2. 添加 progress 更新（P1）

当前 progress 只在成功时更新为 100，建议在处理过程中更新：

```typescript
// 处理中
querySqlite(
  `UPDATE jobs SET progress = 50 WHERE id = ${sqlValue(job.id)};`
);

// 成功
querySqlite(
  `UPDATE jobs SET status = 'succeeded', progress = 100, finished_at = datetime('now') WHERE id = ${sqlValue(job.id)};`
);
```

---

## ✅ 最终结论

**状态**：✅ **已修正，可合并**

**修复完整性**：
- ✅ error_code 字段更新：完全修正
- ✅ parsed_json 字段类型：完全一致
- ✅ claimNextJob() 逻辑：优化改进
- ✅ SQLite stdin：安全修复
- ✅ 所有文档要求：完全满足

**代码质量**：92/100
- 功能完整正确
- 错误处理完善
- 代码结构清晰
- 与文档完全一致

**建议**：
- ✅ 立即合并（所有 P0 问题已修正）
- 📝 后续可考虑添加重试机制和 progress 更新（P1）

---

**审查完成**：2025-12-16  
**审查人**：Kiro  
**状态**：✅ 已批准，可合并
