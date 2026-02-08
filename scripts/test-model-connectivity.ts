import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { createLlmProvider } from '../src/services/LlmProviderFactory';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const models = [
    'qwen2.5-72b',           // ModelScope
    'zhipu/glm-4.7-flash',   // Zhipu Official
    'glm-4.7-flash',         // ModelScope
    'glm-4.6',               // ModelScope
    'mimo-v2',               // ModelScope
    'qwen3-30b',             // ModelScope
    'deepseek-r1-32b',       // ModelScope
    'deepseek-v3',           // ModelScope
    'gemini/gemini-2.5-flash',
    'gemini/gemini-2.5-flash-lite',
    'gemini/gemini-2.5-pro',
    'gemini/gemini-3-flash'
];

async function runTest() {
    const dummyFile = path.join(__dirname, 'test_connectivity.txt');
    fs.writeFileSync(dummyFile, '这是一次模型连通性测试。请仅返回一个 JSON 对象: {"status": "ok", "message": "hello"}');

    console.log('=========================================');
    console.log('   AI 模型连通性测试 (Connectivity Test)');
    console.log('=========================================');
    console.log(`开始时间: ${new Date().toLocaleString()}`);
    console.log(`API 状态:`);
    console.log(`- ModelScope: ${process.env.MODELSCOPE_API_KEY ? '已配置' : '❌ 未配置'}`);
    console.log(`- Gemini: ${process.env.GEMINI_API_KEY ? '已配置' : '❌ 未配置'}`);
    console.log(`- Zhipu: ${process.env.ZHIPU_API_KEY ? '已配置' : '❌ 未配置'}`);
    console.log('-----------------------------------------\n');

    const results = [];

    for (const m of models) {
        process.stdout.write(`正在测试 [${m}] ... `);
        const start = Date.now();
        try {
            let providerName: string | undefined;
            let modelName = m;

            // Logic from ReportUploadService.ts resolveProviderAndModel
            const input = m.toLowerCase().trim();
            if (input.startsWith('gemini/')) {
                providerName = 'gemini';
                modelName = input.replace('gemini/', '');
            } else if (input.startsWith('zhipu/')) {
                providerName = 'zhipu';
                modelName = input.replace('zhipu/', '');
            } else if (
                input.includes('qwen') ||
                input.includes('deepseek') ||
                input.includes('mimo') ||
                input.includes('glm')
            ) {
                providerName = 'modelscope';
            }

            const provider = createLlmProvider(providerName, modelName);

            // Call parse with dummy file
            const result = await provider.parse({
                reportId: 0,
                versionId: 0,
                storagePath: dummyFile
            });

            const duration = ((Date.now() - start) / 1000).toFixed(1);
            console.log(`✅ 成功 (${duration}s)`);

            const preview = JSON.stringify(result.output).slice(0, 50);
            results.push({
                '模型': m,
                '状态': '✅ 连通',
                '耗时': `${duration}s`,
                '预览': preview + '...'
            });
        } catch (err: any) {
            console.log(`❌ 失败`);
            console.error(`   错误信息: ${err.message}`);
            results.push({
                '模型': m,
                '状态': '❌ 失败',
                '耗时': '-',
                '预览': err.message.slice(0, 100)
            });
        }

        // Small delay to avoid triggering rate limits too fast
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (fs.existsSync(dummyFile)) {
        fs.unlinkSync(dummyFile);
    }

    console.log('\n================ Final Results ================');
    console.table(results);
    console.log('==============================================');
}

runTest().catch(err => {
    console.error('\n程序运行出错:', err);
    process.exit(1);
});
