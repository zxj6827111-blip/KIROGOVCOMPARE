import * as fs from 'fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.js';

const pdfjs = (pdfjsLib as any).default || pdfjsLib;

async function diagnose() {
    const pdfPath = String.raw`D:\软件开发\谷歌反重力开发\KIROGOVCOMPARE\data\uploads\79\2024\ab8f5400089e3906a233f61cd70b58ce600cc7a881b4e16a85cb0ba9fc82f7b8.pdf`;

    if (!fs.existsSync(pdfPath)) {
        console.error('File not found:', pdfPath);
        return;
    }

    console.log('Loading PDF:', pdfPath);
    const data = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = pdfjs.getDocument({
        data,
        disableWorker: true,
        cMapUrl: './node_modules/pdfjs-dist/cmaps/',
        cMapPacked: true,
    });
    const pdf = await loadingTask.promise;
    console.log('Total pages:', pdf.numPages);

    // Focus on page 1-2 where tables usually are
    for (let pageNum = 1; pageNum <= Math.min(2, pdf.numPages); pageNum++) {
        console.log(`\n========== PAGE ${pageNum} ==========`);
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        console.log('Total text items:', textContent.items.length);

        // Sort by Y then X
        const items = (textContent.items as any[])
            .filter((it: any) => typeof it?.str === 'string' && it.str.trim())
            .map((it: any) => ({
                str: it.str,
                x: Math.round(it.transform?.[4] ?? 0),
                y: Math.round(it.transform?.[5] ?? 0),
                w: Math.round(it.width ?? 0),
            }))
            .sort((a, b) => {
                if (Math.abs(b.y - a.y) > 3) return b.y - a.y;
                return a.x - b.x;
            });

        // Group items by Y (line)
        const lines: { y: number; items: typeof items }[] = [];
        for (const item of items) {
            const lastLine = lines[lines.length - 1];
            if (!lastLine || Math.abs(item.y - lastLine.y) > 3) {
                lines.push({ y: item.y, items: [item] });
            } else {
                lastLine.items.push(item);
            }
        }

        console.log('Total lines:', lines.length);

        // Print first 20 lines with gap analysis
        for (let i = 0; i < Math.min(30, lines.length); i++) {
            const line = lines[i];
            const parts: string[] = [];
            const gaps: number[] = [];
            let prevEndX = 0;

            for (const item of line.items) {
                if (prevEndX > 0) {
                    gaps.push(item.x - prevEndX);
                }
                parts.push(item.str);
                prevEndX = item.x + item.w;
            }

            const gapInfo = gaps.length ? `[gaps: ${gaps.join(',')}]` : '[no gaps]';
            const lineText = parts.join('');
            console.log(`L${i.toString().padStart(2, '0')} Y${line.y} ${gapInfo} "${lineText}"`);
        }
    }
}

diagnose().catch(console.error);
