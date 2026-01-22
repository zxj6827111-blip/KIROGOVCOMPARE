import pool from '../src/config/database-llm';

async function diagnose() {
    try {
        console.log('--- DIAGNOSIS START ---');

        // 1. Check reports with NO active_version_id
        const noActive = await pool.query(`
      SELECT count(*) as cnt FROM reports WHERE active_version_id IS NULL;
    `);
        console.log(`Reports with active_version_id IS NULL: ${noActive.rows[0].cnt}`);

        // 2. Check reports WITH active_version_id but "No Content" logic
        // Logic from routes/reports.ts:
        // must have parsed.sections array OR parsed.tables object OR basic_info/year/type
        const contentCheck = await pool.query(`
      SELECT 
        r.id, 
        r.unit_name, 
        r.year, 
        rv.id as version_id,
        (rv.parsed_json IS NULL) as is_json_null,
        (rv.parsed_json::text = '{}') as is_json_empty_obj
      FROM reports r
      JOIN report_versions rv ON r.active_version_id = rv.id
      LIMIT 20;
    `);

        let badContentCount = 0;
        for (const row of contentCheck.rows) {
            const parsed = row.is_json_null ? null : (row.is_json_empty_obj ? {} : {}); // approximations
            // We need to fetch actual JSON to really check, but let's check a sample of "bad" ones
        }

        // Let's just fetch detailed info for the reports the user mentioned:
        // "2023年沭阳县人民政府政务公开年报" (approx match)
        // "2024年市工业和信息化局政务公开年报"

        const specificReports = await pool.query(`
      SELECT r.id, r.unit_name, r.year, r.active_version_id
      FROM reports r
      WHERE r.year IN (2023, 2024) 
      AND (r.unit_name LIKE '%沭阳%' OR r.unit_name LIKE '%工业和信息化%')
    `);

        console.log('\n--- Specific Reports Check ---');
        for (const r of specificReports.rows) {
            console.log(`Report [${r.id}] ${r.year} ${r.unit_name}: active_version_id=${r.active_version_id}`);

            if (r.active_version_id) {
                const vRes = await pool.query(`SELECT id, parsed_json FROM report_versions WHERE id = $1`, [r.active_version_id]);
                const v = vRes.rows[0];
                const jsonStr = JSON.stringify(v.parsed_json || '').slice(0, 200);
                console.log(`  Version ${v.id}: parsed_json prefix: ${jsonStr}...`);
            } else {
                // Try to find ANY version
                const anyV = await pool.query(`SELECT id, created_at FROM report_versions WHERE report_id = $1 ORDER BY created_at DESC`, [r.id]);
                console.log(`  No active version. Available versions: ${anyV.rows.map(x => x.id).join(', ')}`);
            }
        }

        console.log('--- DIAGNOSIS END ---');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

diagnose();
