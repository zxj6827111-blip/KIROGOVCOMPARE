
import pool from './src/config/database-llm';
import dotenv from 'dotenv';
dotenv.config();

async function checkViewData() {
    try {
        const res = await pool.query(`
      SELECT 
        outcome_unable,
        outcome_not_open,
        outcome_ignore,
        outcome_unable_no_info -- Check if detail is also there
      FROM gov_open_annual_stats 
      WHERE org_name LIKE '%淮安%' AND year = 2024
    `);

        console.log('Aggregated View Data for Huaian 2024:', res.rows);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkViewData();
