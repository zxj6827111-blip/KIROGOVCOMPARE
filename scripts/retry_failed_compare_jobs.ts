import pool from '../src/config/database-llm';

async function retryFailedCompareJobs() {
    try {
        console.log('\n=== 重试失败的比对任务 ===\n');

        // 1. 统计当前失败的任务
        const beforeRes = await pool.query(`
      SELECT status, COUNT(*) as count FROM jobs WHERE kind = 'compare' GROUP BY status
    `);
        console.log('重试前状态:');
        console.table(beforeRes.rows);

        // 2. 将失败的任务重置为排队状态
        const updateRes = await pool.query(`
      UPDATE jobs 
      SET status = 'queued', 
          error_message = NULL,
          error_code = NULL,
          started_at = NULL,
          finished_at = NULL
      WHERE kind = 'compare' AND status = 'failed'
      RETURNING id
    `);

        console.log(`\n已重置 ${updateRes.rowCount} 个失败任务为 queued 状态`);

        // 3. 确认新状态
        const afterRes = await pool.query(`
      SELECT status, COUNT(*) as count FROM jobs WHERE kind = 'compare' GROUP BY status
    `);
        console.log('\n重试后状态:');
        console.table(afterRes.rows);

        await pool.end();
        console.log('\n完成！这些任务将在下一轮轮询时被重新执行。');
    } catch (err: any) {
        console.error('操作失败:', err.message);
        process.exit(1);
    }
}

retryFailedCompareJobs();
