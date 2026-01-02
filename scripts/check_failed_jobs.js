const Database = require('better-sqlite3');

try {
    const db = new Database('./data/dev.sqlite');
    const jobs = db.prepare(`
        SELECT version_id, status, step_name, error_message, created_at 
        FROM report_versions 
        WHERE status = 'failed' 
        ORDER BY created_at DESC 
        LIMIT 5
    `).all();

    console.log('Failed jobs found:', jobs.length);
    jobs.forEach((job, i) => {
        console.log(`\n--- Job ${i + 1} ---`);
        console.log('Version ID:', job.version_id);
        console.log('Status:', job.status);
        console.log('Step:', job.step_name);
        console.log('Error:', job.error_message?.substring(0, 800) || 'N/A');
    });

    db.close();
} catch (err) {
    console.error('Error:', err.message);
}
