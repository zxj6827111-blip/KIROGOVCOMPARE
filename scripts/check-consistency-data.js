// Quick diagnostic script to check report_consistency_items data
const pool = require('../dist/config/database-llm').default;

async function checkConsistencyData() {
  try {
    // Check if table exists and has data
    const countResult = await pool.query(`
      SELECT COUNT(*) as total FROM report_consistency_items
    `);
    console.log('Total consistency items:', countResult.rows?.[0]?.total || countResult[0]?.total);

    // Check items by auto_status
    const statusResult = await pool.query(`
      SELECT auto_status, COUNT(*) as cnt 
      FROM report_consistency_items 
      GROUP BY auto_status
    `);
    console.log('By auto_status:', statusResult.rows || statusResult);

    // Check items by human_status  
    const humanResult = await pool.query(`
      SELECT human_status, COUNT(*) as cnt 
      FROM report_consistency_items 
      GROUP BY human_status
    `);
    console.log('By human_status:', humanResult.rows || humanResult);

    // Get sample of FAIL items with version IDs
    const failResult = await pool.query(`
      SELECT report_version_id, group_key, auto_status, human_status
      FROM report_consistency_items
      WHERE auto_status = 'FAIL'
      LIMIT 10
    `);
    console.log('Sample FAIL items:', failResult.rows || failResult);

    // Check report_consistency_runs
    const runsResult = await pool.query(`
      SELECT id, report_version_id, status, created_at
      FROM report_consistency_runs
      ORDER BY created_at DESC
      LIMIT 5
    `);
    console.log('Recent consistency runs:', runsResult.rows || runsResult);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkConsistencyData();
