import { runLLMMigrations } from './migrations-llm';
import { ensureStructuredPackageSchema } from './structuredPackageSchema';
import { ensureFilingSchema } from './filingSchema';
import { RegisteredMigration } from './migrationRunner';

export const MIGRATION_SYSTEM_NAME = 'llm_schema_migrations';

export const registeredMigrations: RegisteredMigration[] = [
  {
    id: '0001_legacy_llm_idempotent_schema',
    name: 'Legacy LLM idempotent schema runner',
    reversible: false,
    runOnEveryStart: true,
    transaction: false,
    notes:
      'Existing monolithic CREATE/ALTER/repair runner. It is intentionally forward-only until it is split into reviewed up/down migrations. Structured package DDL is NOT inlined here; see 0002.',
    async up() {
      await runLLMMigrations();
    },
  },
  {
    id: '0002_structured_package_import',
    name: 'Structured package import columns and artifacts',
    // Intentionally irreversible: dropping these columns would re-label all
    // structured versions as ai_parse and destroy artifact metadata. The
    // destructive DDL lives in `dropStructuredPackageSchema` (structuredPackageSchema.ts)
    // but is NOT wired into the registered down()-handler on purpose. Operators who
    // must physically revert this migration should do so via a separate reviewed
    // hotfix that explicitly invokes `dropStructuredPackageSchema` — never via the
    // generic `rollbackRegisteredMigrations` runner, which will block on
    // `rollback_blocked_without_down_migration` as a guard rail.
    reversible: false,
    runOnEveryStart: true,
    transaction: true,
    notes:
      'Single source for structured package DDL. Irreversible by design: dropping columns would destroy artifact metadata and re-label structured versions as ai_parse. See structuredPackageSchema.ts:dropStructuredPackageSchema for the explicit destructive path.',
    async up(client) {
      await ensureStructuredPackageSchema(client);
    },
  },
  {
    id: '0003_department_annual_report_filing',
    name: 'Department annual report online filing',
    reversible: false,
    runOnEveryStart: true,
    transaction: true,
    notes: 'report_filings table for 国办模板在线填报草稿/提交/勾稽生效.',
    async up(client) {
      await ensureFilingSchema(client);
    },
  },
];

export function getRegisteredMigrations(): RegisteredMigration[] {
  return registeredMigrations;
}
