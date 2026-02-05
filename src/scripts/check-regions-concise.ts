
import pool from '../config/database-llm';

async function checkSpecificRegions() {
    try {
        const names = ['淮阴区', '金湖县'];

        for (const name of names) {
            console.log(`\n--- Checking: ${name} ---`);
            const regionRes = await pool.query(`SELECT id, name, parent_id FROM regions WHERE name = $1`, [name]);

            if (regionRes.rows.length === 0) {
                console.log(`Region '${name}' NOT FOUND.`);
                continue;
            }

            for (const region of regionRes.rows) {
                console.log(`Region Found: ID=${region.id}, Name=${region.name}, ParentID=${region.parent_id}`);

                const reportRes = await pool.query(
                    `SELECT id, year, active_version_id, region_id FROM reports WHERE region_id = $1 AND year = 2024`,
                    [region.id]
                );

                console.log(`Reports for Region ${region.id} (2024): Found ${reportRes.rows.length}`);
                if (reportRes.rows.length > 0) {
                    console.log(JSON.stringify(reportRes.rows, null, 2));
                }
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkSpecificRegions();
