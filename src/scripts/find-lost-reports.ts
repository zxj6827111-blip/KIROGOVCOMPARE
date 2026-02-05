
import pool from '../config/database-llm';

async function findLostReports() {
    try {
        console.log('--- Searching for reports by content ---');

        // Find reports where the text mentions Huaian District or Jinhu County in 2024
        // Note: Joining report_versions
        const query = `
            SELECT r.id as report_id, r.region_id, r.year, reg.name as region_name, substring(rv.raw_text from 1 for 50) as snippet
            FROM reports r
            JOIN report_versions rv ON r.active_version_id = rv.id
            LEFT JOIN regions reg ON r.region_id = reg.id
            WHERE r.year = 2024
            AND (rv.raw_text LIKE '%淮阴区%' OR rv.raw_text LIKE '%金湖县%')
        `;

        const res = await pool.query(query);
        console.log(`Found ${res.rows.length} reports with matching text.`);
        console.log(JSON.stringify(res.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

findLostReports();
