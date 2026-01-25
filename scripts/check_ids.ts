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
    console.table(res.rows);

    console.log('\n--- 随机子单位 ID 检查 ---');
    const childRes = await pool.query(`
      SELECT DISTINCT org_id, org_name, parent_id, year
      FROM gov_open_annual_stats
      WHERE org_name = '洪泽区'
      ORDER BY year DESC
    `);
    console.table(childRes.rows);
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}
check();
