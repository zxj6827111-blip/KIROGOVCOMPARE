
import pool from '../src/config/database-llm';

async function inspect() {
    try {
        console.log('Searching for Nanjing City...');
        const regionRes = await pool.query(`SELECT * FROM regions WHERE name = '南京市'`);

        if (regionRes.rows.length === 0) {
            console.log('Region not found.');
            return;
        }

        const region = regionRes.rows[0];
        console.log('Found region:', region.name, region.id);

        console.log('Fetching 2024 report...');
        const reportRes = await pool.query(`
            SELECT r.id, r.year, rv.id as version_id, rv.raw_text, rv.parsed_json
            FROM reports r 
            LEFT JOIN report_versions rv ON rv.id = r.active_version_id
            WHERE r.region_id = $1 AND r.year = 2024
        `, [region.id]);

        if (reportRes.rows.length === 0) {
            console.log('No 2024 report found.');
            return;
        }

        const report = reportRes.rows[0];
        console.log(`Report ID: ${report.id}, Version ID: ${report.version_id}`);

        const rawText = report.raw_text;
        const rawTextLen = rawText ? rawText.length : 0;
        console.log(`raw_text length: ${rawTextLen}`);
        if (rawTextLen < 200) {
            console.log(`raw_text content: "${rawText}"`);
        }

        const parsed = typeof report.parsed_json === 'string' ? JSON.parse(report.parsed_json) : report.parsed_json;
        console.log('Parsed JSON sections count:', parsed?.sections?.length || 0);

        // Check text content in sections
        let sectionsTextLen = 0;
        if (parsed?.sections) {
            parsed.sections.forEach((s: any, idx: number) => {
                if (s.title) console.log(`Section ${idx} Title: ${s.title}`);
                if (s.content) {
                    sectionsTextLen += s.content.length;
                    if (s.content.length > 0) {
                        console.log(`Section ${idx} Content (first 50 chars): ${s.content.substring(0, 50)}...`);
                    }
                }
            });
        }
        console.log(`Total text length in sections: ${sectionsTextLen}`);

        // Re-evaluate Logic
        const isTextEmpty = !rawText || rawText.trim().length < 100;
        console.log(`Current Logic (raw_text < 100): isTextEmpty = ${isTextEmpty}`);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspect();
