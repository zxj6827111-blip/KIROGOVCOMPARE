
import pool from '../config/database-llm';

async function inspectSuqianETDZContent() {
    try {
        console.log('--- Inspecting Suqian ETDZ Content ---');

        const res = await pool.query(`SELECT parsed_json FROM report_versions WHERE id = 138`);
        const json = res.rows[0].parsed_json;

        console.log(JSON.stringify(json, null, 2).slice(0, 2000));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspectSuqianETDZContent();
