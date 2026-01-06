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

// Helper to check if table exists
async function tableExists(client, tableName) {
  const result = await client.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
    [tableName]
  );
  return result.rows[0].exists;
}

// Helper to safely delete from table
async function safeDelete(client, tableName) {
  const exists = await tableExists(client, tableName);
  if (!exists) {
    console.log(`   - ${tableName}: skipped (table does not exist)`);
    return 0;
  }
  const result = await client.query(`DELETE FROM ${tableName}`);
  console.log(`   ✓ ${tableName}: ${result.rowCount} rows deleted`);
  return result.rowCount;
}

async function cleanupDatabase() {
  console.log('🧹 Starting database cleanup...');
  console.log(`   Database: ${process.env.DB_NAME}`);
  console.log(`   Host: ${process.env.DB_HOST}`);
  
  const client = await pool.connect();
  
  try {
    // Start transaction
    await client.query('BEGIN');
    
    console.log('\n📋 Cleaning up tables in order (respecting foreign keys)...');
    
    // Clean tables in reverse dependency order
    await safeDelete(client, 'notifications');
    await safeDelete(client, 'comparison_results');
    await safeDelete(client, 'comparisons');
    await safeDelete(client, 'report_consistency_check_items');
    await safeDelete(client, 'report_consistency_check_runs');
    await safeDelete(client, 'consistency_check_items');
    await safeDelete(client, 'consistency_check_runs');
    await safeDelete(client, 'jobs');
    await safeDelete(client, 'report_version_parses');
    await safeDelete(client, 'report_versions');
    await safeDelete(client, 'reports');
    await safeDelete(client, 'regions');
    
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
