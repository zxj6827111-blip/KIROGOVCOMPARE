
import dotenv from 'dotenv';
import path from 'path';
import { NvidiaLlmProvider } from '../src/services/NvidiaLlmProvider';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

console.log('--- NVIDIA Model Connectivity Diagnostic ---');

if (!NVIDIA_API_KEY) {
    console.error('❌ Error: NVIDIA_API_KEY is missing in .env file.');
    process.exit(1);
}

const maskedKey = NVIDIA_API_KEY.substring(0, 5) + '...' + NVIDIA_API_KEY.substring(NVIDIA_API_KEY.length - 4);
console.log(`✅ Loaded Key: ${maskedKey}`);

async function tryModel(modelName: string) {
    process.stdout.write(`Testing model ID: "${modelName}" ... `);
    try {
        const provider = new NvidiaLlmProvider(NVIDIA_API_KEY!, modelName);
        // Using a very short prompt to minimise cost/time
        const response = await provider.generate('Hi', undefined, { maxOutputTokens: 5 });
        console.log(`✅ SUCCESS!`);
        return true;
    } catch (error: any) {
        if (error.response?.status === 404) {
            console.log(`❌ 404 Not Found (Invalid Model ID)`);
        } else if (error.response?.status === 401) {
            console.log(`❌ 401 Unauthorized (Invalid Key)`);
        } else {
            console.log(`❌ Error: ${error.message}`);
        }
        return false;
    }
}

async function runDiagnostics() {
    console.log('\n--- DeepSeek Candidates ---');
    // Candidates for DeepSeek
    const deepseekCandidates = [
        'deepseek-ai/deepseek-v3',
        'deepseek-ai/deepseek-v3-base',
        'nvidia/deepseek-ai/deepseek-v3', // NIM hosted often uses this full path
        'deepseek-ai/deepseek-v3.2', // Search result mentioned this
    ];

    for (const m of deepseekCandidates) {
        if (await tryModel(m)) break; // Stop after first success
    }

    console.log('\n--- Kimi Candidates ---');
    // Candidates for Kimi
    const kimiCandidates = [
        'moonshotai/kimi-k2.5',
        'moonshotai/moonshot-v1-8k', 
        'nvidia/moonshotai/kimi-k2.5'
    ];

    for (const m of kimiCandidates) {
        if (await tryModel(m)) break;
    }
}

runDiagnostics();
