
import pool from '../config/database-llm';

async function checkSchema() {
    try {
        console.log('--- Table Schema Check ---');

        const resReports = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'reports'
        `);
        console.log('Reports Table Columns:', resReports.rows.map(r => r.column_name));

        const resVersions = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'report_versions'
        `);
        console.log('Report Versions Table Columns:', resVersions.rows.map(r => r.column_name));

        // Also dump EVERYTHING for Region 819 (Huaian District)
        console.log('\n--- Dumping ALL reports for Region 819 ---');
        const dump = await pool.query(`SELECT * FROM reports WHERE region_id = 819`);
        console.log(JSON.stringify(dump.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkSchema();
