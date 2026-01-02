const db = new (require('sqlite3').verbose()).Database('./data/llm_ingestion.db');

// Check ALL recent jobs to see the pattern
db.all(`
SELECT 
    j.id as job_id, 
    j.kind,
    j.version_id,
    j.status,
    j.provider,
    j.model,
    j.created_at,
    r.unit_name,
    r.year
FROM jobs j
LEFT JOIN report_versions rv ON j.version_id = rv.id
LEFT JOIN reports r ON rv.report_id = r.id
ORDER BY j.id DESC
LIMIT 15
`, (err, rows) => {
    if (err) { console.error(err); return; }
    console.log("Recent Jobs:");
    rows.forEach(r => {
        console.log(`${r.job_id} | ${r.kind} | ${r.status} | ${r.model || '-'} | ${r.unit_name || '-'} ${r.year || ''} | ${r.created_at}`);
    });
    db.close();
});
