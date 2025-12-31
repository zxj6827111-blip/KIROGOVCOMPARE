import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';

// Disable warnings to see cleaner output or enable to debug
// process.env.VERBOSITY = 'verbose'; 

async function reproduce() {
    // The file identified from logs
    const pdfPath = String.raw`D:\软件开发\谷歌反重力开发\KIROGOVCOMPARE\data\uploads\79\2024\e3b88837440aaa48d0c3a84efa1e10775a181080875411130200530696b3e61b.pdf`;

    if (!fs.existsSync(pdfPath)) {
        console.error('File not found:', pdfPath);
        return;
    }

    console.log('Parsing:', pdfPath);
    try {
        const result = await PdfParseService.parsePDF(pdfPath, 'repro_cmap');

        if (result.success) {
            console.log('✅ Parse Success (Unexpected if checking for failure)');
            console.log('Text length:', result.document?.extracted_text.length);
            console.log('Text preview:', result.document?.extracted_text.slice(0, 200));
        } else {
            console.error('❌ Parse Failed:', result.error);
        }
    } catch (err) {
        console.error('❌ Error during reproduction:', err);
    }
}

reproduce();
