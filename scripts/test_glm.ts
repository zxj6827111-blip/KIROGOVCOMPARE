
import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

async function runTest() {
    const apiKey = 'ms-ed6b42e7-95f3-4390-876c-c83cf7464ce8'; // Using key provided by user
    const model = 'ZhipuAI/GLM-4.7';

    console.log(`Testing with model: ${model}`);

    const url = 'https://api-inference.modelscope.cn/v1/chat/completions';

    try {
        console.log('Sending API request...');
        const response = await axios.post(
            url,
            {
                model: model,
                messages: [{ role: 'user', content: 'Hello, are you ready? Please output a simple JSON object: {"status": "ready"}' }],
                stream: false
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        console.log('Status:', response.status);
        console.log('Full Response Data:', JSON.stringify(response.data, null, 2));

        const choice = response.data.choices[0];
        if (choice.message.reasoning_content) {
            console.log('Has reasoning_content:', choice.message.reasoning_content);
        }
        console.log('Content:', choice.message.content);

    } catch (error: any) {
        console.error('Error:', error.response?.data || error.message);
    }
}

runTest();
