/**
 * Cloud Database Cleanup Script
 * Run this script on the cloud server to clear all data and start fresh.
 * 
 * Usage: node scripts/cloud-cleanup-database.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'kirogovcompare',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function cleanupDatabase() {
  console.log('🧹 Starting database cleanup...');
  console.log(`   Database: ${process.env.DB_NAME}`);
  console.log(`   Host: ${process.env.DB_HOST}`);
  
  const client = await pool.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');
    
    console.log('\n📋 Cleaning up tables in order (respecting foreign keys)...');
    
    // 1. Clean notifications
    const notifResult = await client.query('DELETE FROM notifications');
    console.log(`   ✓ notifications: ${notifResult.rowCount} rows deleted`);
    
    // 2. Clean comparison results
    const compResultsResult = await client.query('DELETE FROM comparison_results');
    console.log(`   ✓ comparison_results: ${compResultsResult.rowCount} rows deleted`);
    
    // 3. Clean comparisons
    const compResult = await client.query('DELETE FROM comparisons');
    console.log(`   ✓ comparisons: ${compResult.rowCount} rows deleted`);
    
    // 4. Clean consistency_check_items
    try {
      const checkItemsResult = await client.query('DELETE FROM consistency_check_items');
      console.log(`   ✓ consistency_check_items: ${checkItemsResult.rowCount} rows deleted`);
    } catch (e) {
      console.log(`   - consistency_check_items: skipped (table may not exist)`);
    }
    
    // 5. Clean consistency_check_runs
    try {
      const checkRunsResult = await client.query('DELETE FROM consistency_check_runs');
      console.log(`   ✓ consistency_check_runs: ${checkRunsResult.rowCount} rows deleted`);
    } catch (e) {
      console.log(`   - consistency_check_runs: skipped (table may not exist)`);
    }
    
    // 6. Clean jobs
    const jobsResult = await client.query('DELETE FROM jobs');
    console.log(`   ✓ jobs: ${jobsResult.rowCount} rows deleted`);
    
    // 7. Clean report_version_parses
    const parsesResult = await client.query('DELETE FROM report_version_parses');
    console.log(`   ✓ report_version_parses: ${parsesResult.rowCount} rows deleted`);
    
    // 8. Clean report_versions
    const versionsResult = await client.query('DELETE FROM report_versions');
    console.log(`   ✓ report_versions: ${versionsResult.rowCount} rows deleted`);
    
    // 9. Clean reports
    const reportsResult = await client.query('DELETE FROM reports');
    console.log(`   ✓ reports: ${reportsResult.rowCount} rows deleted`);
    
    // 10. Clean regions
    const regionsResult = await client.query('DELETE FROM regions');
    console.log(`   ✓ regions: ${regionsResult.rowCount} rows deleted`);
    
    // Commit transaction
    await client.query('COMMIT');
    
    console.log('\n✅ Database cleanup complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Restart the backend: pm2 restart all');
    console.log('   2. Re-import regions via the web interface');
    console.log('   3. Upload reports for testing');
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n❌ Cleanup failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

cleanupDatabase().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
