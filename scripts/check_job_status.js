const pool = require('./dist/config/database-llm').default;

async function checkJobStatus() {
    try {
        console.log('\n=== 任务队列统计 ===\n');

        // 总体统计
        const allRes = await pool.query(`
      SELECT kind, status, COUNT(*) as count 
      FROM jobs 
      GROUP BY kind, status 
      ORDER BY kind, status
    `);
        console.log('所有任务类型统计:');
        console.table(allRes.rows);

        // Compare任务专门统计
        const compareRes = await pool.query(`
      SELECT status, COUNT(*) as count 
      FROM jobs 
      WHERE kind = 'compare' 
      GROUP BY status
    `);
        console.log('\n比对(compare)任务统计:');
        console.table(compareRes.rows);

        // 检查similarity为0的比对记录
        const simRes = await pool.query(`
      SELECT 
        CASE 
          WHEN similarity IS NULL THEN 'NULL'
          WHEN similarity = 0 THEN '0%'
          WHEN similarity > 0 AND similarity <= 30 THEN '1-30%'
          WHEN similarity > 30 AND similarity <= 60 THEN '31-60%'
          ELSE '>60%'
        END as similarity_range,
        COUNT(*) as count
      FROM comparisons
      GROUP BY 1
      ORDER BY 1
    `);
        console.log('\n比对记录相似度分布:');
        console.table(simRes.rows);

        // 总数
        const totalRes = await pool.query('SELECT COUNT(*) FROM comparisons');
        console.log('比对记录总数:', totalRes.rows[0].count);

        await pool.end();
    } catch (err) {
        console.error('查询失败:', err.message);
        process.exit(1);
    }
}

checkJobStatus();
