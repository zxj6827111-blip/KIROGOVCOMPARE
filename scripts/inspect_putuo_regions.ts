
import pool from '../src/config/database-llm';

async function inspect() {
    try {
        console.log('Searching for regions like Putuo...');
        const regions = await pool.query(`SELECT * FROM regions WHERE name LIKE '%普陀%'`);
        console.log(`Found ${regions.rows.length} regions.`);
        regions.rows.forEach(r => console.log(`ID: ${r.id}, Name: ${r.name}, Province: ${r.province}`));

        // Assuming user meant the one with reports
        for (const region of regions.rows) {
            console.log(`Checking reports for region ${region.name} (${region.id})...`);
            const reportRes = await pool.query(`SELECT * FROM reports WHERE region_id = $1`, [region.id]);
            console.log(`Count: ${reportRes.rows.length}`);
            reportRes.rows.forEach(r => console.log(` - Year: ${r.year}, ID: ${r.id}`));
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
