
import pool from '../config/database-llm';
async function inspectFacts() {
    const res = await pool.query(`SELECT * FROM fact_application WHERE version_id = 3553`);
    console.table(res.rows);
    await pool.end();
}
inspectFacts();
