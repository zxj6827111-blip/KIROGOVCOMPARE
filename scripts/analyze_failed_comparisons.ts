import pool from '../src/config/database-llm';

async function analyzeFailedComparisons() {
    try {
        console.log('\n=== 失败比对任务分析 ===\n');

        // 1. 获取失败的比对任务数量
        const failedRes = await pool.query(`
      SELECT COUNT(*) as count FROM jobs WHERE kind = 'compare' AND status = 'failed'
    `);
        console.log('失败的比对任务总数:', failedRes.rows[0].count);

        // 2. 分析失败原因分布
        const reasonsRes = await pool.query(`
      SELECT 
        CASE 
          WHEN error_message LIKE '%parsed_json%' THEN '解析数据为空'
          WHEN error_message LIKE '%comparison_not_found%' THEN '比对记录不存在'
          WHEN error_message LIKE '%missing%' THEN '缺少必要参数'
          ELSE COALESCE(LEFT(error_message, 50), '未知原因')
        END as reason,
        COUNT(*) as count
      FROM jobs 
      WHERE kind = 'compare' AND status = 'failed'
      GROUP BY 1
      ORDER BY count DESC
    `);
        console.log('\n失败原因分布:');
        console.table(reasonsRes.rows);

        // 3. 找出涉及"内容为空"报告的比对
        const emptyReportsRes = await pool.query(`
      WITH failed_comparisons AS (
        SELECT j.comparison_id
        FROM jobs j
        WHERE j.kind = 'compare' AND j.status = 'failed'
      ),
      comparison_reports AS (
        SELECT 
          c.id as comparison_id,
          c.left_report_id,
          c.right_report_id,
          r_left.unit_name as left_unit,
          r_left.year as left_year,
          r_right.unit_name as right_unit,
          r_right.year as right_year,
          CASE WHEN rv_left.parsed_json IS NULL OR rv_left.parsed_json::text = '{}' THEN true ELSE false END as left_empty,
          CASE WHEN rv_right.parsed_json IS NULL OR rv_right.parsed_json::text = '{}' THEN true ELSE false END as right_empty
        FROM failed_comparisons fc
        JOIN comparisons c ON c.id = fc.comparison_id
        LEFT JOIN reports r_left ON r_left.id = c.left_report_id
        LEFT JOIN reports r_right ON r_right.id = c.right_report_id
        LEFT JOIN report_versions rv_left ON rv_left.id = r_left.active_version_id
        LEFT JOIN report_versions rv_right ON rv_right.id = r_right.active_version_id
      )
      SELECT 
        left_unit, left_year, left_empty,
        right_unit, right_year, right_empty
      FROM comparison_reports
      WHERE left_empty = true OR right_empty = true
      LIMIT 20
    `);
        console.log('\n涉及空内容报告的比对 (前20条):');
        console.table(emptyReportsRes.rows);

        // 4. 统计涉及空内容的数量
        const emptyCountRes = await pool.query(`
      WITH failed_comparisons AS (
        SELECT j.comparison_id
        FROM jobs j
        WHERE j.kind = 'compare' AND j.status = 'failed'
      )
      SELECT 
        COUNT(*) FILTER (WHERE rv_left.parsed_json IS NULL OR rv_left.parsed_json::text = '{}') as left_empty_count,
        COUNT(*) FILTER (WHERE rv_right.parsed_json IS NULL OR rv_right.parsed_json::text = '{}') as right_empty_count
      FROM failed_comparisons fc
      JOIN comparisons c ON c.id = fc.comparison_id
      LEFT JOIN reports r_left ON r_left.id = c.left_report_id
      LEFT JOIN reports r_right ON r_right.id = c.right_report_id
      LEFT JOIN report_versions rv_left ON rv_left.id = r_left.active_version_id
      LEFT JOIN report_versions rv_right ON rv_right.id = r_right.active_version_id
    `);
        console.log('\n空内容统计:');
        console.log('左侧报告(year_a)为空:', emptyCountRes.rows[0].left_empty_count);
        console.log('右侧报告(year_b)为空:', emptyCountRes.rows[0].right_empty_count);

        await pool.end();
    } catch (err: any) {
        console.error('分析失败:', err.message);
        process.exit(1);
    }
}

analyzeFailedComparisons();
