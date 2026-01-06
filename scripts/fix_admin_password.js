const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, '../data/llm_ingestion.db');

console.log('Fixing admin password at:', dbPath);

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
});

// Hash for 'admin123'
const NEW_HASH = '$2b$10$rQZ8K8HbXxjwG8CfTr1qReQ9D.Wkj8TbKf5kj1xY6VqYC0PvC3XHe';

db.serialize(() => {
    db.run("UPDATE admin_users SET password_hash = ? WHERE username = 'admin'", [NEW_HASH], function(err) {
        if (err) {
            console.error('Error updating password:', err);
            return;
        }
        console.log(`✅ Password updated for user 'admin'. Rows affected: ${this.changes}`);
        
        // Verify
        db.get("SELECT password_hash FROM admin_users WHERE username = 'admin'", (err, row) => {
            if (row) {
                console.log('Current Hash:', row.password_hash);
            }
        });
    });
});
