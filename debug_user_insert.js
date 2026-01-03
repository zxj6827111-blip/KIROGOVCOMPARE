
const { querySqlite, sqlValue } = require('./dist/config/sqlite');
const crypto = require('crypto');

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

async function testInsert() {
    console.log('--- Checking admin_users schema ---');
    try {
        const info = querySqlite(`PRAGMA table_info(admin_users)`);
        console.log(JSON.stringify(info, null, 2));
    } catch (e) {
        console.error('Failed to get schema:', e.message);
    }

    console.log('--- Attempting Insert ---');
    const username = 'debug_user_' + Date.now();
    const password = 'password123';
    const displayName = 'Debug User';
    const permissions = { manage_users: true };
    const dataScope = { regions: ['Jiangsu'] };

    try {
        const hash = hashPassword(password);
        const permJson = JSON.stringify(permissions);
        const scopeJson = JSON.stringify(dataScope);

        const sql = `
          INSERT INTO admin_users (username, password_hash, display_name, permissions, data_scope, created_at)
          VALUES (
            ${sqlValue(username)}, 
            ${sqlValue(hash)}, 
            ${sqlValue(displayName)}, 
            ${sqlValue(permJson)}, 
            ${sqlValue(scopeJson)}, 
            datetime('now')
          )
        `;

        console.log('SQL:', sql);
        querySqlite(sql);
        console.log('SUCCESS: User inserted.');
    } catch (error) {
        console.error('ERROR inserting user:');
        console.error(error.message || error);
        if (error.stderr) console.error('STDERR:', error.stderr);
    }
}

testInsert();
