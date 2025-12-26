const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, '../data/llm_ingestion.db'); // Checking standard path first.
// The logs said "D:\软件开发\谷歌反重力开发\KIROGOVCOMPARE\data\llm_ingestion.db"
const dbPath2 = path.resolve(__dirname, '../data/llm_ingestion.db');

let db = new sqlite3.Database(dbPath2, (err) => {
    if (err) {
        console.error('Could not connect to llm_ingestion.db:', err.message);
        const dbPath = path.resolve(__dirname, '../data/local_database.sqlite');
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) console.error('Could not connect to local_database.sqlite:', err.message);
            else runQuery();
        });
    } else {
        runQuery();
    }
});

function runQuery() {
    console.log('Connected to database.');

    // Check comparisons table
    db.all("PRAGMA table_info(comparisons)", [], (err, rows) => {
        if (err) throw err;
        console.log('Columns in comparisons table:');
        rows.forEach((row) => console.log(row));

        // Check report_versions
        db.all("PRAGMA table_info(report_versions)", [], (err, rows) => {
            if (err) console.error(err);
            console.log('Columns in report_versions table:');
            rows.forEach(r => console.log(r));

            // Get one json
            db.get("SELECT parsed_json FROM report_versions WHERE parsed_json IS NOT NULL LIMIT 1", [], (err, row) => {
                if (row) {
                    console.log('Sample parsed_json snippet:', row.parsed_json.substring(0, 500));
                }
                // Check reports table
                db.all("PRAGMA table_info(reports)", [], (err, rows) => {
                    if (err) console.error(err);
                    console.log('Columns in reports table:');
                    rows.forEach(r => console.log(r));
                });
            });
        });
    });
}
