
const { querySqlite, sqlValue } = require('./src/config/sqlite');
const path = require('path');

// Point to the correct DB
process.env.SQLITE_DB_PATH = path.join(__dirname, 'data', 'llm_ingestion.db');

async function fixAdmin() {
    try {
        console.log('--- Fixing Admin Permissions ---');

        // 1. Check if column exists
        let hasPermissions = false;
        try {
            querySqlite(`SELECT permissions FROM admin_users LIMIT 1`);
            hasPermissions = true;
        } catch (e) {
            console.log('Column permissions does not exist, adding...');
        }

        // 2. Apply migrations if needed
        if (!hasPermissions) {
            try {
                querySqlite(`ALTER TABLE admin_users ADD COLUMN permissions TEXT DEFAULT '{}'`);
                console.log('Applied: permissions column');
            } catch (e) { console.log('Error adding permissions:', e.message); }

            try {
                querySqlite(`ALTER TABLE admin_users ADD COLUMN data_scope TEXT DEFAULT '{}'`);
                console.log('Applied: data_scope column');
            } catch (e) { console.log('Error adding data_scope:', e.message); }
        }

        // 3. Update Admin User
        const users = querySqlite(`SELECT * FROM admin_users WHERE username = 'admin'`);
        if (users.length > 0) {
            const admin = users[0];
            console.log(`Updating admin user (ID: ${admin.id})...`);

            const allPerms = JSON.stringify({
                manage_users: true,
                manage_cities: true,
                upload_reports: true,
                compare_reports: true
            });

            // Force update ID to 1 if it's not (optional, but good for ID=1 check)
            // But changing ID is risky if other tables ref it. 
            // Better to rely on permissions.

            querySqlite(`
                UPDATE admin_users 
                SET permissions = '${allPerms}', data_scope = '{}'
                WHERE id = ${admin.id}
            `);
            console.log('SUCCESS: Admin permissions updated.');
        } else {
            console.log('ERROR: Admin user not found!');
        }

    } catch (e) {
        console.error('Fatal Error:', e);
    }
}

fixAdmin();
