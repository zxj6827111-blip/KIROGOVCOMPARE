
import pool from '../src/config/database-llm';

async function check() {
    try {
        const res = await pool.query("SELECT * FROM regions WHERE id = 3411");
        console.log('Region 3411:', res.rows[0]);

        // Check if it has reports
        const reports = await pool.query("SELECT id FROM reports WHERE region_id = 3411");
        console.log('Reports for 3411:', reports.rows.length);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
