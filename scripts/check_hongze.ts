
import pool from '../src/config/database-llm';

async function checkHongze() {
    try {
        const res = await pool.query("SELECT * FROM regions WHERE name LIKE '%洪泽区%' OR name LIKE '%金湖县%'");
        console.table(res.rows);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkHongze();
