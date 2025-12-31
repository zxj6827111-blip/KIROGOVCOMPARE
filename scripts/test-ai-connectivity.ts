import dotenv from 'dotenv';
import path from 'path';
import { createLlmProvider } from '../src/services/LlmProviderFactory';
import { LlmProviderError } from '../src/services/LlmProvider';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

async function checkModel(alias: string, providerName: string, modelName: string) {
    console.log(`\n--- Testing ${alias} (${modelName}) ---`);
    try {
        const provider = createLlmProvider(providerName, modelName);

        // Create a dummy file
        const fs = require('fs');
        const dummyPath = path.join(__dirname, `test_${alias}.txt`);
        fs.writeFileSync(dummyPath, `Test content for ${alias}. Please ignore.`);

        const request = {
            reportId: 0,
            versionId: 0,
            storagePath: dummyPath,
            fileHash: 'test_hash'
        };

        console.log(`Sending request to ${providerName}...`);
        await provider.parse(request);
        console.log(`✅ ${alias}: Success (Connection verified)`);

        fs.unlinkSync(dummyPath);
        return true;
    } catch (error: any) {
        if (error instanceof LlmProviderError) {
            console.error(`❌ ${alias} Failed: [${error.code}] ${error.message}`);
        } else {
            console.error(`❌ ${alias} Failed: ${error.message || error}`);
        }
        return false;
    }
}

async function testConnectivity() {
    console.log('Starting Dual-Model Connectivity Test...');

    // Test 1: Qwen3-235B
    await checkModel('Qwen3-235B', 'modelscope', 'Qwen/Qwen3-235B-A22B-Instruct-2507');

    // Test 2: DeepSeek V3.2
    await checkModel('DeepSeek V3.2', 'modelscope', 'deepseek-ai/DeepSeek-V3.2'); // Using the V3.2 ID we updated

    console.log('\nTest Completed.');
}

testConnectivity();
