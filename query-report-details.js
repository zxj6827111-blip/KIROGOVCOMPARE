// Query latest report with more details
const { querySqlite } = require('./dist/config/sqlite');

console.log('=== Latest Huaian 2024 Report ===');
const reportResult = querySqlite(`
  SELECT r.id as report_id, r.year, reg.name as region, 
         rv.id as version_id, rv.created_at, rv.storage_path
  FROM reports r 
  JOIN regions reg ON reg.id = r.region_id 
  JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = 1 
  WHERE reg.name LIKE '%淮安%' AND r.year = 2024 
  ORDER BY rv.created_at DESC 
  LIMIT 1;
`);

if (reportResult[0]) {
    console.log('Report ID:', reportResult[0].report_id);
    console.log('Version ID:', reportResult[0].version_id);
    console.log('Created:', reportResult[0].created_at);
    console.log('File:', reportResult[0].storage_path);

    // Check consistency check run
    const checkRun = querySqlite(`
    SELECT id, status, created_at, finished_at
    FROM report_consistency_runs
    WHERE report_version_id = ${reportResult[0].version_id}
    ORDER BY id DESC
    LIMIT 1;
  `);

    if (checkRun[0]) {
        console.log('\n=== Consistency Check Run ===');
        console.log('Run ID:', checkRun[0].id);
        console.log('Status:', checkRun[0].status);
        console.log('Created:', checkRun[0].created_at);
        console.log('Finished:', checkRun[0].finished_at);

        // Check consistency items
        const items = querySqlite(`
      SELECT group_key, check_key, auto_status, title
      FROM report_consistency_items
      WHERE report_version_id = ${reportResult[0].version_id}
      AND group_key IN ('visual', 'structure', 'quality')
      ORDER BY group_key, check_key;
    `);

        console.log('\n=== Audit Items ===');
        if (items.length > 0) {
            items.forEach(item => {
                console.log(`[${item.group_key}] ${item.check_key}: ${item.auto_status}`);
                console.log(`  Title: ${item.title}`);
            });
        } else {
            console.log('No visual/structure/quality items found!');
        }
    } else {
        console.log('\n⚠️ No consistency check run found!');
    }
} else {
    console.log('No report found');
}
