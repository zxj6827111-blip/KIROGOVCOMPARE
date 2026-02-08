
import pool from '../config/database-llm';

async function diagnoseShuyang() {
    try {
        console.log('--- Diagnosing Shuyang (775) ---');

        // 1. Check Metrics
        const metricRes = await pool.query(
            `SELECT * FROM derived_region_year_metrics WHERE region_id = 775 AND year = 2024`
        );
        console.log('Metrics:', metricRes.rows[0]);

        // 2. Check Reports
        const reportsRes = await pool.query(
            `SELECT id, active_version_id FROM reports WHERE region_id = 775 AND year = 2024`
        );
        console.log('Reports:', reportsRes.rows);

        if (reportsRes.rows.length > 0) {
            const rid = reportsRes.rows[0].id;
            const vid = reportsRes.rows[0].active_version_id;

            // 3. Check Version & Facts
            if (vid) {
                const factRes = await pool.query(
                    `SELECT count(*) as total, 
                           sum(case when response_type='new_received' then count else 0 end) as new_received_sum
                    FROM fact_application WHERE version_id = $1`,
                    [vid]
                );
                console.log(`Version ${vid} Facts:`, factRes.rows[0]);

                // 4. Check JSON
                const jsonRes = await pool.query(`SELECT parsed_json FROM report_versions WHERE id = $1`, [vid]);
                const json = jsonRes.rows[0].parsed_json;
                const parsed = typeof json === 'string' ? JSON.parse(json) : json;
                console.log('JSON tableData.total:', parsed?.tableData?.total);
            }
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

diagnoseShuyang();
