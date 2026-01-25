/**
 * 直接查询数据库诊断数据匹配问题
 */
const http = require('http');

function makeRequest(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 5000,
      path: path,
      method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function diagnose() {
  console.log('=== 诊断数据匹配问题 ===\n');

  try {
    // 1. 获取orgs列表
    console.log('1. 获取Orgs列表...');
    const orgsRes = await makeRequest('/api/gov-insight/orgs');
    const allOrgs = orgsRes.data || [];
    
    // 找淮安市
    const huaian = allOrgs.find(o => o.name === '淮安市');
    if (!huaian) {
      console.log('找不到淮安市!');
      console.log('可用orgs:', allOrgs.slice(0, 5).map(o => `${o.name}(${o.id})`));
      return;
    }
    console.log('淮安市 ID:', huaian.id);
    
    // 找淮安市的children
    const huaianChildren = allOrgs.filter(o => o.parent_id === huaian.id);
    console.log('淮安市在orgs中的children数量:', huaianChildren.length);
    console.log('前5个children IDs:', huaianChildren.slice(0, 5).map(c => c.id));

    // 2. 获取annual-data (include_children=true)
    console.log('\n2. 获取Annual Data (include_children=true)...');
    const annualRes = await makeRequest(`/api/gov-insight/annual-data?org_id=${huaian.id}&include_children=true`);
    const annualData = annualRes.data || [];
    console.log('API返回记录数:', annualData.length);
    
    // 分析parent_id分布
    const parentIds = [...new Set(annualData.map(r => r.parent_id))];
    console.log('API中的parent_id值:', parentIds);
    
    // 找children记录
    const childRecords = annualData.filter(r => r.parent_id === huaian.id);
    console.log('parent_id匹配淮安市ID的记录数:', childRecords.length);
    
    // 找org_id匹配的
    const childOrgIds = [...new Set(childRecords.map(r => r.org_id))];
    console.log('这些记录的org_id:', childOrgIds.slice(0, 5));
    
    // 3. 检查ID格式是否匹配
    console.log('\n3. 检查ID格式匹配...');
    if (huaianChildren.length > 0 && childOrgIds.length > 0) {
      const sampleChildFromOrgs = huaianChildren[0];
      const sampleChildFromAnnual = childOrgIds[0];
      console.log('Orgs中的child ID格式:', sampleChildFromOrgs.id);
      console.log('Annual中的child org_id格式:', sampleChildFromAnnual);
      console.log('是否匹配:', huaianChildren.some(c => childOrgIds.includes(c.id)));
    }

    // 4. 详细对比
    console.log('\n4. 详细对比...');
    const matchedCount = huaianChildren.filter(c => childOrgIds.includes(c.id)).length;
    console.log('能匹配到的children数量:', matchedCount, '/', huaianChildren.length);
    
    if (matchedCount === 0) {
      console.log('\n❌ 问题确认: Orgs中的children ID与Annual Data中的org_id不匹配!');
      console.log('Orgs children IDs:', huaianChildren.slice(0, 3).map(c => c.id));
      console.log('Annual Data org_ids:', childOrgIds.slice(0, 3));
    } else {
      console.log('\n✅ ID匹配正常');
    }

  } catch (err) {
    console.error('诊断失败:', err.message);
  }
}

diagnose();
