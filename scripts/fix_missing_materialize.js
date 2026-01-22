/**
 * 补跑历史报告的 materialize job
 * 用于修复上线前导入的报告数据未在 fact 表中的问题
 */
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'gov_report_diff',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function fixMissingMaterializeJobs() {
    console.log('=== 补跑缺失的 materialize jobs ===\n');

    // Find reports that have active_version_id but no succeeded materialize job
    const missingRes = await pool.query(`
    SELECT r.id as report_id, r.year, r.active_version_id, reg.name as region_name
    FROM reports r
    JOIN regions reg ON reg.id = r.region_id
    WHERE r.active_version_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM jobs j 
        WHERE j.report_id = r.id 
        AND j.kind = 'materialize' 
        AND j.status IN ('queued', 'running', 'succeeded')
      )
    ORDER BY r.year, r.id
  `);

    console.log(`发现 ${missingRes.rows.length} 个报告缺失 materialize job:\n`);

    for (const report of missingRes.rows) {
        console.log(`  - 报告ID ${report.report_id}: ${report.region_name} (${report.year}年) - version_id=${report.active_version_id}`);
    }

    if (missingRes.rows.length === 0) {
        console.log('没有需要补跑的报告。');
        process.exit(0);
    }

    console.log('\n开始为这些报告创建 materialize jobs...\n');

    let created = 0;
    for (const report of missingRes.rows) {
        try {
            // Check if version has parsed_json
            const versionRes = await pool.query(
                `SELECT id, LENGTH(parsed_json::text) as json_len FROM report_versions WHERE id = $1`,
                [report.active_version_id]
            );

            if (versionRes.rows.length === 0) {
                console.log(`  ⚠ 报告ID ${report.report_id}: version ${report.active_version_id} 不存在，跳过`);
                continue;
            }

            const jsonLen = versionRes.rows[0].json_len || 0;
            if (jsonLen < 50) {
                console.log(`  ⚠ 报告ID ${report.report_id}: parsed_json 太短 (${jsonLen} bytes)，跳过`);
                continue;
            }

            // Create materialize job
            await pool.query(`
        INSERT INTO jobs (report_id, version_id, kind, status, progress, retry_count, max_retries, created_at)
        VALUES ($1, $2, 'materialize', 'queued', 0, 0, 1, NOW())
      `, [report.report_id, report.active_version_id]);

            console.log(`  ✅ 报告ID ${report.report_id}: 已创建 materialize job`);
            created++;
        } catch (err) {
            console.log(`  ❌ 报告ID ${report.report_id}: 创建失败 - ${err.message}`);
        }
    }

    console.log(`\n完成！已创建 ${created} 个 materialize jobs。`);
    console.log('请确保后端 LLM job runner 正在运行，它会自动处理这些 jobs。');
    console.log('运行 "npm run start:llm" 或 "npm run dev:llm" 启动后端服务。');

    process.exit(0);
}

fixMissingMaterializeJobs().catch(e => { console.error(e); process.exit(1); });
