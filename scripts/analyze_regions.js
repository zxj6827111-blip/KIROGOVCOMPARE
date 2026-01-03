const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const db = new sqlite3.Database(DB_PATH);

console.log('=== Region Data Analysis ===\n');

db.serialize(() => {
    // Total count
    db.get('SELECT COUNT(*) as total FROM regions', (err, row) => {
        console.log('1. Total regions in database:', row?.total || 'Error');
    });

    // Count by level
    db.all('SELECT level, COUNT(*) as count FROM regions GROUP BY level ORDER BY level', (err, rows) => {
        console.log('\n2. Regions by level:');
        rows?.forEach(r => console.log(`   Level ${r.level}: ${r.count}`));
    });

    // Count regions with no parent (roots, should be level 1)
    db.all('SELECT id, name, level FROM regions WHERE parent_id IS NULL ORDER BY name', (err, rows) => {
        console.log('\n3. Root regions (no parent, Level 1):');
        rows?.forEach(r => console.log(`   [${r.id}] ${r.name} (Level ${r.level})`));
        console.log(`   Total roots: ${rows?.length || 0}`);
    });

    // Find potential duplicates (same name and level and parent)
    db.all(`
    SELECT name, level, parent_id, COUNT(*) as cnt 
    FROM regions 
    GROUP BY name, level, parent_id 
    HAVING cnt > 1
    ORDER BY cnt DESC
    LIMIT 20
  `, (err, rows) => {
        console.log('\n4. Potential duplicates (same name+level+parent):');
        if (rows && rows.length > 0) {
            rows.forEach(r => console.log(`   "${r.name}" (L${r.level}, parent=${r.parent_id}): ${r.cnt} copies`));
        } else {
            console.log('   None found');
        }
    });

    // Find regions with codes starting with 'import_' vs others (manual adds)
    db.all(`
    SELECT 
      CASE 
        WHEN code LIKE 'import_%' THEN 'Imported'
        WHEN code LIKE 'manual_%' THEN 'Manual'
        ELSE 'Other'
      END as source,
      COUNT(*) as count
    FROM regions
    GROUP BY source
  `, (err, rows) => {
        console.log('\n5. Regions by source:');
        rows?.forEach(r => console.log(`   ${r.source}: ${r.count}`));
    });

    // Show sample of regions that are not from this import batch (older codes)
    db.all(`
    SELECT id, code, name, level, created_at
    FROM regions 
    WHERE code NOT LIKE 'import_%'
    ORDER BY id
    LIMIT 50
  `, (err, rows) => {
        console.log('\n6. Non-imported regions (manual/other sources):');
        if (rows && rows.length > 0) {
            rows.forEach(r => console.log(`   [${r.id}] ${r.name} (L${r.level}) - code: ${r.code}`));
        } else {
            console.log('   None found');
        }

        db.close(() => {
            console.log('\n=== Analysis Complete ===');
        });
    });
});
