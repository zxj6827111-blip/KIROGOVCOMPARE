/**
 * 直接查询数据库诊断数据匹配问题
 */
import pool from '../src/config/database-llm';

async function diagnose() {
  console.log('=== 诊断数据匹配问题 ===\n');

  try {
    // 1. 检查淮安市的org_id
    console.log('1. 查询淮安市...');
    const huaianRes = await pool.query(`
      SELECT DISTINCT org_id, org_name, org_type, parent_id
      FROM gov_open_annual_stats
      WHERE org_name = '淮安市' AND org_type = 'city'
      LIMIT 1
    `);
    
    if (huaianRes.rows.length === 0) {
      console.log('❌ 找不到淮安市');
      return;
    }
    
    const huaian = huaianRes.rows[0];
    console.log('淮安市 org_id:', huaian.org_id);
    console.log('淮安市 parent_id:', huaian.parent_id);
    
    // 2. 查询所有children (from orgs query perspective)
    console.log('\n2. 查询淮安市的children (按parent_id)...');
    const childrenRes = await pool.query(`
      SELECT DISTINCT org_id, org_name, parent_id
      FROM gov_open_annual_stats
      WHERE parent_id = $1
      ORDER BY org_name
    `, [huaian.org_id]);
    
    console.log('找到children数量:', childrenRes.rows.length);
    console.log('前5个children:');
    childrenRes.rows.slice(0, 5).forEach(c => {
      console.log(`  - ${c.org_name}: org_id=${c.org_id}, parent_id=${c.parent_id}`);
    });
    
    // 3. 检查children的数据年份
    console.log('\n3. 检查children数据年份分布...');
    const yearsRes = await pool.query(`
      SELECT org_name, array_agg(DISTINCT year ORDER BY year DESC) as years
      FROM gov_open_annual_stats
      WHERE parent_id = $1
      GROUP BY org_name
      ORDER BY org_name
    `, [huaian.org_id]);
    
    console.log('各区县的数据年份:');
    yearsRes.rows.forEach(r => {
      console.log(`  - ${r.org_name}: ${r.years.join(', ')}`);
    });
    
    // 4. 验证API include_children逻辑
    console.log('\n4. 模拟API查询 (org_id = ? OR parent_id = ?)...');
    const apiRes = await pool.query(`
      SELECT org_id, org_name, parent_id, year
      FROM gov_open_annual_stats
      WHERE org_id = $1 OR parent_id = $1
      ORDER BY year DESC, org_name
      LIMIT 20
    `, [huaian.org_id]);
    
    console.log('模拟API返回记录数:', apiRes.rows.length);
    console.log('记录样本:');
    apiRes.rows.slice(0, 10).forEach(r => {
      console.log(`  - ${r.org_name} (${r.year}): org_id=${r.org_id}, parent_id=${r.parent_id}`);
    });
    
    console.log('\n=== 诊断完成 ===');
    
  } catch (err) {
    console.error('诊断失败:', err);
  } finally {
    await pool.end();
  }
}

diagnose();
