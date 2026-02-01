/**
 * 测试智谱官方 API 连通性
 */
import OpenAI from 'openai';
import * as dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.ZHIPU_API_KEY;

async function testZhipuOfficial() {
    console.log('========================================');
    console.log('智谱官方 API 连通性测试');
    console.log(`时间: ${new Date().toLocaleString()}`);
    console.log('========================================\n');

    if (!API_KEY) {
        console.error('❌ 错误: ZHIPU_API_KEY 未设置');
        console.log('\n请在 .env 文件中添加:');
        console.log('ZHIPU_API_KEY=your-api-key-here');
        return;
    }

    console.log(`API Key: ${API_KEY.slice(0, 10)}...${API_KEY.slice(-4)}`);

    const client = new OpenAI({
        apiKey: API_KEY,
        baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    });

    const models = ['glm-4.7-flash', 'glm-4-flash'];

    for (const model of models) {
        console.log(`\n正在测试: ${model}...`);
        const startTime = Date.now();

        try {
            const response = await client.chat.completions.create({
                model: model,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'Say "OK" if you can hear me.' }
                ],
                max_tokens: 10
            });

            const elapsed = Date.now() - startTime;
            const content = response.choices?.[0]?.message?.content || '(empty)';
            console.log(`   ✅ 成功 | 耗时: ${elapsed}ms | 响应: ${content.trim()}`);
        } catch (error: any) {
            const elapsed = Date.now() - startTime;
            console.log(`   ❌ 失败 | 耗时: ${elapsed}ms | 错误: ${error.message}`);
        }
    }

    console.log('\n========================================');
    console.log('测试完成');
    console.log('========================================');
}

testZhipuOfficial().catch(console.error);
