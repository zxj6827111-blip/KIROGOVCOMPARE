const { execSync } = require('child_process');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');
const sqliteBin = path.join(__dirname, '..', 'tools', 'sqlite', 'sqlite3.exe');

function query(sql) {
    try {
        const cmd = `"${sqliteBin}" "${dbPath}" -json "${sql}"`;
        return JSON.parse(execSync(cmd, { encoding: 'utf-8' }));
    } catch (e) {
        console.error(e.message);
        return [];
    }
}

console.log("Regions Count:", query("SELECT count(*) as c FROM regions")[0].c);
console.log("Reports Count:", query("SELECT count(*) as c FROM reports")[0].c);
console.log("Jobs Count:", query("SELECT count(*) as c FROM jobs")[0].c);

console.log("\nSample Regions:");
console.log(query("SELECT * FROM regions LIMIT 5"));

console.log("\nSample Reports:");
console.log(query("SELECT * FROM reports LIMIT 5"));
