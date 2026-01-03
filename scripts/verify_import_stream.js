const http = require('http');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

async function testImport() {
    const filePath = path.join(__dirname, '..', 'data', 'temp', 'test_regions.csv');

    // Create a dummy CSV with 100 rows
    let csvContent = '省份,城市,区县,街道\n';
    for (let i = 0; i < 120; i++) {
        csvContent += `省份${i},城市${i},区县${i},街道${i}\n`;
    }

    if (!fs.existsSync(path.dirname(filePath))) {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    fs.writeFileSync(filePath, csvContent);

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    const options = {
        hostname: 'localhost',
        port: 8787,
        path: '/api/regions/import',
        method: 'POST',
        headers: form.getHeaders(),
    };

    const req = http.request(options, (res) => {
        console.log(`STATUS: ${res.statusCode}`);
        console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            console.log('CHUNK RECEIVED:');
            console.log(chunk);
        });
        res.on('end', () => {
            console.log('STREAM ENDED');
        });
    });

    req.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
    });

    form.pipe(req);
}

testImport();
