const { execSync } = require('child_process');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const sqliteBin = path.join(__dirname, '..', 'tools', 'sqlite', 'sqlite3.exe');

function query(sql) {
    try {
        const cmd = `"${sqliteBin}" "${dbPath}" -cmd ".timeout 10000" -json "${sql}"`;
        return JSON.parse(execSync(cmd, { encoding: 'utf-8' }));
    } catch (e) {
        return [];
    }
}

console.log("--- Regions count ---");
console.log(query("SELECT count(*) as c FROM regions"));

console.log("\n--- Top Level (Parent IS NULL) ---");
console.log(query("SELECT id, name, level, parent_id FROM regions WHERE parent_id IS NULL LIMIT 20"));

console.log("\n--- Level 1 ---");
console.log(query("SELECT id, name, level, parent_id FROM regions WHERE level=1 LIMIT 5"));

console.log("\n--- Orphans (Level > 1 but Parent NULL) ---");
console.log(query("SELECT count(*) as c FROM regions WHERE level > 1 AND parent_id IS NULL"));

console.log("\n--- Sample Orphans ---");
console.log(query("SELECT id, name, level, parent_id FROM regions WHERE level > 1 AND parent_id IS NULL LIMIT 5"));
