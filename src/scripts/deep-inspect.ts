
import pool from '../config/database-llm';

async function deepInspect() {
    try {
        console.log('--- Deep Inspecting Yanghe & Suqian ETDZ ---');

        // 782: 洋河新区
        // 780: 宿迁经济技术开发区
        const targets = [782, 780];

        for (const regId of targets) {
            const regRes = await pool.query(`SELECT name FROM regions WHERE id = $1`, [regId]);
            console.log(`\n=== ${regRes.rows[0].name} (ID: ${regId}) ===`);

            // 1. Check ALL versions for 2024 reports
            const versionsRes = await pool.query(
                `SELECT rv.id, rv.report_id, rv.created_at, rv.state, rv.is_active, 
                        length(rv.parsed_json::text) as json_len,
                        rv.parsed_json
                 FROM report_versions rv
                 JOIN reports r ON rv.report_id = r.id
                 WHERE r.region_id = $1 AND r.year = 2024
                 ORDER BY rv.created_at DESC`,
                [regId]
            );

            if (versionsRes.rows.length === 0) {
                console.log('  No 2024 versions found.');
            } else {
                console.log(`  Found ${versionsRes.rows.length} versions:`);
                for (const v of versionsRes.rows) {
                    const json = typeof v.parsed_json === 'string' ? JSON.parse(v.parsed_json) : v.parsed_json;
                    const appVal = json?.applications?.newReceived;
                    // Check deeply if applications exists in any form
                    const hasApp = json && json.applications;

                    console.log(`    Version ${v.id} (Report ${v.report_id}):`);
                    console.log(`      Active: ${v.is_active}, State: ${v.state}, Size: ${v.json_len}`);
                    console.log(`      applications.newReceived: ${appVal}`);
                    if (!hasApp && v.json_len > 10) {
                        console.log(`      JSON Keys: ${Object.keys(json).join(', ')}`);
                    }
                }
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

deepInspect();
