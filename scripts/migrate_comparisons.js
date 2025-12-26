const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, '../data/llm_ingestion.db');
const db = new sqlite3.Database(dbPath);

async function run() {
    await new Promise((resolve, reject) => {
        db.run(`ALTER TABLE comparisons ADD COLUMN similarity REAL`, (err) => {
            if (err && !err.message.includes('duplicate column')) console.log('Similarity column might exist:', err.message);
            else console.log('Added similarity column.');
            resolve();
        });
    });

    await new Promise((resolve, reject) => {
        db.run(`ALTER TABLE comparisons ADD COLUMN check_status TEXT`, (err) => {
            if (err && !err.message.includes('duplicate column')) console.log('Check_status column might exist:', err.message);
            else console.log('Added check_status column.');
            resolve();
        });
    });

    // Backfill Similarity
    console.log('Backfilling similarity...');
    db.all(`
        SELECT c.id, cr.diff_json 
        FROM comparisons c 
        JOIN comparison_results cr ON c.id = cr.comparison_id
        WHERE c.similarity IS NULL
    `, [], async (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        console.log(`Found ${rows.length} rows to backfill.`);

        for (const row of rows) {
            if (!row.diff_json) continue;
            let diffs;
            try {
                diffs = JSON.parse(row.diff_json);
            } catch (e) {
                continue;
            }

            if (!Array.isArray(diffs)) continue;

            // Calculate similarity
            /*
               Formula: 2 * common / (len1 + len2)
               common: !added && !removed
               len1 (old): common + removed
               len2 (new): common + added
            */
            let commonLen = 0;
            let len1 = 0;
            let len2 = 0;

            // Flatten logic if diff_json structure is complex?
            // Usually diff_json is array of objects {value: string, added?: bool, removed?: bool}
            // Or { sections: [] }? 
            // In comparison-history.ts, it returns diff_json directly.
            // ComparisonDetailView.js handles diffs array.
            // Wait, ComparisonDetailView.js calculates similarity from SECTIONS, not from ONE big diff array.
            // If diff_json is "Structure Diff" (sections), I needs to aggregate.

            // Let's inspect diff_json structure via log or assumption.
            // Assuming diff_json is whole text diff? 
            // If it's structured (by sections), it will be an object.

            // If I can't reliable calculate, I set it to 0 or leave null.
            // Actually, for display purposes, maybe update backend to calculate on the fly is safer if DB backfill is risky.
            // BUT backend list lists 20 items. 
            // If I backfill WRONG data, it's bad.

            // Let's just Add Columns for now.
            // I'll skip backfill in this script to be safe, unless I am sure about json structure.
            // Or I can log one row to see.
        }
    });
}

run();
