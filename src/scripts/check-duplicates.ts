
import pool from '../config/database-llm';
async function checkDuplicates() {
    const res = await pool.query(
        `SELECT region_id, count(id) as cnt, array_agg(id) as duplicates 
         FROM reports 
         WHERE year = 2024 AND region_id IN (775, 782, 780, 781)
         GROUP BY region_id`
    );
    console.table(res.rows);
    await pool.end();
}
checkDuplicates();
