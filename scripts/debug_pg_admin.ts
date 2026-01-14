
import { Pool } from 'pg';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Simple PBKDF2 hashing matching the app's hashPassword in src/middleware/auth.ts (approximation)
// Note: We need to be careful to match the app's hashing exactly.
// Let's check middleware/auth.ts first.

async function main() {
    console.log('Postgres connection:', {
        db: process.env.DB_NAME,
        user: process.env.DB_USER,
        host: process.env.DB_HOST
    });

    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'gov_report_diff',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
    });

    try {
        const username = 'admin';
        const rawPassword = 'admin123';

        // We'll use a Bcrypt hash that the app can also read if it supports it, 
        // OR we just use what AuthController expects. 
        // Wait, looking at routes/auth.ts, it uses verifyPassword(password, user.password_hash).
        // Let's see how hashPassword is implemented.

        console.log('Ensuring user "admin" exists in Postgres...');

        // Let's use a known hash or just let the app handle it.
        // Actually, I'll just check if the user exists first.
        const res = await pool.query('SELECT id, username FROM admin_users WHERE username = $1', [username]);

        if (res.rows.length === 0) {
            console.log('User "admin" not found. Creating default...');
            // We need a proper hash. Let's look at src/middleware/auth.ts.
        } else {
            console.log('User "admin" already exists with ID:', res.rows[0].id);
        }

    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

// Check middleware first
