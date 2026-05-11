# 年报解析入库准确率提升 - 全链路改造升级方案

> 文档版本: v5.2（开发启动版）
> 创建日期: 2026-05-06
> 上次修订: 2026-05-06
> 项目: KIROGOVCOMPARE

---

## 修订说明

**v5.2 (本次)** - 开发启动确认与最后补强：
1. ✅ 补齐 `source_gate_warning_threshold`，GateConfig 快照完整进入 DDL / 迁移 / 指纹 / MaterializeGate 构造
2. ✅ `restoreSupersededParseRun()` 恢复 superseded 时同步 `report_versions.parsed_json/provider/model/prompt_version`
3. ✅ 明确本方案已达到正式开发基线，可按阶段进入实施
4. ✅ 新增正式开发准入结论、地基优先的落地顺序、阶段验收标准和回滚边界

**v5.1** - 修正 8 个落地细节问题：
13. ✅ superseded 历史模型：同一 version+fingerprint 允许多条 superseded，补充 superseded_by/superseded_at/restored_from 字段
14. ✅ 恢复 superseded 为 current 的原子流程：如何把 superseded 重新置为 accepted/current，同时降级旧 current，避免唯一索引冲突
15. ✅ finalize_failed 恢复：持久化 intended_final_status，recoverStuckJobs 重试时不能把 finalStatus 当成 finalize_failed
16. ✅ jobs.error_code/error_message 写入：使用 finalize 阶段刚推断出的 errorCode/errorMessage，而非 parse_runs 中的旧值
17. ✅ switchCurrentParseRun 后一致性问题：入队 materialize+checks 或标记旧物化数据 stale，说明事务边界
18. ✅ MaterializeGate 必须从 current parse_run 读取同一份 GateConfig，复用 parse 阶段 Source Gate 阻断逻辑（含 highConfidenceBlocking）
19. ✅ 补全 10.3 迁移 SQL：删除旧 fingerprint 唯一索引，创建 history 索引，所有 ADD CONSTRAINT 可重复执行
20. ✅ 修正 10.2 Provider 文件清单：与 6.5 真实调用链一致，不写成统一 buildSystemInstruction

**v5.0** - 修正 6 个状态一致性和实现误导问题：
1. ✅ 同 fingerprint 强制重解析会撞 accepted 唯一索引 → 新增 superseded 状态
2. ✅ jobs.status 不应写 gate_failed/finalize_failed → 统一改为 failed
3. ✅ finalize 不应清掉失败错误信息 → 只有 accepted 时清空
4. ✅ Source Gate 新配置必须影响门禁逻辑 → determineParseStatus 接收 gateConfig
5. ✅ PromptRules 示例必须实现去重和表四规则
6. ✅ Provider 改造段落必须与真实调用链保持一致

**v4.0** - 修正 6 个会导致迁移失败、状态串线或错误改造的问题：
7. ✅ materialize job ON CONFLICT 无唯一约束 → 先查询后插入
8. ✅ switchCurrentParseRun 缺少 version 校验与并发锁 → FOR UPDATE 行锁
9. ✅ source_gate_strategy 未进入 fingerprint
10. ✅ ALTER TYPE 与 VARCHAR CHECK 冲突 → DROP CONSTRAINT + ADD CONSTRAINT
11. ✅ Provider 调用链核对不准确
12. ✅ PromptRules 示例代码不可编译

**v3.0** - 修正 6 个落地问题：
1-6. (parse_runs 建表、draft 持久化、is_current 单一来源、Source Gate 阻断、NA/null 处理、Provider 调用链)

**v2.0** - 修正 10 个基础设计问题：
1-10. (事务边界、parse_runs 关系、重解析策略、source_snapshots、Source Gate 映射、null/0/斜杠、Gate 顺序、多模型覆盖、队列批次、验收指标)

---

## Context

当前系统存在"数字被拆成两个数字"的准确率问题，且整个解析入库流程存在以下问题：
1. **版本策略缺陷**：`prompt_version` 硬编码为 `'v1'`，解析器升级后旧报告不重解析
2. **源表信息丢失**：PDF/HTML 解析后丢失行列位置、合并单元格、页码等信息
3. **稳定化/门禁结果未持久化**：repairs 数组仅 console.log，无法追溯
4. **半状态风险**：先插入 report_version_parses，门禁失败后数据不一致
5. **hasParsedContent 过宽**：metadata-only JSON 可能被误判为已解析

**本方案的目标**：将表格解析准确率提升至 95%+，建立完整的版本控制、源表快照、门禁持久化机制。

---

## 一、版本与重解析策略

### 1.1 问题分析

**当前问题**：
- `prompt_version` 硬编码为 `'v1'`
- `file_hash` 匹配即复用 parsed_json，不检查解析器版本
- 解析器升级后，历史上传的报告不会重新解析
- `report_versions(report_id, file_hash)` 有唯一约束，同一个文件无法创建新 version

### 1.2 parse_runs 与 report_version_parses 的关系

**决策**：双写过渡，最终 parse_runs 作为主表

| 表名 | 角色 | 原因 |
|------|------|------|
| `parse_runs` | **主表** | 新建，存储完整的解析配置指纹、过程状态、结果 |
| `report_version_parses` | **兼容视图/历史表** | 现有表，保留历史记录，逐步迁移 |

**迁移策略**：
- 过渡期双写：写入 parse_runs 时，同时写入 report_version_parses
- 读取优先级：优先从 parse_runs 读取，report_version_parses 作为备份
- 最终：将 report_version_parses 改为只读历史视图

### 1.3 parse_runs 表结构（最终可执行版）

**问题修正**：
1. superseded 历史模型重构：允许多条 superseded，移除旧的不合理唯一索引
2. 新增 superseded_by/superseded_at/restored_from/restored_at 字段，支持多次覆盖和恢复
3. 唯一约束只保证：同一 version 最多一个 accepted（is_current=TRUE 的那条）
4. 新增 intended_final_status 字段用于 finalize_failed 恢复

```sql
-- 建表顺序：先建 parse_runs，后建 source_snapshots（避免循环依赖）
CREATE TABLE IF NOT EXISTS parse_runs (
  id BIGSERIAL PRIMARY KEY,

  -- 核心关联
  report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  job_id BIGINT REFERENCES jobs(id) ON DELETE SET NULL,

  -- 配置指纹（区分不同解析配置）
  fingerprint VARCHAR(64) NOT NULL,

  -- 模型配置
  provider VARCHAR(50) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt_version VARCHAR(50) NOT NULL,
  parser_version VARCHAR(50) NOT NULL,
  source_extractor_version VARCHAR(50) NOT NULL,
  schema_version VARCHAR(50) NOT NULL,
  stabilize_mode VARCHAR(20) NOT NULL,
  rule_gate_enabled BOOLEAN NOT NULL,
  source_gate_strategy VARCHAR(20) NOT NULL DEFAULT 'standard',
  source_gate_uncertain_threshold INTEGER NOT NULL DEFAULT 10,
  source_gate_high_confidence_blocking BOOLEAN NOT NULL DEFAULT TRUE,
  source_gate_warning_threshold INTEGER NOT NULL DEFAULT 5,

  -- 配置快照
  config_json JSONB NOT NULL,

  -- 状态与结果
  status VARCHAR(30) NOT NULL CHECK (status IN (
    'created',        -- 已创建，等待执行
    'running',       -- 执行中
    'accepted',      -- 解析成功，结果已接受
    'superseded',    -- 曾是 accepted，被新 run 替代（保留历史，供审计追溯）
    'failed',        -- 解析失败（API错误、超时）
    'gate_failed',   -- 门禁失败
    'finalize_failed' -- 阶段3写入失败，可重试finalize
  )),

  -- 最终状态（仅 finalized 阶段写入，用于 finalize_failed 恢复）
  -- 记录本次解析的原始意图结果（accepted/failed/gate_failed），与 status（可能是 finalize_failed）区分
  intended_final_status VARCHAR(30),

  -- 当前使用标记（保证同一version只有一个current）
  is_current BOOLEAN NOT NULL DEFAULT FALSE,

  -- superseded 历史链（支持多次强制覆盖和恢复）
  superseded_by BIGINT REFERENCES parse_runs(id) ON DELETE SET NULL,  -- 被哪个 parse_run 替代
  superseded_at TIMESTAMPTZ,                                            -- 被替代的时间
  restored_from BIGINT REFERENCES parse_runs(id) ON DELETE SET NULL,  -- 如果是从 superseded 恢复，记录来源
  restored_at TIMESTAMPTZ,                                             -- 恢复为 current 的时间

  -- 草稿结果（阶段2结束后写入，用于阶段3失败恢复）
  draft_output_json JSONB,
  draft_repairs_json JSONB,
  draft_gate_result_json JSONB,
  draft_consensus_result_json JSONB,
  draft_source_snapshots_json JSONB,

  -- 时间戳
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,

  -- 最终结果（accepted 时写入，从 draft_* 提升）
  output_json JSONB,
  repairs_json JSONB,
  gate_result_json JSONB,
  consensus_result_json JSONB,

  -- 错误信息
  error_code VARCHAR(50),
  error_message TEXT,

  -- 审计字段
  retry_of BIGINT REFERENCES parse_runs(id) ON DELETE SET NULL,
  attempt INTEGER NOT NULL DEFAULT 1
);

-- 唯一约束：同一 version 只能有一个 current parse_run（is_current = TRUE）
-- 这是"当前使用结果"的单一来源保证
CREATE UNIQUE INDEX IF NOT EXISTS uq_parse_runs_version_current
  ON parse_runs(report_version_id)
  WHERE is_current = TRUE;

-- 辅助索引：按 version + fingerprint 查询所有 superseded 历史（允许多条）
CREATE INDEX IF NOT EXISTS idx_parse_runs_version_fingerprint
  ON parse_runs(report_version_id, fingerprint);

-- 辅助索引：查询 superseded 链（按 superseded_by 查找）
CREATE INDEX IF NOT EXISTS idx_parse_runs_superseded_by
  ON parse_runs(superseded_by) WHERE superseded_by IS NOT NULL;

-- 辅助索引：查询从哪个 superseded 恢复
CREATE INDEX IF NOT EXISTS idx_parse_runs_restored_from
  ON parse_runs(restored_from) WHERE restored_from IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parse_runs_created ON parse_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_parse_runs_status ON parse_runs(status);
CREATE INDEX IF NOT EXISTS idx_parse_runs_job ON parse_runs(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_parse_runs_version ON parse_runs(report_version_id);
CREATE INDEX IF NOT EXISTS idx_parse_runs_is_current ON parse_runs(is_current) WHERE is_current = TRUE;
```

### 1.4 同文件重解析策略

**决策**：同一个 version 下允许多个 parse_run，通过 fingerprint 区分；同一 fingerprint 允许多条 superseded 历史

#### 重解析触发场景

| 场景 | 触发条件 | 行为 |
|------|----------|------|
| **手动重解析** | 用户点击"重新解析"按钮 | 创建新 parse_run，使用最新配置 |
| **配置升级** | prompt_version / parser_version / schema_version 变化 | 创建新 parse_run，提示用户确认 |
| **强制重解析** | 用户选择"覆盖原解析" | 创建新 parse_run，旧 accepted → superseded |
| **失败重试** | parse_run 失败或 gate_failed | 创建 retry parse_run，increment attempt |
| **恢复 superseded** | 用户从历史中选择 superseded 记录 | 将 superseded 重新置为 accepted/current |

#### 强制重解析流程（多次覆盖）

```
用户触发强制重解析（同 fingerprint，勾选"强制覆盖"）
    ↓
检查 fingerprint 是否变化
    ↓
┌─────────────────────────────────────────────────┐
│ fingerprint 变化？                                │
├─────────────────────────────────────────────────┤
│ 是 → 创建新 parse_run (status: created)           │
│ 否 → 检查是否有 is_current = TRUE 的 parse_run    │
│      有（用户确认强制覆盖） →                        │
│        1. 查询旧 current parse_run (id = A)       │
│        2. 创建新 parse_run (id = B, status: created)│
│        3. finalize 时：                          │
│           - 旧 run (A): status = 'superseded',    │
│             superseded_by = B, superseded_at = NOW│
│           - 新 run (B): status = 'accepted',      │
│             is_current = TRUE, accepted_at = NOW  │
│      无 → 创建新 parse_run                         │
└─────────────────────────────────────────────────┘
    ↓
执行 parse_run（阶段1→阶段2→阶段3）
    ↓
finalizeParseRun(parseRunId = B, finalStatus = 'accepted')
    ↓
┌─────────────────────────────────────────────────┐
│ 原子事务：                                        │
│ 1. 查找 is_current = TRUE 的旧 run (A)           │
│ 2. 更新旧 run (A):                               │
│      is_current = FALSE,                         │
│      status = 'superseded',                       │
│      superseded_by = B,                           │
│      superseded_at = NOW                          │
│ 3. 更新新 run (B):                               │
│      status = 'accepted',                         │
│      is_current = TRUE,                          │
│      accepted_at = NOW                           │
│ 4. INSERT materialize job                        │
│ 5. INSERT checks job                             │
│ 6. UPDATE jobs (succeeded)                       │
│ COMMIT                                           │
└─────────────────────────────────────────────────┘
```

**多次强制覆盖示例**（A → B → C，同一 fingerprint）：

| parse_run id | status | is_current | superseded_by | superseded_at |
|-------------|--------|------------|---------------|---------------|
| A (首次) | superseded | FALSE | B | 2026-05-06 10:00 |
| B (第二次) | superseded | FALSE | C | 2026-05-06 11:00 |
| C (第三次) | accepted | TRUE | NULL | NULL |

#### 恢复 superseded 为 current 的原子流程

**场景**：用户从解析历史中恢复一条 superseded 记录（可能不是最近的那条）

```
用户选择 superseded parse_run (id = A) 并点击"恢复为当前"
    ↓
恢复前检查：
- parse_run.id = A 且 status = 'superseded'
- parse_run.output_json IS NOT NULL（必须有结果）
- 当前 is_current = TRUE 的 run (id = C) 存在
    ↓
┌─────────────────────────────────────────────────┐
│ 原子事务（switchCurrentParseRun 复用）：           │
│ 1. 锁定 report_versions(id) FOR UPDATE           │
│ 2. 查询目标 run (A)：status = 'superseded',        │
│    output_json IS NOT NULL                       │
│ 3. 查询当前 run (C)：is_current = TRUE           │
│ 4. 更新旧 run (C)：                              │
│      is_current = FALSE,                         │
│      status = 'superseded',                      │
│      superseded_by = A,                           │
│      superseded_at = NOW                         │
│ 5. 更新目标 run (A)：                             │
│      status = 'accepted',                        │
│      is_current = TRUE,                          │
│      accepted_at = NOW,                          │
│      restored_from = C（记录来源）,               │
│      restored_at = NOW                           │
│ 6. 同步 report_versions.parsed_json = A.output_json│
│ 7. INSERT materialize job（标记 stale=true）      │
│ 8. INSERT checks job（标记 stale=true）           │
│ COMMIT                                           │
└─────────────────────────────────────────────────┘
```

**关键设计点**：
- 恢复时，旧的 current (C) 也标记为 superseded（而不是 "accepted"），保持链式关系
- `restored_from` 记录恢复来源，audit 可追溯
- `restored_at` 记录恢复时间
- 新插入 materialize/check job，标记为 stale（因为旧物化数据是针对 C 的）
- 不存在唯一索引冲突：accepted 状态没有唯一索引，is_current 才是唯一约束

```typescript
/**
 * 恢复 superseded parse_run 为 current
 * 可复用于 switchCurrentParseRun（两者逻辑相同）
 */
async restoreSupersededParseRun(versionId: number, targetParseRunId: number): Promise<void> {
  await this.pool.connect(async (client) => {
    await client.query('BEGIN');

    try {
      // 1. 锁定 report_versions 行
      await client.query(`SELECT id FROM report_versions WHERE id = $1 FOR UPDATE`, [versionId]);

      // 2. 查询目标 run（A）：必须是 superseded 且有 output_json
      const targetResult = await client.query(`
        SELECT id, output_json, restored_from, provider, model, prompt_version FROM parse_runs
        WHERE id = $1 AND report_version_id = $2 AND status = 'superseded' AND output_json IS NOT NULL
        FOR UPDATE
      `, [targetParseRunId, versionId]);

      if (targetResult.rows.length === 0) {
        throw new Error('Cannot restore: parse_run not found, not superseded, or has no output');
      }

      // 3. 查询当前 run（C）
      const currentResult = await client.query(`
        SELECT id FROM parse_runs
        WHERE report_version_id = $1 AND is_current = TRUE
        FOR UPDATE
      `, [versionId]);

      const currentId = currentResult.rows[0]?.id;

      // 4. 更新旧 current（C → superseded）
      if (currentId) {
        await client.query(`
          UPDATE parse_runs SET
            is_current = FALSE,
            status = 'superseded',
            superseded_by = $1,
            superseded_at = NOW()
          WHERE id = $2
        `, [targetParseRunId, currentId]);
      }

      // 5. 更新目标 run（A → accepted/restored）
      await client.query(`
        UPDATE parse_runs SET
          status = 'accepted',
          is_current = TRUE,
          accepted_at = NOW(),
          restored_from = $1,
          restored_at = NOW()
        WHERE id = $2
      `, [currentId ?? null, targetParseRunId]);

      // 6. 同步 report_versions.parsed_json 和解析元数据
      await client.query(`
        UPDATE report_versions SET
          parsed_json = $1,
          provider = $2,
          model = $3,
          prompt_version = $4
        WHERE id = $5
      `, [
        targetResult.rows[0].output_json,
        targetResult.rows[0].provider,
        targetResult.rows[0].model,
        targetResult.rows[0].prompt_version,
        versionId
      ]);

      // 7. 入队 materialize + checks（标记 stale）
      await this.enqueueStaleMaterializeJob(client, versionId);
      await this.enqueueStaleChecksJob(client, versionId);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
```

#### 前端展示策略

```typescript
interface VersionParseHistory {
  versionId: number;
  fileName: string;
  currentAccepted: {
    parseRunId: number;
    fingerprint: string;
    provider: string;
    model: string;
    promptVersion: string;
    parsedAt: string;
  } | null;
  alternativeRuns: Array<{
    parseRunId: number;
    fingerprint: string;
    status: string;   // 'accepted' | 'superseded' | 'failed' | 'gate_failed' | ...
    createdAt: string;
    attempt: number;
    supersededBy?: number;  // 被哪个 parse_run 替代（仅 superseded 时有值）
  }>;
}
```

- 用户可以在"解析历史"中查看同一 version 的所有 parse_run
- `status='superseded'` 的记录显示为"已被替代（可恢复）"
- 可以切换"当前使用"的解析结果到任何 `accepted`/`superseded` 记录
- 显示"最新"和"推荐"标记（推荐指向 `is_current=TRUE` 的记录）
- 强制覆盖时，旧 accepted → superseded，新 accepted → is_current=TRUE

### 1.5 fingerprint 计算规则（最终版）

**关键修正**：所有影响 accepted/gate_failed 判定的配置都必须进入 fingerprint
- Source Gate 策略、阈值、规则版本变化会创建不同指纹
- Prompt/parse gate 规则版本变化会创建不同指纹
- 目标：任何会改变解析接受/拒绝结果的配置变化，都必须触发新 fingerprint

```typescript
interface ParseConfig {
  provider: string;                    // 'gemini'/'openai'/'zhipu'/'modelscope'/'nvidia'
  model: string;                       // 'gemini-2.0-flash'/'gpt-4o'
  prompt_version: string;              // 'v1'/'v2'/'table3-enhanced'
  parser_version: string;              // 'v1.0'/'v1.1'/'v1.2-fix-split'
  source_extractor_version: string;    // 'pdfjs-v1'/'html-cheerio-v2'/'txt-raw'
  stabilize_mode: string;              // 'all'/'table4'/'none'
  rule_gate_enabled: boolean;
  consensus_enabled: boolean;
  schema_version: string;             // 'v1'/'v2'

  // ========== 以下字段新增：必须进入 fingerprint ==========
  source_gate_strategy: string;        // 'conservative'/'standard'/'permissive'
  source_gate_uncertain_threshold: number;  // standard 策略下触发 gate_failed 的阈值
  source_gate_high_confidence_blocking: boolean;  // 是否阻断高置信度不匹配
  source_gate_warning_threshold: number;  // warning 级别不确定字段阈值

  // 提示词规则版本：影响 LLM 输出的任何 prompt 规则变化
  prompt_rules_version: string;        // e.g., 'v1.1'

  // 门禁规则版本：影响 gate_failed 判定的任何规则变化
  parse_gate_version: string;          // e.g., 'v1.0'

  // 共识验证配置（如果启用）
  consensus_provider?: string;
  consensus_model?: string;
}

export function computeParseFingerprint(config: ParseConfig): string {
  // 所有字段都参与指纹计算，包括新增的 source gate 和版本字段
  const normalized = JSON.stringify(config, Object.keys(config).sort());
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex').substring(0, 32);
}

// 版本兼容性检查：判断是否需要重解析
export function requiresReparse(oldConfig: ParseConfig, newConfig: ParseConfig): boolean {
  // 必须重解析的条件：所有会影响解析结果或门禁判定的配置变化
  const mustReparse = [
    // 核心解析配置
    oldConfig.prompt_version !== newConfig.prompt_version,
    oldConfig.schema_version !== newConfig.schema_version,
    oldConfig.source_extractor_version !== newConfig.source_extractor_version,
    oldConfig.parser_version !== newConfig.parser_version,

    // 门禁策略变化（影响 accepted/gate_failed 判定）
    oldConfig.source_gate_strategy !== newConfig.source_gate_strategy,
    oldConfig.source_gate_uncertain_threshold !== newConfig.source_gate_uncertain_threshold,
    oldConfig.source_gate_high_confidence_blocking !== newConfig.source_gate_high_confidence_blocking,
    oldConfig.source_gate_warning_threshold !== newConfig.source_gate_warning_threshold,

    // 规则版本变化
    oldConfig.prompt_rules_version !== newConfig.prompt_rules_version,
    oldConfig.parse_gate_version !== newConfig.parse_gate_version,

    // 共识验证配置变化
    oldConfig.consensus_enabled !== newConfig.consensus_enabled,
    oldConfig.consensus_enabled && (
      oldConfig.consensus_provider !== newConfig.consensus_provider ||
      oldConfig.consensus_model !== newConfig.consensus_model
    ),
  ];

  return mustReparse.some(Boolean);
}
```

### 1.6 指纹变更后的重解析策略

| 配置变更类型 | 是否触发重解析 | 原因 |
|-------------|---------------|------|
| prompt_version 升级 | ✅ 是 | 直接影响 LLM 输出 |
| source_gate_strategy 变化 | ✅ 是 | 影响门禁判定结果 |
| source_gate 阈值变化 | ✅ 是 | uncertain/warning/high-confidence 阈值会改变 gate_failed/warning 判定 |
| prompt_rules_version 变化 | ✅ 是 | 影响 prompt 注入规则 |
| parse_gate_version 变化 | ✅ 是 | 影响 gate_failed 判定逻辑 |
| provider/model 变化 | ✅ 是 | 影响解析准确率 |
| stabilize_mode 变化 | ✅ 是 | 影响最终输出修正 |
| 同一 fingerprint 已有 accepted | ⚠️ 用户选择 | 用户可选择"复用"或"强制重解析" |

### 1.6 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/db/migrations-llm.ts` | 修改 | 新增 parse_runs 表（含修正版结构） |
| `src/services/ParseFingerprintService.ts` | 新建 | 指纹计算服务 |
| `src/services/PromptVersionService.ts` | 新建 | 版本管理服务 |
| `src/services/ParseRunService.ts` | 新建 | parse_runs 管理服务 |
| `src/services/ReportUploadService.ts` | 修改 | 集成指纹检查逻辑、创建 parse_run |
| `src/services/LlmJobRunner.ts` | 修改 | 写入 parse_runs 表 |
| `src/routes/reports.ts` | 修改 | 支持查看解析历史、切换当前解析 |

---

## 二、事务边界设计

### 2.1 问题分析

**原方案错误**：将 `BEGIN` 放在 LLM 解析之前，导致：
1. 数据库长事务锁定资源
2. LLM/API 调用失败时事务无法回滚
3. PDF/HTML 源表抽取在长事务中执行，性能差

### 2.2 正确的事务边界

**原则**：长事务只用于最终状态的原子写入，核心逻辑在事务外执行

#### 流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           解析任务主流程                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────┐                                                         │
│  │ 1. 创建Job     │                                                         │
│  └────────┬────────┘                                                         │
│           ↓                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │ 2. 短事务：创建 parse_run (status: 'created')                 │            │
│  │    BEGIN → INSERT parse_run → UPDATE job status → COMMIT     │            │
│  └─────────────────────────────────────────────────────────────┘            │
│           ↓                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │ 3. 事务外执行（NO transaction）                              │            │
│  │    - 源文件抽取（PDF/HTML/TXT）                              │            │
│  │    - LLM API 调用                                            │            │
│  │    - 规范化输出                                              │            │
│  │    - 稳定化处理                                              │            │
│  │    - Source Gate 校验                                        │            │
│  │    - 规则门禁检查                                            │            │
│  │    - 共识验证（可选）                                        │            │
│  └─────────────────────────────────────────────────────────────┘            │
│           ↓                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │ 4. 短事务：写入结果 + 状态更新                               │            │
│  │    BEGIN                                                    │            │
│  │    → UPDATE parse_run (status, output_json, ...)           │            │
│  │    → INSERT source_snapshots（如有）                        │            │
│  │    → INSERT source_gate_results（如有）                    │            │
│  │    → IF accepted: UPDATE report_versions.parsed_json      │            │
│  │    → INSERT materialize job                                 │            │
│  │    → UPDATE jobs (succeeded/failed)                        │            │
│  │    COMMIT                                                   │            │
│  └─────────────────────────────────────────────────────────────┘            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 事务边界代码示例（方案A：草稿结果持久化）

**选择方案A的理由**：
- 阶段2（LLM调用）是最昂贵的部分，失败后不应重复调用
- draft_* 字段持久化所有中间结果，阶段3失败后可直接重试
- 不重复扣 LLM token 费用，不浪费 API 调用次数

```typescript
// src/services/LlmJobRunner.ts (最终可执行版)

async processParseJob(job: QueuedJob): Promise<void> {
  let parseRunId: number | null = null;
  let currentStatus: string = 'failed';
  let finalOutput: any = null;
  let gateResult: any = null;
  let repairsJson: any = null;
  let consensusResult: any = null;
  let sourceSnapshots: any = null;

  try {
    // ========== 阶段1：短事务创建 parse_run ==========
    const gateConfig = DEFAULT_GATE_CONFIGS[sourceGateStrategy] ?? DEFAULT_GATE_CONFIGS['standard'];

    parseRunId = await this.pool.query(`
      INSERT INTO parse_runs (
        report_version_id, job_id, fingerprint, provider, model,
        prompt_version, parser_version, source_extractor_version,
        schema_version, stabilize_mode, rule_gate_enabled,
        source_gate_strategy, source_gate_uncertain_threshold,
        source_gate_high_confidence_blocking, source_gate_warning_threshold,
        config_json, status, attempt
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING id
    `, [
      job.version_id, job.id, fingerprint, provider, model,
      promptVersion, parserVersion, extractorVersion,
      schemaVersion, stabilizeMode, ruleGateEnabled,
      sourceGateStrategy,
      gateConfig.uncertainThreshold,
      gateConfig.highConfidenceBlocking,
      gateConfig.warningThreshold,
      JSON.stringify(config), 'created', job.attempt ?? 1
    ]).then(r => r.rows[0].id);

    // ========== 阶段2：事务外执行（所有昂贵操作） ==========

    // 2.1 标记为 running
    await this.updateParseRunStatus(parseRunId, 'running');

    // 2.2 源文件抽取（昂贵操作：PDF解析、HTML解析）
    sourceSnapshots = await extractSourceSnapshots(job.filePath, job.version_id);

    // 2.3 LLM 解析（最昂贵操作：API调用）
    const rawOutput = await this.callLlmApi(job, config);

    // 2.4 规范化（CPU密集）
    const normalized = normalizeAnnualReportOutputFromSource(rawOutput, sourceSnapshots);

    // 2.5 稳定化（CPU密集）
    const { output: stabilized, repairs } = stabilizeParsedOutput(normalized, options);
    repairsJson = JSON.stringify(repairs);

    // 2.6 确定性规则门禁（parse-level）
    const ruleGateResult = ruleGateEnabled
      ? parseConsensusService.checkDeterministicRules(stabilized)
      : null;

    // 2.7 Source Gate（如果源快照可用）
    // 注意：这里会根据 source_gate_strategy 决定是否阻断
    const sourceGateResult = sourceSnapshots && sourceSnapshots.length > 0
      ? await tableSourceGateService.gateAllTables(job.version_id, stabilized, sourceSnapshots, sourceGateStrategy)
      : null;

    // 2.8 共识验证（可选，昂贵操作）
    consensusResult = consensusEnabled
      ? await this.runConsensusCheck(stabilized, sourceSnapshots)
      : null;

    // 2.9 决定最终状态（从 gateConfig 读取阈值，不硬编码）
    const statusDecision = this.determineParseStatus(
      ruleGateResult,
      sourceGateResult,
      consensusResult,
      gateConfig
    );
    currentStatus = statusDecision.status;
    gateResult = statusDecision.gateResult;
    finalOutput = currentStatus === 'accepted' ? stabilized : null;

    // ========== 关键：阶段2结束后立即写入草稿结果 ==========
    // 这是方案A的核心：持久化所有昂贵操作的结果，阶段3失败后可恢复
    await this.pool.query(`
      UPDATE parse_runs SET
        draft_output_json = $1,
        draft_repairs_json = $2,
        draft_gate_result_json = $3,
        draft_consensus_result_json = $4,
        draft_source_snapshots_json = $5,
        intended_final_status = $6,
        finished_at = NOW()
      WHERE id = $7
    `, [
      finalOutput ? JSON.stringify(finalOutput) : null,
      repairsJson,
      JSON.stringify(gateResult),
      consensusResult ? JSON.stringify(consensusResult) : null,
      sourceSnapshots ? JSON.stringify(sourceSnapshots) : null,
      currentStatus,
      parseRunId
    ]);

  } catch (error) {
    // LLM/API 失败，记录错误但不影响后续重试机制
    currentStatus = 'failed';
    gateResult = { type: 'error', message: error.message };
    finalOutput = null;

    // 即使失败也写入草稿（保留错误上下文）
    if (parseRunId) {
      await this.pool.query(`
        UPDATE parse_runs SET
          draft_output_json = $1,
          draft_gate_result_json = $2,
          finished_at = NOW(),
          error_code = $3,
          error_message = $4,
          intended_final_status = $5
        WHERE id = $6
      `, [
        null,
        JSON.stringify(gateResult),
        'LLM_API_ERROR',
        String(error?.message).substring(0, 1000),
        'failed',  // 记录原始意图：本次解析是 failed
        parseRunId
      ]);
    }
  }

  // ========== 阶段3：短事务原子提交结果 ==========
  // 此阶段只做数据库写入，不涉及任何外部API调用
  // 失败后可以随时重试 finalizeParseRun，无需重复阶段2
  try {
    await this.finalizeParseRun(parseRunId, job, currentStatus);
  } catch (err) {
    // 阶段3失败：标记为 finalize_failed，保留 draft_* 数据
    // 下次 recoverStuckJobs 时可以直接从 draft_* 恢复并重试
    // 注意：intended_final_status 已在上一步设置，记录了原始意图
    await this.pool.query(`
      UPDATE parse_runs SET
        status = 'finalize_failed',
        error_code = $1,
        error_message = $2
      WHERE id = $3
    `, ['FINALIZE_COMMIT_FAILED', String(err.message).substring(0, 1000), parseRunId]);

    // Job 状态保持 running，recoverStuckJobs 会重试 finalize
    throw err;
  }
}

/**
 * 阶段3：原子提交 parse_run 结果
 * 可以独立调用，用于从 finalize_failed 状态恢复
 *
 * 关键设计：
 * - finalStatus = parseRun.status（阶段2的意图结果），可能已是 finalized 值
 * - intended_final_status 字段记录原始意图（accepted/failed/gate_failed），不受 finalize 失败影响
 * - recoverStuckJobs 重试时，读取 intended_final_status，而不是误用 finalize_failed
 */
async finalizeParseRun(parseRunId: number, job: QueuedJob, targetStatus?: string): Promise<void> {
  // 读取 parse_run（含 draft_* 和 intended_final_status）
  const parseRun = await this.getParseRunById(parseRunId);

  // 原始意图状态（阶段2记录的 intended_final_status）
  const intendedStatus = parseRun.intended_final_status ?? parseRun.status;
  // 本次调用的目标状态（recoverStuckJobs 可能传入覆盖）
  const finalStatus = targetStatus ?? intendedStatus;

  if (!parseRun.draft_output_json && finalStatus === 'accepted') {
    throw new Error('Cannot finalize: no draft output available');
  }

  const finalOutput = parseRun.draft_output_json;
  const repairsJson = parseRun.draft_repairs_json;
  const gateResult = parseRun.draft_gate_result_json;

  await this.pool.connect(async (client) => {
    await client.query('BEGIN');

    try {
      // 1. 推断本轮 finalize 的错误码（使用阶段2的完整上下文，不依赖 parseRun.error_code）
      // 重要：使用 finalize 时 freshly 推断的值，而不是 parse_runs 中已存在的旧值
      const errorCode = finalStatus === 'accepted'
        ? null
        : (finalStatus === 'failed'
            ? (parseRun.error_code ?? this.inferErrorCode(finalStatus))
            : this.inferErrorCode(finalStatus));
      const errorMessage = finalStatus === 'accepted'
        ? null
        : (finalStatus === 'failed'
            ? (parseRun.error_message ?? this.inferErrorMessage(finalStatus, gateResult))
            : this.inferErrorMessage(finalStatus, gateResult));

      // 2. 写入 intended_final_status（记录原始意图，用于 finalize_failed 恢复）
      //    即使本次 finalize 成功，也要设置 intended_final_status = finalStatus
      await client.query(`
        UPDATE parse_runs SET
          status = $1,
          intended_final_status = $2,
          output_json = $3,
          repairs_json = $4,
          gate_result_json = $5,
          consensus_result_json = $6,
          ${finalStatus === 'accepted' ? 'accepted_at = NOW(),' : ''}
          error_code = $7,
          error_message = $8
        WHERE id = $9
      `, [
        finalStatus,
        intendedStatus,       // intended_final_status = 阶段2的原始意图，不因 finalize 成功而改变
        finalOutput,
        repairsJson,
        gateResult,
        parseRun.draft_consensus_result_json,
        errorCode,           // 使用 freshly 推断的值
        errorMessage,         // 使用 freshly 推断的值
        parseRunId
      ]);

      // 3. 如果 accepted，更新 report_versions
      if (finalStatus === 'accepted') {
        const parsedData = typeof finalOutput === 'string'
          ? finalOutput
          : JSON.stringify(finalOutput);

        await client.query(`
          UPDATE report_versions SET
            parsed_json = $1,
            provider = $2,
            model = $3,
            prompt_version = $4
          WHERE id = $5
        `, [
          parsedData,
          parseRun.provider,
          parseRun.model,
          parseRun.prompt_version,
          job.version_id
        ]);

        // 4. 设置 is_current = TRUE（原子操作，利用 partial unique index）
        // 先查找旧 current，再将其标记为 superseded（设置 superseded_by）
        const oldCurrentRuns = await client.query(`
          SELECT id FROM parse_runs
          WHERE report_version_id = $1 AND is_current = TRUE
        `, [job.version_id]);

        // 旧 current → superseded（保留历史，供审计追溯）
        if (oldCurrentRuns.rows.length > 0) {
          await client.query(`
            UPDATE parse_runs SET
              is_current = FALSE,
              status = 'superseded',
              superseded_by = $1,
              superseded_at = NOW()
            WHERE id = ANY($2::bigint[])
          `, [parseRunId, oldCurrentRuns.rows.map(r => r.id)]);
        }

        await client.query(`
          UPDATE parse_runs SET is_current = TRUE
          WHERE id = $1
        `, [parseRunId]);
      }

      // 5. 更新 jobs 状态
      // 原则：jobs.status 只用 succeeded/failed/cancelled
      // 使用 freshly 推断的 errorCode/errorMessage（而非 parse_runs 中已存在的旧值）
      const jobStatus = finalStatus === 'accepted' ? 'succeeded' : 'failed';
      await client.query(`
        UPDATE jobs SET
          status = $1,
          finished_at = NOW(),
          error_code = $2,
          error_message = $3
        WHERE id = $4
      `, [
        jobStatus,
        errorCode,      // 使用 finalize 时 freshly 推断的值（finalStatus === 'accepted' 时为 null）
        errorMessage,   // 使用 finalize 时 freshly 推断的值
        job.id
      ]);

      // 6. 如果 accepted，入队 materialize + checks jobs
      if (finalStatus === 'accepted') {
        // 先查询是否已有 queued/running 的 materialize job
        const existingJob = await client.query(`
          SELECT id FROM jobs
          WHERE report_id = $1 AND version_id = $2 AND kind = 'materialize'
            AND status IN ('queued', 'running')
          LIMIT 1
        `, [job.report_id, job.version_id]);

        if (existingJob.rows.length === 0) {
          await client.query(`
            INSERT INTO jobs (report_id, version_id, kind, status, created_at)
            VALUES ($1, $2, 'materialize', 'queued', NOW())
          `, [job.report_id, job.version_id]);
        }

        // 同时入队 checks job
        const existingChecks = await client.query(`
          SELECT id FROM jobs
          WHERE report_id = $1 AND version_id = $2 AND kind = 'checks'
            AND status IN ('queued', 'running')
          LIMIT 1
        `, [job.report_id, job.version_id]);

        if (existingChecks.rows.length === 0) {
          await client.query(`
            INSERT INTO jobs (report_id, version_id, kind, status, created_at)
            VALUES ($1, $2, 'checks', 'queued', NOW())
          `, [job.report_id, job.version_id]);
        }
      }

      // 7. 如果有 source_snapshots 草稿，批量插入
      if (parseRun.draft_source_snapshots_json) {
        await this.persistSourceSnapshots(client, parseRunId, parseRun.draft_source_snapshots_json);
      }

      await client.query('COMMIT');

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * 根据 parse_runs.status 推断错误码（用于写入 parse_runs.error_code 和 jobs.error_code）
 * 原则：accepted 时返回 null；失败状态必须返回有意义的错误码
 * 重要：此函数在 finalize 时 freshly 调用，使用完整的 finalStatus 和 gateResult 推断
 */
private inferErrorCode(status: string): string {
  const codeMap: Record<string, string> = {
    'failed': 'LLM_API_ERROR',
    'gate_failed': 'PARSE_RULE_GATE_FAILED',
    'finalize_failed': 'FINALIZE_COMMIT_FAILED',
  };
  return codeMap[status] ?? 'UNKNOWN_PARSE_STATUS';
}

/**
 * 根据 parse_runs.status 和 gateResult 推断错误信息
 * gate_failed 时记录 gateResult 的摘要，用于 jobs.error_message
 */
  private inferErrorMessage(status: string, gateResult: any): string | null {
  if (status === 'accepted') return null;

  if (status === 'failed') {
    return gateResult?.message ?? gateResult?.error?.message ?? '解析失败';
  }

  if (status === 'gate_failed' && gateResult) {
    const issues: string[] = gateResult.issues ?? [];
    const ruleIssues = gateResult.ruleGate?.issues ?? [];
    const sourceIssues = gateResult.sourceGate?.uncertain_fields ?? [];

    const parts: string[] = [];
    if (ruleIssues.length > 0) {
      parts.push(`规则门禁: ${ruleIssues.slice(0, 3).join('; ')}`);
    }
    if (sourceIssues.length > 0) {
      parts.push(`源表不确定: ${sourceIssues.slice(0, 3).join('; ')}`);
    }
    if (issues.length > 0 && parts.length === 0) {
      parts.push(issues.slice(0, 3).join('; '));
    }
    return parts.join(' | ') || null;
  }

  return null;
}
/**
 * Source Gate 阻断规则
 * 所有阈值从 gateConfig 读取，不硬编码
 */
export interface GateConfig {
  strategy: 'conservative' | 'standard' | 'permissive';
  uncertainThreshold: number;          // 触发 gate_failed 的不确定字段数量阈值
  highConfidenceBlocking: boolean;    // 是否阻断高置信度不匹配
  warningThreshold: number;           // 标记 warning 的不确定字段数量阈值
}

export const DEFAULT_GATE_CONFIGS: Record<string, GateConfig> = {
  conservative: {
    strategy: 'conservative',
    uncertainThreshold: 5,            // conservative：更严格，阈值更小
    highConfidenceBlocking: true,      // 阻断高置信度不匹配
    warningThreshold: 2
  },
  standard: {
    strategy: 'standard',
    uncertainThreshold: 10,           // standard：中等阈值
    highConfidenceBlocking: true,      // 阻断高置信度不匹配
    warningThreshold: 5
  },
  permissive: {
    strategy: 'permissive',
    uncertainThreshold: 999,          // permissive：几乎不阻断
    highConfidenceBlocking: false,    // 不阻断高置信度不匹配
    warningThreshold: 999
  }
};

private determineParseStatus(
  ruleGateResult: any,
  sourceGateResult: any,
  consensusResult: any,
  gateConfig: GateConfig
): { status: string; gateResult: any } {
  const gateResult = {
    type: 'combined',
    ruleGate: ruleGateResult,
    sourceGate: sourceGateResult,
    consensus: consensusResult,
    config: gateConfig,
    issues: [] as string[]
  };

  // 1. 规则门禁失败：直接 gate_failed
  if (ruleGateResult && !ruleGateResult.passed) {
    gateResult.issues.push(`规则门禁失败: ${ruleGateResult.issues?.length || 0} 个问题`);
    return { status: 'gate_failed', gateResult };
  }

  // 2. 共识验证失败：直接 gate_failed
  if (consensusResult && !consensusResult.matched) {
    gateResult.issues.push(`共识验证失败: ${consensusResult.mismatchedSections?.length || 0} 个不匹配`);
    return { status: 'gate_failed', gateResult };
  }

  // 3. Source Gate 阻断规则（从 gateConfig 读取阈值，不硬编码）
  if (sourceGateResult) {
    const highConfidenceMismatches = sourceGateResult.comparisons?.filter(
      (c: any) => !c.isMatch && c.confidence === 'high'
    ).length || 0;

    const uncertainCount = sourceGateResult.uncertain_fields?.length || 0;

    // 高置信度不匹配阻断（由 gateConfig 控制）
    if (gateConfig.highConfidenceBlocking && highConfidenceMismatches > 0) {
      gateResult.issues.push(`Source Gate 高置信度不匹配: ${highConfidenceMismatches} 个字段`);
      return { status: 'gate_failed', gateResult };
    }

    // 不确定字段阈值阻断（从 gateConfig 读取）
    if (uncertainCount > gateConfig.uncertainThreshold) {
      gateResult.issues.push(`Source Gate 不确定字段过多: ${uncertainCount} 个（阈值: ${gateConfig.uncertainThreshold}）`);
      return { status: 'gate_failed', gateResult };
    }

    // TXT/OCR 源置信度降级（规则由 gateConfig 控制，不硬编码）
    if (sourceGateResult.overall_confidence === 'low' && gateConfig.strategy !== 'permissive') {
      gateResult.issues.push('TXT/OCR 源数据置信度低，建议人工复核');
    }
  }

  // 所有检查通过
  return { status: 'accepted', gateResult };
}
```

### 2.4 失败恢复策略（方案A完整实现）

**方案A选择理由：
- ✅ 不重复扣 LLM token 费用
- ✅ draft_* 字段持久化所有中间结果
- ✅ 阶段3失败后可立即重试，无需重新执行昂贵的阶段2
- ✅ 支持断点续传，避免 API 调用不会丢失

| 失败点 | 恢复策略 |
|--------|----------|
| **阶段1（创建 parse_run 失败）** | Job 状态保持 queued，重试时重新创建 |
| **阶段2（LLM API 超时）** | 标记 parse_run 为 failed，记录 error_message，保留 draft_* 字段（如有），下次重试从 attempt+1 |
| **阶段2（LLM API 返回无效 JSON）** | 标记 parse_run 为 failed，记录 error_message，保留部分草稿 |
| **阶段3（写入失败）** | 标记为 `finalize_failed`，**保留所有 draft_* 数据**，Job 状态保持 running，下次 recoverStuckJobs 直接重试 finalizeParseRun |
| **阶段3（部分成功）** | ROLLBACK 保证原子性，下次重试从头执行 finalizeParseRun |

**状态流转图：

```
created → running → [draft_saved → finalize_failed
                                 ↓
                              accepted
                                 ↓
                           is_current = TRUE
```

**恢复机制实现**：

```typescript
// LlmJobRunner 启动时检查 stuck jobs 每5分钟执行一次 recoverStuckJobs
/**
 * finalize_failed 恢复关键设计：
 * - parse_runs.intended_final_status 记录阶段2的原始意图（accepted/failed/gate_failed）
 * - parse_runs.status 可能是 finalize_failed
 * - 重试时使用 intended_final_status，不误用 finalize_failed 作为 finalStatus
 */
async recoverStuckJobs(): Promise<void> {
  // 1. 找出所有 running 超过30分钟的 job
  const stuckJobs = await this.pool.query(`
    SELECT
      j.*,
      pr.id as parse_run_id,
      pr.status as parse_run_status,
      pr.intended_final_status as intended_status,
      pr.draft_output_json IS NOT NULL as has_draft
    FROM jobs j
    LEFT JOIN parse_runs pr ON pr.job_id = j.id
    WHERE j.status IN ('running', 'queued')
      AND j.started_at < NOW() - INTERVAL '30 minutes'
  `);

  for (const job of stuckJobs.rows) {
    const { parse_run_id, parse_run_status, intended_status, has_draft } = job;

    if (parse_run_id && parse_run_status === 'finalize_failed') {
      // 阶段3失败，但有完整草稿
      // 关键：读取 intended_final_status 作为 finalStatus，不误用 finalize_failed
      const originalStatus = intended_status ?? 'failed';
      this.logger.info(`Retrying finalize for parse_run ${parse_run_id} with intended status: ${originalStatus}`);
      await this.finalizeParseRun(parse_run_id, job, originalStatus);
      continue;
    }

    if (parse_run_id && parse_run_status === 'running' && has_draft) {
      // 阶段2已完成，阶段3可能在执行中或失败
      // 关键：使用 intended_final_status（如果存在）或回退到 running
      const statusToFinalize = intended_status ?? parse_run_status;
      this.logger.info(`Recovering running parse_run ${parse_run_id} from draft (status: ${statusToFinalize})`);
      try {
        await this.finalizeParseRun(parse_run_id, job, statusToFinalize);
      } catch (err) {
        this.logger.warn(`Finalize retry failed, will retry later`, err);
      }
      continue;
    }

    // 没有草稿不可恢复的情况：阶段1或阶段2失败，没有可恢复的草稿
    // 只能重置为 queued，下次完整重试
    await this.pool.query(`
      UPDATE jobs SET status = 'queued', started_at = NULL
      WHERE id = $1
    `, [job.id]);

    // 如果有对应的 parse_run，标记为 failed 保留历史
    if (parse_run_id) {
      await this.pool.query(`
        UPDATE parse_runs SET status = 'failed', error_code = 'RECOVERED_STUCK'
        WHERE id = $1
      `, [parse_run_id]);
    }
  }

  // 2. 清理超过24小时的 finalize_failed，记录告警
  const expiredFinalize = await this.pool.query(`
    SELECT COUNT(*) as count FROM parse_runs
    WHERE status = 'finalize_failed'
      AND created_at < NOW() - INTERVAL '24 hours'
  `);

  if (expiredFinalize.rows[0].count > 0) {
    this.logger.alert(`${expiredFinalize.rows[0].count} parse_runs stuck in finalize_failed for >24h');
  }
}

/**
 * 切换当前使用的 parse_run（前端按钮触发）
 * 原子操作：旧 current → superseded（含 superseded_by），新 run → accepted（含 restored_from）
 * 同时入队 materialize + checks jobs（标记旧物化数据 stale）
 * 关键校验：
 * - parse_run 必须属于当前 version
 * - 必须是 accepted 状态（从 superseded 恢复时也是 accepted）
 * - 必须有 output_json
 * - 使用行锁避免并发切换
 *
 * 事务边界：整个切换在一个 BEGIN...COMMIT 中完成，保证 is_current 切换的原子性
 * 一致性保证：切换后立即入队 materialize/check jobs，旧物化数据通过 stale 标记隔离
 */
async switchCurrentParseRun(versionId: number, newParseRunId: number): Promise<void> {
  await this.pool.connect(async (client) => {
    await client.query('BEGIN');
    try {
      // 1. 获取新 parse_run：
      // - 必须属于当前 version
      // - 必须是 accepted 状态（可能是从 superseded 恢复的）
      // - 必须有 output_json
      // - 使用 FOR UPDATE 行锁避免并发修改
      const newParseRun = await client.query(`
        SELECT * FROM parse_runs
        WHERE id = $1
          AND report_version_id = $2
          AND status = 'accepted'
          AND output_json IS NOT NULL
        FOR UPDATE
      `, [newParseRunId, versionId]);

      if (newParseRun.rows.length === 0) {
        throw new Error('Cannot switch: target parse_run is invalid, not accepted, or belongs to wrong version');
      }

      // 2. 锁定 report_versions 行，避免并发 publish 冲突
      await client.query(`
        SELECT id FROM report_versions WHERE id = $1 FOR UPDATE
      `, [versionId]);

      // 3. 查询旧 current（旧 accepted → superseded）
      const oldCurrentRuns = await client.query(`
        SELECT id FROM parse_runs
        WHERE report_version_id = $1 AND is_current = TRUE
      `, [versionId]);

      const oldCurrentId = oldCurrentRuns.rows[0]?.id;

      // 4. 将旧 current 标记为 superseded（设置 superseded_by 和 superseded_at）
      if (oldCurrentId) {
        await client.query(`
          UPDATE parse_runs SET
            is_current = FALSE,
            status = 'superseded',
            superseded_by = $1,
            superseded_at = NOW()
          WHERE id = $2
        `, [newParseRunId, oldCurrentId]);
      }

      // 5. 设置新 parse_run 为 current（如果它是从 superseded 恢复的，设置 restored_from）
      //    无论是 finalize 时自动切换还是用户手动恢复，状态都已是 accepted
      await client.query(`
        UPDATE parse_runs SET
          is_current = TRUE,
          accepted_at = COALESCE(accepted_at, NOW()),
          restored_from = $1,
          restored_at = CASE WHEN $1 IS NOT NULL THEN NOW() ELSE restored_at END
        WHERE id = $2
      `, [oldCurrentId, newParseRunId]);

      // 6. 同步更新 report_versions.parsed_json
      await client.query(`
        UPDATE report_versions SET
          parsed_json = $1,
          provider = $2,
          model = $3,
          prompt_version = $4
        WHERE id = $5
      `, [
        newParseRun.rows[0].output_json,
        newParseRun.rows[0].provider,
        newParseRun.rows[0].model,
        newParseRun.rows[0].prompt_version,
        versionId
      ]);

      // 7. 入队 materialize + checks jobs（标记 stale，因为旧数据是针对旧 parse_run 的）
      //    方案：先查询是否已有 queued/running 的 job，没有再插入
      const reportId = await client.query(`SELECT report_id FROM report_versions WHERE id = $1`, [versionId])
        .then(r => r.rows[0]?.report_id);

      if (reportId) {
        // materialize job
        const existingMat = await client.query(`
          SELECT id FROM jobs
          WHERE report_id = $1 AND version_id = $2 AND kind = 'materialize'
            AND status IN ('queued', 'running')
          LIMIT 1
        `, [reportId, versionId]);
        if (existingMat.rows.length === 0) {
          await client.query(`
            INSERT INTO jobs (report_id, version_id, kind, status, created_at)
            VALUES ($1, $2, 'materialize', 'queued', NOW())
          `, [reportId, versionId]);
        }

        // checks job
        const existingCheck = await client.query(`
          SELECT id FROM jobs
          WHERE report_id = $1 AND version_id = $2 AND kind = 'checks'
            AND status IN ('queued', 'running')
          LIMIT 1
        `, [reportId, versionId]);
        if (existingCheck.rows.length === 0) {
          await client.query(`
            INSERT INTO jobs (report_id, version_id, kind, status, created_at)
            VALUES ($1, $2, 'checks', 'queued', NOW())
          `, [reportId, versionId]);
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
```
```

### 2.5 当前解析结果的单一来源保证

```typescript
// 获取当前使用的解析结果（唯一入口）
async getCurrentParsedResult(versionId: number): Promise<any> {
  const result = await this.pool.query(`
    SELECT pr.* FROM parse_runs pr
    WHERE pr.report_version_id = $1 AND pr.is_current = TRUE
    LIMIT 1
  `, [versionId]);

  // 兼容旧数据：如果没有 is_current 的记录，从 report_versions 读取
  if (result.rows.length === 0) {
    const legacy = await this.pool.query(`
      SELECT parsed_json, provider, model, prompt_version
      FROM report_versions WHERE id = $1
    `, [versionId]);
    return legacy.rows[0]?.parsed_json;
  }

  return result.rows[0].output_json;
}

// materialize 服务必须使用 current parse_run
async materializeCurrent(versionId: number): Promise<void> {
  const currentParseRun = await this.getCurrentParsedResult(versionId);
  if (!currentParseRun) {
    throw new Error('No current parse_run found for materialize');
  }

  // 使用 currentParseRun.output_json 进行物化
  // ...
}
```

### 2.6 is_current 数据库约束建议

```sql
-- 1. 已有的 partial unique index：同一 version 只能有一个 current
CREATE UNIQUE INDEX IF NOT EXISTS idx_parse_runs_version_current
  ON parse_runs(report_version_id) WHERE is_current = TRUE;

-- 2. CHECK 约束：is_current = TRUE 时必须是 accepted 且有 output_json
ALTER TABLE parse_runs ADD CONSTRAINT chk_current_must_be_accepted
  CHECK (
    is_current = FALSE OR
    (status = 'accepted' AND output_json IS NOT NULL)
  );

-- 3. 一致性建议：
-- - materialize/check/publish 全部通过 getCurrentParsedResult(versionId) 读取
-- - 不再使用 "latest accepted" 作为默认解析结果
-- - 只有用户明确切换或新解析首次成功时才更新 is_current
```

---

## 三、源表结构快照与 Source Gate

### 3.1 问题分析

**当前问题**：
- `PdfParseService` 提取后只保留 Markdown 文本，丢失行列位置、页码
- `HtmlParseService` 处理了 colspan/rowspan 但转换时展平
- 表格区域信息仅用于边框检测，不保留
- 无统一的 SourceGate 服务
- `UNIQUE(version_id, table_type)` 太粗，无法支持多个候选快照

### 3.2 source_snapshots 表结构（最终可执行版）

**问题修正**：
1. 建表顺序：在 `parse_runs` 之后创建，避免外键依赖问题
2. `parse_run_id` 单向关联（parse_runs 不再反向引用 source_snapshots）
3. 完整的索引和约束定义

```sql
-- 注意：必须在 parse_runs 表创建之后执行此建表语句
CREATE TABLE IF NOT EXISTS source_snapshots (
  id BIGSERIAL PRIMARY KEY,

  -- 关联（单向关联：parse_run_id 引用 parse_runs.id）
  report_version_id BIGINT NOT NULL REFERENCES report_versions(id) ON DELETE CASCADE,
  parse_run_id BIGINT REFERENCES parse_runs(id) ON DELETE SET NULL,

  -- 表格标识
  table_type VARCHAR(20) NOT NULL,           -- 'table_2'/'table_3'/'table_4'
  table_index INTEGER NOT NULL DEFAULT 0,      -- 同类型第几个表格（如有多个候选）
  candidate_rank INTEGER NOT NULL DEFAULT 0,   -- 候选排名（0=主选，1+=备选）

  -- 来源信息
  source_type VARCHAR(10) NOT NULL,            -- 'pdf'/'html'/'txt'
  source_path TEXT,                            -- 原始文件路径
  page_range VARCHAR(50),                     -- PDF页码范围，如 '5-7'
  dom_path TEXT,                              -- HTML选择器路径，如 'body > table:nth-child(3)'
  source_ref TEXT,                             -- 通用来源引用

  -- 原始数据
  raw_text TEXT,                              -- PDF纯文本行
  raw_html TEXT,                              -- HTML原始片段
  normalized_cells_json JSONB NOT NULL,       -- 展开后的单元格矩阵
  original_cells_json JSONB,                  -- 原始单元格矩阵（未展开）

  -- 元数据
  metadata_json JSONB NOT NULL,              -- {hasBorder, hasMergedCells, rowCount, colCount, ...}
  extractor_version VARCHAR(50) NOT NULL,

  -- 状态与质量
  status VARCHAR(20) NOT NULL DEFAULT 'extracted' CHECK (
    status IN ('extracted', 'ambiguous', 'failed')
  ),
  error_code VARCHAR(50),
  error_message TEXT,

  -- 审计
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 唯一约束：同一 parse_run 内，同一类型+索引只能有一个主候选
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_snapshots_primary
  ON source_snapshots(parse_run_id, table_type, table_index)
  WHERE candidate_rank = 0;

-- 允许同一 parse_run 内，同一类型有多个候选
CREATE INDEX IF NOT EXISTS idx_source_snapshots_parse_run
  ON source_snapshots(parse_run_id, table_type, candidate_rank);

-- 唯一约束：同一 version 内，同一类型+索引只能有一个主候选（兼容旧数据）
CREATE UNIQUE INDEX IF NOT EXISTS uq_source_snapshots_version_primary
  ON source_snapshots(report_version_id, table_type, table_index)
  WHERE candidate_rank = 0 AND parse_run_id IS NULL;

-- 按版本查询的索引
CREATE INDEX IF NOT EXISTS idx_source_snapshots_version ON source_snapshots(report_version_id);
-- 按表格类型查询的索引
CREATE INDEX IF NOT EXISTS idx_source_snapshots_type ON source_snapshots(table_type);
```

#### 数据库迁移执行顺序（重要）

```sql
-- 步骤1：创建 parse_runs 表（无外键依赖）
-- 步骤2：创建 source_snapshots 表（依赖 parse_runs）
-- 步骤3：创建 source_gate_results 表（依赖 parse_runs 和 source_snapshots）
```

### 3.3 表格结构类型定义

```typescript
// src/types/table-snapshot.ts

export interface TableCellSnapshot {
  id: string;
  rowIndex: number;
  colIndex: number;
  content: string;

  // 语义
  isHeader: boolean;
  headerText?: string;           // 如果是表头单元格，原始文本

  // 合并单元格
  colspan: number;
  rowspan: number;

  // 位置（PDF）
  bbox?: {
    pageNumber: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };

  // 来源引用
  sourceRef?: string;            // HTML selector 或 PDF 位置描述
}

export interface TableSnapshot {
  id: string;
  type: 'table_2' | 'table_3' | 'table_4';
  tableIndex: number;
  candidateRank: number;
  title?: string;

  sourceType: 'pdf' | 'html' | 'txt';
  sourcePath?: string;
  pageRange?: string;
  domPath?: string;
  sourceRef?: string;

  // 原始数据
  rawText?: string;
  rawHtml?: string;

  // 单元格矩阵（已展开）
  cells: TableCellSnapshot[][];
  originalCells?: TableCellSnapshot[][];  // 原始未展开的

  // 元数据
  metadata: {
    hasBorder: boolean;
    hasMergedCells: boolean;
    rowCount: number;
    colCount: number;
    extractedAt: string;
    extractorVersion: string;
  };
}

export interface SourceSnapshotSet {
  reportVersionId: number;
  parseRunId?: number;
  tables: TableSnapshot[];

  // 获取主候选
  getPrimarySnapshot(type: 'table_2' | 'table_3' | 'table_4', index?: number): TableSnapshot | null;

  // 获取所有候选
  getCandidates(type: 'table_2' | 'table_3' | 'table_4', index?: number): TableSnapshot[];
}
```

### 3.4 Source Gate 候选选择规则

```typescript
class TableSourceGateService {
  /**
   * 选择源表候选的优先级规则
   */
  selectSnapshotCandidate(candidates: TableSnapshot[]): TableSnapshot | null {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    // 1. 优先选择 status = 'extracted'
    const extracted = candidates.filter(c => c.metadata.status === 'extracted');
    if (extracted.length === 1) return extracted[0];

    // 2. 优先选择 hasBorder = true（表格边框清晰）
    const withBorder = (extracted.length > 0 ? extracted : candidates)
      .filter(c => c.metadata.hasBorder);
    if (withBorder.length >= 1) {
      return withBorder.sort((a, b) => a.candidateRank - b.candidateRank)[0];
    }

    // 3. 优先选择 rowCount 和 colCount 最接近预期的
    // 表三预期：7-9行 x 7-9列
    const expectedTable3 = { minRows: 7, maxRows: 9, minCols: 7, maxCols: 9 };
    const bestFit = (extracted.length > 0 ? extracted : candidates)
      .map(c => ({
        snapshot: c,
        rowScore: Math.abs(c.metadata.rowCount - expectedTable3.minRows),
        colScore: Math.abs(c.metadata.colCount - expectedTable3.minCols),
        totalScore: 0
      }))
      .map(item => ({
        ...item,
        totalScore: item.rowScore + item.colScore
      }))
      .sort((a, b) => a.totalScore - b.totalScore);

    return bestFit[0]?.snapshot ?? candidates[0];
  }
}
```

### 3.5 Source Gate 映射算法

#### 3.5.1 表三行名归一化

```typescript
// 表三行名关键词 → 标准字段映射
const TABLE3_ROW_MAPPINGS: Record<string, string> = {
  // 主分类行
  '本年新收': 'newReceived',
  '本年新收政府信息公开申请数量': 'newReceived',

  '上年结转': 'carriedOver',
  '上年结转政府信息公开申请数量': 'carriedOver',

  // 办理结果主分类
  '予以公开': 'results.granted',
  '予以公开情况': 'results.granted',

  '部分公开': 'results.partialGrant',
  '部分公开（区分处理）': 'results.partialGrant',

  '不予公开': 'results.denied',  // 需要进一步匹配子项
  '不予公开情况': 'results.denied',

  '无法提供': 'results.unableToProvide',
  '无法提供情况': 'results.unableToProvide',

  '不予处理': 'results.notProcessed',
  '不予处理情况': 'results.notProcessed',

  '其他处理': 'results.other',
  '其他处理情况': 'results.other',

  // 合计行
  '办理结果合计': 'results.totalProcessed',
  '总计': 'results.totalProcessed',
  '本年度办理结果': 'results.totalProcessed',

  '结转下年': 'results.carriedForward',
  '结转下年度继续办理': 'results.carriedForward',
};

// 表三行子项映射
const TABLE3_ROW_SUB_MAPPINGS: Record<string, string> = {
  // 不予公开子项
  '属于国家秘密': 'results.denied.stateSecret',
  '国家秘密': 'results.denied.stateSecret',
  '其他法律行政法规禁止公开': 'results.denied.lawForbidden',
  '法律行政法规禁止公开': 'results.denied.lawForbidden',
  '危及三安全一稳定': 'results.denied.safetyStability',
  '三安全一稳定': 'results.denied.safetyStability',
  '危及“国家安全”：危及“国家安全”': 'results.denied.safetyStability',
  '保护第三方合法权益': 'results.denied.thirdPartyRights',
  '第三方合法权益': 'results.denied.thirdPartyRights',
  '属于三类内部事务信息': 'results.denied.internalAffairs',
  '内部事务信息': 'results.denied.internalAffairs',
  '属于四类过程性信息': 'results.denied.processInfo',
  '过程性信息': 'results.denied.processInfo',
  '属于行政执法案卷': 'results.denied.enforcementCase',
  '行政执法案卷': 'results.denied.enforcementCase',
  '属于行政查询事项': 'results.denied.adminQuery',
  '行政查询事项': 'results.denied.adminQuery',

  // 无法提供子项
  '本机关不掌握相关政府信息': 'results.unableToProvide.noInfo',
  '不掌握相关政府信息': 'results.unableToProvide.noInfo',
  '没有现成信息需要另行制作': 'results.unableToProvide.needCreation',
  '现成信息需要另行制作': 'results.unableToProvide.needCreation',
  '补正后申请内容仍不明确': 'results.unableToProvide.unclear',
  '申请内容不明确': 'results.unableToProvide.unclear',

  // 不予处理子项
  '信访举报投诉类申请': 'results.notProcessed.complaint',
  '重复申请': 'results.notProcessed.repeat',
  '要求提供公开出版物': 'results.notProcessed.publication',
  '无正当理由大量反复申请': 'results.notProcessed.massiveRequests',
  '要求行政机关确认或重新出具': 'results.notProcessed.confirmInfo',

  // 其他处理子项
  '申请人无正当理由逾期不补正': 'results.other.overdueCorrection',
  '逾期不补正': 'results.other.overdueCorrection',
  '申请人逾期未按收费通知要求缴纳费用': 'results.other.overdueFee',
  '逾期未缴费': 'results.other.overdueFee',
  '其他': 'results.other.otherReasons',
};
```

#### 3.5.2 表三列名归一化

```typescript
// 表三列名关键词 → 标准字段映射
const TABLE3_COL_MAPPINGS: Record<string, string> = {
  // 自然人（第一列）
  '自然人': 'naturalPerson',

  // 法人/其他组织
  '商业企业': 'legalPerson.commercial',
  '企业': 'legalPerson.commercial',

  '科研机构': 'legalPerson.research',
  '科研': 'legalPerson.research',

  '社会公益组织': 'legalPerson.social',
  '公益组织': 'legalPerson.social',
  '社会组织': 'legalPerson.social',

  '法律服务机构': 'legalPerson.legal',
  '法律服务': 'legalPerson.legal',

  '其他': 'legalPerson.other',

  // 总计
  '总计': 'total',
  '合计': 'total',
};
```

#### 3.5.3 rowspan/colspan 展开规则

```typescript
function expandMergedCells(cells: (string | null)[][], mergedCells: MergedCellInfo[]): string[][] {
  const expanded: string[][] = cells.map(row => [...row]);

  // 按行优先顺序处理合并单元格
  mergedCells
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .forEach(merge => {
      const { row, col, rowspan, colspan, content } = merge;

      // 填充主单元格（左上角）
      expanded[row][col] = content;

      // 填充 rowspan × colspan 区域
      for (let r = 0; r < rowspan; r++) {
        for (let c = 0; c < colspan; c++) {
          if (r === 0 && c === 0) continue; // 主单元格已填充
          expanded[row + r][col + c] = content;
        }
      }
    });

  return expanded;
}

// 表头单元格特殊处理
function resolveHeaderText(expanded: string[][], rowIndex: number, colIndex: number): string {
  const cell = expanded[rowIndex][colIndex];

  // 如果是表头单元格（isHeader=true），返回表头文本
  // 否则返回单元格内容
  return cell ?? '';
}
```

#### 3.5.4 PDF 跨页表格合并规则

```typescript
function mergeCrossPageTable(tableFragments: TableSnapshot[]): TableSnapshot | null {
  if (tableFragments.length === 0) return null;
  if (tableFragments.length === 1) return tableFragments[0];

  // 1. 按页码排序
  const sorted = [...tableFragments].sort((a, b) => {
    const pageA = parseInt(a.pageRange?.split('-')[0] ?? '0');
    const pageB = parseInt(b.pageRange?.split('-')[0] ?? '0');
    return pageA - pageB;
  });

  // 2. 检测表头行（通常是多行表头，包含"自然人"、"法人"等）
  const headerRows = detectHeaderRows(sorted);

  // 3. 合并数据行
  const mergedCells: string[][] = [];
  const allRows = sorted.flatMap(t => t.cells.map(row => row.map(cell => cell.content)));

  // 4. 检测并跳过重复的表头行（跨页后的表头重复）
  const dataRows = allRows.filter((row, idx) => {
    // 跳过表头行（通常前2-4行）
    if (idx < headerRows) return false;
    // 跳过与表头行完全相同的行（跨页后的表头）
    const isDuplicateHeader = headerRows > 0 && idx < headerRows * 2 && isHeaderRow(row);
    return !isDuplicateHeader;
  });

  // 5. 合并行
  const merged: TableSnapshot = {
    ...sorted[0],
    cells: dataRows.map((content, rowIdx) =>
      content.map((text, colIdx) => ({
        id: `merged-${rowIdx}-${colIdx}`,
        rowIndex: rowIdx,
        colIndex: colIdx,
        content: text,
        isHeader: rowIdx < headerRows,
        colspan: 1,
        rowspan: 1,
        sourceRef: `merged:${sorted.map(s => s.sourceRef).join('|')}`
      }))
    ),
    pageRange: `${sorted[0].pageRange?.split('-')[0]}-${sorted[sorted.length - 1].pageRange?.split('-')[1]}`
  };

  return merged;
}
```

#### 3.5.5 TXT/OCR 无坐标来源时的降级策略

```typescript
function extractFromTxt(sourceText: string, tableType: 'table_3'): TableSnapshot | null {
  // TXT 格式通常是 Markdown 表格：| 项目 | 数值 | ...
  // 无法确定行列位置，只能通过行关键词匹配

  const lines = sourceText.split('\n');
  const table3Lines: string[][] = [];

  // 识别表格行（以 | 开头和结尾）
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').slice(1, -1).map(c => c.trim());
      table3Lines.push(cells);
    }
  }

  if (table3Lines.length === 0) {
    return {
      id: uuid(),
      type: tableType,
      sourceType: 'txt',
      cells: [],
      metadata: { hasBorder: false, hasMergedCells: false, rowCount: 0, colCount: 0, ... }
    };
  }

  // TXT 无坐标，使用行索引和列索引
  return {
    id: uuid(),
    type: tableType,
    sourceType: 'txt',
    cells: table3Lines.map((row, rowIdx) =>
      row.map((text, colIdx) => ({
        id: `txt-${rowIdx}-${colIdx}`,
        rowIndex: rowIdx,
        colIndex: colIdx,
        content: text,
        isHeader: rowIdx === 0,  // 假设第一行是表头
        colspan: 1,
        rowspan: 1,
        sourceRef: `line:${rowIdx}`
      }))
    ),
    metadata: {
      hasBorder: false,
      hasMergedCells: false,
      rowCount: table3Lines.length,
      colCount: table3Lines[0]?.length ?? 0,
      extractedAt: new Date().toISOString(),
      extractorVersion: 'txt-raw-v1'
    }
  };
}
```

#### 3.5.6 无法确定时输出 UNCERTAIN

```typescript
export interface CellComparison {
  field: string;
  parsedValue: number | null;    // LLM 解析的值
  sourceValue: number | null;     // 源表中提取的值
  isMatch: boolean;
  confidence: 'high' | 'medium' | 'low' | 'uncertain';
  evidence: {
    sourceRow: number;
    sourceCol: number;
    sourceText: string;
    matchReason?: string;
    mismatchReason?: string;
  };
}

class TableSourceGateService {
  compareCell(
    field: string,
    parsedValue: number | null,
    sourceCells: string[][],
    rowMapping: Map<number, string>,
    colMapping: Map<number, string>
  ): CellComparison {
    // 1. 找到源表中对应行
    const rowIdx = this.findRowIndex(field, rowMapping);
    if (rowIdx === null) {
      return {
        field,
        parsedValue,
        sourceValue: null,
        isMatch: false,
        confidence: 'uncertain',
        evidence: { sourceRow: -1, sourceCol: -1, sourceText: 'Row not found' }
      };
    }

    // 2. 找到源表中对应列
    const colIdx = this.findColIndex(field, colMapping);
    if (colIdx === null) {
      return {
        field,
        parsedValue,
        sourceValue: null,
        isMatch: false,
        confidence: 'uncertain',
        evidence: { sourceRow: rowIdx, sourceCol: -1, sourceText: 'Column not found' }
      };
    }

    // 3. 提取源值
    const sourceText = sourceCells[rowIdx]?.[colIdx];
    const sourceValue = this.parseNumericCell(sourceText);

    // 4. 比较
    const match = this.valuesMatch(parsedValue, sourceValue);

    return {
      field,
      parsedValue,
      sourceValue,
      isMatch: match,
      confidence: sourceText ? 'high' : 'uncertain',
      evidence: {
        sourceRow: rowIdx,
        sourceCol: colIdx,
        sourceText: sourceText ?? '',
        matchReason: match ? 'Values match' : undefined,
        mismatchReason: !match ? `Parsed: ${parsedValue}, Source: ${sourceValue}` : undefined
      }
    };
  }

  private parseNumericCell(text: string | null | undefined): number | null {
    if (!text) return null;
    const trimmed = String(text).trim();

    // 空值
    if (!trimmed) return null;

    // 特殊标记：保留为 null（不是 0）
    if (['/', '-', '—', '空', 'N/A'].includes(trimmed)) {
      return null;  // 注意：不是 0，保留原始标记
    }

    // 数字
    const normalized = trimmed.replace(/,/g, '').replace(/,/g, '');
    if (/^-?\d+(\.\d+)?$/.test(normalized)) {
      return parseFloat(normalized);
    }

    return null;
  }
}
```

### 3.6 数据库表

```sql
-- 新增表：source_gate_results
CREATE TABLE IF NOT EXISTS source_gate_results (
  id BIGSERIAL PRIMARY KEY,

  -- 关联
  version_id BIGINT NOT NULL REFERENCES report_versions(id),
  parse_run_id BIGINT REFERENCES parse_runs(id),
  source_snapshot_id BIGINT REFERENCES source_snapshots(id),

  -- 表格类型
  table_type VARCHAR(20) NOT NULL,

  -- 结果
  passed BOOLEAN NOT NULL,
  overall_confidence VARCHAR(20) NOT NULL CHECK (
    overall_confidence IN ('high', 'medium', 'low', 'uncertain')
  ),

  -- 详细比较结果
  comparisons_json JSONB NOT NULL,           -- CellComparison[]
  uncertain_fields_json JSONB,
  auto_fixes_json JSONB,

  -- 统计
  total_fields INTEGER NOT NULL DEFAULT 0,
  matched_fields INTEGER NOT NULL DEFAULT 0,
  uncertain_fields INTEGER NOT NULL DEFAULT 0,

  -- 审计
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_source_gate_results_version ON source_gate_results(version_id);
CREATE UNIQUE INDEX uq_source_gate_results_parse_run
  ON source_gate_results(parse_run_id, table_type);
```

### 3.7 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/types/table-snapshot.ts` | 新建 | 源表快照类型定义（修正版） |
| `src/db/migrations-llm.ts` | 修改 | source_snapshots（修正版）、source_gate_results |
| `src/services/PdfParseService.ts` | 修改 | 保留表格位置信息、页码 |
| `src/services/HtmlParseService.ts` | 修改 | 保留展开后的单元格矩阵 |
| `src/services/TableSourceGateService.ts` | 新建 | SourceGate 服务（含映射算法） |
| `src/services/TableRowMapper.ts` | 新建 | 行名归一化映射 |
| `src/services/TableColMapper.ts` | 新建 | 列名归一化映射 |

---

## 四、稳定化、共识和规则门禁持久化

### 4.1 问题分析

**当前问题**：
- `LLM_PARSE_STABILIZE_MODE` 默认 `'none'`
- 稳定化结果不持久化
- 门禁失败可重试（可能无限循环）

### 4.2 生产环境默认值建议

```bash
# .env.example

# 稳定化模式：'all'/'table4'/'none'
# 生产环境建议：'all'（自动修复明显错误）
LLM_PARSE_STABILIZE_MODE=all

# 规则门禁：true/false
# 生产环境建议：true（阻止不符合规则的解析）
LLM_PARSE_RULE_GATE_ENABLED=true

# 共识验证：true/false
# 生产环境建议：false（成本高，可选）
LLM_PARSE_CONSENSUS_ENABLED=false

# 解析失败重试次数
LLM_PARSE_MAX_RETRIES=1  # 默认1次，避免无限重试

# Source Gate 策略
LLM_PARSE_SOURCE_GATE_STRATEGY=standard
```

### 4.3 灰度策略

```typescript
export const GATE_STRATEGIES = {
  // 保守策略：主要用于高精度要求场景
  conservative: {
    stabilizeMode: 'all',
    ruleGateEnabled: true,
    consensusEnabled: true,
    autoFixHighConfidence: true,
    blockOnUncertain: true,
    maxRetries: 1
  },

  // 标准策略：平衡准确率和成本
  standard: {
    stabilizeMode: 'all',
    ruleGateEnabled: true,
    consensusEnabled: false,
    autoFixHighConfidence: true,
    blockOnUncertain: false,
    maxRetries: 1
  },

  // 宽松策略：主要用于快速验证
  permissive: {
    stabilizeMode: 'none',
    ruleGateEnabled: false,
    consensusEnabled: false,
    autoFixHighConfidence: false,
    blockOnUncertain: false,
    maxRetries: 0
  }
};

export function getGateStrategy(env: string): GateStrategy {
  const envMap: Record<string, keyof typeof GATE_STRATEGIES> = {
    'production': 'standard',
    'staging': 'conservative',
    'development': 'permissive',
    'test': 'permissive'
  };
  return GATE_STRATEGIES[envMap[env] ?? 'standard'];
}
```

### 4.4 parse-level 门禁 vs materialize 后检查

| 检查类型 | 执行时机 | 是否阻塞入库 | 失败处理 |
|----------|----------|--------------|----------|
| **parse-level deterministic checks** | parse_runs 写入前 | 是（gate_failed） | 记录 issues，不自动修复 |
| **Source Gate** | parse_runs 写入前 | 可选 | 标记 uncertain fields |
| **hasSubstantiveContent** | materialize 前 | 是 | 阻止 materialize |
| **consistency checks** | materialize **后** | 是（publish 前） | 人工确认 |

**说明**：
- parse-level 检查在 parsed_json 写入之前执行，失败则 parse_run 状态为 gate_failed
- materialize 后的一致性检查是更全面的校验，不阻塞入库，但阻塞发布
- Source Gate 可以选择不阻塞入库（标记 uncertain），只作为参考

---

## 五、表三准确率专项

### 5.1 问题分析

**原方案错误**：使用 `?? 0` 会把 null、空白、`/`、`-` 当成 0

```typescript
// 原方案错误示例
const leftSide = (entity.newReceived ?? 0) + (entity.carriedOver ?? 0);
// 如果 newReceived 是 null 或 "/" 或 "-"，会变成 0
```

### 5.2 严格的数字解析（修正 NA/null 处理）

**问题修正**：
1. NA 标记（`/`、`-`、空）严格返回 null，绝不转为 0
2. `toFiniteNumber` 仅接受 NUMERIC/ZERO，其他全部返回 null
3. 公式校验时所有参与值必须都是可校验的，否则整体 `not_assessable`

```typescript
// src/utils/numeric-parser.ts

export type CellSemantic = 'ZERO' | 'EMPTY' | 'NA' | 'TEXT' | 'NUMERIC';

export interface ParsedCell {
  value: number | null;        // 数值或 null（null = 空白/NA/无法解析）
  semantic: CellSemantic;        // 语义类型
  rawText: string;              // 原始文本
  isReliable: boolean;          // 是否可靠（非猜测）
}

// NA 标记：这些都表示"无数据"，严格返回 null，绝不转为 0
const NA_MARKERS = new Set(['/', '-', '—', '空', 'N/A', 'n/a', 'na', 'NA', '']);
// 数字正则：支持负数、小数、千分位
const NUMERIC_PATTERN = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/;

export function parseTable3Cell(raw: string | null | undefined): ParsedCell {
  const rawText = String(raw ?? '').trim();

  // 空白
  if (!rawText) {
    return { value: null, semantic: 'EMPTY', rawText, isReliable: true };
  }

  // NA 标记：保留为 null，不转为 0
  if (NA_MARKERS.has(rawText)) {
    return { value: null, semantic: 'NA', rawText, isReliable: true };
  }

  // 数字（移除千分位逗号）
  if (NUMERIC_PATTERN.test(rawText)) {
    const normalized = rawText.replace(/,/g, '');
    const value = parseFloat(normalized);
    const isZero = Math.abs(value) < Number.EPSILON;

    return {
      value,
      semantic: isZero ? 'ZERO' : 'NUMERIC',
      rawText,
      isReliable: true
    };
  }

  // 无法解析：返回 null，标记为 TEXT
  return { value: null, semantic: 'TEXT', rawText, isReliable: false };
}

/**
 * 严格数字提取：用于公式校验
 * 只有 NUMERIC 和 ZERO 才返回数值，其他全部返回 null
 * 不做任何隐式转换！
 */
export function toFiniteNumber(cell: ParsedCell | null | undefined): number | null {
  if (!cell) return null;
  if (cell.semantic === 'NUMERIC' || cell.semantic === 'ZERO') {
    return cell.value;
  }
  return null;  // EMPTY, NA, TEXT 都返回 null - 不参与计算
}

/**
 * 检查一个值是否可用于公式校验
 */
export function isAssessable(cell: ParsedCell): boolean {
  return cell.semantic === 'NUMERIC' || cell.semantic === 'ZERO';
}

/**
 * 批量检查所有参与值是否都可校验
 */
export function allAssessable(cells: ParsedCell[]): boolean {
  return cells.every(cell => isAssessable(cell));
}

// 用于显示的宽松数字提取
export function toDisplayNumber(cell: ParsedCell): string {
  if (cell.value === null) {
    if (cell.semantic === 'NA') return cell.rawText || '-';
    if (cell.semantic === 'EMPTY') return '-';
    return cell.rawText;
  }
  return String(cell.value);
}
```

### 5.3 表三校验（最终修正版 - 不漏掉 NA/null）

**问题修正**：
1. 先 parse 所有参与值，检查是否全部可校验
2. **任一参与值是 EMPTY/NA/TEXT → 整体 `not_assessable`**
3. **不做任何过滤！不把 NA/null 静默排除**
4. 只有所有参与值都是 NUMERIC/ZERO 才进行计算
5. row equation / breakdown sum / column sum 统一使用严格校验

```typescript
// src/services/Table3AccuracyService.ts

interface EquationCheckResult {
  passed: boolean;
  confidence: 'high' | 'medium' | 'low' | 'not_assessable';
  leftValue: number | null;
  rightValue: number | null;
  balance: number | null;  // null = 有参与值为 null
  reason?: string;
  // 新增：详细的不可校验原因
  notAssessableDetails?: {
    field: string;
    semantic: string;
    rawText: string;
  }[];
}

class Table3AccuracyService {
  /**
   * 行等式校验
   * 本年新收 + 上年结转 = 办理结果合计 + 结转下年
   *
   * 严格规则：所有参与值必须都是可校验的（NUMERIC/ZERO）
   * 任一值是 EMPTY/NA/TEXT → 整体 not_assessable
   */
  checkRowEquation(entity: Table3Entity): EquationCheckResult {
    // 步骤1：解析所有参与字段（包括嵌套路径）
    const fields = [
      { path: 'newReceived', value: entity.newReceived },
      { path: 'carriedOver', value: entity.carriedOver },
      { path: 'results.totalProcessed', value: entity.results?.totalProcessed },
      { path: 'results.carriedForward', value: entity.results?.carriedForward }
    ];

    const parsedCells = fields.map(f => ({
      path: f.path,
      parsed: parseTable3Cell(f.value)
    }));

    // 步骤2：检查所有参与值是否都可校验
    const notAssessable = parsedCells.filter(
      cell => !isAssessable(cell.parsed)
    );

    if (notAssessable.length > 0) {
      return {
        passed: false,
        confidence: 'not_assessable',
        leftValue: null,
        rightValue: null,
        balance: null,
        reason: `${notAssessable.length} 个参与值不可校验（${notAssessable.map(n => n.path).join(', ')}）`,
        notAssessableDetails: notAssessable.map(n => ({
          field: n.path,
          semantic: n.parsed.semantic,
          rawText: n.parsed.rawText
        }))
      };
    }

    // 步骤3：提取数值（此时所有值都保证是 NUMERIC/ZERO）
    const [newReceived, carriedOver, totalProcessed, carriedForward] =
      parsedCells.map(c => toFiniteNumber(c.parsed)!);

    // 步骤4：执行等式校验（此时所有值都是有效数字）
    const leftSide = newReceived + carriedOver;
    const rightSide = totalProcessed + carriedForward;
    const balance = leftSide - rightSide;

    const absBalance = Math.abs(balance);
    let confidence: EquationCheckResult['confidence'];
    if (absBalance <= 0.5) {
      confidence = 'high';
    } else if (absBalance <= 5) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    return {
      passed: absBalance <= 0.5,
      confidence,
      leftValue: leftSide,
      rightValue: rightSide,
      balance,
      reason: confidence === 'high' ? '通过' : `差值 ${balance}`
    };
  }

  /**
   * 分项和校验
   * 办理结果合计 = 所有办理结果子项之和
   *
   * 严格规则：所有子项 + 合计值必须都可校验
   * 任一值是 EMPTY/NA/TEXT → 整体 not_assessable
   */
  checkBreakdownSum(entity: Table3Entity): EquationCheckResult {
    const breakdown = entity.results;

    // 步骤1：定义所有需要校验的分项
    const breakdownFields = [
      { path: 'results.granted', value: breakdown?.granted },
      { path: 'results.partialGrant', value: breakdown?.partialGrant },
      { path: 'results.denied', value: breakdown?.denied },
      { path: 'results.unableToProvide', value: breakdown?.unableToProvide },
      { path: 'results.notProcessed', value: breakdown?.notProcessed },
      { path: 'results.other', value: breakdown?.other },
      // 合计值也要参与完整性检查
      { path: 'results.totalProcessed', value: breakdown?.totalProcessed }
    ];

    // 步骤2：解析所有字段
    const parsedCells = breakdownFields.map(f => ({
      path: f.path,
      parsed: parseTable3Cell(f.value)
    }));

    // 步骤3：检查所有参与值是否都可校验
    const notAssessable = parsedCells.filter(
      cell => !isAssessable(cell.parsed)
    );

    if (notAssessable.length > 0) {
      return {
        passed: false,
        confidence: 'not_assessable',
        leftValue: null,
        rightValue: null,
        balance: null,
        reason: `${notAssessable.length} 个分项值不可校验（${notAssessable.map(n => n.path).join(', ')}）`,
        notAssessableDetails: notAssessable.map(n => ({
          field: n.path,
          semantic: n.parsed.semantic,
          rawText: n.parsed.rawText
        }))
      };
    }

    // 步骤4：提取子项数值并求和（排除 totalProcessed）
    const subItems = parsedCells.filter(c => c.path !== 'results.totalProcessed');
    const sumFromDetail = subItems.reduce(
      (sum, item) => sum + toFiniteNumber(item.parsed)!,
      0
    );

    // 步骤5：提取合计值
    const totalCell = parsedCells.find(c => c.path === 'results.totalProcessed')!;
    const totalProcessed = toFiniteNumber(totalCell.parsed)!;

    // 步骤6：校验
    const diff = sumFromDetail - totalProcessed;

    return {
      passed: Math.abs(diff) <= 0.5,
      confidence: Math.abs(diff) <= 0.5 ? 'high' : Math.abs(diff) <= 3 ? 'medium' : 'low',
      leftValue: sumFromDetail,
      rightValue: totalProcessed,
      balance: diff,
      reason: Math.abs(diff) <= 0.5 ? '通过' : `分项和与合计值差 ${diff}`
    };
  }

  /**
   * 总列和校验
   * 总计列 = 自然人 + 各法人/组织类别之和
   *
   * 严格规则：所有子实体 + 总计值必须都可校验
   */
  checkColumnSum(
    tableData: Table3Data,
    fieldPath: string
  ): EquationCheckResult {
    const subEntityPaths = [
      'naturalPerson',
      'legalPerson.commercial',
      'legalPerson.research',
      'legalPerson.social',
      'legalPerson.legal',
      'legalPerson.other',
      'total'  // 总计值也要参与完整性检查
    ];

    // 步骤1：解析所有字段
    const parsedCells = subEntityPaths.map(entityPath => {
      const fullPath = `${entityPath}.${fieldPath}`;
      const value = this.getNestedValue(tableData, fullPath);
      return {
        path: fullPath,
        parsed: parseTable3Cell(value)
      };
    });

    // 步骤2：检查所有参与值是否都可校验
    const notAssessable = parsedCells.filter(
      cell => !isAssessable(cell.parsed)
    );

    if (notAssessable.length > 0) {
      return {
        passed: false,
        confidence: 'not_assessable',
        leftValue: null,
        rightValue: null,
        balance: null,
        reason: `${notAssessable.length} 个实体值不可校验（${notAssessable.map(n => n.path).join(', ')}）`,
        notAssessableDetails: notAssessable.map(n => ({
          field: n.path,
          semantic: n.parsed.semantic,
          rawText: n.parsed.rawText
        }))
      };
    }

    // 步骤3：提取子实体数值并求和（排除 total）
    const subItems = parsedCells.filter(c => !c.path.startsWith('total.'));
    const sumFromSubs = subItems.reduce(
      (sum, item) => sum + toFiniteNumber(item.parsed)!,
      0
    );

    // 步骤4：提取总计值
    const totalCell = parsedCells.find(c => c.path.startsWith('total.'))!;
    const totalValue = toFiniteNumber(totalCell.parsed)!;

    // 步骤5：校验
    const diff = sumFromSubs - totalValue;

    return {
      passed: Math.abs(diff) <= 0.5,
      confidence: Math.abs(diff) <= 0.5 ? 'high' : Math.abs(diff) <= 3 ? 'medium' : 'low',
      leftValue: sumFromSubs,
      rightValue: totalValue,
      balance: diff,
      reason: Math.abs(diff) <= 0.5 ? '通过' : `各实体和与总计值差 ${diff}`
    };
  }

  /**
   * 四维校验总入口
   */
  checkAllDimensions(entity: Table3Entity): EquationCheckResult[] {
    return [
      this.checkRowEquation(entity),
      this.checkBreakdownSum(entity),
      this.checkColumnSum(entity, 'newReceived'),
      this.checkColumnSum(entity, 'carriedOver')
    ];
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((o, k) => o?.[k], obj);
  }
}
```

#### NA/null 处理校验矩阵

| 字段类型 | 示例 | semantic | toFiniteNumber | 是否参与计算 |
|---------|------|----------|----------------|-------------|
| 数字 0 | `"0"` | ZERO | `0` | ✅ 是 |
| 正数 | `"123"` | NUMERIC | `123` | ✅ 是 |
| 千分位 | `"1,234"` | NUMERIC | `1234` | ✅ 是 |
| 斜杠 NA | `"/"` | NA | `null` | ❌ 否 → not_assessable |
| 横线 NA | `"-"` | NA | `null` | ❌ 否 → not_assessable |
| 空字符串 | `""` | EMPTY | `null` | ❌ 否 → not_assessable |
| 文本 | `"不适用"` | TEXT | `null` | ❌ 否 → not_assessable |
| null | `null` | EMPTY | `null` | ❌ 否 → not_assessable |

### 5.4 置信度分级与修复策略

```typescript
export type RepairConfidence = 'high' | 'medium' | 'low' | 'not_assessable';
export type RepairAction = 'auto_fix' | 'mark_uncertain' | 'skip';

interface Table3Repair {
  type: 'row_equation' | 'breakdown_sum' | 'column_sum' | 'split_number';
  entity: string;
  field: string;
  oldValue: ParsedCell;
  newValue: ParsedCell | null;  // null = 建议标记为 uncertain，不自动修复
  confidence: RepairConfidence;
  action: RepairAction;
  reason: string;
  sourceEvidence?: {
    sourceRow: number;
    sourceCol: number;
    sourceText: string;
  };
}

// 修复决策
function determineAction(
  repair: Table3Repair,
  options: { autoFixHighConfidence: boolean; blockOnUncertain: boolean }
): RepairAction {
  // not_assessable：不自动修复，标记 uncertain
  if (repair.confidence === 'not_assessable') {
    return 'skip';  // 无法确定，不做处理
  }

  // high + autoFixHighConfidence：自动修复
  if (repair.confidence === 'high' && options.autoFixHighConfidence) {
    return 'auto_fix';
  }

  // low + blockOnUncertain：标记 uncertain，阻止入库
  if (repair.confidence === 'low' && options.blockOnUncertain) {
    return 'mark_uncertain';
  }

  // 默认：标记 uncertain，但不阻止入库
  return 'mark_uncertain';
}
```

---

## 六、多模型提示词统一（真实调用链核对）

### 6.1 问题分析

**原方案问题**：标注所有 Provider 都复用公共 prompt，但实际代码中并非如此。需要逐个核对真实调用链。

### 6.2 各 Provider 真实调用链核对（最终核实版）

逐个文件核对每个 Provider 的 `parse` 方法实际调用的 prompt 构建函数，按**整文解析/分段解析**拆开：

| Provider | 文件 | 当前真实调用链 | 已覆盖规则 | 缺失规则 | 需要改造 |
|----------|------|-------------|-----------|---------|---------|
| **OpenAILlmProvider** | `src/services/OpenAILlmProvider.ts` | **整文**路径：使用 `buildStrictParseSystemInstruction()`；<br>**分段**路径：使用 `SegmentedAnnualReportParse.buildTable2/3/4ParseSystemInstruction()` | 基础解析规则 | CELL_VALUE、NUMERIC_INTEGRITY、空值处理 | ✅ 是 |
| **GeminiLlmProvider** | `src/services/GeminiLlmProvider.ts` | **内部自有** `buildSystemInstruction()`，不是从 `LlmCommon.ts` 导入的公共函数 | 自有规则 | 公共 CELL_VALUE、NUMERIC_INTEGRITY 规则未同步 | ✅ 是（迁移到公共函数） |
| **ZhipuLlmProvider** | `src/services/ZhipuLlmProvider.ts` | 使用 `buildStrictParseSystemInstruction()` | 基础解析规则 | CELL_VALUE、NUMERIC_INTEGRITY | ✅ 是 |
| **ModelScopeLlmProvider** | `src/services/ModelScopeLlmProvider.ts` | 使用 `buildSystemInstruction()` | 基础解析规则 | CELL_VALUE、NUMERIC_INTEGRITY | ✅ 是（注入统一规则） |
| **NvidiaLlmProvider** | `src/services/NvidiaLlmProvider.ts` | 使用 `buildStrictParseSystemInstruction()` | 基础解析规则 | CELL_VALUE、NUMERIC_INTEGRITY | ✅ 是 |
| **SegmentedAnnualReportParse** | `src/services/SegmentedAnnualReportParse.ts` | 表二/表三/表四分段 prompt 单独维护 | 各表特定规则 | 统一的 CELL_VALUE、NUMERIC_INTEGRITY、空值处理规则 | ✅ 是 |

### 6.3 当前问题代码示例（以 OpenAI 为例）

```typescript
// src/services/OpenAILlmProvider.ts (当前实际代码)
export class OpenAILlmProvider {
  async parse(request: ParseRequest, signal?: AbortSignal) {
    // ❌ 问题：直接内联构建，未复用公共函数
    const systemPrompt = `
你是一个专业的年报解析助手...
（此处有 500+ 行内联 prompt，未与其他 Provider 同步）
`;

    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.sourceText }
      ],
      // ...
    });
  }
}
```

### 6.4 统一规则定义（可编译 TypeScript，含去重和表四规则）

```typescript
// src/services/PromptRules.ts

/**
 * 规则版本标记：注入后检测是否已有同版本规则，避免重复注入
 * 格式：<!-- PROMPT_RULES_VERSION:v1.0 -->
 */
export const RULES_VERSION = 'v1.0';

export interface InjectOptions {
  includeTable3Rules?: boolean;
  includeTable4Rules?: boolean;
}

/**
 * 核心规则集：所有 Provider 必须注入的规则
 * 表四规则：复议诉讼类专项规则
 */
export const PROMPT_RULES = {
  CELL_VALUE_RULES: `<!-- PROMPT_RULES_VERSION:${RULES_VERSION} -->
【单元格值处理规则】
1. 明确的数字 "0" → 输出为 0（数值类型）
2. 斜杠 "/"、横线 "-"、空单元格 → 输出为 null（不是字符串 "null"）
3. 文本内容如 "不适用"、"无" → 输出为 null，不转为 0
4. 千分位数字如 "1,234" → 解析为 1234（数值类型）
5. 永远不要把 NA/空/斜杠 隐式转为 0`,

  NUMERIC_INTEGRITY_RULES: `【数字完整性规则】
1. 完整的数字如 "1234" 不要拆分为 "1" "234" 等多个部分
2. 跨行的数字要合并为一个完整数值
3. 保持原始精度，不要四舍五入除非明确要求`,

  TABLE3_SPECIFIC_RULES: `【表三解析专用规则】
1. 行名归一化："本年新收" → newReceived，"上年结转" → carriedOver
2. 列名归一化："自然人" → naturalPerson，"法人" → legalPerson
3. 办理结果子项要完整，不要遗漏
4. 合计行必须与子项和一致`,

  TABLE4_SPECIFIC_RULES: `【表四解析专用规则】
1. 表四包含"行政复议"和"行政诉讼"两部分
2. "维持" / "驳回" / "未结" 等结果需精确映射到对应字段
3. 结果为 "0" 的字段输出 0，不输出 null
4. 合计行（total）必须等于各项之和`,

  OUTPUT_FORMAT_RULES: `【输出格式规则】
1. 严格输出 JSON 格式，不要有 Markdown 代码块标记
2. 空值使用 JSON null，不是字符串 "null"
3. 数字使用 JSON number 类型，不是字符串
4. 布尔值使用 JSON true/false`
};

/**
 * 检测 prompt 是否已包含当前版本的规则标记
 * 用于避免重复注入（幂等保证）
 */
function hasRulesVersion(prompt: string): boolean {
  return prompt.includes(`<!-- PROMPT_RULES_VERSION:${RULES_VERSION} -->`);
}

/**
 * 注入统一规则到 basePrompt
 * - 自动跳过已注入同版本规则的情况（幂等）
 * - 支持按表类型选择性注入表三/表四专项规则
 * - 返回 string（不是 void）
 */
export function injectCommonRules(
  basePrompt: string,
  options: InjectOptions = {}
): string {
  // 去重：已有同版本规则则直接返回原 prompt
  if (hasRulesVersion(basePrompt)) {
    return basePrompt;
  }

  const rules: string[] = [
    PROMPT_RULES.CELL_VALUE_RULES,
    PROMPT_RULES.NUMERIC_INTEGRITY_RULES,
    PROMPT_RULES.OUTPUT_FORMAT_RULES,
  ];

  if (options.includeTable3Rules === true) {
    rules.push(PROMPT_RULES.TABLE3_SPECIFIC_RULES);
  }

  if (options.includeTable4Rules === true) {
    rules.push(PROMPT_RULES.TABLE4_SPECIFIC_RULES);
  }

  return [basePrompt, ...rules].join('\n\n');
}
```

### 6.5 各 Provider 改造要点

**改造原则**：
- **保留现有路径**（`buildStrictParseSystemInstruction()` / `buildTable2/3/4ParseSystemInstruction()` 等）
- **在 builder 末尾注入 PromptRules**，不替换已有路径
- 各 Provider 按真实调用链改造，不统一为同一函数

#### OpenAI Provider 改造

```typescript
// src/services/OpenAILlmProvider.ts (改造后)
// ✅ 保留整文路径 buildStrictParseSystemInstruction()，在结果上注入规则
// ✅ 保留分段路径 SegmentedAnnualReportParse.buildTable2/3/4ParseSystemInstruction()，在结果上注入规则

import { injectCommonRules } from './PromptRules';
import { buildStrictParseSystemInstruction } from './LlmCommon';

export class OpenAILlmProvider {
  async parse(request: ParseRequest, signal?: AbortSignal) {
    // 整文解析路径：保留 buildStrictParseSystemInstruction，不替换
    const basePrompt = buildStrictParseSystemInstruction();
    // 在 builder 结果上注入统一规则（幂等：已有规则则跳过）
    const systemPrompt = injectCommonRules(basePrompt, {
      includeTable3Rules: request.tableType === 'table3'
    });

    const response = await this.client.chat.completions.create({
      model: request.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: request.sourceText }
      ],
      // ...
    });
  }

  async parseSegmented(request: SegmentedParseRequest, signal?: AbortSignal) {
    // 分段解析路径：保留 SegmentedAnnualReportParse 的 builder，不替换
    const basePrompt = SegmentedAnnualReportParse.buildTable3ParseSystemInstruction();
    // 在分段 builder 结果上注入规则
    const systemPrompt = injectCommonRules(basePrompt, {
      includeTable3Rules: true
    });

    // ... 分段调用
  }
}
```

#### Zhipu / Nvidia Provider 改造

```typescript
// src/services/ZhipuLlmProvider.ts (改造后)
// ✅ 保留 buildStrictParseSystemInstruction() 路径，在结果上注入规则
// src/services/NvidiaLlmProvider.ts 同理

import { injectCommonRules } from './PromptRules';
import { buildStrictParseSystemInstruction } from './LlmCommon';

export class ZhipuLlmProvider {
  async parse(request: ParseRequest, signal?: AbortSignal) {
    // 保留 buildStrictParseSystemInstruction() 路径
    const basePrompt = buildStrictParseSystemInstruction();
    const systemPrompt = injectCommonRules(basePrompt);
    // Zhipu 特定的 API 调用
  }
}
```

#### ModelScope Provider 改造

```typescript
// src/services/ModelScopeLlmProvider.ts (改造后)
// ✅ 保留 buildSystemInstruction() 路径，在结果上注入规则

import { injectCommonRules } from './PromptRules';
import { buildSystemInstruction } from './LlmCommon';

export class ModelScopeLlmProvider {
  async parse(request: ParseRequest, signal?: AbortSignal) {
    // 保留 buildSystemInstruction() 路径
    const basePrompt = buildSystemInstruction();
    const systemPrompt = injectCommonRules(basePrompt);
    // ModelScope 特定的 API 调用
  }
}
```

#### Gemini Provider 改造（特殊说明）

```typescript
// src/services/GeminiLlmProvider.ts (改造后)
// ⚠️ Gemini 有内部自有 buildSystemInstruction()，不是从 LlmCommon.ts 导入的公共函数
// 方案：直接在其 builder 末尾注入规则，不迁移到公共函数（避免破坏性变更）

import { injectCommonRules } from './PromptRules';

export class GeminiLlmProvider {
  // Gemini 内部自有的 builder（不是 LlmCommon.buildSystemInstruction）
  private buildGeminiSystemInstruction(): string {
    // ... Gemini 特有的 prompt 构建逻辑（保留）
    const baseInstruction = '...Gemini 特有的系统指令...';
    // 在自有 builder 末尾注入统一规则
    return injectCommonRules(baseInstruction);
  }

  async parse(request: ParseRequest, signal?: AbortSignal) {
    // 使用 Gemini 自有 builder（含规则注入）
    const systemPrompt = this.buildGeminiSystemInstruction();
    // ... Gemini 特定的 API 调用
  }
}
```

#### SegmentedAnnualReportParse 改造

```typescript
// src/services/SegmentedAnnualReportParse.ts (改造后)
// ✅ 保留各表分段 builder，在结果上注入规则

import { injectCommonRules } from './PromptRules';

export function buildTable3ParseSystemInstruction(): string {
  const baseInstruction = `
【表三分段解析】
请解析以下政府信息公开年度报告中的表三（办理情况）...
`;

  // ✅ 注入统一规则（含表三专项规则）
  return injectCommonRules(baseInstruction, {
    includeTable3Rules: true
  });
}

export function buildTable4ParseSystemInstruction(): string {
  const baseInstruction = `
【表四分段解析】
请解析以下政府信息公开年度报告中的表四（复议诉讼）...
`;

  // ✅ 注入统一规则（含表四专项规则）
  return injectCommonRules(baseInstruction, {
    includeTable4Rules: true
  });
}

export function buildTable2ParseSystemInstruction(): string {
  const baseInstruction = `
【表二分段解析】
请解析以下政府信息公开年度报告中的表二（收到情况）...
`;

  // ✅ 注入统一规则（不需要表三/表四专项规则）
  return injectCommonRules(baseInstruction);
}
```

### 6.6 改造验收清单

- [ ] OpenAILlmProvider：保留 `buildStrictParseSystemInstruction()` + 注入 `injectCommonRules()`
- [ ] OpenAI 分段路径：保留 `SegmentedAnnualReportParse.buildTable*ParseSystemInstruction()` + 注入规则
- [ ] ZhipuLlmProvider：保留 `buildStrictParseSystemInstruction()` + 注入规则
- [ ] NvidiaLlmProvider：保留 `buildStrictParseSystemInstruction()` + 注入规则
- [ ] ModelScopeLlmProvider：保留 `buildSystemInstruction()` + 注入规则
- [ ] GeminiLlmProvider：保留自有 `buildSystemInstruction()`（不迁移）+ 在末尾注入规则
- [ ] SegmentedAnnualReportParse：所有 `build*SystemInstruction` 都注入规则（含 `includeTable4Rules: true`）
- [ ] `injectCommonRules()` 幂等：检测到同版本规则后不重复注入
- [ ] 回归测试：各 Provider 输出的 JSON 结构一致
- [ ] 回归测试：NA/null/0 处理在所有 Provider 中行为一致

### 6.7 修改文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/PromptRules.ts` | 新建 | 统一规则定义 |
| `src/services/LlmCommon.ts` | 修改 | 使用统一规则 |
| `src/services/SegmentedAnnualReportParse.ts` | 修改 | 使用统一规则 |
| `src/services/OpenAILlmProvider.ts` | 修改 | 使用统一规则 |
| `src/services/GeminiLlmProvider.ts` | 修改 | 使用统一规则 |
| `src/services/ZhipuLlmProvider.ts` | 修改 | 使用统一规则 |
| `src/services/ModelScopeLlmProvider.ts` | 修改 | 使用统一规则 |
| `src/services/NvidiaLlmProvider.ts` | 修改 | 使用统一规则 |

---

## 七、入库与发布安全

### 7.1 统一 hasParsedContent

```typescript
// src/utils/content-utils.ts

const KNOWN_METADATA_KEYS = new Set([
  'meta', 'source', 'version', 'timestamp', 'generated_at',
  'provider', 'model', 'prompt_version', 'schema_version',
  'extracted_at', 'fingerprint', 'parse_run_id'
]);

export function hasParsedContent(parsed: unknown): boolean {
  if (parsed === null || parsed === undefined) return false;

  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    if (!trimmed || trimmed === '{}' || trimmed === 'null' || trimmed === '""') {
      return false;
    }
    try {
      return hasParsedContent(JSON.parse(trimmed));
    } catch {
      return true;
    }
  }

  if (Array.isArray(parsed)) return parsed.length > 0;
  if (typeof parsed !== 'object') return false;

  const obj = parsed as Record<string, unknown>;

  // 核心数据检查
  if (Array.isArray(obj.sections) && obj.sections.length > 0) return true;
  if (obj.tables && typeof obj.tables === 'object' && Object.keys(obj.tables as object).length > 0) return true;

  // 已知元数据字段 - 应该排除这些被误判
  const hasDataKeys = Object.keys(obj).some(key => !KNOWN_METADATA_KEYS.has(key));
  if (!hasDataKeys) return false;

  // 兼容原有逻辑
  if (obj.report_type || obj.basic_info || obj.year) return true;

  return false;  // 改为 false，防止 metadata-only JSON 被误判
}

export function hasSubstantiveContent(parsed: unknown): boolean {
  // 比 hasParsedContent 更严格：必须有实质性表格数据
  if (!hasParsedContent(parsed)) return false;

  if (typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;

    // 必须有 sections 且包含表格类型的 section
    if (Array.isArray(obj.sections)) {
      const hasTableSection = obj.sections.some((s: any) =>
        s.type === 'table_2' || s.type === 'table_3' || s.type === 'table_4'
      );
      if (hasTableSection) return true;
    }

    // 或者有 tables 对象且非空
    if (obj.tables && typeof obj.tables === 'object') {
      const tableKeys = Object.keys(obj.tables as object);
      if (tableKeys.length > 0) return true;
    }
  }

  return false;
}
```

### 7.2 入库前 Gate（修正版）

```typescript
// src/services/MaterializeGateService.ts
import { GateConfig, DEFAULT_GATE_CONFIGS } from './ParseGateService';

export interface MaterializeGateResult {
  passed: boolean;
  blockers: GateBlocker[];
  warnings: GateWarning[];
}

export class MaterializeGateService {
  /**
   * 注意：必须使用 getCurrentParseRun，而不是 getLatestAcceptedParseRun
   * 原因：用户可能切换到旧版本的解析结果，必须以用户当前选择的为准
   *
   * GateConfig 必须从 current parse_run 的 source_gate_strategy 等字段构造
   * 与 parse 阶段使用同一份配置（source_gate_strategy / uncertain_threshold / high_confidence_blocking / warning_threshold）
   * 不依赖外部传入的 gateConfig（gateConfig 参数仅用于测试覆盖）
   */
  async gate(versionId: number, parsedJson: any, overrideGateConfig?: GateConfig): Promise<MaterializeGateResult> {
    const currentParseRun = await this.getCurrentParseRun(versionId);

    // 从 current parse_run 构造 GateConfig（与 parse 阶段一致）
    // 如果有 overrideGateConfig（测试覆盖场景），优先使用；否则从 parse_run 读取
    const cfg = overrideGateConfig ?? this.buildGateConfigFromParseRun(currentParseRun);

    const blockers: GateBlocker[] = [];
    const warnings: GateWarning[] = [];

    // 1. hasSubstantiveContent 检查（必须在前面）
    if (!hasSubstantiveContent(parsedJson)) {
      blockers.push({
        code: 'NO_SUBSTANTIVE_CONTENT',
        message: 'parsed_json 不包含实质性表格数据，无法物化',
        severity: 'error'
      });
      return { passed: false, blockers, warnings };
    }

    // 2. parse-level gate 结果检查（使用当前解析，不是 latest accepted）
    if (currentParseRun) {
      const gateResult = currentParseRun.gate_result_json;
      if (gateResult?.type === 'gate_failed') {
        blockers.push({
          code: 'PARSE_GATE_FAILED',
          message: `解析门禁失败: ${gateResult.issues?.slice(0, 3).join(', ')}`,
          severity: 'error'
        });
      }

      if (gateResult?.ruleGate?.issues?.length > 0) {
        warnings.push({
          code: 'RULE_GATE_ISSUES',
          message: `${gateResult.ruleGate.issues.length} 个规则门禁问题`,
          severity: 'warning'
        });
      }

      // Source Gate blocker/warning 阈值从 gateConfig 读取（与 parse 阶段一致）
      // 复用 parse 阶段的 Source Gate 阻断逻辑（含 highConfidenceBlocking）
      if (gateResult?.sourceGate) {
        const sg = gateResult.sourceGate;
        const highConfidenceMismatches = sg.comparisons?.filter(
          (c: any) => !c.isMatch && c.confidence === 'high'
        ).length || 0;

        // 1. 高置信度不匹配阻断（由 cfg.highConfidenceBlocking 控制）
        if (cfg.highConfidenceBlocking && highConfidenceMismatches > 0) {
          blockers.push({
            code: 'SOURCE_GATE_HIGH_CONF_BLOCKED',
            message: `源表高置信度不匹配: ${highConfidenceMismatches} 个字段（阻断开关: ${cfg.highConfidenceBlocking}）`,
            severity: 'error'
          });
        }

        // 2. 不确定字段阈值阻断
        if (!sg.passed && sg.uncertain_fields?.length > cfg.uncertainThreshold) {
          blockers.push({
            code: 'SOURCE_GATE_BLOCKED',
            message: `源表门禁失败: ${sg.uncertain_fields.length} 个不确定字段（阈值: ${cfg.uncertainThreshold}）`,
            severity: 'error'
          });
        } else if (sg.uncertain_fields?.length > cfg.warningThreshold) {
          warnings.push({
            code: 'SOURCE_GATE_UNCERTAIN',
            message: `${sg.uncertain_fields.length} 个源表不确定字段（警告阈值: ${cfg.warningThreshold}）`,
            severity: 'warning'
          });
        }
      }
    }

    // 3. 稳定化修复记录检查
    if (currentParseRun?.repairs_json) {
      const repairs = JSON.parse(currentParseRun.repairs_json);
      const lowConfidenceRepairs = repairs.filter((r: any) => r.confidence === 'low');

      if (lowConfidenceRepairs.length > 3) {
        blockers.push({
          code: 'TOO_MANY_LOW_CONFIDENCE_REPAIRS',
          message: `${lowConfidenceRepairs.length} 个低置信度修复，建议人工确认`,
          severity: 'error'
        });
      }
    }

    return {
      passed: blockers.length === 0,
      blockers,
      warnings
    };
  }

  /**
   * 从 current parse_run 构造 GateConfig
   * 与 parse 阶段使用同一份配置（source_gate_strategy / uncertain_threshold / high_confidence_blocking / warning_threshold）
   * fallback 到 DEFAULT_GATE_CONFIGS['standard']
   */
  private buildGateConfigFromParseRun(parseRun: any): GateConfig {
    if (!parseRun) {
      return DEFAULT_GATE_CONFIGS['standard'];
    }

    const strategy = parseRun.source_gate_strategy ?? 'standard';
    const base = DEFAULT_GATE_CONFIGS[strategy] ?? DEFAULT_GATE_CONFIGS['standard'];

    return {
      strategy,
      uncertainThreshold: parseRun.source_gate_uncertain_threshold ?? base.uncertainThreshold,
      highConfidenceBlocking: parseRun.source_gate_high_confidence_blocking ?? base.highConfidenceBlocking,
      warningThreshold: parseRun.source_gate_warning_threshold ?? base.warningThreshold
    };
  }
}
```

### 7.3 一致性检查顺序（修正版）

```
解析任务 → parse_runs(status: accepted) → report_versions.parsed_json 更新
    ↓
materialize 任务 → materialize → fact_* 表入库
    ↓
consistency check 任务 → consistency checks → report_consistency_items 表
    ↓
publish → 检查 open_review_issues → 发布或拒绝
```

**前移的检查**：
- parse-level deterministic checks（在 parse_runs 写入时）
- Source Gate（在 parse_runs 写入时）
- hasSubstantiveContent（在 materialize 前）

**后置的检查**：
- consistency checks（在 materialize 后）
- 用于发布前的最终拦截

---

## 八、队列和批次状态

### 8.1 max_retries 问题

**当前问题**：`max_retries` 被强制固定为 1，无法配置

**修正方案**：

```typescript
// src/services/LlmJobRunner.ts

const DEFAULT_MAX_RETRIES = parseInt(process.env.LLM_PARSE_MAX_RETRIES || '1', 10);
const MAX_ALLOWED_RETRIES = 3;  // 安全上限

async processParseJob(job: QueuedJob): Promise<void> {
  const maxRetries = Math.min(
    job.max_retries ?? DEFAULT_MAX_RETRIES,
    MAX_ALLOWED_RETRIES
  );

  if (job.retry_count >= maxRetries) {
    // 不再重试，直接失败
    await this.markJobFailed(job.id, 'MAX_RETRIES_EXCEEDED');
    return;
  }

  // ... 执行解析逻辑
}
```

### 8.2 失败重试保留 parse_run 策略

```typescript
// 失败重试策略：
// - 保留失败的 parse_run（status: failed/gate_failed）
// - 创建新的 retry parse_run（increment attempt）
// - 使用相同的 fingerprint（除非配置变化）

async retryParse(job: QueuedJob): Promise<void> {
  const lastParseRun = await this.getLatestParseRun(job.id);

  if (lastParseRun) {
    // 创建 retry parse_run
    await this.pool.query(`
      INSERT INTO parse_runs (
        report_version_id, job_id, fingerprint, provider, model,
        prompt_version, parser_version, source_extractor_version,
        schema_version, stabilize_mode, rule_gate_enabled,
        config_json, status, attempt,
        retry_of
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
    `, [
      job.version_id, job.id,
      lastParseRun.fingerprint,
      lastParseRun.provider, lastParseRun.model,
      lastParseRun.prompt_version, lastParseRun.parser_version, lastParseRun.source_extractor_version,
      lastParseRun.schema_version, lastParseRun.stabilize_mode, lastParseRun.rule_gate_enabled,
      lastParseRun.config_json,
      'created',
      lastParseRun.attempt + 1,
      lastParseRun.id
    ]);
  }

  // 重置 job 状态
  await this.pool.query(`
    UPDATE jobs SET status = 'queued', retry_count = retry_count + 1
    WHERE id = $1
  `, [job.id]);
}
```

### 8.3 队列优先级与批量吞吐

```typescript
// 队列优先级配置
const JOB_KIND_PRIORITY = {
  'materialize': 0,   // 最高：物化必须在解析后立即执行
  'checks': 1,         // 其次：一致性检查
  'parse': 2,         // 解析任务
  'compare': 3        // 比较任务：最低
};

// 批量解析吞吐量控制
const BATCH_THROUGHPUT_CONFIG = {
  maxConcurrentParses: parseInt(process.env.MAX_CONCURRENT_PARSES || '5', 10),
  maxConcurrentMaterializes: parseInt(process.env.MAX_CONCURRENT_MATERIALIZES || '3', 10),
  batchSize: parseInt(process.env.PARSE_BATCH_SIZE || '10', 10),
};
```

---

## 九、验收指标和基线

### 9.1 改造前基线统计

```sql
-- 1. 数字拆分问题统计（从现有数据）
SELECT
  rv.report_id,
  rv.file_name,
  pr.prompt_version,
  -- 表三勾稽关系不平的数量
  COUNT(*) FILTER (WHERE abs(a.new_received + a.carried_over - a.total_processed - a.carried_forward) > 1) as balance_failed,
  -- totalProcessed 与分项和不一致的数量
  COUNT(*) FILTER (WHERE abs(a.total_processed - breakdown_sum) > 1) as breakdown_failed
FROM report_versions rv
JOIN parse_runs pr ON pr.report_version_id = rv.id
JOIN fact_application fa ON fa.version_id = rv.id
GROUP BY rv.report_id, rv.file_name, pr.prompt_version;

-- 2. 解析准确率基线
SELECT
  COUNT(DISTINCT rv.id) as total_versions,
  COUNT(*) FILTER (WHERE pr.status = 'accepted') as accepted,
  COUNT(*) FILTER (WHERE pr.status = 'failed') as failed,
  COUNT(*) FILTER (WHERE pr.status = 'gate_failed') as gate_failed,
  ROUND(COUNT(*) FILTER (WHERE pr.status = 'accepted')::numeric /
        NULLIF(COUNT(*), 0) * 100, 2) as acceptance_rate
FROM report_versions rv
JOIN parse_runs pr ON pr.report_version_id = rv.id;
```

### 9.2 预期指标定义

| 指标 | 定义 | 改造前基线 | 改造后目标 |
|------|------|-----------|------------|
| **数字拆分发生率** | 数字被错误拆分到两个单元格的报告占比 | ~20% | < 5% |
| **表三勾稽关系通过率** | `abs(newReceived + carriedOver - totalProcessed - carriedForward) <= 1` 的报告占比 | ~80% | > 95% |
| **发布前无需人工修正率** | 无需打开审核页面手动修正的报告占比 | ~70% | > 90% |
| **parse_runs acceptance rate** | status='accepted' 的 parse_runs 占比 | - | > 85% |

### 9.3 Golden Fixture 测试用例（详细版）

```typescript
// tests/fixtures/golden-parsing-cases.ts

export interface GoldenTestCase {
  id: string;
  description: string;
  sourceType: 'pdf' | 'html' | 'txt';
  fileName: string;
  fileHash?: string;  // 可选，用于自动定位文件

  // 预期结果
  expected: {
    // 表三关键字段
    table3?: {
      naturalPerson?: {
        newReceived?: number | null;
        carriedOver?: number | null;
        granted?: number | null;
        totalProcessed?: number | null;
        carriedForward?: number | null;
      };
      total?: {
        newReceived?: number | null;
        carriedOver?: number | null;
        granted?: number | null;
        totalProcessed?: number | null;
        carriedForward?: number | null;
      };
    };
    // 表四关键字段
    table4?: {
      review?: { total?: number | null };
      litigationDirect?: { total?: number | null };
    };
    // 空值/斜杠/零区分
    nullHandling?: {
      [fieldPath: string]: {
        expectedSemantic: 'ZERO' | 'EMPTY' | 'NA' | 'NUMERIC';
        expectedRawText: string;
      };
    };
  };

  // 预期 gate 结果
  expectedGate?: {
    passed: boolean;
    uncertainFieldsCount?: number;
    confidence: 'high' | 'medium' | 'low';
  };

  // 已知问题
  knownIssues?: string[];
  skipIf?: string[];  // 某些条件下跳过
}

export const GOLDEN_TEST_CASES: GoldenTestCase[] = [
  // 1. PDF 基本解析
  {
    id: 'pdf-basic-001',
    description: 'PDF文件 - 数字完整性',
    sourceType: 'pdf',
    fileName: '3356_2023.pdf',
    expected: {
      table3: {
        naturalPerson: { newReceived: 3402, carriedOver: 91 },
        total: { newReceived: 3511, carriedOver: 96 }
      }
    },
    expectedGate: { passed: true, confidence: 'high' }
  },

  // 2. HTML rowspan/colspan
  {
    id: 'html-rowspan-001',
    description: 'HTML文件 - 合并单元格展开',
    sourceType: 'html',
    fileName: '3356_2023.html',
    expected: {
      table3: {
        'legalPerson.commercial': { newReceived: 99 },
        'legalPerson.research': { newReceived: 0 }
      },
      nullHandling: {
        'legalPerson.research.newReceived': {
          expectedSemantic: 'ZERO',  // 明确为0，不是NA
          expectedRawText: '0'
        }
      }
    },
    expectedGate: { passed: true, confidence: 'high' }
  },

  // 3. TXT/OCR 数字拆分
  {
    id: 'txt-ocr-001',
    description: 'TXT文件（OCR转换）- 数字拆分检测与自动修复',
    sourceType: 'txt',
    fileName: 'siyang_2024.txt',
    expected: {
      table3: {
        naturalPerson: { newReceived: 5, carriedOver: 0 }
      }
    },
    expectedGate: {
      passed: true,
      uncertainFieldsCount: 0,
      confidence: 'medium'  // TXT 置信度略低
    }
  },

  // 4. 空值/斜杠/零区分
  {
    id: 'null-handling-001',
    description: '空值、斜杠、零值语义区分',
    sourceType: 'html',
    fileName: 'null_test.html',
    expected: {
      table3: {
        'legalPerson.research': {
          newReceived: 0,  // 明确为0
          carriedOver: null  // 斜杠或空白
        }
      }
    },
    nullHandling: {
      'legalPerson.research.newReceived': {
        expectedSemantic: 'ZERO',
        expectedRawText: '0'
      },
      'legalPerson.research.carriedOver': {
        expectedSemantic: 'NA',  // 斜杠或空白
        expectedRawText: '/'
      }
    },
    expectedGate: { passed: true, confidence: 'high' }
  },

  // 5. 表四复杂表头
  {
    id: 'table4-complex-001',
    description: '表四复杂表头 - 多级标题解析',
    sourceType: 'pdf',
    fileName: 'table4_complex.pdf',
    expected: {
      table4: {
        review: { total: 0 },
        litigationDirect: { total: 1 }
      }
    },
    expectedGate: { passed: true, confidence: 'medium' }
  }
];
```

### 9.4 回归测试命令

```bash
# 1. 运行 Golden Fixture 测试
npm test -- --grep "golden"

# 2. 运行端到端测试
npm test -- --grep "parsing-pipeline-e2e"

# 3. 检查覆盖率
npm test -- --coverage -- --grep "golden"

# 4. 通过标准
# - 所有 golden fixture 测试通过
# - acceptance rate 测试 > 85%
# - 表三勾稽关系通过率 > 95%
```

---

## 十、修改文件总清单（v3.0 更新版）

### 10.1 新建文件（新增 2 个关键接口）

| 文件路径 | 说明 | 本次修订新增 |
|----------|------|-------------|
| `src/services/ParseFingerprintService.ts` | 指纹计算服务 | - |
| `src/services/PromptVersionService.ts` | 版本管理服务 | - |
| `src/services/ParseRunService.ts` | parse_runs 管理服务 | ✅ 新增 `switchCurrentParseRun()` 方法 |
| `src/services/TableSourceGateService.ts` | SourceGate 服务（含映射算法） | ✅ 新增阻断阈值配置 |
| `src/services/TableRowMapper.ts` | 表三行名归一化映射 | - |
| `src/services/TableColMapper.ts` | 表三列名归一化映射 | - |
| `src/services/Table3AccuracyService.ts` | 表三准确率专项服务 | ✅ 修正不遗漏 NA/null |
| `src/services/ParseGateService.ts` | 门禁策略管理服务 | ✅ 新增 `determineParseStatus()` 方法 |
| `src/services/MaterializeGateService.ts` | 入库前 Gate 服务 | ✅ Source Gate blocker 与 parse 阶段一致 |
| `src/utils/content-utils.ts` | 内容检查工具 | - |
| `src/utils/numeric-parser.ts` | 严格的数字解析工具 | ✅ 新增 `isAssessable()` / `allAssessable()` |
| `src/types/table-snapshot.ts` | 源表快照类型定义 | - |
| `src/services/PromptRules.ts` | 统一提示词规则 | ✅ 完整定义注入规则 |
| `tests/fixtures/golden-parsing-cases.ts` | Golden 测试用例 | ✅ 新增 NA/null 专项测试 |
| `tests/e2e/parsing-pipeline.test.ts` | 端到端测试 | ✅ 新增 finalize_failed 恢复测试 |
| `scripts/migrate-parsing-pipeline.ts` | 迁移脚本 | ✅ 新增 draft 字段迁移 |

### 10.2 修改文件（6 个关键问题对应修改）

| 文件路径 | 修改内容 | 对应问题编号 |
|----------|----------|-------------|
| `src/db/migrations-llm.ts` | parse_runs 表：新增 is_current、draft_* 字段，修正建表顺序，移除循环外键，新增 partial unique index | 问题1、问题3 |
| `src/services/LlmJobRunner.ts` | 草稿持久化、finalize_failed 状态、recoverStuckJobs 恢复、finalizeParseRun 可独立调用 | 问题2 |
| `src/services/Table3AccuracyService.ts` | 先检查所有参与值完整性，任一 NA/null → 整体 not_assessable，不做过滤 | 问题5 |
| `src/utils/numeric-parser.ts` | 严格区分 ZERO/NA/EMPTY/TEXT，不做隐式转换，新增 isAssessable 函数 | 问题5 |
| `src/services/ParseGateService.ts` | Source Gate 按策略阻断，高置信度不匹配 gate_failed，TXT/OCR 降级不阻断 | 问题4 |
| `src/services/OpenAILlmProvider.ts` | 保留 buildStrictParseSystemInstruction() 路径，末尾注入 injectCommonRules()；分段路径保留 SegmentedAnnualReportParse builder | 问题6 |
| `src/services/ZhipuLlmProvider.ts` | 保留 buildStrictParseSystemInstruction() 路径，末尾注入 injectCommonRules() | 问题6 |
| `src/services/NvidiaLlmProvider.ts` | 保留 buildStrictParseSystemInstruction() 路径，末尾注入 injectCommonRules() | 问题6 |
| `src/services/ModelScopeLlmProvider.ts` | 保留 buildSystemInstruction() 路径，末尾注入 injectCommonRules() | 问题6 |
| `src/services/GeminiLlmProvider.ts` | 保留自有 buildSystemInstruction()（不迁移），末尾注入 injectCommonRules() | 问题6 |
| `src/services/SegmentedAnnualReportParse.ts` | 所有 buildTable2/3/4ParseSystemInstruction 都注入规则（buildTable4 用 includeTable4Rules: true） | 问题6 |
| `src/services/LlmCommon.ts` | 导出 buildStrictParseSystemInstruction/buildSystemInstruction；PromptRules 注入在各 Provider 调用处 | 问题6 |
| `src/services/PdfParseService.ts` | 保留表格位置信息、页码 | - |
| `src/services/HtmlParseService.ts` | 保留展开后的单元格矩阵 | - |
| `src/services/ParsedOutputStabilityService.ts` | 增强 repairs 结构、使用严格数字解析 | - |
| `src/services/ReportUploadService.ts` | 指纹检查逻辑、创建 parse_run | - |
| `src/services/MaterializeService.ts` | 使用 getCurrentParsedResult() 获取当前解析 | 问题3 |
| `src/services/ConsistencyCheckService.ts` | 使用 getCurrentParsedResult() 获取当前解析 | 问题3 |
| `src/routes/reports.ts` | 解析历史展示、切换当前解析/恢复 superseded API | 问题3 |
| `.env.example` | 新增 SOURCE_GATE_STRATEGY、MAX_CONCURRENT_PARSES 等配置 | 问题4 |

### 10.3 数据库字段变更详情（可执行迁移方案）

**关键设计**：
- parse_runs.status 是 VARCHAR(30) CHECK (...)，不是 enum 类型，不能用 ALTER TYPE
- 通过 ALTER TABLE DROP CONSTRAINT / ADD CONSTRAINT 方式更新
- 所有 ADD CONSTRAINT 使用 `IF NOT EXISTS` 或 fallback 处理确保可重复执行
- 新增字段：intended_final_status / superseded_by / superseded_at / restored_from / restored_at

#### parse_runs 表新增字段和约束
```sql
-- ========== 1. 新增字段 ==========
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS source_gate_strategy VARCHAR(20) NOT NULL DEFAULT 'standard';
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS draft_output_json JSONB;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS draft_repairs_json JSONB;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS draft_gate_result_json JSONB;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS draft_consensus_result_json JSONB;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS draft_source_snapshots_json JSONB;

-- ========== 2. 新增 source_gate 配置字段（用于 fingerprint 和门禁逻辑） ==========
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS source_gate_uncertain_threshold INTEGER NOT NULL DEFAULT 10;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS source_gate_high_confidence_blocking BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS source_gate_warning_threshold INTEGER NOT NULL DEFAULT 5;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS prompt_rules_version VARCHAR(20) NOT NULL DEFAULT 'v1.0';
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS parse_gate_version VARCHAR(20) NOT NULL DEFAULT 'v1.0';
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS consensus_provider VARCHAR(50);
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS consensus_model VARCHAR(100);

-- ========== 3. 新增 superseded 历史链字段 ==========
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS superseded_by BIGINT;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS restored_from BIGINT;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ;
ALTER TABLE parse_runs ADD COLUMN IF NOT EXISTS intended_final_status VARCHAR(30);

-- 添加外键约束（可重复执行）
DO $$
BEGIN
  ALTER TABLE parse_runs ADD CONSTRAINT fk_parse_runs_superseded_by
    FOREIGN KEY (superseded_by) REFERENCES parse_runs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE parse_runs ADD CONSTRAINT fk_parse_runs_restored_from
    FOREIGN KEY (restored_from) REFERENCES parse_runs(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ========== 4. 更新 status CHECK 约束（添加 superseded） ==========
-- 4.1 删除旧约束（可重复执行）
ALTER TABLE parse_runs DROP CONSTRAINT IF EXISTS parse_runs_status_check;

-- 4.2 添加新约束（包含 superseded，用于强制覆盖时标记旧 accepted）
ALTER TABLE parse_runs ADD CONSTRAINT parse_runs_status_check
  CHECK (status IN (
    'created', 'running', 'accepted', 'superseded', 'failed', 'gate_failed', 'finalize_failed'
  ));

-- ========== 5. 添加 is_current CHECK 约束（current 必须是 accepted 且有 output） ==========
DO $$
BEGIN
  ALTER TABLE parse_runs ADD CONSTRAINT chk_current_must_be_accepted
    CHECK (is_current = FALSE OR (status = 'accepted' AND output_json IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ========== 6. 新增索引 ==========
-- 唯一索引：同一 version 只能有一个 current（is_current = TRUE）
CREATE UNIQUE INDEX IF NOT EXISTS idx_parse_runs_version_current
  ON parse_runs(report_version_id) WHERE is_current = TRUE;

-- 辅助索引：按 version + fingerprint 查询所有历史（允许多条 superseded）
CREATE INDEX IF NOT EXISTS idx_parse_runs_version_fingerprint
  ON parse_runs(report_version_id, fingerprint);

-- 辅助索引：查询 superseded 链
CREATE INDEX IF NOT EXISTS idx_parse_runs_superseded_by
  ON parse_runs(superseded_by) WHERE superseded_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_parse_runs_restored_from
  ON parse_runs(restored_from) WHERE restored_from IS NOT NULL;

-- 辅助索引：按 version 查询
CREATE INDEX IF NOT EXISTS idx_parse_runs_version ON parse_runs(report_version_id);
CREATE INDEX IF NOT EXISTS idx_parse_runs_is_current ON parse_runs(is_current) WHERE is_current = TRUE;
CREATE INDEX IF NOT EXISTS idx_parse_runs_status ON parse_runs(status);
CREATE INDEX IF NOT EXISTS idx_parse_runs_created ON parse_runs(created_at DESC);

-- ========== 7. 迁移旧数据（设置 intended_final_status） ==========
-- 只回填明确的最终态：accepted / failed / gate_failed
-- finalize_failed 与 superseded 保留为空，避免把恢复上下文误写成最终意图
UPDATE parse_runs SET intended_final_status = status
WHERE intended_final_status IS NULL
  AND status IN ('accepted', 'failed', 'gate_failed');

-- ========== 8. 删除旧 fingerprint 唯一索引（如存在） ==========
-- 旧版本可能有一个 (version_id, fingerprint) 的唯一索引，迁移后不再需要
DO $$
BEGIN
  DROP INDEX IF EXISTS uq_parse_runs_version_fingerprint_accepted;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  DROP INDEX IF EXISTS uq_parse_runs_version_fingerprint_history;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;
```

### 10.4 API 变更详情

| API | 变更内容 | 说明 |
|-----|----------|------|
| `GET /api/reports/:id/parse-history` | 新增 | 展示所有 parse_run，标记 current |
| `POST /api/reports/:id/switch-current-parse` | 新增 | 切换当前使用的 parse_run |
| `POST /api/reports/:id/restore-superseded-parse` | 新增 | 将 superseded 记录恢复为 current，并重新入队 materialize/checks |
| `POST /api/reports/:id/retry-finalize` | 新增 | 重试 finalize_failed 的 parse_run |

---

## 十一、实施计划

### 11.1 正式开发准入结论

**结论：可以进入正式开发。**

本方案已经完成从“解析提示词优化”到“解析运行、门禁、入库、恢复、追溯”的全链路设计闭环，具备作为开发基线的条件：

- `parse_runs` 已成为解析历史和 current 结果的主来源，能承载 accepted / superseded / failed / gate_failed / finalize_failed 全状态审计。
- 三段式事务边界已经明确：短事务创建 parse_run → 事务外执行 LLM/源表抽取/门禁 → 短事务 finalize。
- `draft_*` + `intended_final_status` 已覆盖 finalize_failed 恢复，不重复消耗 LLM token。
- `is_current` + `getCurrentParsedResult()` 已定义 materialize / checks / publish 的唯一解析结果入口。
- Source Gate / rule gate / MaterializeGate 的阻断阈值和配置快照已补齐，避免 parse 阶段与 materialize 阶段判定不一致。
- Provider PromptRules 改造已按真实调用链拆分，避免破坏 strict / segmented / Gemini 自有 builder。

### 11.2 开发原则

- **地基优先**：先落数据库迁移、`ParseRunService` 和 current 结果读取，再改解析和物化流程。
- **每阶段可回滚**：每一阶段必须能单独验证、失败可回退，不依赖一次性大爆改。
- **先闭环后优化**：先保证 parse → finalize → current → materialize → checks 链路正确，再扩大 Source Gate 映射覆盖率。
- **旧链路兼容**：过渡期保留 `report_version_parses` / `report_versions.parsed_json` 兼容读取，直到 current parse_run 链路稳定。
- **真实样本驱动**：Source Gate 阈值、表三行列映射、PDF 跨页识别必须用真实年报样本回归，而不是只靠伪数据。

### 11.3 推荐开发顺序

| 阶段 | 工作内容 | 关键产出 | 最小验收 |
|------|---------|----------|----------|
| **第0阶段：开工准备** | 切开发分支、确认迁移环境、准备 5-10 个真实年报样本和 Golden Fixture 骨架 | 开发基线、样本清单、回滚预案 | 文档 v5.2 确认，迁移脚本可 dry-run |
| **第一阶段：数据库与 ParseRunService** | 新增 parse_runs/source_snapshots/source_gate_results，补齐索引、约束、迁移回填、ParseRunService | `parse_runs` 可创建/查询/current 切换/恢复 superseded | 迁移可重复执行；同一 version 只有一个 `is_current=TRUE` |
| **第二阶段：LlmJobRunner 三段式改造** | 实现 create → execute → finalize，写入 draft_*、intended_final_status、error_code/error_message，恢复 finalize_failed | parse job 全状态可追溯 | accepted/gate_failed/failed/finalize_failed 都能正确落库和更新 jobs |
| **第三阶段：current 结果贯通** | `getCurrentParsedResult()` 接入 materialize/check/publish，切换 current 后重新入队 materialize/checks | 入库和校验统一使用 current parse_run | 手动切换 current 后 fact_* 和 checks 使用新结果 |
| **第四阶段：Source Gate 与表三专项** | source_snapshots 抽取、表三行列映射、严格数字解析、not_assessable 语义、Source Gate 阻断 | 表三准确率提升链路 | NA/null/0 不混淆；高置信 mismatch 可阻断 |
| **第五阶段：Provider PromptRules** | PromptRules.ts、OpenAI/Zhipu/Nvidia/ModelScope/Gemini/Segmented builder 注入规则 | 多 Provider 规则一致 | 各 Provider 输出 JSON 结构稳定，PromptRules 幂等 |
| **第六阶段：回归与灰度** | Golden Fixture、端到端测试、批量样本回归、指标看板、灰度开关 | 可上线验证包 | Golden 全通过，表三勾稽通过率 >95%，acceptance rate >85% |

### 11.4 阶段回滚边界

| 阶段 | 可回滚边界 | 回滚方式 |
|------|------------|----------|
| 数据库迁移 | parse_runs 新表和新增索引不影响旧读取链路 | 保留旧 `report_versions.parsed_json` 和 `report_version_parses`，暂停新写入 |
| LlmJobRunner 改造 | parse job 失败不应污染旧物化数据 | 关闭新 parse_run finalize，恢复旧 parse 写入路径 |
| current 链路 | current 切换不应影响已发布数据 | 禁用 switch/restore API，回退到 report_versions.parsed_json |
| Source Gate | 门禁误杀不应阻塞所有解析 | 将 `SOURCE_GATE_STRATEGY=permissive` 或关闭 blocker |
| PromptRules | Provider 输出漂移可快速停止 | 回退 prompt_rules_version，触发旧规则重解析或复用旧 accepted |

### 11.5 开发启动检查清单

- [ ] 文档版本已更新到 v5.2，并作为开发基线冻结。
- [ ] 已创建开发分支，避免直接在主线大范围改动。
- [ ] 已准备迁移 dry-run 数据库和至少 5 个真实年报样本。
- [ ] 已明确 `report_version_parses` 到 `parse_runs` 的过渡期兼容策略。
- [ ] 已确定 Source Gate 默认策略：生产 `standard`，测试/开发可用 `permissive`。
- [ ] 已确定第一阶段最小测试：迁移重复执行、current 唯一约束、superseded 恢复、finalize_failed 重试。

---

## 十二、预期效果

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 数字拆分问题发生率 | ~20% | < 5% |
| 表三勾稽关系通过率 | ~80% | > 95% |
| 发布前无需人工修正率 | ~70% | > 90% |
| parse_runs acceptance rate | - | > 85% |
| 版本升级后重解析机制 | 无 | 完整支持 |
| 解析结果可追溯性 | 低 | 高（parse_runs 表） |
| Source Gate 覆盖率 | 0% | 100% |

---

## 本次修订摘要（v5.2 - 开发启动版）

### v5.1 → v5.2 新增补强

- ✅ `parse_runs` 补齐 `source_gate_warning_threshold`，GateConfig 快照字段完整覆盖 DDL / 迁移 / 指纹 / MaterializeGate
- ✅ `restoreSupersededParseRun()` 恢复 superseded 时同步 `report_versions.parsed_json/provider/model/prompt_version`
- ✅ 新增正式开发准入结论、分阶段实施顺序、阶段验收标准和回滚边界

### v5.0 → v5.1 新增修正的 8 个问题

**问题13（新增）：superseded 历史模型——允许多条历史链**
- ✅ 移除旧不合理唯一索引 `uq_parse_runs_version_fingerprint_history`（同一 fingerprint 允许多条 accepted/superseded）
- ✅ parse_runs 新增字段：superseded_by / superseded_at / restored_from / restored_at / intended_final_status
- ✅ 唯一约束只保留：`uq_parse_runs_version_current`（同一 version 最多一个 is_current = TRUE）
- ✅ 辅助索引：idx_parse_runs_version_fingerprint（允许多条）/ idx_parse_runs_superseded_by / idx_parse_runs_restored_from
- ✅ 多次强制覆盖示例：id A→B→C，同一 fingerprint 可有多条 superseded 记录

**问题14（新增）：恢复 superseded 为 current 的原子流程**
- ✅ restoreSupersededParseRun 伪代码：旧 current → superseded + superseded_by，新目标 → accepted + restored_from + restored_at
- ✅ 事务边界：BEGIN → 锁定 report_versions → 更新旧 current → 更新目标 → 同步 report_versions.parsed_json/provider/model/prompt_version → 入队 materialize+checks → COMMIT
- ✅ 恢复时旧 current 也标记为 superseded（保持链式关系），不违反唯一索引
- ✅ switchCurrentParseRun 可复用于恢复流程（逻辑相同）

**问题15（新增）：finalize_failed 恢复——持久化 intended_final_status**
- ✅ 阶段2结束时写入：`intended_final_status = currentStatus`（记录原始意图）
- ✅ finalizeParseRun 读取：`const intendedStatus = parseRun.intended_final_status ?? parseRun.status`
- ✅ finalize 时设置 `intended_final_status = intendedStatus`（不受 finalize 成功影响）
- ✅ recoverStuckJobs 重试：读取 `intended_final_status` 作为 finalStatus，不误用 finalize_failed
- ✅ 错误：不能把 finalize_failed 当成 finalStatus（否则会无限重试失败的 finalize）

**问题16（新增）：jobs.error_code/error_message 使用 freshly 推断的值**
- ✅ finalizeParseRun 中：errorCode = this.inferErrorCode(finalStatus)，errorMessage = this.inferErrorMessage(finalStatus, gateResult)
- ✅ 不依赖 parse_runs.error_code（可能是旧值）：使用 freshly 推断的值写入 parse_runs 和 jobs
- ✅ jobs.error_code 映射：accepted → null；failed → LLM_API_ERROR；gate_failed → PARSE_RULE_GATE_FAILED
- ✅ jobs.error_message：gate_failed 时记录 gateResult.issues / ruleGate.issues / sourceGate.uncertain_fields 摘要

**问题17（新增）：switchCurrentParseRun 后一致性问题**
- ✅ 切换成功后入队 materialize + checks jobs（先查询是否存在 queued/running，没有再 INSERT）
- ✅ jobs 表没有 (report_id, version_id, kind) 唯一约束，方案：先查后 INSERT
- ✅ 旧 materialize/check 数据通过"入队新 jobs"覆盖，不是直接"标记 stale"（因为旧 job 可能已完成）
- ✅ 事务边界：整个切换在一个 BEGIN...COMMIT 中，is_current 切换 + 入队 jobs 是原子的

**问题18（新增）：MaterializeGate 必须从 current parse_run 读取 GateConfig**
- ✅ MaterializeGateService.buildGateConfigFromParseRun()：从 parse_run.source_gate_strategy / source_gate_uncertain_threshold / source_gate_high_confidence_blocking / source_gate_warning_threshold 构造
- ✅ fallback 到 DEFAULT_GATE_CONFIGS['standard']
- ✅ gate() 方法使用 overrideGateConfig 参数仅用于测试覆盖，优先从 parse_run 读取
- ✅ Source Gate 阻断逻辑：复用 parse 阶段的 highConfidenceBlocking 逻辑（blocker 判断）

**问题19（新增）：补全 10.3 迁移 SQL**
- ✅ 删除旧 fingerprint 唯一索引（DROP INDEX IF EXISTS uq_parse_runs_version_fingerprint_accepted/history）
- ✅ 新增 superseded 历史链字段迁移（superseded_by / superseded_at / restored_from / restored_at / intended_final_status）
- ✅ DO $$ / EXCEPTION WHEN duplicate_object THEN NULL 包装所有 ADD CONSTRAINT
- ✅ 添加外键约束（DO $$ 包装可重复执行）
- ✅ 迁移旧数据：UPDATE parse_runs SET intended_final_status = status WHERE intended_final_status IS NULL
- ✅ 新增辅助索引：idx_parse_runs_version_fingerprint / idx_parse_runs_superseded_by / idx_parse_runs_restored_from

**问题20（新增）：修正 10.2 Provider 文件清单与 6.5 真实调用链一致**
- ✅ OpenAI：保留 buildStrictParseSystemInstruction()，末尾 injectCommonRules()；保留 SegmentedAnnualReportParse 分段 builder
- ✅ Zhipu/Nvidia：保留 buildStrictParseSystemInstruction()，末尾 injectCommonRules()
- ✅ ModelScope：保留 buildSystemInstruction()，末尾 injectCommonRules()
- ✅ Gemini：保留自有 buildSystemInstruction()（不迁移），末尾 injectCommonRules()
- ✅ SegmentedAnnualReportParse：所有 buildTable2/3/4ParseSystemInstruction 注入规则（含 buildTable4 includeTable4Rules: true）
- ✅ 不再写成"统一 buildSystemInstruction"，明确每个 Provider 的具体 builder 路径

---

### v5.0 已修正的 6 个问题（历史记录）

1. 同 fingerprint 强制重解析会撞 accepted 唯一索引 → 新增 superseded 状态
2. jobs.status 不应写 gate_failed/finalize_failed → 统一改为 failed
3. finalize 不应清掉失败错误信息 → 只有 accepted 时清空
4. Source Gate 新配置必须影响门禁逻辑 → determineParseStatus 接收 gateConfig
5. PromptRules 示例必须实现去重和表四规则
6. Provider 改造段落必须与真实调用链保持一致

### v4.0 已修正的 6 个问题（历史记录）

7. materialize job ON CONFLICT 无唯一约束 → 先查询后插入
8. switchCurrentParseRun 缺少 version 校验与并发锁 → FOR UPDATE 行锁
9. source_gate_strategy 未进入 fingerprint
10. ALTER TYPE 与 VARCHAR CHECK 冲突 → DROP CONSTRAINT + ADD CONSTRAINT
11. Provider 调用链核对不准确
12. PromptRules 示例代码不可编译

### v3.0 已修正的 6 个问题（历史记录）

1-6. (parse_runs 建表、draft 持久化、is_current 单一来源、Source Gate 阻断、NA/null 处理、Provider 调用链)

---

### 仍需真实代码验证的风险（v5.1 更新）

1. **superseded_by FK 循环引用风险**：parse_runs 尚未插入时可能 FK 引用自身（建议：INSERT 时不加 FK，事后 ADD CONSTRAINT）
2. **intended_final_status 与 finalized run 状态混淆**：如果 finalized 后 status 被覆盖（但 draft_* 保留了上下文），是否需要单独追踪
3. **switchCurrentParseRun 中 materialized jobs 入队的时机**：旧 job 可能已完成，新 job 会重复处理；如果旧 job 正在 running，新的会排队等待
4. **restoreSupersededParseRun 与 finalizeParseRun 的恢复链**：A superseded B superseded C 恢复 A 时，restored_from 指向 C 但 superseded_by 不连续（需要说明）
5. **GateConfig 与 parse_gate_version / prompt_rules_version 的交互**：当 source_gate_strategy 和具体阈值字段同时存在时，以谁为准
6. **RULES_VERSION 升级后的旧记录兼容**：旧 parse_run 注入 v1.0 规则，升级 v1.1 后是否需要重解析
7. **DO $$ 异常处理块的迁移兼容性**：某些 PostgreSQL 版本可能对 EXCEPTION WHEN duplicate_object 处理不同
8. **行锁并发冲突与死锁**：恢复 superseded 时锁顺序（report_versions → 旧 current → 目标 run）与 finalizeParseRun 锁顺序是否一致
9. **draft_source_snapshots_json 数据量**：全量源表快照可能达到 MB 级别，需要评估 PostgreSQL JSONB 存储和查询性能
10. **Source Gate 阈值调优**：standard=10 / conservative=5 需要从真实报告数据中验证
