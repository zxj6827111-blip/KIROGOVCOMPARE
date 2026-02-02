
import pool from '../config/database-llm';

async function debugRegions() {
    try {
        console.log('--- Debugging Regions: 淮阴区 (Huaian District) & 金湖县 (Jinhu County) ---');

        // Check Regions
        const regionQuery = `SELECT id, name, level, parent_id, code FROM regions WHERE name LIKE '%淮阴%' OR name LIKE '%金湖%'`;
        const regionRes = await pool.query(regionQuery);
        console.log('Found Regions:', JSON.stringify(regionRes.rows, null, 2));

        if (regionRes.rows.length === 0) {
            console.log('No regions found!');
            return;
        }

        const regionIds = regionRes.rows.map(r => r.id);
        console.log('Region IDs to check:', regionIds);

        // Check Reports for these regions (Year 2024)
        const reportQuery = `
            SELECT id, region_id, year, active_version_id, created_at
            FROM reports 
            WHERE region_id = ANY($1::int[]) AND year = 2024
        `;
        const reportRes = await pool.query(reportQuery, [regionIds]);
        console.log('Found Reports (2024):', JSON.stringify(reportRes.rows, null, 2));

    } catch (err) {
        console.error('Error:', err);
    } finally {
        await pool.end();
    }
}

debugRegions();
