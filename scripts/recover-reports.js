const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const db = new sqlite3.Database(dbPath);

console.log('RECOVERY START: Attempting to reconstruct reports table');

db.serialize(() => {
    // 1. Create the reports table again
    db.run(`
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      region_id INTEGER NOT NULL REFERENCES regions(id),
      year INTEGER NOT NULL,
      unit_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(region_id, year, unit_name)
    )
  `);

    // 2. Recover from Comparisons table
    // comparisons has: id, region_id, year_a, year_b, left_report_id, right_report_id
    db.all("SELECT * FROM comparisons", (err, comparisons) => {
        if (err) {
            console.error('Failed to read comparisons:', err);
            return;
        }
        console.log(`Found ${comparisons.length} comparisons for recovery`);
        for (const c of comparisons) {
            // Re-insert left report
            db.run(
                "INSERT OR IGNORE INTO reports (id, region_id, year, unit_name) VALUES (?, ?, ?, ?)",
                [c.left_report_id, c.region_id, c.year_a, ''],
                (err) => { if (!err) console.log(`  Recovered report ${c.left_report_id} from comparison ${c.id}`); }
            );
            // Re-insert right report
            db.run(
                "INSERT OR IGNORE INTO reports (id, region_id, year, unit_name) VALUES (?, ?, ?, ?)",
                [c.right_report_id, c.region_id, c.year_b, ''],
                (err) => { if (!err) console.log(`  Recovered report ${c.right_report_id} from comparison ${c.id}`); }
            );
        }
    });

    // 3. Recover from report_versions storage paths
    // storage_path often looks like: uploads/region_name/year/filename
    db.all("SELECT * FROM report_versions", (err, versions) => {
        if (err) {
            console.error('Failed to read report_versions:', err);
            return;
        }
        console.log(`Found ${versions.length} versions for recovery`);

        // We also need region_id mapping. Let's get regions first.
        db.all("SELECT id, name FROM regions", (err, regions) => {
            if (err) return;

            const regionMap = {}; // name -> id
            for (const r of regions) regionMap[r.name] = r.id;

            for (const v of versions) {
                // Example path: "uploads/南京市/2023/report.pdf" or "uploads/2023/report.pdf"
                const parts = v.storage_path.split(/[\\/]/);
                let year = 2023; // fallback
                let regionId = 1; // fallback
                let unitName = '';

                // Try to find year in path
                const yearMatch = v.storage_path.match(/20\d{2}/);
                if (yearMatch) year = parseInt(yearMatch[0]);

                // Try to find region name in path
                for (const name in regionMap) {
                    if (v.storage_path.includes(name)) {
                        regionId = regionMap[name];
                        break;
                    }
                }

                // If we still didn't find region, maybe it's in filename?
                if (regionId === 1) {
                    for (const name in regionMap) {
                        if (v.file_name.includes(name)) {
                            regionId = regionMap[name];
                            break;
                        }
                    }
                }

                db.run(
                    "INSERT OR IGNORE INTO reports (id, region_id, year, unit_name) VALUES (?, ?, ?, ?)",
                    [v.report_id, regionId, year, unitName],
                    (err) => {
                        if (!err) {
                            console.log(`  Recovered report ${v.report_id} from version ${v.id} (Path: ${v.storage_path})`);
                        }
                    }
                );
            }
        });
    });

    // 4. Verification
    setTimeout(() => {
        db.get("SELECT COUNT(*) as count FROM reports", (err, row) => {
            console.log(`RECOVERY FINISHED: Reconstructed ${row?.count || 0} reports`);
            db.close();
        });
    }, 5000);
});
