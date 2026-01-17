
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import pool from '../src/config/database-llm';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function applyFix() {
    console.log('Applying View Fix: gov_open_annual_stats ...');

    const client = await pool.connect();
    try {
        // 1. Read the SQL file
        const sqlPath = path.join(__dirname, '..', 'migrations', 'postgres', '014_gov_insight_view.sql');
        if (!fs.existsSync(sqlPath)) {
            throw new Error(`Migration file not found at: ${sqlPath}`);
        }
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');

        // 2. Split statements (simple split by semicolon)
        // Note: This is a simple parser, assuming no semicolons inside string literals within the view definition.
        // For this specific view file, it is safe.
        const statements = sqlContent
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        console.log(`Found ${statements.length} SQL statements to execute.`);

        // 3. Execute sequentially
        await client.query('BEGIN');

        for (const stmt of statements) {
            // Skip comments if they result in empty query after processing? 
            // Postgres handles comments fine, but let's just run it.
            console.log(`Executing: ${stmt.substring(0, 50).replace(/\n/g, ' ')}...`);
            await client.query(stmt);
        }

        await client.query('COMMIT');
        console.log('✅ View updated successfully!');

    } catch (err: any) {
        await client.query('ROLLBACK');
        console.error('❌ Failed to update view:', err.message);
        process.exit(1);
    } finally {
        client.release();
        setTimeout(() => process.exit(0), 1000);
    }
}

applyFix();
