const { Pool } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'gov_report_diff',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
});

// Implementation matching src/middleware/auth.ts
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

async function main() {
    console.log('🔍 Fixing Admin User (PBKDF2 Mode)...');
    console.log(`- DB Connection: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);

    const client = await pool.connect();
    try {
        // Generate valid PBKDF2 hash for 'admin123'
        const newHash = hashPassword('admin123');
        console.log('🔐 Generated new PBKDF2 hash for "admin123"');

        // Check user
        const res = await client.query("SELECT id FROM admin_users WHERE username = 'admin'");
        
        if (res.rows.length === 0) {
            console.log('🆕 Admin user not found. Creating...');
            await client.query(`
                INSERT INTO admin_users (username, password_hash, display_name, created_at, updated_at)
                VALUES ('admin', $1, 'System Admin', NOW(), NOW())
            `, [newHash]);
            console.log('✅ Admin user created with PBKDF2 hash.');
        } else {
            console.log('🔄 Admin user exists. Updating password...');
            await client.query(`
                UPDATE admin_users 
                SET password_hash = $1, updated_at = NOW() 
                WHERE username = 'admin'
            `, [newHash]);
            console.log('✅ Admin password updated to "admin123" (PBKDF2 format).');
        }

    } catch (err) {
        console.error('❌ Error executing query:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

main();
