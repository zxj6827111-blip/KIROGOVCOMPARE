import * as fs from 'fs';
import * as path from 'path';
import pool from '../config/database';

interface Migration {
  name: string;
  up: string;
}

const migrationsDir = path.join(__dirname, '../../migrations');

async function getMigrations(): Promise<Migration[]> {
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
  return files.map((file) => ({
    name: file,
    up: fs.readFileSync(path.join(migrationsDir, file), 'utf-8'),
  }));
}

async function initMigrationsTable(): Promise<void> {
  const query = `
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await pool.query(query);
}

async function getExecutedMigrations(): Promise<string[]> {
  const result = await pool.query('SELECT name FROM migrations ORDER BY executed_at');
  return result.rows.map((row) => row.name);
}

async function recordMigration(name: string): Promise<void> {
  await pool.query('INSERT INTO migrations (name) VALUES ($1)', [name]);
}

export async function runMigrations(): Promise<void> {
  try {
    console.log('Starting database migrations...');

    await initMigrationsTable();
    const executed = await getExecutedMigrations();
    const migrations = await getMigrations();

    for (const migration of migrations) {
      if (!executed.includes(migration.name)) {
        console.log(`Running migration: ${migration.name}`);
        await pool.query(migration.up);
        await recordMigration(migration.name);
        console.log(`✓ Migration completed: ${migration.name}`);
      }
    }

    console.log('All migrations completed successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
}

export async function rollbackMigration(steps: number = 1): Promise<void> {
  try {
    console.log(`Rolling back ${steps} migration(s)...`);
    const executed = await getExecutedMigrations();

    for (let i = 0; i < steps && executed.length > 0; i++) {
      const migrationName = executed.pop();
      if (migrationName) {
        console.log(`Rolling back: ${migrationName}`);
        // 在实际应用中，应该有对应的 down 脚本
        await pool.query('DELETE FROM migrations WHERE name = $1', [migrationName]);
        console.log(`✓ Rollback completed: ${migrationName}`);
      }
    }
  } catch (error) {
    console.error('Rollback failed:', error);
    throw error;
  }
}
