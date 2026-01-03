
const { querySqlite, sqlValue } = require('./dist/config/sqlite');

try {
    // Check current state
    const users = querySqlite("SELECT * FROM admin_users WHERE username = 'huaian'");
    if (users.length > 0) {
        const u = users[0];
        let perms = JSON.parse(u.permissions || '{}');
        perms.view_reports = true; // Grant view permission

        const sql = `UPDATE admin_users SET permissions = ${sqlValue(JSON.stringify(perms))} WHERE id = ${u.id}`;
        console.log('Update SQL:', sql);
        querySqlite(sql);
        console.log('Granted view_reports to huaian');
    }
} catch (e) {
    console.error(e);
}
