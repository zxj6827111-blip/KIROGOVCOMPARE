const http = require('http');

http.get('http://127.0.0.1:8787/api/reports/33', res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Response keys:', Object.keys(json));
      
      const report = json.data || json.report || json;
      const sections = report.active_version?.parsed_json?.sections;
      
      if (!sections) {
        console.log('No sections found. Full response:', JSON.stringify(json, null, 2).substring(0, 500));
        return;
      }
      
      console.log('Total sections:', sections.length);
    console.log('\nSection details:');
    
    sections.forEach((sec, i) => {
      console.log(`\n[${i}] ${sec.title} (${sec.type})`);
      
      if (sec.type === 'table_2') {
        console.log('  activeDisclosureData:', sec.activeDisclosureData ? 'EXISTS' : 'NULL');
        if (sec.activeDisclosureData && sec.activeDisclosureData.rows) {
          console.log('  Rows:', sec.activeDisclosureData.rows.length);
        }
      } else if (sec.type === 'table_3') {
        console.log('  tableData:', sec.tableData ? 'EXISTS' : 'NULL');
        if (sec.tableData && sec.tableData.rows) {
          console.log('  Rows:', sec.tableData.rows.length);
        }
      } else if (sec.type === 'table_4') {
        console.log('  reviewLitigationData:', sec.reviewLitigationData ? 'EXISTS' : 'NULL');
        if (sec.reviewLitigationData && sec.reviewLitigationData.rows) {
          console.log('  Rows:', sec.reviewLitigationData.rows.length);
        }
      }
    });
    } catch (err) {
      console.error('Parse error:', err.message);
      console.log('Raw data:', data.substring(0, 200));
    }
  });
}).on('error', err => console.error('Error:', err));
