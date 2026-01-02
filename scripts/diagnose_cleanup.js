const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

let sqliteBin = 'sqlite3';
const localBin = path.join(__dirname, '..', 'tools', 'sqlite', 'sqlite3.exe');
if (fs.existsSync(localBin)) {
    sqliteBin = localBin;
}
const dbPath = path.join(__dirname, '..', 'data', 'llm_ingestion.db');

function query(sql) {
    try {
        const cmd = `"${sqliteBin}" "${dbPath}" -json "${sql}"`;
        return JSON.parse(execSync(cmd, { encoding: 'utf-8' }));
    } catch (e) {
        console.error("Query Error:", e.message);
        return [];
    }
}

// Fetch all regions
const regions = query("SELECT id, name, level FROM regions");
console.log(`Total regions: ${regions.length}`);

// Heuristic: Check for valid characters (Chinese, English, Numbers, parens, hyphens)
// Mojibake often appears as extended ASCII (e.g. ºáÉ³Ïç)
// Regex: At least one Chinese char OR English word?
// Stricter: Names must contain valid Chinese if they are Chinese regions.
// But some might be "District A".
// Let's count how many fail a "Looks like UTF-8 Chinese/English" test.

const badRegions = regions.filter(r => {
    // Matches common Chinese chars, english letters, numbers, spaces, dots, parens
    if (/[\u4e00-\u9fa5]/.test(r.name)) return false; // Has Chinese -> Likely Good
    if (/^[a-zA-Z0-9\s\(\)\-_]+$/.test(r.name)) return false; // All English/Numbers -> Likely Good
    return true; // Look garbled
});

console.log(`Found ${badRegions.length} potentially garbled regions.`);

if (badRegions.length > 0) {
    console.log("Samples of garbled regions:");
    badRegions.slice(0, 10).forEach(r => console.log(`ID: ${r.id}, Name: ${r.name}, Level: ${r.level}`));
}

// Also check if there are any recent "Good" regions (high IDs)
const highIdGood = regions.filter(r => r.id > 100 && !badRegions.includes(r));
console.log(`\nValid regions with ID > 100: ${highIdGood.length}`);
if (highIdGood.length > 0) {
    highIdGood.slice(0, 5).forEach(r => console.log(`ID: ${r.id}, Name: ${r.name}`));
}
