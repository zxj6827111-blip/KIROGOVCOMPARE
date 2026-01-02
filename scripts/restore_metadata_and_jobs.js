const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Config
const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const sqliteBin = path.join(__dirname, '..', 'tools', 'sqlite', 'sqlite3.exe');
const projectRoot = path.join(__dirname, '..');

function query(sql) {
    try {
        const cmd = `"${sqliteBin}" "${dbPath}" -cmd ".timeout 10000" -json "${sql}"`;
        return JSON.parse(execSync(cmd, { encoding: 'utf-8' }));
    } catch (e) {
        return [];
    }
}

function execute(sql) {
    try {
        // Escape check
        const finalSql = sql.replace(/"/g, '""'); // Just basic protection if needed
        const cmd = `"${sqliteBin}" "${dbPath}" -cmd ".timeout 10000" "${sql}"`;
        execSync(cmd);
    } catch (e) {
        console.error(`Exec Error: ${e.message.split('\n')[0]}`);
    }
}

// 1. Find Recovered Regions
const regions = query("SELECT id, name FROM regions WHERE name LIKE 'Recovered Region%'");
console.log(`Found ${regions.length} regions to fix.`);

let fixedCount = 0;
let jobsCreated = 0;

regions.forEach(r => {
    // 2. Find a report_version file to read
    // We need linkage: region -> report -> report_version
    const rows = query(`
        SELECT v.storage_path, v.id as version_id, r.id as report_id
        FROM report_versions v
        JOIN reports r ON v.report_id = r.id
        WHERE r.region_id = ${r.id}
        LIMIT 1
    `);

    if (rows.length === 0) return;

    const row = rows[0];
    const fullPath = path.join(projectRoot, 'data', row.storage_path);

    if (!fs.existsSync(fullPath)) return;

    // 3. Read content
    let extractedName = null;
    let title = null;

    if (fullPath.endsWith('.html')) {
        const content = fs.readFileSync(fullPath, 'utf8');

        // Try Unit Name regex
        const unitMatch = content.match(/<strong>单位：<\/strong>(.*?)<\/div>/);
        if (unitMatch) extractedName = unitMatch[1];

        // Try Title Regex
        if (!extractedName) {
            const titleMatch = content.match(/<title>(.*?)<\/title>/);
            if (titleMatch) {
                title = titleMatch[1];
                // Extract "X County X Street" from title
                // "沭阳县沭城街道办事处2024年..."
                // Remove 2024..., Remove Suffix
                extractedName = title.split(/\d{4}年/)[0]
                    .replace(/办事处$/, '')
                    .replace(/人民政府$/, '')
                    .replace(/办公室$/, '');
            }
        }
    }

    // 4. Update Region Name
    if (extractedName && extractedName.length > 2) {
        // Fix SQL escape
        const safeName = extractedName.replace(/'/g, "''");
        console.log(`Region ${r.id}: "${r.name}" -> "${extractedName}"`);
        execute(`UPDATE regions SET name = '${safeName}' WHERE id = ${r.id}`);
        fixedCount++;

        // Also update report unit_name if generic
        if (title) {
            const safeTitle = title.replace(/'/g, "''").slice(0, 100); // Truncate
            execute(`UPDATE reports SET unit_name = '${safeTitle}' WHERE id = ${row.report_id}`);
        }
    }

    // 5. Create Job (for ALL versions in this region, not just one)
    // Find all versions for this region
    const allVersions = query(`
        SELECT v.id 
        FROM report_versions v
        JOIN reports r ON v.report_id = r.id
        WHERE r.region_id = ${r.id}
    `);

    allVersions.forEach(v => {
        // Check if job exists
        const job = query(`SELECT id FROM jobs WHERE report_version_id = ${v.id}`);
        if (job.length === 0) {
            execute(`INSERT INTO jobs (report_version_id, status, created_at, updated_at) VALUES (${v.id}, 'pending', datetime('now'), datetime('now'))`);
            jobsCreated++;
        }
    });
});

console.log(`Metadata Restore Complete.`);
console.log(`Fixed Names: ${fixedCount}`);
console.log(`Jobs Created: ${jobsCreated}`);
