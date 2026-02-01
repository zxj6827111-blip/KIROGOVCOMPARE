import pool from '../src/config/database';

async function checkAllConstraints() {
    const client = await pool.connect();

    try {
        console.log('检查所有与 comparisons 相关的外键约束...\n');

        // 查询引用 comparisons 表的所有外键约束
        const result = await client.query(`
      SELECT
        tc.table_name,
        tc.constraint_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        rc.delete_rule,
        rc.update_rule
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
        AND ccu.table_name = 'comparisons'
      ORDER BY tc.table_name, tc.constraint_name;
    `);

        console.log('引用 comparisons 表的外键约束:');
        result.rows.forEach(row => {
            console.log(`\n表: ${row.table_name}`);
            console.log(`  约束名: ${row.constraint_name}`);
            console.log(`  列: ${row.column_name}`);
            console.log(`  引用: ${row.foreign_table_name}.${row.foreign_column_name}`);
            console.log(`  删除规则: ${row.delete_rule}`);
            console.log(`  更新规则: ${row.update_rule}`);
        });

        console.log(`\n总共 ${result.rows.length} 个外键约束引用 comparisons 表`);

    } catch (error) {
        console.error('❌ 查询失败:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

checkAllConstraints().catch(console.error);
