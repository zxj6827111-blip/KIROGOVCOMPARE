
const { querySqlite } = require('./dist/config/sqlite');

try {
    const users = querySqlite('SELECT id, username, display_name, permissions, data_scope FROM admin_users');
    console.log(JSON.stringify(users, null, 2));
} catch (e) {
    console.error(e);
}
