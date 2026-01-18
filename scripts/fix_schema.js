// Fix schema mismatch: add active_version_id to reports table
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'gov_report_diff',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function main() {
    const client = await pool.connect();
    try {
        console.log('Connected to database');

        // 1. Add active_version_id column
        console.log('Adding active_version_id column...');
        await client.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS active_version_id BIGINT;`);
        console.log('Done');

        // 2. Add sort_order to regions
        console.log('Adding sort_order column to regions...');
        await client.query(`ALTER TABLE regions ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;`);
        console.log('Done');

        // 3. Update active_version_id based on is_active
        console.log('Updating active_version_id...');
        const updateResult = await client.query(`
      UPDATE reports r 
      SET active_version_id = sub.version_id
      FROM (
        SELECT DISTINCT ON (report_id) report_id, id as version_id
        FROM report_versions
        WHERE is_active = true
        ORDER BY report_id, id DESC
      ) sub
      WHERE r.id = sub.report_id
      AND r.active_version_id IS NULL;
    `);
        console.log(`Updated ${updateResult.rowCount} reports`);

        // 4. Verify
        const verifyResult = await client.query(`SELECT COUNT(*) as cnt FROM reports WHERE active_version_id IS NOT NULL;`);
        console.log(`Reports with active_version_id: ${verifyResult.rows[0].cnt}`);

        console.log('Schema fix completed!');
    } catch (e) {
        console.error('Error:', e.message);
        throw e;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
