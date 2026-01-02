const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const db = new sqlite3.Database(dbPath);

console.log('Searching for report: 宿迁市年政府信息公开工作年度报告-宿迁市');

db.serialize(() => {
    // Search in reports table
    db.all("SELECT * FROM reports WHERE unit_name LIKE '%宿迁市%'", (err, rows) => {
        if (err) {
            console.error('Error querying reports:', err);
            return;
        }
        console.log('\n--- Reports found ---');
        console.log(rows);
    });

    // Search in jobs table for failures
    db.all("SELECT * FROM jobs ORDER BY id DESC LIMIT 10", (err, rows) => {
        if (err) {
            console.error('Error querying jobs:', err);
            return;
        }
        console.log('\n--- Recent Jobs ---');
        rows.forEach(row => {
            console.log(`ID: ${row.id}, Type: ${row.type}, Status: ${row.status}, Error: ${row.error ? row.error.substring(0, 100) : 'None'}`);
        });
    });

    // Search in report_versions
    db.all("SELECT * FROM report_versions WHERE file_name LIKE '%宿迁市%'", (err, rows) => {
        if (err) {
            console.error('Error querying report_versions:', err);
            return;
        }
        console.log('\n--- Report Versions found ---');
        console.log(rows);
    });
});

setTimeout(() => db.close(), 2000);
