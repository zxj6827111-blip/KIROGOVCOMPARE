
import fs from 'fs';
import path from 'path';
import pool from '../src/config/database-llm';

async function applyFix() {
    try {
        const sqlPath = path.join(__dirname, '../migrations/postgres/014_gov_insight_view.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Applying refined view update from:', sqlPath);

        await pool.query(sql);

        console.log('Successfully updated gov_open_annual_stats view with level-based logic.');
        process.exit(0);
    } catch (err) {
        console.error('Failed to apply fix:', err);
        process.exit(1);
    }
}

applyFix();
