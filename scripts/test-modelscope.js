const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function testModelScope() {
    console.log('--- ModelScope Connection Test ---');

    let apiKey = '';
    try {
        const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
        const lines = envContent.split('\n');
        for (const line of lines) {
            if (line.trim().startsWith('MODELSCOPE_API_KEY=')) apiKey = line.split('=')[1].trim();
        }
    } catch (e) {
        console.error('Failed to read .env file:', e.message);
        process.exit(1);
    }

    if (!apiKey) {
        console.error('Missing MODELSCOPE_API_KEY in .env');
        process.exit(1);
    }

    console.log(`Using Key: ${apiKey.substring(0, 8)}...`);

    // Test Qwen
    console.log('\nTesting Qwen (qwen-turbo)...');
    try {
        const payload = {
            model: 'qwen-turbo',
            input: {
                messages: [
                    { role: 'user', content: 'Hello!' }
                ]
            },
            parameters: {}
        };

        const response = await axios.post(
            'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation',
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                }
            }
        );

        if (response.status === 200) {
            console.log('✅ Qwen Connected!');
        } else {
            console.error(`❌ Qwen Failed: ${response.status}`);
        }
    } catch (error) {
        console.error('❌ Qwen Error:', error.response ? error.response.data : error.message);
    }
}

testModelScope();
