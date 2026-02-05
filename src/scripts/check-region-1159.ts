
import pool from '../config/database-llm';

async function checkRegion1159() {
    try {
        console.log('--- Checking Region 1159 ---');
        const res = await pool.query(`SELECT id, name, parent_id, level, code FROM regions WHERE id = 1159`);
        console.log(res.rows);

        console.log('--- Checking Parent of 1159 ---');
        if (res.rows.length > 0) {
            const parentRes = await pool.query(`SELECT id, name FROM regions WHERE id = $1`, [res.rows[0].parent_id]);
            console.log('Parent:', parentRes.rows);
        }

        console.log('--- Checking Region 819 (The one used in list) ---');
        const res819 = await pool.query(`SELECT id, name, parent_id, level, code FROM regions WHERE id = 819`);
        console.log(res819.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkRegion1159();
