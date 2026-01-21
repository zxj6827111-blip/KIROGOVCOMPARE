
import pool from './src/config/database-llm';
import dotenv from 'dotenv';
dotenv.config();

async function inspectAllFacts() {
    try {
        // 1. Find Huaian 2024 Report
        const reportRes = await pool.query(`
      SELECT r.id, r.year, r.active_version_id, reg.name 
      FROM reports r 
      JOIN regions reg ON r.region_id = reg.id 
      WHERE reg.name LIKE '%淮安%' AND r.year = 2024
    `);

        if (reportRes.rows.length === 0) {
            console.log('No report found for Huaian 2024');
            return;
        }

        const report = reportRes.rows[0];
        console.log('Report found:', report);

        if (!report.active_version_id) {
            console.log('No active version for this report.');
            return;
        }

        // 2. Dump all facts
        const factsRes = await pool.query(`
      SELECT applicant_type, response_type, count 
      FROM fact_application 
      WHERE version_id = $1
    `, [report.active_version_id]);

        console.log('All Fact Rows:', factsRes.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspectAllFacts();
