// 测试勾稽关系校验 API
const http = require('http');

const baseUrl = 'http://127.0.0.1:8787';
const reportId = 33;

function httpGet(path) {
  return new Promise((resolve, reject) => {
    http.get(`${baseUrl}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    }).on('error', reject);
  });
}

function httpPost(path, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const options = {
      hostname: '127.0.0.1',
      port: 8787,
      path: path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error(`Parse error: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function testConsistencyChecksAPI() {
  console.log('🧪 测试勾稽关系校验 API...\n');

  try {
    // 1. 获取校验结果
    console.log('1️⃣ GET /api/reports/33/checks');
    const checks = await httpGet(`/api/reports/${reportId}/checks`);
    console.log('✅ 获取成功');
    console.log(`   - Latest run: ${checks.latest_run ? 'exists' : 'none'}`);
    if (checks.latest_run) {
      console.log(`   - Summary: ${JSON.stringify(checks.latest_run.summary)}`);
      console.log(`   - Groups: ${checks.groups.length}`);
      checks.groups.forEach(g => {
        console.log(`     - ${g.group_name}: ${g.items.length} items`);
      });
    }
    console.log();

    // 2. 运行校验
    console.log('2️⃣ POST /api/reports/33/checks/run');
    const runResult = await httpPost(`/api/reports/${reportId}/checks/run`, {});
    console.log('✅ 触发成功');
    console.log(`   - Message: ${runResult.message}`);
    console.log(`   - Job ID: ${runResult.job_id || 'N/A'}`);
    console.log();

    // 3. 等待3秒后再次获取
    console.log('⏳ 等待3秒后重新获取结果...\n');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('3️⃣ GET /api/reports/33/checks (after run)');
    const checksAfter = await httpGet(`/api/reports/${reportId}/checks`);
    console.log('✅ 获取成功');
    if (checksAfter.latest_run) {
      console.log(`   - Summary: ${JSON.stringify(checksAfter.latest_run.summary)}`);
      console.log(`   - Total items: ${checksAfter.groups.reduce((sum, g) => sum + g.items.length, 0)}`);
      
      // 显示失败项
      const failedItems = checksAfter.groups.flatMap(g => g.items.filter(i => i.auto_status === 'FAIL'));
      if (failedItems.length > 0) {
        console.log(`\n   ❌ 失败项 (${failedItems.length}):`);
        failedItems.forEach(item => {
          console.log(`      - ${item.title}: ${item.left_value} vs ${item.right_value} (delta: ${item.delta})`);
        });
      } else {
        console.log('\n   ✅ 无失败项！');
      }
    }

    console.log('\n✅ 所有测试通过！');
  } catch (err) {
    console.error('\n❌ 测试失败:', err.message);
    process.exit(1);
  }
}

testConsistencyChecksAPI();
