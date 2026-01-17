const Database = require('better-sqlite3');
const db = new Database('data/llm_ingestion.db');
const newChecksum = '545d5594e2f152f4d33b5dff287f65bdbbbd4b0e1d4940bd33ea924636381b6c';
const result = db.prepare("UPDATE sqlite_migrations SET checksum = ? WHERE filename = '013_fix_reports_table.sql'").run(newChecksum);
console.log('Updated rows:', result.changes);
db.close();
console.log('Done.');
