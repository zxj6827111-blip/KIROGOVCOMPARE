const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let sqliteBin = 'sqlite3';
const localBin = path.join(__dirname, '..', 'tools', 'sqlite', 'sqlite3.exe');
if (fs.existsSync(localBin)) {
    sqliteBin = localBin;
}
const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');

function execute(sql) {
    try {
        console.log(`Executing: ${sql}`);
        const cmd = `"${sqliteBin}" "${dbPath}" "${sql}"`;
        execSync(cmd);
    } catch (e) {
        console.error("Exec Error:", e.message);
    }
}

const tables = [
    'notifications',
    'report_consistency_items',
    'report_consistency_runs',
    'report_version_parses',
    'comparison_results',
    'jobs',
    'comparisons',
    'report_versions',
    'reports',
    'regions',
    'sqlite_sequence' // Reset IDs
];

console.log("Starting full data wipe...");
tables.forEach(t => {
    execute(`DELETE FROM ${t}`);
});
console.log("Wipe complete.");
