
import pool from '../src/config/database-llm';

async function inspect() {
    try {
        console.log('Searching for Huaian Market Supervision Administration...');
        // Search by name and parent path if possible, or broad search
        const regions = await pool.query(`
            SELECT r.id, r.name, p.name as parent_name 
            FROM regions r
            LEFT JOIN regions p ON r.parent_id = p.id
            WHERE r.name LIKE '%市场监督管理局%' AND (p.name = '淮安市' OR r.name LIKE '%淮安市%')
        `);

        if (regions.rows.length === 0) {
            console.log('Region not found.');
            return;
        }

        console.log(`Found ${regions.rows.length} regions.`);
        regions.rows.forEach(r => console.log(`ID: ${r.id}, Name: ${r.name}, Parent: ${r.parent_name}`));

        // Assuming the first one or iterate all
        for (const region of regions.rows) {
            console.log(`\nChecking 2024 report for ${region.name} (${region.id})...`);
            const reportRes = await pool.query(`
                SELECT r.id, r.year, rv.id as version_id, rv.raw_text, rv.parsed_json
                FROM reports r 
                LEFT JOIN report_versions rv ON rv.id = r.active_version_id
                WHERE r.region_id = $1 AND r.year = 2024
            `, [region.id]);

            if (reportRes.rows.length === 0) {
                console.log('No 2024 report.');
                continue;
            }

            const report = reportRes.rows[0];
            const parsed = typeof report.parsed_json === 'string' ? JSON.parse(report.parsed_json) : report.parsed_json;

            const keys = parsed ? Object.keys(parsed) : [];
            console.log(`JSON Keys: ${keys.join(', ')}`);

            const sectionsLen = parsed?.sections?.length || 0;
            const tablesKeys = parsed?.tables ? Object.keys(parsed.tables).length : 0;
            console.log(`Sections count: ${sectionsLen}, Tables count: ${tablesKeys}`);

            const parsedTextLen = parsed?.sections ? parsed.sections.reduce((acc: number, s: any) => acc + (s.content?.length || 0), 0) : 0;
            console.log(`Total Parsed Text Length: ${parsedTextLen}`);
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
