const fs = require('fs');
const path = require('path');

// Config
const uploadsDir = path.join(__dirname, '..', 'data', 'uploads');
const sqlFile = path.join(__dirname, '..', 'data', 'recovery.sql');
const CUTOFF_DATE = new Date('2026-01-02T00:00:00');

console.log("Generating SQL Recovery Script...");

if (!fs.existsSync(uploadsDir)) {
    console.error("No uploads dir.");
    process.exit(1);
}

const wstream = fs.createWriteStream(sqlFile);
wstream.write('BEGIN TRANSACTION;\n');

function escape(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/'/g, "''");
}

const regions = fs.readdirSync(uploadsDir).filter(f => /^\d+$/.test(f));
let restoredCount = 0;

regions.forEach(regionIdStr => {
    const regionId = parseInt(regionIdStr);
    const regionPath = path.join(uploadsDir, regionIdStr);

    // Check years
    let hasLegacy = false;
    const years = fs.readdirSync(regionPath).filter(y => /^\d{4}$/.test(y));

    let regionName = `Recovered Region ${regionId}`;
    let potentialNames = [];

    // Scan for legacy files
    years.forEach(year => {
        const yearPath = path.join(regionPath, year);
        const files = fs.readdirSync(yearPath);

        files.forEach(f => {
            const filePath = path.join(yearPath, f);
            const stat = fs.statSync(filePath);
            if (stat.birthtime < CUTOFF_DATE || stat.mtime < CUTOFF_DATE) {
                hasLegacy = true;
                const base = path.parse(f).name;
                const nameClean = base.replace(year, '').replace(/(\d{4})/, '');
                const nameShort = nameClean.replace(/政府信息公开/g, '').replace(/报告/g, '').replace(/年度/g, '').replace(/工作/g, '').trim();
                if (nameShort.length > 1) potentialNames.push(nameShort);
            }
        });
    });

    if (!hasLegacy) return;

    if (potentialNames.length > 0) {
        regionName = potentialNames[0].replace(/[_\-\s]+$/, '');
    }

    // Recover Region
    wstream.write(`INSERT OR IGNORE INTO regions (id, name, level) VALUES (${regionId}, '${escape(regionName)}', 3);\n`);

    // Recover Reports / Versions
    years.forEach(year => {
        const yearInt = parseInt(year);
        const yearPath = path.join(regionPath, year);
        const files = fs.readdirSync(yearPath);

        files.forEach(f => {
            const filePath = path.join(yearPath, f);
            const stat = fs.statSync(filePath);

            if (stat.birthtime < CUTOFF_DATE || stat.mtime < CUTOFF_DATE) {
                const unitName = path.parse(f).name;
                const relPath = `uploads/${regionId}/${year}/${f}`;
                const hash = `REC_${Date.now()}_${Math.random().toString(36).substring(7)}`;

                // Insert Report
                wstream.write(`INSERT OR IGNORE INTO reports (region_id, year, unit_name) VALUES (${regionId}, ${yearInt}, '${escape(unitName)}');\n`);

                // Insert Version (Subquery for ID)
                const subQuery = `(SELECT id FROM reports WHERE region_id=${regionId} AND year=${yearInt} AND unit_name='${escape(unitName)}' LIMIT 1)`;

                wstream.write(`INSERT INTO report_versions (report_id, file_name, file_hash, storage_path, provider, model, prompt_version, parsed_json) VALUES (${subQuery}, '${escape(f)}', '${hash}', '${escape(relPath)}', 'recovery', 'model', 'v1', '{}');\n`);

                restoredCount++;
            }
        });
    });
});

wstream.write('COMMIT;\n');
wstream.end();

wstream.on('finish', () => {
    console.log(`SQL Generated at ${sqlFile}. Contains ${restoredCount} file entries.`);
});
