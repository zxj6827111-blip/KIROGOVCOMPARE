
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

async function checkAdminUsers() {
    console.log('--- Checking admin_users in PostgreSQL ---');
    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'gov_report_diff',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
    });

    try {
        const result = await pool.query('SELECT id, username, password_hash, display_name FROM admin_users');
        console.log(`Total users found: ${result.rows.length}`);
        result.rows.forEach(user => {
            console.log(`- ID: ${user.id}, Username: ${user.username}, Hash: ${user.password_hash.substring(0, 20)}...`);
        });
    } catch (error) {
        console.error('Error querying admin_users:', error);
    } finally {
        await pool.end();
    }
}

checkAdminUsers();
