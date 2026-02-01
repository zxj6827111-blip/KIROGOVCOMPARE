/**
 * 测试魔搭社区 API - 单次调用测试
 * 用于诊断"并发太大"错误的真正原因
 */

import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.MODELSCOPE_API_KEY;
const URL = 'https://api-inference.modelscope.cn/v1/chat/completions';

// 测试用的简单文本
const TEST_TEXT = `
这是一个测试文本。
表一：主动公开信息统计
项目  数量
政府文件 100
政策解读 50
`;

async function testSingleCall(model: string): Promise<void> {
    console.log(`\n==========================================`);
    console.log(`测试模型: ${model}`);
    console.log(`==========================================`);

    if (!API_KEY) {
        console.error('❌ 错误: MODELSCOPE_API_KEY 未设置');
        return;
    }

    const startTime = Date.now();

    try {
        console.log(`发送请求到: ${URL}`);
        console.log(`API Key: ${API_KEY.slice(0, 10)}...${API_KEY.slice(-4)}`);

        const response = await axios.post(
            URL,
            {
                model: model,
                messages: [
                    { role: 'system', content: '你是一个测试助手，请简短回复。' },
                    { role: 'user', content: '请回复"OK"表示你收到了消息。' }
                ],
                stream: false,
                max_tokens: 50
            },
            {
                headers: {
                    'Authorization': `Bearer ${API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 60000
            }
        );

        const elapsed = Date.now() - startTime;
        console.log(`\n✅ 请求成功! 耗时: ${elapsed}ms`);
        console.log(`响应:`, response.data?.choices?.[0]?.message?.content || response.data);

    } catch (error: any) {
        const elapsed = Date.now() - startTime;
        console.log(`\n❌ 请求失败! 耗时: ${elapsed}ms`);

        if (axios.isAxiosError(error)) {
            const status = error.response?.status;
            const data = error.response?.data;

            console.log(`HTTP 状态码: ${status}`);
            console.log(`错误响应:`, JSON.stringify(data, null, 2));

            if (status === 429) {
                console.log(`\n🔴 这是速率限制错误 (Too Many Requests)`);
                console.log(`   建议: 等待一段时间后再试，或检查账户额度`);
            } else if (status === 401 || status === 403) {
                console.log(`\n🔴 这是认证错误`);
                console.log(`   建议: 检查 API Key 是否正确或是否已过期`);
            } else if (status === 400) {
                const msg = data?.message || data?.error?.message || '';
                if (msg.includes('stream')) {
                    console.log(`\n🔴 该模型只支持流式输出`);
                    console.log(`   建议: 换一个模型，如 qwen3-235b 或 deepseek-v3`);
                } else {
                    console.log(`\n🔴 请求参数错误`);
                    console.log(`   错误信息: ${msg}`);
                }
            }
        } else {
            console.log(`错误类型: ${error.name}`);
            console.log(`错误信息: ${error.message}`);
        }
    }
}

async function main() {
    console.log('========================================');
    console.log('魔搭社区 API 单次调用测试');
    console.log('========================================');
    console.log(`时间: ${new Date().toLocaleString()}`);

    // 测试三个模型
    const models = [
        'Qwen/Qwen3-235B-A22B-Instruct-2507',  // qwen3-235b
        'deepseek-ai/DeepSeek-V3.2',           // deepseek-v3
        'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B'  // deepseek-r1-32b
    ];

    for (const model of models) {
        await testSingleCall(model);
        // 等待5秒再测试下一个，避免触发速率限制
        console.log('\n等待 5 秒...');
        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    console.log('\n========================================');
    console.log('测试完成');
    console.log('========================================');
}

main().catch(console.error);
