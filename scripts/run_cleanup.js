const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let sqliteBin = 'sqlite3';
const localBin = path.join(__dirname, '..', 'tools', 'sqlite', 'sqlite3.exe');
if (fs.existsSync(localBin)) {
    sqliteBin = localBin;
}
const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');

function query(sql) {
    try {
        const cmd = `"${sqliteBin}" "${dbPath}" -json "${sql}"`;
        const res = execSync(cmd, { encoding: 'utf-8' });
        return JSON.parse(res);
    } catch (e) {
        console.error("Query Error:", e.message);
        return [];
    }
}

function execute(sql) {
    try {
        const cmd = `"${sqliteBin}" "${dbPath}" "${sql}"`;
        execSync(cmd);
    } catch (e) {
        console.error("Exec Error:", e.message);
    }
}

console.log("Fetching all regions...");
const regions = query("SELECT id, name FROM regions");

const toDelete = regions.filter(r => {
    // Keep if has Chinese
    if (/[\u4e00-\u9fa5]/.test(r.name)) return false;
    // Keep if looks like standard config/English
    if (/^[a-zA-Z0-9\s\(\)\-_]+$/.test(r.name)) return false;

    // Otherwise delete (Mojibake)
    return true;
});

console.log(`Found ${toDelete.length} garbled regions to delete.`);

if (toDelete.length > 0) {
    const ids = toDelete.map(r => r.id);
    const chunkSize = 50;

    for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const idList = chunk.join(',');
        console.log(`Deleting chunk ${i / chunkSize + 1}...`);

        // Delete
        execute(`DELETE FROM regions WHERE id IN (${idList})`);
    }
    console.log("Cleanup complete.");
} else {
    console.log("No garbled regions found.");
}
