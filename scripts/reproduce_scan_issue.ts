import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';

async function reproduce() {
    // The latest file found
    // The latest file found
    const pdfPath = String.raw`D:\软件开发\谷歌反重力开发\KIROGOVCOMPARE\data\uploads\79\2024\ab8f5400089e3906a233f61cd70b58ce600cc7a881b4e16a85cb0ba9fc82f7b8.pdf`;

    if (!fs.existsSync(pdfPath)) {
        console.error('File not found:', pdfPath);
        return;
    }

    console.log('Parsing:', pdfPath);
    console.time('ParseTime');
    try {
        const result = await PdfParseService.parsePDF(pdfPath, 'repro_scan_issue');
        console.timeEnd('ParseTime');

        if (result.success) {
            const text = result.document?.extracted_text || '';
            console.log('✅ Parse Success');
            console.log('Total Length:', text.length);

            console.log('\n--- TEXT SAMPLE (Start) ---');
            console.log(text.slice(0, 1000));
            console.log('\n--- TEXT SAMPLE (Middle) ---');
            const mid = Math.floor(text.length / 2);
            console.log(text.slice(mid, mid + 1000));

            console.log('\n--- SPACING CHECK ---');
            // Check for patterns like "政 策"
            const spacingMatch = text.match(/[\u4e00-\u9fa5]\s+[\u4e00-\u9fa5]/g);
            if (spacingMatch) {
                console.warn('⚠️ Found potential CJK spacing issues:', spacingMatch.slice(0, 10));
            } else {
                console.log('✅ No obvious CJK spacing issues found.');
            }

        } else {
            console.error('❌ Parse Failed:', result.error);
        }
    } catch (err) {
        console.error('❌ Error during reproduction:', err);
    }
}

reproduce();
