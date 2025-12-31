import * as dotenv from 'dotenv';
dotenv.config();
import { GeminiLlmProvider } from '../src/services/GeminiLlmProvider';
import * as path from 'path';

async function run() {
    const apiKey = process.env.GEMINI_API_KEY!;
    const model = process.env.GEMINI_MODEL!;
    const provider = new GeminiLlmProvider(apiKey, model);

    // Job 200 / Version 59 details
    const request = {
        reportId: 71,
        versionId: 59,
        storagePath: 'data\\uploads\\79\\2024\\a1348bf9fcb7dfd1b74384bdabdded24960fa591e18310bf548fcbf4c09a715a.txt',
        fileHash: 'a1348bf9fcb7dfd1b74384bdabdded24960fa591e18310bf548fcbf4c09a715a'
    };

    console.log('Starting parse reproduction...');
    try {
        const result = await provider.parse(request);
        console.log('✅ Success:', JSON.stringify(result, null, 2));
    } catch (error: any) {
        console.error('❌ Failed:', error.message);
        if (error.code) console.error('Code:', error.code);
    }
}

run();
