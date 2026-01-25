/**
 * 系统化验证数据流
 * Step 1: 数据库层验证
 * Step 2: API层验证
 */
import pool from '../src/config/database-llm';

async function verify() {
  console.log('='.repeat(60));
  console.log('系统化数据流验证');
  console.log('='.repeat(60));

  try {
    // Step 1: 数据库验证
    console.log('\n【Step 1】数据库层验证');
    console.log('-'.repeat(40));
    
    // 1.1 确认淮安市ID
    const huaianRes = await pool.query(`
      SELECT DISTINCT org_id, org_name FROM gov_open_annual_stats 
      WHERE org_name = '淮安市' LIMIT 1
    `);
    const huaianId = huaianRes.rows[0]?.org_id;
    console.log('淮安市 org_id:', huaianId);

    // 1.2 查询真正的区县（以区/县结尾）
    const districtRes = await pool.query(`
      SELECT DISTINCT org_id, org_name, 
             array_agg(DISTINCT year ORDER BY year DESC) as years,
             count(*) as record_count
      FROM gov_open_annual_stats 
      WHERE parent_id = $1 
        AND (org_name LIKE '%区' OR org_name LIKE '%县')
      GROUP BY org_id, org_name
      ORDER BY org_name
    `, [huaianId]);
    
    console.log('\n区县数据 (共', districtRes.rows.length, '个):');
    districtRes.rows.forEach(r => {
      console.log(`  ✓ ${r.org_name}: org_id=${r.org_id}, years=[${r.years.join(',')}], records=${r.record_count}`);
    });

    // 1.3 验证某个区县的完整数据
    if (districtRes.rows.length > 0) {
      const sampleDistrict = districtRes.rows[0];
      console.log('\n抽检样本:', sampleDistrict.org_name);
      
      const sampleData = await pool.query(`
        SELECT year, app_new, outcome_public, rev_total, lit_total
        FROM gov_open_annual_stats
        WHERE org_id = $1
        ORDER BY year DESC
      `, [sampleDistrict.org_id]);
      
      console.log('该区县的详细数据:');
      sampleData.rows.forEach(r => {
        console.log(`  ${r.year}年: 新收${r.app_new}件, 主动公开${r.outcome_public}件, 复议${r.rev_total}件, 诉讼${r.lit_total}件`);
      });
    }

    // Step 2: 模拟API查询
    console.log('\n【Step 2】模拟API查询 (include_children=true)');
    console.log('-'.repeat(40));
    
    const apiRes = await pool.query(`
      SELECT org_id, org_name, parent_id, year, app_new
      FROM gov_open_annual_stats
      WHERE LOWER(org_id) = LOWER($1) OR LOWER(parent_id) = LOWER($1)
      ORDER BY year DESC, org_name
    `, [huaianId]);
    
    console.log('模拟API返回总记录数:', apiRes.rows.length);
    
    // 分析返回结果
    const selfRecords = apiRes.rows.filter(r => r.org_id.toLowerCase() === huaianId.toLowerCase());
    const childRecords = apiRes.rows.filter(r => r.parent_id?.toLowerCase() === huaianId.toLowerCase());
    
    console.log('其中:');
    console.log('  - 淮安市自身记录:', selfRecords.length, '条');
    console.log('  - 子单位记录:', childRecords.length, '条');
    
    // 过滤出区县
    const districtRecords = childRecords.filter(r => 
      r.org_name.endsWith('区') || r.org_name.endsWith('县')
    );
    console.log('  - 真正区县记录:', districtRecords.length, '条');
    
    // 按区县分组
    const districtMap = new Map();
    districtRecords.forEach(r => {
      if (!districtMap.has(r.org_name)) districtMap.set(r.org_name, []);
      districtMap.get(r.org_name).push(r.year);
    });
    
    console.log('\n各区县年份分布:');
    districtMap.forEach((years, name) => {
      console.log(`  ${name}: ${years.join(', ')}`);
    });

    console.log('\n='.repeat(60));
    console.log('验证完成');
    console.log('='.repeat(60));

  } catch (e) {
    console.error('验证失败:', e);
  } finally {
    await pool.end();
  }
}

verify();
