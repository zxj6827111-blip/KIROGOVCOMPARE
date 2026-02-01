import axios, { AxiosError } from 'axios';
import * as dotenv from 'dotenv';
import path from 'path';

// 加载环境变量
dotenv.config();

const PRIMARY_KEY = process.env.MODELSCOPE_API_KEY;
const BACKUP_KEY = process.env.MODELSCOPE_API_KEY_BACKUP;
const BASE_URL = 'https://api-inference.modelscope.cn/v1/chat/completions';

/**
 * 待测试模型列表
 * 格式为: [前端别名 (如果有), 实际模型 ID]
 */
const MODELS_TO_TEST: [string | null, string][] = [
    ['qwen2.5-72b', 'Qwen/Qwen2.5-72B-Instruct'],
    ['glm-4.7-flash', 'ZhipuAI/GLM-4.7-Flash'],
    ['glm-4.6', 'ZhipuAI/GLM-4.6'],
    ['mimo-v2', 'XiaomiMiMo/MiMo-V2-Flash'],
    ['qwen3-30b', 'Qwen/Qwen3-30B-A3B-Instruct-2507'],
    ['deepseek-v3', 'deepseek-ai/DeepSeek-V3.2'],
    ['deepseek-r1-32b', 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B'],
    [null, 'Qwen/Qwen3-235B-A22B-Instruct-2507'],
    [null, 'ZhipuAI/glm-4-plus']
];

interface TestResult {
    alias: string | null;
    modelId: string;
    status: '✅ 成功' | '❌ 失败';
    usingKey: 'Primary' | 'Backup' | 'None';
    duration: number;
    error?: string;
    response?: string;
}

async function testModel(alias: string | null, modelId: string): Promise<TestResult> {
    const startTime = Date.now();
    let usingKey: 'Primary' | 'Backup' | 'None' = 'None';
    let currentKey = PRIMARY_KEY;

    if (!currentKey && !BACKUP_KEY) {
        return {
            alias,
            modelId,
            status: '❌ 失败',
            usingKey: 'None',
            duration: 0,
            error: '未配置 MODELSCOPE_API_KEY'
        };
    }

    async function attempt(apiKey: string): Promise<{ response: string, reasoning?: string }> {
        const resp = await axios.post(
            BASE_URL,
            {
                model: modelId,
                messages: [
                    { role: 'system', content: 'You are a helpful assistant.' },
                    { role: 'user', content: 'Say "OK"' }
                ],
                stream: false,
                max_tokens: 10
            },
            {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000 // 30秒超时
            }
        );
        return {
            response: resp.data?.choices?.[0]?.message?.content || JSON.stringify(resp.data),
            reasoning: resp.data?.choices?.[0]?.message?.reasoning_content
        };
    }

    try {
        if (PRIMARY_KEY) {
            usingKey = 'Primary';
            const res = await attempt(PRIMARY_KEY);
            return {
                alias,
                modelId,
                status: '✅ 成功',
                usingKey,
                duration: Date.now() - startTime,
                response: res.response
            };
        }
        throw new Error('No primary key');
    } catch (err: any) {
        if (BACKUP_KEY && PRIMARY_KEY !== BACKUP_KEY) {
            console.log(`[${modelId}] Primary key failed, trying backup...`);
            try {
                usingKey = 'Backup';
                const res = await attempt(BACKUP_KEY);
                return {
                    alias,
                    modelId,
                    status: '✅ 成功',
                    usingKey,
                    duration: Date.now() - startTime,
                    response: res.response
                };
            } catch (backupErr: any) {
                return {
                    alias,
                    modelId,
                    status: '❌ 失败',
                    usingKey: 'Backup',
                    duration: Date.now() - startTime,
                    error: backupErr.response?.data?.message || backupErr.message
                };
            }
        }
        return {
            alias,
            modelId,
            status: '❌ 失败',
            usingKey: 'Primary',
            duration: Date.now() - startTime,
            error: err.response?.data?.message || err.message
        };
    }
}

async function runAllTests() {
    console.log('================================================================');
    console.log('🚀 魔搭社区 (ModelScope) 模型可用性全量测试');
    console.log(`时间: ${new Date().toLocaleString()}`);
    console.log('================================================================\n');

    const results: TestResult[] = [];

    for (const [alias, modelId] of MODELS_TO_TEST) {
        console.log(`正在测试: ${modelId} ${alias ? `(${alias})` : ''}...`);
        const result = await testModel(alias, modelId);
        results.push(result);

        if (result.status === '✅ 成功') {
            console.log(`   ${result.status} | 耗时: ${result.duration}ms | Key: ${result.usingKey}`);
        } else {
            console.log(`   ${result.status} | 错误: ${result.error}`);
        }

        // 等待 2 秒，避免过快触发频率限制
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    console.log('\n================================================================');
    console.log('📊 测试结果汇总');
    console.log('================================================================');
    console.table(results.map(r => ({
        '模型 ID': r.modelId,
        '别名': r.alias || '-',
        '状态': r.status,
        'Key': r.usingKey,
        '耗时(ms)': r.duration,
        '备注/错误': r.error ? r.error.slice(0, 50) : (r.response?.trim() || '无响应内容')
    })));

    const successCount = results.filter(r => r.status === '✅ 成功').length;
    console.log(`\n总结: 总计 ${MODELS_TO_TEST.length} 个模型, 成功 ${successCount} 个, 失败 ${MODELS_TO_TEST.length - successCount} 个。`);
    console.log('================================================================');
}

runAllTests().catch(console.error);
