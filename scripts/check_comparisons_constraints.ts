import pool from '../src/config/database';

async function checkComparisonsTable() {
    const client = await pool.connect();

    try {
        console.log('检查 comparisons 表的外键约束...\n');

        // 查询外键约束
        const result = await client.query(`
      SELECT
        tc.constraint_name,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      JOIN information_schema.referential_constraints AS rc
        ON rc.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_name = 'comparisons'
      ORDER BY tc.constraint_name;
    `);

        console.log('comparisons 表的外键约束:');
        result.rows.forEach(row => {
            console.log(`\n约束名: ${row.constraint_name}`);
            console.log(`  列: ${row.column_name}`);
            console.log(`  引用表: ${row.foreign_table_name}.${row.foreign_column_name}`);
            console.log(`  删除规则: ${row.delete_rule}`);
        });

        console.log(`\n总共 ${result.rows.length} 个外键约束`);

    } catch (error) {
        console.error('❌ 查询失败:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

checkComparisonsTable().catch(console.error);
