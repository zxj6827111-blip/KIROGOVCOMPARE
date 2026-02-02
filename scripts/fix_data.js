const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: 'gov_report_diff',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function checkAndFix() {
    try {
        console.log('Cleaning up misplaced report 186...');

        // 1. Break circular dependency
        await pool.query('UPDATE reports SET active_version_id = NULL WHERE id = 186');
        console.log('Cleared active_version_id for report 186');

        const versionRes = await pool.query('SELECT id FROM report_versions WHERE report_id = 186');
        const vIds = versionRes.rows.map(r => r.id);
        console.log('Versions to delete:', vIds);

        if (vIds.length > 0) {
            const tables = [
                'report_consistency_items',
                'cells',
                'fact_active_disclosure',
                'fact_application',
                'fact_legal_proceeding',
                'fact_fee_mgmt',
                'fact_supervision',
                'fact_platform',
                'notifications',
                'comparison_jobs',
                'comparison_results'
            ];

            for (const t of tables) {
                try {
                    await pool.query(`DELETE FROM ${t} WHERE version_id = ANY($1::int[])`, [vIds]);
                } catch (e) {
                    try {
                        await pool.query(`DELETE FROM ${t} WHERE report_version_id = ANY($1::int[])`, [vIds]);
                    } catch (e2) { }
                    try {
                        await pool.query(`DELETE FROM ${t} WHERE related_version_id = ANY($1::int[])`, [vIds]);
                    } catch (e3) { }
                }
            }

            await pool.query('DELETE FROM report_versions WHERE id = ANY($1::int[])', [vIds]);
        }

        await pool.query('DELETE FROM reports WHERE id = 186');
        console.log('Successfully deleted report 186.');

    } catch (err) {
        console.error(err);
    } finally {
        pool.end();
    }
}

checkAndFix();
