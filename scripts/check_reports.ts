
import pool from '../src/config/database-llm';

async function check() {
    try {
        const res = await pool.query("SELECT id FROM reports WHERE region_id = 4040");
        console.log('Reports for 4040:', res.rows.length);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
