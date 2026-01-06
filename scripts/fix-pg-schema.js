/**
 * PostgreSQL Schema Fix Script
 * Adds missing columns to tables that CODEX's changes require.
 * 
 * Usage: node scripts/fix-pg-schema.js
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

async function addColumnIfNotExists(client, table, column, definition) {
  const check = await client.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = $1 AND column_name = $2
  `, [table, column]);
  
  if (check.rows.length === 0) {
    await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`  ✓ Added ${table}.${column}`);
    return true;
  } else {
    console.log(`  - ${table}.${column} already exists`);
    return false;
  }
}

async function createTableIfNotExists(client, tableName, createSQL) {
  const check = await client.query(`
    SELECT table_name FROM information_schema.tables 
    WHERE table_name = $1
  `, [tableName]);
  
  if (check.rows.length === 0) {
    await client.query(createSQL);
    console.log(`  ✓ Created table ${tableName}`);
    return true;
  } else {
    console.log(`  - Table ${tableName} already exists`);
    return false;
  }
}

async function fixSchema() {
  console.log('🔧 PostgreSQL Schema Fix Script');
  console.log(`   Database: ${process.env.DB_NAME}`);
  console.log(`   Host: ${process.env.DB_HOST}\n`);
  
  const client = await pool.connect();
  
  try {
    console.log('📋 Fixing comparisons table...');
    await addColumnIfNotExists(client, 'comparisons', 'similarity', 'INTEGER DEFAULT 0');
    await addColumnIfNotExists(client, 'comparisons', 'check_status', 'TEXT');
    
    console.log('\n📋 Fixing comparison_exports table...');
    await createTableIfNotExists(client, 'comparison_exports', `
      CREATE TABLE comparison_exports (
        id SERIAL PRIMARY KEY,
        comparison_id INTEGER REFERENCES comparisons(id) ON DELETE CASCADE,
        format TEXT NOT NULL DEFAULT 'pdf',
        file_path TEXT,
        file_size INTEGER,
        watermark_text TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log('\n📋 Fixing report_consistency_items table...');
    await createTableIfNotExists(client, 'report_consistency_items', `
      CREATE TABLE report_consistency_items (
        id SERIAL PRIMARY KEY,
        report_version_id INTEGER NOT NULL,
        run_id INTEGER,
        group_key TEXT NOT NULL,
        check_key TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        title TEXT,
        expr TEXT,
        left_value NUMERIC,
        right_value NUMERIC,
        delta NUMERIC,
        tolerance NUMERIC DEFAULT 0,
        auto_status TEXT DEFAULT 'UNKNOWN',
        human_status TEXT DEFAULT 'pending',
        paths TEXT,
        val_json TEXT,
        raw_text TEXT,
        engine_version TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(report_version_id, fingerprint)
      )
    `);
    
    console.log('\n📋 Fixing report_consistency_check_runs table...');
    await createTableIfNotExists(client, 'report_consistency_check_runs', `
      CREATE TABLE report_consistency_check_runs (
        id SERIAL PRIMARY KEY,
        report_version_id INTEGER NOT NULL,
        engine_version TEXT,
        total_items INTEGER DEFAULT 0,
        pass_count INTEGER DEFAULT 0,
        fail_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    console.log('\n📋 Fixing jobs table columns...');
    await addColumnIfNotExists(client, 'jobs', 'step_code', 'TEXT');
    await addColumnIfNotExists(client, 'jobs', 'step_name', 'TEXT');
    await addColumnIfNotExists(client, 'jobs', 'progress', 'INTEGER DEFAULT 0');
    
    console.log('\n📋 Fixing report_versions table columns...');
    await addColumnIfNotExists(client, 'report_versions', 'raw_text', 'TEXT');
    
    console.log('\n✅ Schema fix complete!');
    console.log('\n📝 Next steps:');
    console.log('   1. Restart the backend: pm2 restart all');
    console.log('   2. Test the features again');
    
  } catch (error) {
    console.error('\n❌ Schema fix failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

fixSchema().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
