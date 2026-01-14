
import { Pool } from 'pg';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

// Re-implementing the app's hashPassword logic to ensure compatibility
export function hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

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
        const newPassword = 'admin123';
        const newHash = hashPassword(newPassword);

        console.log(`Setting password for "${username}" to "${newPassword}"...`);
        console.log(`New hash: ${newHash}`);

        const result = await pool.query(
            'UPDATE admin_users SET password_hash = $1, last_login_at = NULL WHERE username = $2',
            [newHash, username]
        );

        if (result.rowCount && result.rowCount > 0) {
            console.log('✅ Success: Admin password has been reset.');
        } else {
            console.error('❌ Error: User "admin" not found in the database.');
            // Try to create it if it doesn't exist
            console.log('Creating admin user...');
            await pool.query(
                'INSERT INTO admin_users (username, password_hash, role) VALUES ($1, $2, $3)',
                [username, newHash, 'admin']
            );
            console.log('✅ Success: Admin user created.');
        }
    } catch (error) {
        console.error('Error updating password:', error);
    } finally {
        await pool.end();
    }
}

resetAdminPassword();
