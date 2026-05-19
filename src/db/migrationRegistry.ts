import { runLLMMigrations } from './migrations-llm';
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
      'Existing monolithic CREATE/ALTER/repair runner. It is intentionally forward-only until it is split into reviewed up/down migrations.',
    async up() {
      await runLLMMigrations();
    },
  },
];

export function getRegisteredMigrations(): RegisteredMigration[] {
  return registeredMigrations;
}
