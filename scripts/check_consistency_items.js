const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '../data/llm_ingestion.db');
const db = new sqlite3.Database(dbPath);

console.log('Querying recent consistency check items...');

db.all(`
    SELECT 
        id, 
        check_key,
        title, 
        auto_status, 
        left_value,
        right_value,
        delta, 
        evidence_json,
        updated_at
    FROM report_consistency_items 
    WHERE updated_at > datetime('now', '-30 minutes')
    ORDER BY updated_at DESC
    LIMIT 50
`, [], (err, rows) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log(`Found ${rows.length} items.`);
    rows.forEach(row => {
        console.log(`[${row.auto_status}] ${row.title}`);
        console.log(`   Expr: ${row.check_key}`);
        console.log(`   Values: L=${row.left_value}, R=${row.right_value}, D=${row.delta}`);
        // console.log(`   Evidence: ${row.evidence_json}`);
        console.log('-----------------------------------');
    });
    db.close();
});
