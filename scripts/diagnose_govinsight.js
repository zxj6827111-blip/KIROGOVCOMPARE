// Diagnosis script for missing GovInsight data
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'gov_report_diff',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
});

async function diagnose() {
    console.log('=== 诊断智慧治理数据缺失问题 ===\n');

    // 1. Check reports for 宿迁市
    console.log('1. 宿迁市的报告情况:');
    const reportsRes = await pool.query(`
    SELECT 
      r.id as report_id, 
      r.year, 
      reg.name as region_name,
      r.active_version_id,
      rv.id as version_id
    FROM reports r
    JOIN regions reg ON reg.id = r.region_id
    LEFT JOIN report_versions rv ON rv.id = r.active_version_id
    WHERE reg.name LIKE '%宿迁市%' AND reg.name NOT LIKE '%宿迁市%区%' AND reg.name NOT LIKE '%宿迁市%局%'
    ORDER BY r.year
  `);
    console.table(reportsRes.rows);

    // 2. Check jobs status
    console.log('\n2. 各报告的 materialize job 状态:');
    for (const report of reportsRes.rows) {
        const jobRes = await pool.query(`
      SELECT j.id, j.kind, j.status, j.created_at
      FROM jobs j 
      WHERE j.report_id = $1 AND j.kind = 'materialize'
      ORDER BY j.id DESC LIMIT 1
    `, [report.report_id]);

        const job = jobRes.rows[0];
        console.log(`  报告ID ${report.report_id} (${report.year}年): ${job ? `materialize job ${job.id} - ${job.status}` : '无 materialize job'}`);
    }

    // 3. Check fact tables
    console.log('\n3. fact 表数据情况:');
    for (const report of reportsRes.rows) {
        const factRes = await pool.query(`
      SELECT 
        (SELECT COUNT(*) FROM fact_active_disclosure WHERE report_id = $1) as fact_ad,
        (SELECT COUNT(*) FROM fact_application WHERE report_id = $1) as fact_app,
        (SELECT COUNT(*) FROM fact_legal_proceeding WHERE report_id = $1) as fact_legal
    `, [report.report_id]);

        const fact = factRes.rows[0];
        console.log(`  报告ID ${report.report_id} (${report.year}年): AD=${fact.fact_ad}, APP=${fact.fact_app}, LEGAL=${fact.fact_legal}`);
    }

    // 4. Check what gov_open_annual_stats VIEW returns
    console.log('\n4. gov_open_annual_stats VIEW 中的数据:');
    const viewRes = await pool.query(`
    SELECT year, org_name, app_new, outcome_public, action_licensing
    FROM gov_open_annual_stats
    WHERE org_name LIKE '%宿迁市%' 
    ORDER BY year
  `);
    console.table(viewRes.rows);

    process.exit(0);
}

diagnose().catch(e => { console.error(e); process.exit(1); });
