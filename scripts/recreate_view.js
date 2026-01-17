const db = require('better-sqlite3')('data/llm_ingestion.db');
const fs = require('fs');

const viewSql = fs.readFileSync('migrations/sqlite/017_gov_insight_view.sql', 'utf8');
console.log('Executing view recreation...');
db.exec(viewSql);
console.log('View recreated successfully!');

// Verify
const sample = db.prepare('SELECT DISTINCT org_id, parent_id FROM gov_open_annual_stats LIMIT 5').all();
console.log('Sample data:', JSON.stringify(sample, null, 2));
