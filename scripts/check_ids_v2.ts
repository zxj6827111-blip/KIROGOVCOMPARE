import pool from '../src/config/database-llm';

async function check() {
  try {
    console.log('--- 淮安市 ID 检查 ---');
    const res = await pool.query(`
      SELECT DISTINCT org_id, org_name, parent_id, year
      FROM gov_open_annual_stats
      WHERE org_name = '淮安市'
      ORDER BY year DESC
    `);
    res.rows.forEach(r => console.log(`Year: ${r.year}, org_id: ${r.org_id}, parent_id: ${r.parent_id}`));

    const countRes = await pool.query(`
      SELECT year, count(*) as child_count
      FROM gov_open_annual_stats
      WHERE parent_id IN (SELECT DISTINCT org_id FROM gov_open_annual_stats WHERE org_name = '淮安市')
      GROUP BY year
      ORDER BY year DESC
    `);
    console.log('\n--- 子单位数据按年份统计 ---');
    countRes.rows.forEach(r => console.log(`Year: ${r.year}, Count: ${r.child_count}`));

  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
check();
