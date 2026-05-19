import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

function resolveBootstrapPassword(): string {
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    if (!password || password.length < 8) {
        throw new Error('ADMIN_INITIAL_PASSWORD must be set and at least 8 characters long');
    }
    return password;
}

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
        const password = resolveBootstrapPassword();
        console.log('Ensuring user "admin" exists in Postgres...');
        console.log(`Bootstrap password source length: ${password.length}`);

        const res = await pool.query('SELECT id, username FROM admin_users WHERE username = $1', [username]);

        if (res.rows.length === 0) {
            console.log('User "admin" not found.');
        } else {
            console.log('User "admin" already exists with ID:', res.rows[0].id);
        }
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await pool.end();
    }
}

main();
