
import axios from 'axios';
import { ModelScopeLlmProvider } from '../src/services/ModelScopeLlmProvider';
import * as dotenv from 'dotenv';
dotenv.config();

async function runTest() {
    const apiKey = 'ms-ed6b42e7-95f3-4390-876c-c83cf7464ce8';

    const model = 'Qwen/Qwen3-235B-A22B-Instruct-2507';
    console.log(`Testing with model: ${model}`);

    // Direct axios test first
    try {
        console.log('Sending direct API request...');
        const resp = await axios.post(
            'https://api-inference.modelscope.cn/v1/chat/completions',
            {
                model: model,
                messages: [{ role: 'user', content: 'Say "Hello ModelScope" if you can hear me.' }],
                stream: false
            },
            {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            }
        );
        console.log('Direct API Response:', JSON.stringify(resp.data, null, 2));
    } catch (err: any) {
        console.error('Direct API Error:', err.response?.data || err.message);
    }

    // Provider test
    try {
        console.log('Testing ModelScopeLlmProvider mock...');
        const provider = new ModelScopeLlmProvider(apiKey, model);
        // We can't easily test parse without a file, but we can verify instantiation
        console.log('Provider instantiated.');
    } catch (err) {
        console.error('Provider Error:', err);
    }
}

runTest();
