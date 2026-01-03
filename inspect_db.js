const db = new (require('sqlite3').verbose()).Database('./data/llm_ingestion.db');

// Check ALL jobs related to Huangpu 2023 (including deleted reports)
db.all(`
SELECT 
    j.id as job_id, 
    j.kind,
    j.status,
    j.provider,
    j.model,
    j.created_at,
    j.started_at,
    j.finished_at,
    rv.id as version_id,
    r.unit_name,
    r.year
FROM jobs j
LEFT JOIN report_versions rv ON j.version_id = rv.id
LEFT JOIN reports r ON rv.report_id = r.id
WHERE (r.unit_name LIKE '%黄浦%' OR rv.id IS NULL) 
  AND (r.year = 2023 OR r.year IS NULL)
  AND j.kind = 'parse'
ORDER BY j.id DESC
LIMIT 20
`, (err, rows) => {
    if (err) { console.error(err); return; }
    console.log("黄浦区 2023 年所有 parse 任务历史：\n");
    console.log("ID | 状态 | Provider | Model | 创建时间 | 开始时间 | 完成时间");
    console.log("-".repeat(100));
    rows.forEach(r => {
        console.log(`${r.job_id} | ${r.status} | ${r.provider || '-'} | ${r.model || '-'} | ${r.created_at} | ${r.started_at || '-'} | ${r.finished_at || '-'}`);
    });
    db.close();
});
