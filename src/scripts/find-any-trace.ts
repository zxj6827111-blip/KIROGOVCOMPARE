
import pool from '../config/database-llm';

async function findTrace() {
    try {
        console.log('--- Searching report_versions directly ---');
        // Search for the specific title seen in screenshot
        const searchTerm = '%淮阴区人民政府%';

        const query = `
            SELECT id, report_id, file_name, created_at 
            FROM report_versions 
            WHERE file_name LIKE $1
        `;

        const res = await pool.query(query, [searchTerm]);
        console.log(`Found ${res.rows.length} versions matching '${searchTerm}'.`);

        for (const rv of res.rows) {
            console.log(`Version ID: ${rv.id}, Report ID: ${rv.report_id}, File: ${rv.file_name}`);

            // Check the report it belongs to
            if (rv.report_id) {
                const repRes = await pool.query(`SELECT * FROM reports WHERE id = $1`, [rv.report_id]);
                if (repRes.rows.length > 0) {
                    console.log(` -> Linked Report: ID=${repRes.rows[0].id}, RegionID=${repRes.rows[0].region_id}, Year=${repRes.rows[0].year}`);
                } else {
                    console.log(` -> Linked Report ID ${rv.report_id} NOT FOUND in reports table.`);
                }
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

findTrace();
