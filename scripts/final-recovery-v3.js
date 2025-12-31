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
    console.log('START: High-Precision Recovery');
    try {
        const referencedIdsRaw = await all(`
      SELECT DISTINCT report_id FROM report_versions
      UNION
      SELECT DISTINCT report_id FROM jobs
      WHERE report_id IS NOT NULL
    `);
        const referencedIds = referencedIdsRaw.map(r => r.report_id).filter(id => id != null);
        console.log(`Found ${referencedIds.length} referenced report IDs`);

        const existingRows = await all("SELECT id FROM reports");
        const existingIds = new Set(existingRows.map(r => r.id));
        const missingIds = referencedIds.filter(id => !existingIds.has(id));
        console.log(`Missing ${missingIds.length} reports to restore: ${missingIds.join(', ')}`);

        for (const id of missingIds) {
            const v = await get("SELECT storage_path, file_name FROM report_versions WHERE report_id = ? LIMIT 1", [id]);
            let regionId = 1;
            let year = 2023;
            let unitName = '';

            if (v && v.storage_path) {
                // Path format: data/uploads/{regionId}/{year}/{filename} or data\uploads\{regionId}\{year}\{filename}
                const parts = v.storage_path.split(/[\\/]/);
                // Look for the part that is a number and preceded by 'uploads'
                const uploadsIdx = parts.findIndex(p => p.toLowerCase() === 'uploads');
                if (uploadsIdx !== -1 && parts[uploadsIdx + 1]) {
                    const maybeRegionId = parseInt(parts[uploadsIdx + 1]);
                    if (!isNaN(maybeRegionId)) regionId = maybeRegionId;

                    if (parts[uploadsIdx + 2]) {
                        const maybeYear = parseInt(parts[uploadsIdx + 2]);
                        if (!isNaN(maybeYear) && maybeYear > 2000) year = maybeYear;
                    }
                }
            }

            // To avoid unique constraint if we still have collisions, use a temporary unit name if needed
            // But let's try with empty first, if it fails we check
            try {
                await run(
                    "INSERT INTO reports (id, region_id, year, unit_name) VALUES (?, ?, ?, ?)",
                    [id, regionId, year, unitName]
                );
                console.log(`  [SUCCESS] Restored report ${id} (Region: ${regionId}, Year: ${year})`);
            } catch (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    // If collision, use a fallback unit name
                    const altUnitName = `RESTORED_${id}`;
                    await run(
                        "INSERT OR IGNORE INTO reports (id, region_id, year, unit_name) VALUES (?, ?, ?, ?)",
                        [id, regionId, year, altUnitName]
                    );
                    console.log(`  [COLLISION FIX] Restored report ${id} as ${altUnitName} (Region: ${regionId}, Year: ${year})`);
                } else {
                    console.error(`  [FAILED] Report ${id}: ${err.message}`);
                }
            }
        }

        const finalCount = await get("SELECT COUNT(*) as count FROM reports");
        console.log(`DONE: Total reports now: ${finalCount.count}`);

        // Also cleanup unit_name for any that were restored as empty but might have better info elsewhere?
        // For now, this is enough to restore the list and detail views.
    } catch (err) {
        console.error('RECOVERY FATAL ERROR:', err);
    } finally {
        db.close();
    }
}

recover();
