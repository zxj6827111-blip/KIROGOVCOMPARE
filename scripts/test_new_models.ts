/**
 * 测试新配置的模型
 */
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const API_KEY = process.env.MODELSCOPE_API_KEY;
const URL = 'https://api-inference.modelscope.cn/v1/chat/completions';

async function test(model: string, displayName: string) {
    console.log(`\n测试: ${displayName}`);
    console.log(`模型ID: ${model}`);

    try {
        const response = await axios.post(URL, {
            model: model,
            messages: [{ role: 'user', content: '请回复OK' }],
            stream: false,
            max_tokens: 10
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });
        console.log('✅ 成功:', response.data?.choices?.[0]?.message?.content?.slice(0, 50));
        return true;
    } catch (error: any) {
        const status = error.response?.status;
        const msg = error.response?.data?.errors?.message || error.response?.data?.error?.message || '';
        console.log(`❌ 失败 (HTTP ${status}): ${msg.slice(0, 80)}`);
        return false;
    }
}

async function main() {
    console.log('========================================');
    console.log('新模型可用性测试');
    console.log('========================================');

    const models = [
        ['ZhipuAI/GLM-4.7-Flash', '智谱 GLM-4.7-Flash (推荐)'],
        ['Qwen/Qwen3-30B-A3B-Instruct-2507', '通义千问 Qwen3-30B'],
        ['deepseek-ai/DeepSeek-R1-Distill-Qwen-32B', 'DeepSeek R1-32B'],
    ];

    let successCount = 0;
    for (const [model, name] of models) {
        const ok = await test(model, name);
        if (ok) successCount++;
        await new Promise(r => setTimeout(r, 3000)); // 间隔3秒
    }

    console.log('\n========================================');
    console.log(`测试完成: ${successCount}/${models.length} 个模型可用`);
    console.log('========================================');
}

main();
