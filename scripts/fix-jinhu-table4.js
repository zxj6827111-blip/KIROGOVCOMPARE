// 修正金湖县报告解析错误 - 表四数据修正脚本

const { querySqlite, sqlValue } = require('../dist/config/sqlite');

// 获取当前数据
const versionId = 25;
const result = querySqlite(`SELECT parsed_json FROM report_versions WHERE id = ${versionId} LIMIT 1`)[0];

if (!result || !result.parsed_json) {
  console.log('未找到解析数据');
  process.exit(1);
}

// 解析 JSON
const parsed = typeof result.parsed_json === 'string' 
  ? JSON.parse(result.parsed_json) 
  : result.parsed_json;

// 找到表四的 section
const table4Section = parsed.sections.find(s => s.type === 'table_4');

if (!table4Section) {
  console.log('未找到表四数据');
  process.exit(1);
}

console.log('修正前的数据：');
console.log(JSON.stringify(table4Section.reviewLitigationData.litigationDirect, null, 2));

// 修正错误
table4Section.reviewLitigationData.litigationDirect.other = 10;  // 从 1 改为 10
table4Section.reviewLitigationData.litigationDirect.total = 12;  // 从 0 改为 12

console.log('\n修正后的数据：');
console.log(JSON.stringify(table4Section.reviewLitigationData.litigationDirect, null, 2));

// 保存回数据库
const updatedJson = JSON.stringify(parsed);
querySqlite(`
  UPDATE report_versions
  SET parsed_json = ${sqlValue(updatedJson)}
  WHERE id = ${versionId};
`);

console.log('\n✅ 数据已修正并保存到数据库');
console.log('请重新运行一致性校验：');
console.log(`curl -Method POST http://localhost:8787/api/reports/33/checks/run`);
