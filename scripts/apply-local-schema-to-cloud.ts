import fs from 'fs';
import path from 'path';
import pool from '../src/config/database-llm';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function applySchema() {
    try {
        console.log('--- Applying Missing Local Schema to Database ---');
        console.log(`Target Database: ${process.env.DB_NAME} @ ${process.env.DB_HOST}`);

        // Test connection
        await pool.query('SELECT 1');
        console.log('✅ Database connected.');

        // Locate schema file
        const schemaPath = path.join(__dirname, '../migrations/postgres/full_schema.sql');
        console.log(`Reading schema file: ${schemaPath}`);

        if (!fs.existsSync(schemaPath)) {
            console.error('❌ Error: Schema file not found at expected path.');
            process.exit(1);
        }

        const schemaSql = fs.readFileSync(schemaPath, 'utf8');

        console.log('Executing schema SQL (CREATE TABLE IF NOT EXISTS)...');

        // Execute the entire SQL script
        // Note: pg driver handles multiple statements if they are simple, usually. 
        // If exact schema contains transactions or special commands, might need splitting, 
        // but full_schema.sql is usually standard.
        await pool.query(schemaSql);

        console.log('✅ Schema executed successfully.');
        console.log('Checking for new tables...');

        const res = await pool.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'report_consistency_items';
    `);

        if (res.rows.length > 0) {
            console.log('✅ Verification passed: Table "report_consistency_items" exists.');
        } else {
            console.warn('⚠️ Warning: Verification failed. Table "report_consistency_items" was not found.');
        }

    } catch (err) {
        console.error('❌ Error applying schema:', err);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

applySchema();
