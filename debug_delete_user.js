
const { querySqlite, sqlValue } = require('./dist/config/sqlite');

async function testDelete() {
    console.log('--- Setup: Inserting Temp User ---');
    const username = 'del_test_' + Date.now();
    try {
        querySqlite(`
            INSERT INTO admin_users (username, password_hash, display_name) 
            VALUES ('${username}', 'hash', 'Delete Me')
        `);

        const users = querySqlite(`SELECT id FROM admin_users WHERE username = '${username}'`);
        if (!users || users.length === 0) {
            console.error('Setup failed: Could not create temp user');
            return;
        }
        const userId = users[0].id;
        console.log(`Temp User Created. ID: ${userId}`);

        console.log('--- Attempting Delete ---');
        // Logic from users.ts
        // querySqlite(`DELETE FROM admin_users WHERE id = ${sqlValue(userId)}`);

        // userId from DB is number. req.params.id is string.
        // Let's simulate string input which matches req.params
        const userIdStr = String(userId);
        const sql = `DELETE FROM admin_users WHERE id = ${sqlValue(userIdStr)}`;
        console.log('SQL:', sql);

        querySqlite(sql);

        // Verify
        const check = querySqlite(`SELECT id FROM admin_users WHERE id = ${userId}`);
        if (!check || check.length === 0) {
            console.log('SUCCESS: User deleted.');
        } else {
            console.error('FAILURE: User still exists.');
        }

    } catch (e) {
        console.error('Error:', e.message);
    }
}

testDelete();
