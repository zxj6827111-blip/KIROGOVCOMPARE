// Test PDF border detection on a real file
const fs = require('fs');
const path = require('path');

// Find the uploaded Huaian 2024 report file
const { querySqlite } = require('./dist/config/sqlite');

const result = querySqlite(`
  SELECT rv.storage_path 
  FROM reports r 
  JOIN regions reg ON reg.id = r.region_id 
  JOIN report_versions rv ON rv.report_id = r.id AND rv.is_active = 1 
  WHERE reg.name LIKE '%淮安%' AND r.year = 2024 
  ORDER BY r.id DESC 
  LIMIT 1;
`);

if (result[0] && result[0].storage_path) {
    const filePath = result[0].storage_path;
    console.log('File path:', filePath);
    console.log('File exists:', fs.existsSync(filePath));

    // Now test the PDF parser
    const PdfParseService = require('./dist/services/PdfParseService').default;

    PdfParseService.parsePDF(filePath, 'test').then((parseResult) => {
        console.log('Parse success:', parseResult.success);
        if (parseResult.document) {
            console.log('visual_border_missing:', parseResult.document.metadata.visual_border_missing);
        }
    }).catch(err => {
        console.error('Parse error:', err);
    });
} else {
    console.log('No file found');
}
