const http = require('http');

const data = JSON.stringify({
  parsed_json: { test: "fixed" }
});

const options = {
  hostname: '127.0.0.1',
  port: 8787,
  path: '/api/reports/33/parsed-data',
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', chunk => responseData += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Response:', responseData);
  });
});

req.on('error', (e) => {
  console.error('Error:', e.message);
});

req.write(data);
req.end();
