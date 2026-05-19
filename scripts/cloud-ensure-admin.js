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

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function resolveInitialPassword() {
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    if (!password || password.length < 8) {
        throw new Error('ADMIN_INITIAL_PASSWORD must be set and at least 8 characters long');
    }
    return password;
}

async function main() {
    console.log('Ensuring bootstrap admin user...');
    console.log(`DB Connection: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);

    const client = await pool.connect();
    try {
        const newHash = hashPassword(resolveInitialPassword());
        console.log('Generated PBKDF2 hash from ADMIN_INITIAL_PASSWORD');

        const adminPermissions = JSON.stringify({
            upload_reports: true,
            view_reports: true,
            manage_users: true,
            manage_regions: true,
            manage_jobs: true,
            delete_reports: true,
            system_admin: true,
        });

        const res = await client.query("SELECT id FROM admin_users WHERE username = 'admin'");

        if (res.rows.length === 0) {
            console.log('Admin user not found. Creating...');
            await client.query(`
                INSERT INTO admin_users (username, password_hash, display_name, permissions, created_at, updated_at)
                VALUES ('admin', $1, 'System Admin', $2, NOW(), NOW())
            `, [newHash, adminPermissions]);
            console.log('Admin user created with PBKDF2 hash and full permissions.');
        } else {
            console.log('Admin user exists. Updating password and permissions...');
            await client.query(`
                UPDATE admin_users
                SET password_hash = $1, permissions = $2, updated_at = NOW()
                WHERE username = 'admin'
            `, [newHash, adminPermissions]);
            console.log('Admin password updated from ADMIN_INITIAL_PASSWORD and permissions refreshed.');
        }

    } catch (err) {
        console.error('Error executing query:', err);
        throw err;
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch(err => {
    console.error('Script failed:', err);
    process.exit(1);
});
