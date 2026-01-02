const axios = require('axios');
const fs = require('fs');
const path = require('path');

async function testAll() {
    console.log('--- 🛡️  Starting Comprehensive Model Connectivity Test 🛡️  ---\n');

    // 1. Read .env
    let env = {};
    try {
        const envContent = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
        envContent.split('\n').forEach(line => {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                const parts = line.split('=');
                const key = parts[0].trim();
                const value = parts.slice(1).join('=').trim();
                env[key] = value;
            }
        });
        console.log('✅ .env file read successfully\n');
    } catch (e) {
        console.error('❌ Failed to read .env file:', e.message);
        process.exit(1);
    }

    // Helper for ModelScope
    async function checkModelScope(name, key, model) {
        process.stdout.write(`Testing ModelScope [${name}]... `);
        try {
            const resp = await axios.post(
                'https://api-inference.modelscope.cn/v1/chat/completions',
                {
                    model: model,
                    messages: [{ role: 'user', content: 'hi' }],
                    stream: false
                },
                {
                    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
                    timeout: 10000
                }
            );
            if (resp.status === 200) console.log('✅ OK');
            else console.log(`❌ Failed (${resp.status})`);
        } catch (e) {
            const msg = e.response?.data?.message || e.message;
            if (msg.includes('InvalidApiKey')) console.log('❌ Invalid API Key');
            else console.log(`❌ Error: ${msg}`);
        }
    }

    // Helper for Gemini
    async function checkGemini(key, model) {
        process.stdout.write(`Testing Gemini [${model}]... `);
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
            const resp = await axios.post(url, { contents: [{ parts: [{ text: "hi" }] }] }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });
            if (resp.status === 200) console.log('✅ OK');
            else console.log(`❌ Failed (${resp.status})`);
        } catch (e) {
            const msg = e.response?.data?.error?.message || e.message;
            console.log(`❌ Error: ${msg}`);
        }
    }

    // Helper for Zhipu
    async function checkZhipu(name, key, url, model) {
        process.stdout.write(`Testing Zhipu [${name} / ${model}]... `);
        try {
            const resp = await axios.post(
                url,
                { model: model, messages: [{ role: 'user', content: 'hi' }], stream: false },
                {
                    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
                    timeout: 10000
                }
            );
            if (resp.status === 200) console.log('✅ OK');
            else console.log(`❌ Failed (${resp.status})`);
        } catch (e) {
            const errData = e.response?.data?.error;
            const code = errData?.code;
            const msg = errData?.message || e.message;
            if (code == '1305') console.log('⚠️ Rate Limit (1305) - API Valid but overloaded');
            else console.log(`❌ Error: ${msg}`);
        }
    }

    // --- EXECUTE TESTS ---

    // 1. ModelScope Primary
    if (env.MODELSCOPE_API_KEY) {
        // Use a lightweight Qwen model for testing connectivity
        await checkModelScope('Primary Key', env.MODELSCOPE_API_KEY, 'Qwen/Qwen2.5-Coder-32B-Instruct');
    } else {
        console.log('⚪ ModelScope Primary: Not Configured');
    }

    // 2. ModelScope Backup
    if (env.MODELSCOPE_API_KEY_BACKUP) {
        await checkModelScope('Backup Key', env.MODELSCOPE_API_KEY_BACKUP, 'Qwen/Qwen2.5-Coder-32B-Instruct');
    } else {
        console.log('⚪ ModelScope Backup: Not Configured');
    }

    // 3. Gemini
    if (env.GEMINI_API_KEY) {
        await checkGemini(env.GEMINI_API_KEY, 'gemini-2.0-flash-exp');
    } else {
        console.log('⚪ Gemini: Not Configured');
    }

    // 4. Zhipu GLM-4-Flash
    if (env.GLM_FLASH_API_KEY) {
        await checkZhipu('GLM-4-Flash', env.GLM_FLASH_API_KEY, env.GLM_FLASH_API_URL, 'glm-4-flash');
    } else {
        console.log('⚪ GLM-4-Flash: Not Configured');
    }

    // 5. Zhipu GLM-4.5-Flash
    if (env.GLM_FLASH_API_KEY) {
        await checkZhipu('GLM-4.5-Flash', env.GLM_FLASH_API_KEY, env.GLM_FLASH_API_URL, 'glm-4.5-flash');
    }
}

testAll();
