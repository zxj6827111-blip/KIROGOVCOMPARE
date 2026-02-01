
import pool from '../src/config/database-llm';

async function inspect() {
    try {
        console.log('Searching for region...');
        const regionRes = await pool.query(`SELECT * FROM regions WHERE name = '沭阳县人民政府办公室'`); // Exact match based on user screenshot

        if (regionRes.rows.length === 0) {
            console.log('Region not found. Trying partial...');
            const regionPartial = await pool.query(`SELECT * FROM regions WHERE name LIKE '%沭阳%'`);
            console.log('Partial matches:', regionPartial.rows.map(r => r.name));
            return;
        }

        const region = regionRes.rows[0];
        console.log('Found region:', region);

        console.log('Fetching 2024 report...');
        const reportRes = await pool.query(`
            SELECT r.*, rv.parsed_json, rv.raw_text 
            FROM reports r 
            LEFT JOIN report_versions rv ON rv.id = r.active_version_id
            WHERE r.region_id = $1 AND r.year = 2024
        `, [region.id]);

        if (reportRes.rows.length === 0) {
            console.log('No report found for 2024.');
        } else {
            const report = reportRes.rows[0];
            console.log('Report found!');
            console.log('ID:', report.id);
            console.log('Active Version ID:', report.active_version_id);

            console.log('Parsed JSON Type:', typeof report.parsed_json);
            console.log('Parsed JSON Keys:', report.parsed_json ? Object.keys(report.parsed_json) : 'null');
            console.log('Parsed JSON Stringified (first 200 chars):', JSON.stringify(report.parsed_json).substring(0, 200));

            console.log('Raw Text Length:', report.raw_text ? report.raw_text.length : 'null');
            console.log('Raw Text (first 100 chars):', report.raw_text ? report.raw_text.substring(0, 100) : 'null');

            // Replicate logic
            const isJsonEmpty = !report.active_version_id ||
                !report.parsed_json ||
                (typeof report.parsed_json === 'object' && Object.keys(report.parsed_json).length === 0);

            const isTextEmpty = !report.raw_text || report.raw_text.trim().length < 100;

            console.log('Logic Check:');
            console.log('isJsonEmpty:', isJsonEmpty);
            console.log('isTextEmpty:', isTextEmpty);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
