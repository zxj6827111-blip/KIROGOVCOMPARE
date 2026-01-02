const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function testGemini() {
    console.log('--- Gemini Connection Test ---');

    let apiKey = '';
    try {
        const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
        const lines = envContent.split('\n');
        for (const line of lines) {
            if (line.trim().startsWith('GEMINI_API_KEY=')) apiKey = line.split('=')[1].trim();
        }
    } catch (e) {
        console.error('Failed to read .env file:', e.message);
        process.exit(1);
    }

    if (!apiKey) {
        console.error('Missing GEMINI_API_KEY in .env');
        process.exit(1);
    }

    console.log(`Using Key: ${apiKey.substring(0, 8)}...`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;

    try {
        const payload = {
            contents: [{
                parts: [{ text: "Hello" }]
            }]
        };

        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });

        if (response.status === 200) {
            console.log('✅ Gemini Connected!');
        } else {
            console.error(`❌ Gemini Failed: ${response.status}`);
        }
    } catch (error) {
        console.error('❌ Gemini Error:', error.response ? error.response.data : error.message);
    }
}

testGemini();
