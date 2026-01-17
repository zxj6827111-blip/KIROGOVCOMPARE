
import pool from '../src/config/database-llm';

async function checkHierarchy() {
    try {
        // 1. Get Huaian City (Parent)
        console.log('--- Huaian City ---');
        const huaian = await pool.query("SELECT id, name, level, parent_id FROM regions WHERE name LIKE '%淮安市%'");
        console.table(huaian.rows);
        const huaianId = huaian.rows[0]?.id;

        if (huaianId) {
            // 2. Get Children of Huaian (Districts)
            console.log(`--- Children of Huaian (${huaianId}) ---`);
            const districts = await pool.query("SELECT id, name, level, parent_id FROM regions WHERE parent_id = $1 LIMIT 5", [huaianId]);
            console.table(districts.rows);

            // 3. Get Children of a District (e.g., Jinhu or one of the above)
            if (districts.rows.length > 0) {
                const districtId = districts.rows[0].id;
                console.log(`--- Children of District (${districtId}) ---`);
                const depts = await pool.query("SELECT id, name, level, parent_id FROM regions WHERE parent_id = $1 LIMIT 5", [districtId]);
                console.table(depts.rows);
            }
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

checkHierarchy();
