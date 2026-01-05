const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'gov_report_diff',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
});

// bcrypt hash for 'admin123'
const DEFAULT_PASS_HASH = '$2b$10$rQZ8K8HbXxjwG8CfTr1qReQ9D.Wkj8TbKf5kj1xY6VqYC0PvC3XHe';

async function main() {
    console.log('🐘 Connecting to PostgreSQL...');
    console.log(`Endpoint: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);

    const client = await pool.connect();
    try {
        console.log('🔧 Ensuring admin_users table exists...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                display_name VARCHAR(100),
                permissions TEXT DEFAULT '{}',
                data_scope TEXT DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW(),
                last_login_at TIMESTAMPTZ
            );
        `);

        console.log('👤 Checking admin user...');
        const res = await client.query("SELECT id, username FROM admin_users WHERE username = 'admin'");
        
        if (res.rows.length === 0) {
            console.log('🆕 Admin user not found. Creating...');
            await client.query(`
                INSERT INTO admin_users (username, password_hash, display_name, created_at)
                VALUES ('admin', $1, 'System Admin', NOW())
            `, [DEFAULT_PASS_HASH]);
            console.log('✅ Admin user created.');
        } else {
            console.log('🔄 Admin user exists. Resetting password...');
            await client.query(`
                UPDATE admin_users 
                SET password_hash = $1, updated_at = NOW() 
                WHERE username = 'admin'
            `, [DEFAULT_PASS_HASH]);
            console.log('✅ Admin password reset to default (admin123).');
        }

    } catch (err) {
        console.error('❌ Error:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
