/**
 * 测试 MiMo-V2 模型
 */
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.MODELSCOPE_API_KEY;
const URL = 'https://api-inference.modelscope.cn/v1/chat/completions';

async function test(model: string) {
    console.log(`测试模型: ${model}`);
    console.log(`API Key: ${API_KEY?.slice(0, 10)}...`);

    try {
        const response = await axios.post(URL, {
            model: model,
            messages: [
                { role: 'user', content: '请回复OK' }
            ],
            stream: false,
            max_tokens: 10
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        console.log('✅ 成功:', response.data?.choices?.[0]?.message?.content);
    } catch (error: any) {
        console.log('❌ 失败');
        console.log('状态码:', error.response?.status);
        console.log('错误详情:', JSON.stringify(error.response?.data, null, 2));
    }
}

async function main() {
    // 测试 mimo-v2
    await test('XiaomiMiMo/MiMo-V2-Flash');
    console.log('\n--- 等待3秒 ---\n');
    await new Promise(r => setTimeout(r, 3000));

    // 测试 deepseek-v3
    await test('deepseek-ai/DeepSeek-V3.2');
}

main();
