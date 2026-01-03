const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function testGlm45() {
    console.log('--- Zhipu AI (GLM-4.5-Flash) Connection Test ---');

    let apiKey = '';
    let apiUrl = '';
    try {
        const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
        const lines = envContent.split('\n');
        for (const line of lines) {
            if (line.trim().startsWith('GLM_FLASH_API_KEY=')) apiKey = line.split('=')[1].trim();
            if (line.trim().startsWith('GLM_FLASH_API_URL=')) apiUrl = line.split('=')[1].trim();
        }
    } catch (e) {
        console.error('Failed to read .env file:', e.message);
        process.exit(1);
    }

    if (!apiKey || !apiUrl) {
        console.error('Missing GLM_FLASH_API_KEY or GLM_FLASH_API_URL in .env');
        process.exit(1);
    }

    console.log(`Using URL: ${apiUrl}`);
    console.log(`Using Key: ${apiKey.substring(0, 8)}...`);

    const payload = {
        model: 'glm-4.5-flash',
        messages: [
            { role: 'user', content: '你好，确认一下你的身份。' }
        ],
        stream: false
    };

    try {
        const response = await axios.post(apiUrl, payload, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        });

        if (response.status === 200) {
            console.log('\n✅ GLM-4.5-Flash 连接成功！');
            console.log('响应内容:', response.data.choices[0].message.content);
        } else {
            console.error(`\n❌ 连接失败，状态码: ${response.status}`);
            console.error('响应详情:', response.data);
        }
    } catch (error) {
        console.error('\n❌ 请求发生错误:');
        if (error.response) {
            console.error('错误响应:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

testGlm45();
