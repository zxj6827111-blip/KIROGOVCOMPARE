
import pool from '../src/config/database-llm';

async function verify() {
    try {
        console.log('--- Verifying Level 3 (District) ---');
        // Check Shuyang (3411) -> Parent Suqian (3356)
        const l3 = await pool.query("SELECT org_id, org_type, parent_id FROM gov_open_annual_stats WHERE org_id = 'city_3411' OR org_id = 'district_3411'");
        console.log('Shuyang (3411):', l3.rows[0]);

        // Check Hongze (3460)
        const hongze = await pool.query("SELECT org_id, org_type, parent_id FROM gov_open_annual_stats WHERE org_id = 'city_3460' OR org_id = 'district_3460'");
        console.log('Hongze (3460):', hongze.rows[0]);

        console.log('--- Verifying Level 4 (Dept/Street) ---');
        // Check Zhuba Street (4040) -> Parent Hongze (3460)
        // Should be type: district, id: district_4040, parent_id: district_3460
        const l4 = await pool.query("SELECT org_id, org_type, parent_id FROM gov_open_annual_stats WHERE org_id = 'district_4040'");
        console.log('Zhuba Street (4040):', l4.rows[0]);

        process.exit(0);
    } catch (err) {
        console.error('Verification failed:', err);
        process.exit(1);
    }
}

verify();
