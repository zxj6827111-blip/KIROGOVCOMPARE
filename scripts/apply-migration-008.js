const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const migrationPath = path.join(__dirname, '..', 'migrations', 'sqlite', '008_async_jobs_schema.sql');

if (!fs.existsSync(dbPath)) {
    console.log('Database not found at', dbPath);
    process.exit(0);
}

const db = new sqlite3.Database(dbPath);
const migration = fs.readFileSync(migrationPath, 'utf8');

console.log('Applying migration 008 to', dbPath);

// Execute the migration SQL
// We split by ; and run each statement to avoid issues with some drivers
const statements = migration
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('--'));

db.serialize(() => {
    db.run('PRAGMA foreign_keys = OFF');

    for (const statement of statements) {
        db.run(statement, (err) => {
            if (err) {
                // Some errors are expected if we run it multiple times (e.g. column already exists)
                if (err.message.includes('duplicate column name') || err.message.includes('already exists')) {
                    console.log('  Skipping:', statement.substring(0, 50) + '... (Already applied)');
                } else {
                    console.error('  Error executing statement:', statement.substring(0, 100));
                    console.error('  Error message:', err.message);
                }
            } else {
                console.log('  Success:', statement.substring(0, 50) + '...');
            }
        });
    }

    db.run('PRAGMA foreign_keys = ON', () => {
        db.close();
        console.log('Migration attempt finished.');
    });
});
