const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const sqliteBin = path.join(__dirname, '..', 'tools', 'sqlite', 'sqlite3.exe');
const projectRoot = path.join(__dirname, '..');

function query(sql) {
    try {
        const cmd = `"${sqliteBin}" "${dbPath}" -cmd ".timeout 10000" -json "${sql}"`;
        const out = execSync(cmd, { encoding: 'utf-8' }).trim();
        if (!out) return [];
        return JSON.parse(out);
    } catch (e) {
        return [];
    }
}

function execute(sql) {
    try {
        const cmd = `"${sqliteBin}" "${dbPath}" -cmd ".timeout 10000" "${sql}"`;
        execSync(cmd);
    } catch (e) {
        console.error(`Exec Error: ${e.message.split('\n')[0]}`);
    }
}

console.log("Starting Emergency Restore...");

// 1. Get orphaned Region IDs from reports
const orphans = query("SELECT DISTINCT region_id FROM reports");
console.log(`Found ${orphans.length} orphaned region IDs in reports.`);

let recoveredCount = 0;
let jobsCreated = 0;

orphans.forEach(row => {
    const regionId = row.region_id;
    let regionName = `Recovered Region ${regionId}`;

    // 2. Try to find a file to name it
    const fileRow = query(`
        SELECT v.storage_path 
        FROM report_versions v 
        JOIN reports r ON v.report_id = r.id 
        WHERE r.region_id = ${regionId} 
        LIMIT 1
    `);

    if (fileRow.length > 0) {
        const fullPath = path.join(projectRoot, 'data', fileRow[0].storage_path);
        if (fs.existsSync(fullPath) && fullPath.endsWith('.html')) {
            try {
                const content = fs.readFileSync(fullPath, 'utf8');
                // Regex checks
                const unitMatch = content.match(/<strong>单位：<\/strong>(.*?)<\/div>/);
                if (unitMatch) {
                    regionName = unitMatch[1];
                } else {
                    const titleMatch = content.match(/<title>(.*?)<\/title>/);
                    if (titleMatch) {
                        regionName = titleMatch[1].split(/\d{4}年/)[0]
                            .replace(/办事处$/, '')
                            .replace(/人民政府$/, '')
                            .replace(/办公室$/, '');
                    }
                }
            } catch (e) { }
        }
    }

    // 3. Insert Region with Code and Parent
    const safeName = regionName.replace(/'/g, "''");
    let level = 3;
    let parentId = 1;
    let code = `REC_${regionId}`;

    if (regionId === 1 || regionName.includes('上海市')) {
        level = 1;
        parentId = 'NULL'; // Root
        if (regionId === 1) code = '310000'; // Standard code for Shanghai
    }

    // Check if exists first to avoid ignore skipping updates
    const existing = query(`SELECT id FROM regions WHERE id=${regionId}`);

    if (existing.length === 0) {
        execute(`INSERT INTO regions (id, code, name, level, parent_id) VALUES (${regionId}, '${code}', '${safeName}', ${level}, ${parentId})`);
    } else {
        execute(`UPDATE regions SET name = '${safeName}', parent_id = ${parentId} WHERE id = ${regionId}`);
    }

    recoveredCount++;
    console.log(`Restored Region ${regionId}: ${safeName} (Parent: ${parentId})`);
});

// 4. Create Jobs for ALL reports
// We need report_id and version_id
const allVersions = query("SELECT v.id, v.report_id FROM report_versions v");
allVersions.forEach(v => {
    execute(`INSERT OR IGNORE INTO jobs (report_id, version_id, status, created_at) VALUES (${v.report_id}, ${v.id}, 'pending', datetime('now'))`);
    jobsCreated++;
});

console.log(`Structure Restore Complete.`);
console.log(`Regions: ${recoveredCount}`);
console.log(`Jobs: ${jobsCreated}`);
