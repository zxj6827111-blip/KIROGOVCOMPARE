
const { querySqlite } = require('./dist/config/sqlite');

try {
    const rows = querySqlite(`SELECT id, name, level, parent_id FROM regions WHERE name LIKE '%淮安%' OR name LIKE '%Huaian%'`);
    console.log(JSON.stringify(rows, null, 2));
} catch (e) {
    console.error(e);
}
