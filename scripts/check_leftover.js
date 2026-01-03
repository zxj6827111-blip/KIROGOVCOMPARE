const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const db = new sqlite3.Database(DB_PATH);

console.log('=== 检查残留数据 ===\n');

db.serialize(() => {
    // Check by code prefix timestamp - import codes contain timestamps
    db.all(`
    SELECT 
      SUBSTR(code, 8, 13) as timestamp_part,
      COUNT(*) as count
    FROM regions
    WHERE code LIKE 'import_%'
    GROUP BY SUBSTR(code, 8, 13)
    ORDER BY timestamp_part
  `, (err, rows) => {
        console.log('1. 按导入时间分组 (code中的时间戳):');
        if (rows && rows.length > 0) {
            rows.forEach(r => {
                const ts = parseInt(r.timestamp_part);
                const date = new Date(ts);
                console.log(`   ${date.toLocaleString('zh-CN')}: ${r.count} 条记录`);
            });
            console.log(`   总共 ${rows.length} 个独立批次`);
        }
    });

    // Show earliest and latest IDs with their details
    db.get('SELECT MIN(id) as min_id, MAX(id) as max_id FROM regions', (err, row) => {
        console.log(`\n2. ID 范围: ${row?.min_id} ~ ${row?.max_id}`);
    });

    // Check ID gaps - might indicate deleted records between imports
    db.all(`
    SELECT id, name, level, code
    FROM regions
    ORDER BY id
    LIMIT 10
  `, (err, rows) => {
        console.log('\n3. 最早的 10 条记录:');
        rows?.forEach(r => {
            const ts = r.code.match(/import_(\d+)_/);
            const date = ts ? new Date(parseInt(ts[1])).toLocaleString('zh-CN') : 'unknown';
            console.log(`   [${r.id}] ${r.name} (L${r.level}) - 创建于: ${date}`);
        });
    });

    db.all(`
    SELECT id, name, level, code
    FROM regions
    ORDER BY id DESC
    LIMIT 10
  `, (err, rows) => {
        console.log('\n4. 最新的 10 条记录:');
        rows?.forEach(r => {
            const ts = r.code.match(/import_(\d+)_/);
            const date = ts ? new Date(parseInt(ts[1])).toLocaleString('zh-CN') : 'unknown';
            console.log(`   [${r.id}] ${r.name} (L${r.level}) - 创建于: ${date}`);
        });

        db.close(() => {
            console.log('\n=== 分析完成 ===');
        });
    });
});
