import pool from '../src/config/database';

async function fixRetryOfConstraint() {
    const client = await pool.connect();

    try {
        console.log('开始修复 retry_of 外键约束...');

        // 1. 删除旧的外键约束
        console.log('1. 删除旧的外键约束...');
        await client.query(`
      ALTER TABLE compare_tasks 
      DROP CONSTRAINT IF EXISTS compare_tasks_retry_of_fkey;
    `);
        console.log('   ✓ 旧约束已删除');

        // 2. 添加新的外键约束，带 ON DELETE SET NULL
        console.log('2. 添加新的外键约束（ON DELETE SET NULL）...');
        await client.query(`
      ALTER TABLE compare_tasks 
      ADD CONSTRAINT compare_tasks_retry_of_fkey 
      FOREIGN KEY (retry_of) REFERENCES compare_tasks(task_id) ON DELETE SET NULL;
    `);
        console.log('   ✓ 新约束已添加');

        console.log('\n✅ 迁移成功完成！');
        console.log('现在可以安全地删除被其他任务引用的任务了。');

    } catch (error) {
        console.error('❌ 迁移失败:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

fixRetryOfConstraint().catch(console.error);
