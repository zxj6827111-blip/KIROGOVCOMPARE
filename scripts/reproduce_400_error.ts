import * as fs from 'fs';
import * as path from 'path';
import PdfParseService from '../src/services/PdfParseService';

async function reproduce() {
    // The file identified from logs
    const pdfPath = String.raw`D:\软件开发\谷歌反重力开发\KIROGOVCOMPARE\data\uploads\6\2024\401aa1bb2323ceb2d9cb33040280810d6124be957cdc0cb005c6af90a19eea80.pdf`;

    if (!fs.existsSync(pdfPath)) {
        console.error('File not found:', pdfPath);
        return;
    }

    console.log('Parsing:', pdfPath);
    try {
        const result = await PdfParseService.parsePDF(pdfPath, 'repro_400');

        if (result.success) {
            const text = result.document?.extracted_text || '';
            console.log('✅ Parse Success');
            console.log('Text length:', text.length);
            console.log('Text preview start:', text.slice(0, 500));
            console.log('Text preview end:', text.slice(-500));

            // Check for issues that might cause 400
            if (text.length === 0) console.warn('WARNING: Extracted text is empty!');
        } else {
            console.error('❌ Parse Failed:', result.error);
        }
    } catch (err) {
        console.error('❌ Error during reproduction:', err);
    }
}

reproduce();
