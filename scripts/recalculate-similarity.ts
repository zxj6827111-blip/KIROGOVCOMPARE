/**
 * 脚本：重新计算所有比对记录的 similarity (文字重复率)
 * 
 * 使用方法: npx tsx scripts/recalculate-similarity.ts
 */
import pool from '../src/config/database-llm';
import { calculateReportMetrics } from '../src/utils/reportAnalysis';

async function main() {
    console.log('开始重新计算比对记录的 similarity 值...');

    // 获取所有比对记录
    const comparisonsRes = await pool.query(`
    SELECT c.id, c.left_report_id, c.right_report_id, c.similarity, c.check_status
    FROM comparisons c
    ORDER BY c.id
  `);

    const comparisons = comparisonsRes.rows;
    console.log(`共找到 ${comparisons.length} 条比对记录`);

    let updated = 0;
    let failed = 0;

    for (const comp of comparisons) {
        try {
            // 获取两边报告的 parsed_json
            const leftRes = await pool.query(`
        SELECT rv.parsed_json
        FROM reports r
        JOIN report_versions rv ON rv.id = r.active_version_id
        WHERE r.id = $1
      `, [comp.left_report_id]);

            const rightRes = await pool.query(`
        SELECT rv.parsed_json
        FROM reports r
        JOIN report_versions rv ON rv.id = r.active_version_id
        WHERE r.id = $1
      `, [comp.right_report_id]);

            const leftJson = leftRes.rows[0]?.parsed_json || {};
            const rightJson = rightRes.rows[0]?.parsed_json || {};

            // 计算 metrics
            const metrics = calculateReportMetrics(leftJson, rightJson);

            // 更新数据库
            await pool.query(`
        UPDATE comparisons 
        SET similarity = $1, check_status = $2, updated_at = NOW()
        WHERE id = $3
      `, [metrics.similarity, metrics.checkStatus || '正常', comp.id]);

            console.log(`ID ${comp.id}: 旧值=${comp.similarity}% -> 新值=${metrics.similarity}%, 状态=${metrics.checkStatus || '正常'}`);
            updated++;
        } catch (err) {
            console.error(`ID ${comp.id}: 更新失败`, err);
            failed++;
        }
    }

    console.log(`\n完成！更新成功: ${updated}, 失败: ${failed}`);
    pool.end();
}

main().catch(err => {
    console.error('脚本执行失败:', err);
    process.exit(1);
});
