const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const db = new sqlite3.Database(dbPath);

const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const all = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

async function recover() {
    console.log('START: Robust Recovery');
    try {
        const regions = await all("SELECT id, name FROM regions");
        const regionMap = {};
        for (const r of regions) regionMap[r.name] = r.id;

        const referencedIdsRaw = await all(`
      SELECT DISTINCT report_id FROM report_versions
      UNION
      SELECT DISTINCT report_id FROM jobs
    `);
        const referencedIds = referencedIdsRaw.map(r => r.report_id).filter(id => id != null);
        console.log(`Found ${referencedIds.length} referenced report IDs in versions/jobs`);

        const existingRows = await all("SELECT id FROM reports");
        const existingIds = new Set(existingRows.map(r => r.id));
        const missingIds = referencedIds.filter(id => !existingIds.has(id));
        console.log(`Missing ${missingIds.length} reports in the reports table`);

        for (const id of missingIds) {
            const v = await get("SELECT storage_path, file_name FROM report_versions WHERE report_id = ? LIMIT 1", [id]);
            let regionId = 1;
            let year = 2023;
            let unitName = '';

            if (v) {
                const yearMatch = v.storage_path.match(/20\d{2}/);
                if (yearMatch) year = parseInt(yearMatch[0]);

                for (const name in regionMap) {
                    if (v.storage_path.includes(name) || (v.file_name && v.file_name.includes(name))) {
                        regionId = regionMap[name];
                        break;
                    }
                }
            }

            await run(
                "INSERT OR IGNORE INTO reports (id, region_id, year, unit_name) VALUES (?, ?, ?, ?)",
                [id, regionId, year, unitName]
            );
            console.log(`  Restored report ${id} (Region: ${regionId}, Year: ${year})`);
        }

        const finalCount = await get("SELECT COUNT(*) as count FROM reports");
        console.log(`DONE: Total reports now: ${finalCount.count}`);
    } catch (err) {
        console.error('RECOVERY FAILED:', err);
    } finally {
        db.close();
    }
}

recover();
