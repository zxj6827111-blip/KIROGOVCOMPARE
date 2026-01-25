import pool from '../src/config/database-llm';

async function check() {
  try {
    console.log('--- 淮安市 children 按 org_type 分组统计 ---');
    const res = await pool.query(`
      SELECT org_type, COUNT(*) as count,
             array_agg(DISTINCT org_name) as sample_names
      FROM gov_open_annual_stats
      WHERE parent_id = 'city_721'
      GROUP BY org_type
      ORDER BY count DESC
    `);
    res.rows.forEach(r => {
      console.log(`\nType: ${r.org_type || 'null'}, Count: ${r.count}`);
      console.log(`  Sample: ${r.sample_names.slice(0, 5).join(', ')}`);
    });

    console.log('\n--- 仅"区县"类型的children ---');
    const districtRes = await pool.query(`
      SELECT DISTINCT org_id, org_name, org_type, year
      FROM gov_open_annual_stats
      WHERE parent_id = 'city_721' AND org_type = 'district'
      ORDER BY org_name, year DESC
    `);
    console.log('区县数量:', districtRes.rows.length);
    districtRes.rows.forEach(r => console.log(`  - ${r.org_name} (${r.year}): ${r.org_id}`));

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
check();
