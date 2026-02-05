
import pool from '../config/database-llm';

async function findTheReport() {
    try {
        console.log('--- Searching for the specific report ---');
        // Search by filename or text content for the specific title seen in screenshot
        const searchTerm = '%2024年度 淮阴区人民政府政务公开年报%'; // based on screenshot

        const query = `
            SELECT r.id as report_id, r.region_id, r.year, rv.file_name, rv.raw_text, reg.name as linked_region_name
            FROM reports r
            JOIN report_versions rv ON r.active_version_id = rv.id
            LEFT JOIN regions reg ON r.region_id = reg.id
            WHERE rv.file_name LIKE $1 OR rv.raw_text LIKE $1
        `;

        const res = await pool.query(query, [`%淮阴区%`]); // Broaden search
        console.log(`Found ${res.rows.length} matches for broad search.`);

        for (const row of res.rows) {
            // Filter more strictly in JS if needed, or just look at all matches
            if (row.year === 2024 || (row.year === 2023)) { // Check recent years
                console.log(`Report ID: ${row.report_id}, Region ID: ${row.region_id}, Region Name: ${row.linked_region_name}, Year: ${row.year}, File: ${row.file_name}`);
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

findTheReport();
