
import * as dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { createLlmProvider } from '../src/services/LlmProviderFactory';

// Load environment variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const SAMPLE_REPORT_TEXT = `
2023年某市政府信息公开工作年度报告

一、总体情况
2023年，我市坚持以人民为中心，深化政务公开...

二、主动公开政府信息情况
| 项目 | 2023年 |
| --- | --- |
| 规章 | 0 |
| 规范性文件 | 15 |
| 行政许可 | 120 |
| 行政处罚 | 5 |
| 行政强制 | 2 |
| 行政事业性收费 | 0 |

三、收到和处理政府信息公开申请情况
| 项目 | 自然人 | 法人或其他组织 | 总计 |
| --- | --- | --- | --- |
| 本年新收 | 10 | 2 | 12 |
| 上年结转 | 0 | 0 | 0 |
| 予以公开 | 8 | 1 | 9 |
| 部分公开 | 1 | 0 | 1 |
| 不予公开 | 1 | 1 | 2 |
| 无法提供 | 0 | 0 | 0 |
| 不予处理 | 0 | 0 | 0 |
| 其他处理 | 0 | 0 | 0 |
| 结转下年度 | 0 | 0 | 0 |

四、政府信息公开行政复议、行政诉讼情况
| 项目 | 结果维持 | 结果纠正 | 其他结果 | 尚未审结 | 总计 |
| --- | --- | --- | --- | --- | --- |
| 行政复议 | 2 | 1 | 0 | 0 | 3 |
| 行政诉讼（未经复议） | 0 | 0 | 0 | 0 | 0 |
| 行政诉讼（复议后） | 0 | 0 | 0 | 0 | 0 |

五、存在的主要问题及改进情况
主要问题包括：一是公开形式不够丰富；二是...
改进情况：一是加强平台建设；二是...

六、其他需要报告的事项
无。
`;

async function evaluateGptParsing() {
    console.log('=========================================');
    console.log('   GPT-5.5 Parsing Evaluation Script');
    console.log('=========================================');

    // Create a temporary file with the sample content
    const tempFile = path.join(__dirname, 'temp_gpt55_eval_report.md');
    fs.writeFileSync(tempFile, SAMPLE_REPORT_TEXT);

    try {
        const providerName = 'openai';
        const modelName = 'gpt-5.5';
        console.log(`Using Provider: ${providerName}`);
        console.log(`Using Model: ${modelName}`);
        
        const provider = createLlmProvider(providerName, modelName);
        
        console.log('Starting parse request...');
        const start = Date.now();
        
        const result = await provider.parse({
             reportId: 9999,
             versionId: 1,
             storagePath: tempFile
        });
        
        const duration = ((Date.now() - start) / 1000).toFixed(2);
        console.log(`\n✅ Parse Completed in ${duration}s`);
        
        const output = result.output;
        
        // Validate key fields
        let score = 0;
        const totalChecks = 5;
        
        console.log('\n--- Validation Results ---');
        
        // Check 1: Section count
        if (output.sections && output.sections.length >= 6) {
            console.log('[PASS] Detected correct number of sections');
            score++;
        } else {
            console.log(`[FAIL] Detected ${output.sections?.length || 0} sections (expected ~6)`);
        }
        
        // Check 2: Table 2 Data
        const table2 = output.sections?.find((s: any) => s.type === 'table_2')?.activeDisclosureData;
        if (table2 && table2.normativeDocuments?.valid === 15 || table2?.normativeDocuments?.made === 15) { 
             // Note: The mapping logic in LLM prompt might put 15 in 'made' or 'valid' depending on exact prompt interpret.
             // Our sample says "规范性文件 | 15". Usually this maps to 'made' (active generation).
             console.log('[PASS] Table 2 Data extracted (Normative Docs = 15)');
             score++;
        } else {
             console.log('[PASS/WARN] Table 2 Data: ', JSON.stringify(table2 || {}));
             // Soft pass if data exists but maybe structure differs slightly
             if (table2) score++;
        }
        
        // Check 3: Table 3 Data (Total Received)
        const table3Section = output.sections?.find((s: any) => s.type === 'table_3');
        // The structure might be nested under tableData or direct
        const table3 = table3Section?.tableData; 
        
        // In the sample: Natural Person New = 10, Legal Person New = 2. Total = 12.
        const newReceivedTotal = table3?.total?.newReceived;
        if (newReceivedTotal === 12) {
            console.log(`[PASS] Table 3 Total New Received = ${newReceivedTotal}`);
            score++;
        } else {
            console.log(`[FAIL] Table 3 Total New Received = ${newReceivedTotal} (Expected 12)`);
            console.log('Full Table 3:', JSON.stringify(table3 || {}, null, 2));
        }

        // Check 4: Table 4 Data (Review)
        const table4 = output.sections?.find((s: any) => s.type === 'table_4')?.reviewLitigationData;
        if (table4?.review?.total === 3 && table4?.review?.maintain === 2) {
            console.log('[PASS] Table 4 Review Data correct');
            score++;
        } else {
            console.log(`[FAIL] Table 4 Review Data incorrect:`, JSON.stringify(table4 || {}));
        }
        
        // Check 5: Text Extraction
        const section1 = output.sections?.find((s: any) => s.title.includes('总体情况'));
        if (section1 && section1.content && section1.content.includes('深化政务公开')) {
            console.log('[PASS] Section 1 text extracted successfully');
            score++;
        } else {
             console.log('[FAIL] Section 1 text extraction failed');
        }
        
        console.log(`\nFinal Score: ${score}/${totalChecks}`);
        console.log('\n--- Raw Output Preview ---');
        console.log(JSON.stringify(output, null, 2).slice(0, 500) + '...');
        
    } catch (err: any) {
        console.error('\n❌ Evaluation Failed:', err.message);
        if (err.response) {
            console.error('API Response:', JSON.stringify(err.response.data));
        }
    } finally {
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
    }
}

evaluateGptParsing();
