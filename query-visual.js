// Query visual_audit from latest Huaian 2024 report
const { querySqlite } = require('./dist/config/sqlite');

const result = querySqlite(`
  SELECT r.id, r.year, reg.name, rv.parsed_json 
  FROM reports r 
  JOIN regions reg ON reg.id = r.region_id 
  JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = 1 
  WHERE reg.name LIKE '%淮安%' AND r.year = 2024 
  ORDER BY r.id DESC 
  LIMIT 1;
`);

if (result[0]) {
    const parsed = JSON.parse(result[0].parsed_json);
    console.log('Report:', result[0].name, result[0].year);
    console.log('visual_audit:', JSON.stringify(parsed.visual_audit, null, 2));
} else {
    console.log('No Huaian 2024 report found');
    // Try to find any recent report
    const recentResult = querySqlite(`
    SELECT r.id, r.year, reg.name, rv.parsed_json 
    FROM reports r 
    JOIN regions reg ON reg.id = r.region_id 
    JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = 1 
    ORDER BY r.id DESC 
    LIMIT 1;
  `);
    if (recentResult[0]) {
        const parsed = JSON.parse(recentResult[0].parsed_json);
        console.log('Most recent report:', recentResult[0].name, recentResult[0].year);
        console.log('visual_audit:', JSON.stringify(parsed.visual_audit, null, 2));
    }
}
