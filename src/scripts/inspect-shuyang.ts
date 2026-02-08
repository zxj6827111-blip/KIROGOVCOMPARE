
import pool from '../config/database-llm';

async function inspectShuyang() {
    try {
        console.log('--- Inspecting Shuyang (775) ---');

        const res = await pool.query(
            `SELECT rv.id, rv.created_at, rv.state, rv.is_active, length(rv.parsed_json::text)
             FROM report_versions rv
             JOIN reports r ON rv.report_id = r.id
             WHERE r.region_id = 775 AND r.year = 2024
             ORDER BY rv.created_at DESC`
        );
        console.table(res.rows);

        if (res.rows.length > 0) {
            const v = res.rows[0];
            const jsonRes = await pool.query(`SELECT parsed_json FROM report_versions WHERE id = $1`, [v.id]);
            const json = jsonRes.rows[0].parsed_json;
            console.log(`Version ${v.id} JSON:`, JSON.stringify(json).slice(0, 200));
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspectShuyang();
