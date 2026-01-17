
import dotenv from 'dotenv';
import path from 'path';
import pool from '../src/config/database-llm';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function inspect() {
    const client = await pool.connect();
    try {
        // Fetch the most recent 5 reports with active versions
        const res = await client.query(`
      SELECT r.id, r.unit_name, r.year, rv.parsed_json
      FROM reports r
      JOIN report_versions rv ON rv.id = r.active_version_id
      WHERE r.active_version_id IS NOT NULL
      ORDER BY r.id DESC
      LIMIT 5
    `);

        console.log(`Checking ${res.rows.length} reports...`);

        for (const row of res.rows) {
            console.log(`\nReport ID: ${row.id} - ${row.unit_name} (${row.year})`);
            const json = typeof row.parsed_json === 'string' ? JSON.parse(row.parsed_json) : row.parsed_json;

            // Check for table_4 or reviewLitigationData
            const table4Section = json.sections?.find((s: any) => s.type === 'table_4');
            const directData = json.reviewLitigationData;

            console.log('--- Structure Check ---');
            if (table4Section) {
                console.log('Found section[type="table_4"]:');
                console.log(JSON.stringify(table4Section, null, 2).slice(0, 500) + '...');
            } else {
                console.log('Section[type="table_4"] NOT found.');
            }

            if (directData) {
                console.log('Found root.reviewLitigationData:');
                console.log(JSON.stringify(directData, null, 2).slice(0, 500) + '...');
            } else {
                console.log('root.reviewLitigationData NOT found.');
            }

            // Also check table_2 for contrast (active disclosure usually works?)
            // const table2 = json.sections?.find((s: any) => s.type === 'table_2');
            // console.log('Has Table 2:', !!table2);
        }

    } catch (err) {
        console.error(err);
    } finally {
        client.release();
        setTimeout(() => process.exit(0), 1000);
    }
}

inspect();
