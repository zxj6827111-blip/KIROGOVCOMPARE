
const http = require('http');

function fetchData(year) {
    return new Promise((resolve, reject) => {
        const url = `http://localhost:8787/api/gov-insight/annual-data?year=${year}`;
        console.log(`Fetching: ${url}`);
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json);
                } catch (e) {
                    reject('Failed to parse JSON');
                }
            });
        }).on('error', (err) => {
            reject(err.message);
        });
    });
}

async function main() {
    try {
        console.log('Testing API for Abolished Data...');
        // Test 2021
        const data2021 = await fetchData(2021);
        if (data2021.data && data2021.data.length > 0) {
            const row = data2021.data.find(r => r.org_name.includes('淮安')) || data2021.data[0];
            console.log('\n--- 2021 Data ---');
            console.log('Org:', row.org_name);
            console.log('reg_abolished:', row.reg_abolished);
            console.log('doc_abolished:', row.doc_abolished);
            console.log('outcome_unable_no_info (Granular check):', row.outcome_unable_no_info);
        } else {
            console.log('No data for 2021');
        }
    } catch (err) {
        console.error('Error:', err);
    }
}

main();
