import { Pool } from 'pg';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

export function hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function resolveBootstrapPassword(): string {
    const password = process.env.ADMIN_INITIAL_PASSWORD;
    if (!password || password.length < 8) {
        throw new Error('ADMIN_INITIAL_PASSWORD must be set and at least 8 characters long');
    }
    return password;
}

const adminPermissions = {
    upload_reports: true,
    view_reports: true,
    manage_users: true,
    manage_regions: true,
    manage_jobs: true,
    delete_reports: true,
    system_admin: true,
};

async function resetAdminPassword() {
    console.log('--- Resetting admin password in PostgreSQL ---');
    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'gov_report_diff',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
    });

    try {
        const username = 'admin';
        const newPassword = resolveBootstrapPassword();
        const newHash = hashPassword(newPassword);

        console.log(`Updating bootstrap password for "${username}" from ADMIN_INITIAL_PASSWORD`);

        const result = await pool.query(
            `INSERT INTO admin_users (username, password_hash, display_name, permissions, created_at, updated_at)
             VALUES ($1, $2, 'System Admin', $3, NOW(), NOW())
             ON CONFLICT (username) DO UPDATE SET
                 password_hash = EXCLUDED.password_hash,
                 permissions = EXCLUDED.permissions,
                 updated_at = NOW(),
                 last_login_at = NULL
             RETURNING id`,
            [username, newHash, JSON.stringify(adminPermissions)]
        );

        if (result.rowCount && result.rowCount > 0) {
            console.log('Success: Admin password and permissions have been ensured.');
        } else {
            console.error('Error: Admin password and permissions were not updated.');
        }
    } catch (error) {
        console.error('Error updating password:', error);
    } finally {
        await pool.end();
    }
}

resetAdminPassword();
