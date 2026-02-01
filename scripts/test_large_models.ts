/**
 * 测试更大参数量的模型 - 用于提升表格识别准确率
 */
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.MODELSCOPE_API_KEY;
const URL = 'https://api-inference.modelscope.cn/v1/chat/completions';

const modelsToTest = [
    ['Qwen/Qwen2.5-72B-Instruct', '通义千问 2.5-72B (大模型)'],
    ['ZhipuAI/GLM-4.6', '智谱 GLM-4.6'],
    ['Qwen/Qwen2.5-14B-Instruct', '通义千问 2.5-14B'],
    ['deepseek-ai/DeepSeek-R1-Distill-Qwen-14B', 'DeepSeek R1-14B'],
];

async function test(model: string, displayName: string) {
    console.log(`\n测试: ${displayName}`);
    console.log(`模型ID: ${model}`);

    try {
        const startTime = Date.now();
        const response = await axios.post(URL, {
            model: model,
            messages: [{ role: 'user', content: '请回复OK' }],
            stream: false,
            max_tokens: 20
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 60000
        });
        const elapsed = Date.now() - startTime;
        console.log(`✅ 成功 (${elapsed}ms):`, response.data?.choices?.[0]?.message?.content?.slice(0, 50));
        return true;
    } catch (error: any) {
        const status = error.response?.status;
        const msg = error.response?.data?.errors?.message ||
            error.response?.data?.error?.message ||
            error.message;
        console.log(`❌ 失败 (HTTP ${status}): ${String(msg).slice(0, 100)}`);
        return false;
    }
}

async function main() {
    console.log('========================================');
    console.log('大模型可用性测试 - 提升表格识别准确率');
    console.log('========================================');

    let successCount = 0;
    for (const [model, name] of modelsToTest) {
        const ok = await test(model, name);
        if (ok) successCount++;
        await new Promise(r => setTimeout(r, 3000));
    }

    console.log('\n========================================');
    console.log(`测试完成: ${successCount}/${modelsToTest.length} 个模型可用`);
    console.log('========================================');
}

main();
