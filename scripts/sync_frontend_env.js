const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Paths
const rootEnvPath = path.join(__dirname, '..', '.env');
const frontendEnvPath = path.join(__dirname, '..', 'frontend', '.env');

console.log('🔄 Syncing GEMINI_API_KEY from root .env to frontend/.env...');

// 1. Read Root .env
const rootConfig = dotenv.config({ path: rootEnvPath }).parsed || {};
const apiKey = rootConfig.GEMINI_API_KEY;

if (!apiKey) {
    console.error('❌ Error: GEMINI_API_KEY not found in root .env');
    process.exit(1);
}

// 2. Read Frontend .env
let frontendContent = '';
if (fs.existsSync(frontendEnvPath)) {
    frontendContent = fs.readFileSync(frontendEnvPath, 'utf8');
}

// 3. Update or Append REACT_APP_GEMINI_API_KEY
const keyName = 'REACT_APP_GEMINI_API_KEY';
const newLine = `${keyName}=${apiKey}`;

const lines = frontendContent.split(/\r?\n/);
let found = false;
let newLines = lines.map(line => {
    if (line.trim().startsWith(keyName + '=')) {
        found = true;
        return newLine;
    }
    return line;
});

if (!found) {
    if (newLines.length > 0 && newLines[newLines.length - 1].trim() !== '') {
        newLines.push('');
    }
    newLines.push(newLine);
}

// 4. Write back
fs.writeFileSync(frontendEnvPath, newLines.join('\n'));
console.log(`✅ Successfully synced ${keyName} to frontend/.env`);
console.log(`   Value: ${apiKey.slice(0, 5)}...${apiKey.slice(-4)}`);
