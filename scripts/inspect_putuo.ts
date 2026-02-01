
import pool from '../src/config/database-llm';

async function inspect() {
    try {
        console.log('Searching for Putuo District...');
        const regionRes = await pool.query(`SELECT * FROM regions WHERE name = '普陀区'`); // Name from previous output

        if (regionRes.rows.length === 0) {
            console.log('Region not found.');
            return;
        }

        const region = regionRes.rows[0];
        console.log('Found region:', region.name, region.id);

        console.log('Fetching reports...');
        const reportRes = await pool.query(`
            SELECT r.*, rv.parsed_json, rv.raw_text
            FROM reports r 
            LEFT JOIN report_versions rv ON rv.id = r.active_version_id
            WHERE r.region_id = $1
            ORDER BY r.year DESC
        `, [region.id]);

        console.log(`Found ${reportRes.rows.length} reports.`);

        for (const report of reportRes.rows) {
            const isJsonEmpty = !report.active_version_id ||
                !report.parsed_json ||
                (typeof report.parsed_json === 'object' && Object.keys(report.parsed_json).length === 0);

            const isTextEmpty = !report.raw_text || report.raw_text.trim().length < 100;

            console.log(`Year: ${report.year}, ID: ${report.id}, Version: ${report.active_version_id || 'NULL'}, JSON Empty: ${isJsonEmpty}, Text Empty: ${isTextEmpty}`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
