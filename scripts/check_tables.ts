import pool from '../src/config/database';

async function checkTables() {
    const client = await pool.connect();

    try {
        console.log('检查数据库表...\n');

        // 查询所有表
        const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);

        console.log('数据库中的表:');
        result.rows.forEach(row => {
            console.log(`  - ${row.table_name}`);
        });

        console.log(`\n总共 ${result.rows.length} 个表`);

    } catch (error) {
        console.error('❌ 查询失败:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

checkTables().catch(console.error);
