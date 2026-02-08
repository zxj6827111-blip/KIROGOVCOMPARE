
import pool from '../config/database-llm';

async function checkFilenames() {
    try {
        const res = await pool.query(
            `SELECT r.id, r.year, r.region_id, reg.name, rv.file_name 
             FROM reports r 
             JOIN regions reg ON r.region_id = reg.id 
             JOIN report_versions rv ON r.active_version_id = rv.id 
             WHERE r.region_id IN (782, 780, 775) AND r.year = 2024`
        );
        console.table(res.rows);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkFilenames();
