
import dotenv from 'dotenv';
import path from 'path';
import { NvidiaLlmProvider } from '../src/services/NvidiaLlmProvider';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

async function testKimi() {
    console.log('Testing Kimi k2.5 with a proper prompt...');
    try {
        const provider = new NvidiaLlmProvider(NVIDIA_API_KEY!, 'moonshotai/kimi-k2.5');
        // Usign a real question to encourage a response
        const response = await provider.generate('你好，请做个自我介绍。', undefined, { maxOutputTokens: 100 });
        console.log(`✅ Kimi Response: "${response.text.trim()}"`);
    } catch (error: any) {
        console.error(`❌ Error: ${error.message}`);
        if (error.response) console.error(JSON.stringify(error.response.data));
    }
}

testKimi();
