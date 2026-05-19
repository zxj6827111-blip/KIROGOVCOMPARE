# 数据库迁移与回滚操作手册

本文档只描述新的受控 migration/rollback 入口。历史修复脚本仍可能直接改 schema，生产环境不要绕过本手册直接执行。

## 设计摘要

- 迁移注册入口：`src/db/migrationRegistry.ts`
- 迁移执行器：`src/db/migrationRunner.ts`
- 服务启动入口：`src/db/migrations.ts`
- 运维 CLI：`src/scripts/db-migrate.ts`
- Ledger 表：`schema_migration_ledger`

每个 migration 使用 TypeScript 对象注册：

```ts
{
  id: '0002_example',
  name: 'Example schema change',
  reversible: true,
  up: async (client) => { /* forward SQL */ },
  down: async (client) => { /* reviewed rollback SQL */ },
}
```

`reversible: false` 或没有 `down` 的 migration 不允许回滚。当前 legacy LLM schema runner 是既有大号幂等迁移，注册为 `0001_legacy_llm_idempotent_schema`，默认继续 forward-only，不能回滚。

## Ledger 记录

`schema_migration_ledger` 保留旧字段，并新增：

- `migration_id`
- `direction`：`up` 或 `down`
- `status`：`succeeded`、`blocked`、`failed`
- `checksum`
- `started_at` / `finished_at`
- `error_message`

查询最近记录：

```bash
npm run db:migrate -- ledger --limit=20
```

也可以直接查库：

```sql
SELECT id, migration_id, direction, status, action, error_message, created_at
FROM schema_migration_ledger
WHERE system_name = 'llm_schema_migrations'
ORDER BY id DESC
LIMIT 20;
```

## 执行迁移

服务启动仍会在 `LLM_RUN_MIGRATIONS !== 0` 时执行 forward migration：

```bash
npm run start:llm
```

手动执行：

```bash
npm run db:migrate -- up
```

Dry-run：

```bash
npm run db:migrate -- up --dry-run
```

Dry-run 不执行 migration body，也不写 ledger，只输出计划。

## 回滚最近 N 步

先 dry-run：

```bash
npm run db:migrate -- rollback --steps=1 --dry-run
```

确认目标 migration 有 `down` 后，再执行真实回滚：

```bash
npm run db:migrate -- rollback --steps=1
```

如果最近的 migration 没有 `down` 或 `reversible: false`，命令会写入 `rollback_blocked` ledger 并失败，不会继续回滚。

## 生产环境保护

生产环境判断来自 `NODE_ENV`、`APP_ENV`、`DB_ENV` 或 `DATABASE_ENV` 任一值为 `production`。

生产环境真实回滚前必须：

1. 创建数据库备份。
2. 验证备份文件可用。
3. 明确本次回滚的 migration id 和 step 数。
4. 设置双确认变量。

示例：

```bash
pg_dump "$DATABASE_URL" > backup-before-rollback.sql
NODE_ENV=production ALLOW_PRODUCTION_ROLLBACK=1 DB_ROLLBACK_BACKUP_CONFIRMED=1 npm run db:migrate -- rollback --steps=1
```

没有 `ALLOW_PRODUCTION_ROLLBACK=1` 或 `DB_ROLLBACK_BACKUP_CONFIRMED=1` 时，生产回滚会直接阻断。

## 已审计的 schema 入口

正式入口：

- `src/db/migrations.ts`
- `src/db/migrations-llm.ts`
- `src/index-llm.ts`
- `scripts/apply_migration_fix.ts`
- `scripts/govinsight-phase1-bootstrap.ts`

历史直接 schema 脚本，生产环境应避免直接使用，后续应逐步迁入 registry：

- `scripts/apply-local-schema-to-cloud.ts`
- `scripts/apply_view_fix.ts`
- `scripts/fix-pg-schema.js`
- `scripts/fix_db_trigger.ts`
- `scripts/fix_retry_of_constraint.ts`
- `scripts/init-pg-schema.ps1`
- `scripts/setup-admin.js`

## 新增 migration 的规则

- 每个 migration 必须有稳定 `id`，不要改已发布 migration 的 `id`。
- 可回滚 migration 必须提供经过审查的 `down`。
- 数据破坏性操作默认标记为不可回滚，除非有明确备份和恢复设计。
- `down` 只能撤销本 migration 引入的结构变化，不要清理业务数据。
- 生产回滚只能使用 CLI，不允许在服务启动路径中自动触发。
