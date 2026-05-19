/**
 * Cloud Admin User Setup Script
 * Ensures admin_users table exists and creates/updates admin user.
 *
 * Usage: node scripts/setup-admin.js
 */

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
    console.log('Admin User Setup Script');
    console.log(`   Database: ${process.env.DB_NAME}`);
    console.log(`   Host: ${process.env.DB_HOST}\n`);

    const client = await pool.connect();
    try {
        console.log('Checking admin_users table...');
        const tableCheck = await client.query(`
            SELECT table_name FROM information_schema.tables
            WHERE table_name = 'admin_users'
        `);

        if (tableCheck.rows.length === 0) {
            console.log('   Creating admin_users table...');
            await client.query(`
                CREATE TABLE admin_users (
                    id SERIAL PRIMARY KEY,
                    username VARCHAR(255) UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    display_name VARCHAR(255),
                    permissions JSONB DEFAULT '{}',
                    data_scope JSONB DEFAULT '{}',
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW()
                )
            `);
            console.log('   Created admin_users table');
        } else {
            console.log('   admin_users table exists');
        }

        console.log('\nSetting up admin user...');
        const newHash = hashPassword(resolveInitialPassword());

        const userCheck = await client.query(
            "SELECT id FROM admin_users WHERE username = 'admin'"
        );

        const adminPermissions = JSON.stringify({
            upload_reports: true,
            view_reports: true,
            manage_users: true,
            manage_regions: true,
            manage_jobs: true,
            delete_reports: true,
            system_admin: true,
        });

        if (userCheck.rows.length === 0) {
            await client.query(`
                INSERT INTO admin_users (username, password_hash, display_name, permissions, created_at, updated_at)
                VALUES ('admin', $1, 'System Admin', $2, NOW(), NOW())
            `, [newHash, adminPermissions]);
            console.log('   Created admin user with full permissions');
        } else {
            await client.query(`
                UPDATE admin_users
                SET password_hash = $1, permissions = $2, updated_at = NOW()
                WHERE username = 'admin'
            `, [newHash, adminPermissions]);
            console.log('   Updated admin password and permissions');
        }

        console.log('\nSetup complete');
        console.log('\nAdmin bootstrap account:');
        console.log('   Username: admin');
        console.log('   Password source: ADMIN_INITIAL_PASSWORD');
        console.log('\n   Remember to restart the server: pm2 restart all');

    } catch (err) {
        console.error('\nError:', err.message);
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
