import * as fs from 'fs';
import PdfParseService from '../src/services/PdfParseService';

async function inspect() {
    const pdfPath = String.raw`D:\软件开发\谷歌反重力开发\KIROGOVCOMPARE\data\uploads\79\2024\ab8f5400089e3906a233f61cd70b58ce600cc7a881b4e16a85cb0ba9fc82f7b8.pdf`;

    if (!fs.existsSync(pdfPath)) {
        console.error('File not found:', pdfPath);
        return;
    }

    const result = await PdfParseService.parsePDF(pdfPath, 'inspect_chars');
    if (!result.success || !result.document) {
        console.error('Parse failed');
        return;
    }

    const text = result.document.extracted_text;

    // Find a specific problematic sequence, e.g. "年" then space then "度"
    // Scan for it
    const match = /年\s+度/.exec(text);
    if (match) {
        console.log('Found "年 度" at index', match.index);
        const substring = text.substring(match.index, match.index + match[0].length);
        console.log('Substring:', substring);
        console.log('Char codes:');
        for (let i = 0; i < substring.length; i++) {
            console.log(`${substring[i]}: ${substring.charCodeAt(i)} (0x${substring.charCodeAt(i).toString(16)})`);
        }
    } else {
        // Try generalized search
        const genMatch = /[\u4e00-\u9fa5].[\u4e00-\u9fa5]/.exec(text);
        if (genMatch) {
            console.log('Found generalized sequence:', genMatch[0]);
            for (let i = 0; i < genMatch[0].length; i++) {
                console.log(`${genMatch[0][i]}: ${genMatch[0].charCodeAt(i)} (0x${genMatch[0].charCodeAt(i).toString(16)})`);
            }
        } else {
            console.log('Could not find problematic sequence with simple regex.');
        }
    }
}

inspect();
