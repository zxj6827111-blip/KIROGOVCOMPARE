const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '../data/llm_ingestion.db');

console.log('Checking database at:', dbPath);

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

db.serialize(() => {
    // Check if table exists
    db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_users'", (err, row) => {
        if (err) {
            console.error('Error checking table:', err);
            return;
        }
        if (!row) {
            console.error('❌ Table admin_users does NOT exist!');
            return;
        }
        console.log('✅ Table admin_users exists.');

        // Check if admin user exists
        db.all("SELECT id, username, password_hash, display_name FROM admin_users", (err, rows) => {
            if (err) {
                console.error('Error querying users:', err);
                return;
            }
            if (rows.length === 0) {
                console.log('❌ No users found in admin_users table.');
            } else {
                console.log(`✅ Found ${rows.length} users:`);
                rows.forEach(row => {
                    console.log(` - ID: ${row.id}, Username: ${row.username}, Hash: ${row.password_hash.substring(0, 10)}...`);
                });
            }
        });
    });
});
