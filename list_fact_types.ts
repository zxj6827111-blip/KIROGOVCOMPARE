
import pool from './src/config/database-llm';
import dotenv from 'dotenv';
dotenv.config();

async function listFactTypes() {
    try {
        const reportRes = await pool.query(`
      SELECT r.active_version_id 
      FROM reports r 
      JOIN regions reg ON r.region_id = reg.id 
      WHERE reg.name LIKE '%淮安%' AND r.year = 2024
    `);

        if (reportRes.rows.length === 0) return;
        const versionId = reportRes.rows[0].active_version_id;

        const res = await pool.query(`
      SELECT response_type, sum(count) as total_count 
      FROM fact_application 
      WHERE version_id = $1 
      GROUP BY response_type
      ORDER BY total_count DESC
    `, [versionId]);

        console.log('Fact Types & Counts:', res.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

listFactTypes();
