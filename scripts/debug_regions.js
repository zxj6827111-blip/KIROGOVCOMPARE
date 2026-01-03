const Database = require('better-sqlite3');
const db = new Database('./data/dev.sqlite');

console.log("--- Level 1 Regions ---");
const l1 = db.prepare("SELECT id, name, code FROM regions WHERE level = 1").all();
console.log(JSON.stringify(l1, null, 2));

console.log("\n--- All Shanghai related ---");
const shanghai = db.prepare("SELECT id, name, level, parent_id FROM regions WHERE name LIKE '%上海%' OR name LIKE '%Shanghai%'").all();
console.log(JSON.stringify(shanghai, null, 2));

if (shanghai.length > 0) {
    const ids = shanghai.map(r => r.id).join(',');
    if (ids) {
        console.log("\n--- Children of Shanghai ---");
        const children = db.prepare(`SELECT id, name, level, parent_id FROM regions WHERE parent_id IN (${ids})`).all();
        console.log(JSON.stringify(children, null, 2));
    }
}
