import axios from 'axios';
import * as dotenv from 'dotenv';
dotenv.config();

async function testModel(modelName: string) {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    console.log(`Testing model: ${modelName}`);
    try {
        const response = await axios.post(url, {
            contents: [{ parts: [{ text: "Hello" }] }],
            generationConfig: {
                responseMimeType: 'application/json',
            }
        });
        console.log(`✅ ${modelName} works!`);
    } catch (error: any) {
        console.error(`❌ ${modelName} failed:`, error.response?.status, error.response?.data?.error?.message || error.message);
    }
}

async function run() {
    await testModel('gemini-1.5-flash');
    await testModel('gemini-3-pro-preview');
    await testModel('gemini-3-flash-preview');
}

run();
