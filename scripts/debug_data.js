const { Pool } = require('pg');
require('dotenv').config();

// Manually override config just in case
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'gov_report_diff',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function checkData() {
    try {
        console.log('--- Checking Regions with name "市科学技术委员会" ---');
        // Find all regions with this name
        const res1 = await pool.query(`
      SELECT r.id, r.name, r.parent_id, p.name as parent_name 
      FROM regions r 
      LEFT JOIN regions p ON r.parent_id = p.id
      WHERE r.name = '市科学技术委员会'
    `);
        console.table(res1.rows);

        if (res1.rows.length > 0) {
            const ids = res1.rows.map(r => r.id);
            console.log('Region IDs:', ids);

            console.log('\n--- Checking Reports for these regions ---');
            const res2 = await pool.query(`
            SELECT id, region_id, unit_name, year 
            FROM reports 
            WHERE region_id = ANY($1::int[])
        `, [ids]);
            console.table(res2.rows);
        }

        console.log('\n--- Checking generic "市科学技术委员会" usage ---');
        // If there is a mix-up, maybe the report has the WRONG region_id
        // Let's find the report seen in the screenshot "淮安市科学技术局"
        console.log('Searching for report "淮安市科学技术局"...');
        const res4 = await pool.query(`
        SELECT r.id as report_id, r.region_id, r.unit_name, reg.name as region_name, p.name as parent_name, p.id as parent_id
        FROM reports r
        JOIN regions reg ON r.region_id = reg.id
        LEFT JOIN regions p ON reg.parent_id = p.id
        WHERE r.unit_name LIKE '%淮安市科学技术局%' OR r.unit_name LIKE '%市科学技术委员会%'
    `);
        console.table(res4.rows);

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

checkData();
