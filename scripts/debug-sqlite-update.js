
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Mock sqlite.ts functionalities
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const SQLITE_DB_PATH = path.join(DATA_DIR, 'llm_ingestion.db');
const SQLITE3_BIN = path.join(PROJECT_ROOT, 'tools', 'sqlite', 'sqlite3.exe');

console.log('DB Path:', SQLITE_DB_PATH);
console.log('SQLite Bin:', SQLITE3_BIN);

function sqlValue(value) {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}

function runSql(sql) {
    console.log('Running SQL length:', sql.length);
    try {
        const output = execFileSync(SQLITE3_BIN, ['-json', SQLITE_DB_PATH], {
            encoding: 'utf-8',
            input: sql,
            timeout: 10000,
            maxBuffer: 10 * 1024 * 1024 // Increase buffer to 10MB
        });
        console.log('Success. Output:', output.trim());
    } catch (e) {
        console.error('Execution Failed!');
        console.error('Code:', e.code);
        console.error('Message:', e.message);
        console.error('Stderr:', e.stderr ? e.stderr.toString() : 'N/A');
    }
}

// 1. Test existing report version
const versionId = 1; // Assuming 1 exists, or we select one
const getVersionSql = `SELECT id FROM report_versions LIMIT 1;`;

try {
    const output = execFileSync(SQLITE3_BIN, ['-json', SQLITE_DB_PATH], {
        encoding: 'utf-8',
        input: getVersionSql
    });
    const rows = JSON.parse(output);
    if (rows.length > 0) {
        const id = rows[0].id;
        console.log('Testing update on version_id:', id);

        // 2. Create a large JSON object
        const largeObj = {
            data: "Test " + "A".repeat(1000), // Start small: 1KB
            nested: {
                val: "Quote ' test"
            }
        };
        const jsonStr = JSON.stringify(largeObj);
        
        const updateSql = `UPDATE report_versions SET parsed_json = ${sqlValue(jsonStr)}, updated_at = datetime('now') WHERE id = ${id};`;
        
        runSql(updateSql);

        // 3. Ultra large just to be sure
        console.log('Testing 2MB update...');
        const hugeObj = { data: "A".repeat(2 * 1024 * 1024) };
        const hugeJsonStr = JSON.stringify(hugeObj);
        const hugeSql = `UPDATE report_versions SET parsed_json = ${sqlValue(hugeJsonStr)}, updated_at = datetime('now') WHERE id = ${id};`;
        
        runSql(hugeSql);

    } else {
        console.log('No versions found to test.');
    }
} catch (e) {
    console.error('Setup failed:', e);
}
