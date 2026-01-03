const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let sqliteBin = 'sqlite3';
const localBin = path.join(__dirname, '..', 'tools', 'sqlite', 'sqlite3.exe');
if (fs.existsSync(localBin)) {
    sqliteBin = localBin;
}

const datadir = path.join(__dirname, '..', 'data');
const files = fs.readdirSync(datadir).filter(f => f.endsWith('.db') || f.endsWith('.sqlite'));

files.forEach(f => {
    const dbPath = path.join(datadir, f);
    try {
        const cmd = `"${sqliteBin}" "${dbPath}" "SELECT count(id) FROM regions"`;
        const res = execSync(cmd, { encoding: 'utf-8' }).trim();
        console.log(`File: ${f}, Regions: ${res}`);
    } catch (e) {
        console.log(`File: ${f}, Error: ${e.message.split('\n')[0]}`);
    }
});
