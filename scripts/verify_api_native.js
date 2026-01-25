const http = require('http');

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/gov-insight/annual-data?org_id=city_320800&include_children=true',
  method: 'GET',
};

const req = http.request(options, (res) => {
  let data = '';

  res.on('data', (chunk) => {
    data += chunk;
  });

  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      console.log('Status Code:', res.statusCode);
      console.log('Total Records:', json.data.length);
      
      const years = new Set(json.data.map(r => r.year));
      console.log('Years found:', Array.from(years).sort((a,b) => b-a));

      const children = json.data.filter(r => r.parent_id === 'city_320800');
      console.log('Children Records:', children.length);

      const districtMap = new Map();
      children.forEach(c => {
          if(!districtMap.has(c.org_name)) districtMap.set(c.org_name, []);
          districtMap.get(c.org_name).push(c.year);
      });
      
      console.log('District Data Availability:');
      districtMap.forEach((years, name) => {
          console.log(`- ${name}: ${years.join(', ')}`);
      });

    } catch (e) {
      console.error('Error parsing JSON:', e);
    }
  });
});

req.on('error', (e) => {
  console.error('Request error:', e);
});

req.end();
