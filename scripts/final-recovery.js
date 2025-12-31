const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const db = new sqlite3.Database(dbPath);

console.log('FINAL RECOVERY START: Reconstructing missing reports');

db.serialize(() => {
    // 1. Get regions for mapping
    db.all("SELECT id, name FROM regions", (err, regions) => {
        if (err) {
            console.error('Failed to read regions:', err);
            process.exit(1);
        }
        const regionMap = {};
        for (const r of regions) regionMap[r.name] = r.id;

        // 2. Find ALL unique report_ids in versions and jobs
        db.all(`
      SELECT DISTINCT report_id FROM report_versions
      UNION
      SELECT DISTINCT report_id FROM jobs
    `, (err, rows) => {
            if (err) {
                console.error('Failed to read report_ids:', err);
                process.exit(1);
            }
            const referencedIds = rows.map(r => r.report_id);
            console.log(`Found ${referencedIds.length} referenced report IDs`);

            // 3. For each ID, check if it exists in reports
            db.all("SELECT id FROM reports", (err, existingRows) => {
                const existingIds = new Set(existingRows.map(r => r.id));
                const missingIds = referencedIds.filter(id => !existingIds.has(id));
                console.log(`Missing ${missingIds.length} reports: ${missingIds.join(', ')}`);

                if (missingIds.length === 0) {
                    console.log('No reports missing. Restoration complete.');
                    db.close();
                    return;
                }

                // 4. Restore missing IDs
                for (const id of missingIds) {
                    // Get metadata from versions for this ID
                    db.get("SELECT storage_path, file_name FROM report_versions WHERE report_id = ? LIMIT 1", [id], (err, v) => {
                        let regionId = 1; // Default
                        let year = 2023; // Default
                        let unitName = '';

                        if (v) {
                            // Extract year
                            const yearMatch = v.storage_path.match(/20\d{2}/);
                            if (yearMatch) year = parseInt(yearMatch[0]);

                            // Extract region
                            for (const name in regionMap) {
                                if (v.storage_path.includes(name) || v.file_name.includes(name)) {
                                    regionId = regionMap[name];
                                    break;
                                }
                            }

                            // Try to extract unitName from directory structure
                            // Example: data/uploads/79/2024/filename
                            // Wait, the path doesn't seem to have unitName usually in this project
                        }

                        db.run(
                            "INSERT OR IGNORE INTO reports (id, region_id, year, unit_name) VALUES (?, ?, ?, ?)",
                            [id, regionId, year, unitName],
                            (err) => {
                                if (err) console.error(`  Failed to restore report ${id}:`, err.message);
                                else console.log(`  Restored report ${id} (Region: ${regionId}, Year: ${year})`);
                            }
                        );
                    });
                }

                // Final Verify
                setTimeout(() => {
                    db.get("SELECT COUNT(*) as count FROM reports", (err, row) => {
                        console.log(`FINAL RECOVERY DONE: Total reports in DB: ${row.count}`);
                        db.close();
                    });
                }, 5000);
            });
        });
    });
});
