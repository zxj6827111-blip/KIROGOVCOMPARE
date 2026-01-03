const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../data/llm_ingestion.db');
const db = new sqlite3.Database(dbPath);

console.log("Checking Report 21 (Huangpu 2023) Versions...");

db.serialize(() => {
    db.all("SELECT * FROM report_versions WHERE report_id = 21", (err, versions) => {
        if (err) return console.error(err);

        versions.forEach(v => {
            console.log(`Version ${v.id}:`);
            console.log(`  - Active: ${v.is_active}`);
            console.log(`  - Provider: '${v.provider}'`);
            console.log(`  - Model: '${v.model}'`);
            console.log(`  - Created: ${v.created_at}`);
        });

        // Also check keys in database if they exist? No, keys are in env.
    });
});
