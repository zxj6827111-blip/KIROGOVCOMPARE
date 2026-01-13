/**
 * 诊断云端问题清单为空的问题
 * 运行: npx ts-node scripts/diagnose_cloud_issues.ts
 */

import pool, { dbType } from '../src/config/database-llm';

async function diagnose() {
  console.log('=== 云端数据库诊断 ===\n');
  console.log(`数据库类型: ${dbType}\n`);

  try {
    // 1. 检查 report_versions 表结构和 is_active 类型
    console.log('1. 检查 report_versions 表的 is_active 字段类型:');
    if (dbType === 'postgres') {
      const typeCheck = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'report_versions' AND column_name = 'is_active'
      `);
      console.log(typeCheck.rows);
    }

    // 2. 检查 is_active 数据分布
    console.log('\n2. 检查 is_active 字段的数据分布:');
    const activeDistribution = await pool.query(`
      SELECT is_active, COUNT(*) as count
      FROM report_versions
      GROUP BY is_active
      ORDER BY is_active
    `);
    console.log('is_active 分布:', activeDistribution.rows);

    // 3. 检查是否有 active 版本
    console.log('\n3. 检查激活版本数量（使用不同查询方式）:');

    try {
      // 方式1: 直接查 true (可能在某些 PG 配置下失败)
      const count1 = await pool.query(`
        SELECT COUNT(*) as count FROM report_versions WHERE is_active = true
      `);
      console.log('查询 is_active = true:', count1.rows[0].count);
    } catch (err: any) {
      console.log('查询 is_active = true 失败:', err.message);
    }

    try {
      // 方式2: 查询整数 1 (可能在严格类型检查下失败)
      const count2 = await pool.query(`
        SELECT COUNT(*) as count FROM report_versions WHERE is_active = 1
      `);
      console.log('查询 is_active = 1:', count2.rows[0].count);
    } catch (err: any) {
      console.log('查询 is_active = 1 失败:', err.message);
    }

    if (dbType === 'postgres') {
      try {
        // 方式3: 类型转换查询
        const count3 = await pool.query(`
          SELECT COUNT(*) as count FROM report_versions WHERE is_active::integer = 1
        `);
        console.log('查询 is_active::integer = 1:', count3.rows[0].count);
      } catch (err: any) {
        console.log('查询 is_active::integer = 1 失败:', err.message);
      }

      try {
        // 方式4: OR 查询 (最兼容的方式)
        const count4 = await pool.query(`
          SELECT COUNT(*) as count FROM report_versions 
          WHERE (is_active = true OR is_active::integer = 1)
        `);
        console.log('查询 (is_active = true OR is_active::integer = 1):', count4.rows[0].count);
      } catch (err: any) {
        console.log('查询 OR 方式失败:', err.message);
      }
    }

    // 4. 检查 report_consistency_items 表是否存在且有数据
    console.log('\n4. 检查 report_consistency_items 表:');
    try {
      const itemsCount = await pool.query(`
        SELECT COUNT(*) as total_count,
               SUM(CASE WHEN auto_status = 'FAIL' THEN 1 ELSE 0 END) as fail_count,
               SUM(CASE WHEN auto_status = 'FAIL' AND (human_status != 'dismissed' OR human_status IS NULL) THEN 1 ELSE 0 END) as active_fail_count
        FROM report_consistency_items
      `);
      console.log('问题数据统计:', itemsCount.rows[0]);

      // 按 group_key 分类
      const byGroup = await pool.query(`
        SELECT group_key, COUNT(*) as count
        FROM report_consistency_items
        WHERE auto_status = 'FAIL' AND (human_status != 'dismissed' OR human_status IS NULL)
        GROUP BY group_key
      `);
      console.log('\n按分类统计未消除的失败项:');
      console.log(byGroup.rows);
    } catch (err: any) {
      console.error('查询 report_consistency_items 失败:', err.message);
    }

    // 5. 检查关联查询
    console.log('\n5. 测试完整的关联查询（类似 issues-summary 逻辑）:');
    const testQuery = `
      SELECT 
        r.id as report_id,
        r.region_id,
        rv.id as version_id,
        rv.is_active,
        COALESCE(
          (SELECT COUNT(*) FROM report_consistency_items rci 
           WHERE rci.report_version_id = rv.id 
           AND rci.auto_status = 'FAIL'
           AND (rci.human_status != 'dismissed' OR rci.human_status IS NULL)
          ), 0
        ) as issue_count
      FROM reports r
      INNER JOIN report_versions rv ON rv.report_id = r.id 
        AND ${dbType === 'postgres' ? `(rv.is_active = true OR rv.is_active::integer = 1)` : `rv.is_active = 1`}
      ORDER BY r.id
      LIMIT 10
    `;

    const testResult = await pool.query(testQuery);
    console.log(`找到 ${testResult.rows.length} 个报告的激活版本`);
    console.log('前10个报告:');
    console.table(testResult.rows);

    // 6. 检查有问题的报告
    const reportsWithIssues = testResult.rows.filter((r: any) => Number(r.issue_count) > 0);
    console.log(`\n其中有问题的报告数量: ${reportsWithIssues.length}`);
    if (reportsWithIssues.length > 0) {
      console.log('有问题的报告样例:');
      console.table(reportsWithIssues.slice(0, 5));
    }

    console.log('\n=== 诊断完成 ===');
  } catch (error: any) {
    console.error('诊断过程出错:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
  }
}

diagnose();
