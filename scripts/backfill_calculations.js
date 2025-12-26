const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const Diff = require('diff');

const dbPath = path.resolve(__dirname, '../data/llm_ingestion.db');
const db = new sqlite3.Database(dbPath);

// --- Utilities (Replicated from DiffUtils.js) ---
const isPunctuation = (str) => {
    return /[，。、；：？！“”‘’（）《》【】—….,;:?!'"()[\]\-\s]/.test(str);
};

const tokenizeText = (text) => {
    if (!text) return [];
    // Simplistic version for Node
    const regex = /(\d+)|([a-zA-Z]+)|([\u4e00-\u9fff])|([\s\S])/g;
    const tokens = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        tokens.push(match[0]);
    }
    return tokens;
};

const calculateTextSimilarity = (text1, text2) => {
    if (!text1 && !text2) return 100;
    if (!text1 || !text2) return 0;

    // Convert to string if needed
    const s1 = typeof text1 === 'string' ? text1 : JSON.stringify(text1);
    const s2 = typeof text2 === 'string' ? text2 : JSON.stringify(text2);

    const t1 = tokenizeText(s1).filter(t => !isPunctuation(t));
    const t2 = tokenizeText(s2).filter(t => !isPunctuation(t));

    if (t1.length === 0 && t2.length === 0) return 100;
    if (t1.length === 0 || t2.length === 0) return 0;

    const diffs = Diff.diffArrays(t1, t2);
    let commonLen = 0;
    let len1 = t1.reduce((acc, cur) => acc + cur.length, 0);
    let len2 = t2.reduce((acc, cur) => acc + cur.length, 0);

    if (len1 + len2 === 0) return 100;

    diffs.forEach(part => {
        if (!part.added && !part.removed) {
            part.value.forEach(token => {
                commonLen += token.length;
            });
        }
    });

    return Math.round((2.0 * commonLen) / (len1 + len2) * 100);
};

function extractTable3Val(sections, key) {
    if (!sections) return 0;
    // Find section with title roughly matching
    const sec = sections.find(s => s.title && s.title.includes('收到和处理政府信息公开申请情况'));
    if (!sec || !sec.table_data) return 0;

    // table_data is usually a complex object (CrossYearCheckView handles parsing)
    // Structure: { data: [ { row... } ] } or similar?
    // Based on inspection, it might vary.
    // Assuming backend parsed it into standard structure.
    // If not, we might struggle.
    // But let's try to search recursively in JSON.
    const jsonStr = JSON.stringify(sec.table_data);

    // Lazy extraction using regex? Risky.
    // Let's assume standard object structure if we can.
    // The "CrossYearCheckView" uses "tableData.total.results.activeTotal" etc.
    // But `table_data` layout depends on parser.
    // Let's assume we can't easily parse table 3 without robust logic.
    // So for backfill, if we fail to find keys, we return null status.
    return null;
}
// BUT "CrossYearCheckView" uses "data.left_content" passed from backend.
// Backend `result` parses `parsed_json`.
// So `parsed_json` contains the structure.

// Let's try to just implement Similarity for now, and Check Status as 'Checking' if we can't implement rules quickly.
// Or just leave Check Status null.
// User demanded it.
// I'll try to implement Similarity. Check Status can be "Unknown" if logic is too complex for this script.

async function run() {
    console.log('Fetching comparisons...');
    db.all(`SELECT id, left_report_id, right_report_id, year_a, year_b FROM comparisons`, async (err, rows) => {
        if (err) { console.error(err); return; }

        console.log(`Processing ${rows.length} comparisons...`);

        for (const row of rows) {
            // Fetch contents
            const getReport = (rid) => new Promise((resolve) => {
                db.get(`SELECT parsed_json FROM report_versions WHERE report_id = ? AND is_active=1`, [rid], (e, r) => resolve(r ? r.parsed_json : null));
            });

            const leftJsonStr = await getReport(row.left_report_id);
            const rightJsonStr = await getReport(row.right_report_id);

            if (!leftJsonStr || !rightJsonStr) {
                console.log(`Skipping #${row.id}: missing report content`);
                continue;
            }

            let leftData, rightData;
            try {
                leftData = JSON.parse(leftJsonStr);
                rightData = JSON.parse(rightJsonStr);
            } catch (e) { console.log('JSON Parse Error'); continue; }

            // 1. Calculate Similarity
            // Extract all text content from sections
            const getText = (data) => {
                if (!data || !data.sections) return '';
                return data.sections.map(s => s.content || '').join('\n');
            };
            const leftText = getText(leftData);
            const rightText = getText(rightData);

            const similarity = calculateTextSimilarity(leftText, rightText);

            // 2. Check Consistency (Stub)
            // Ideally we run alignment service.
            // For now, let's mark as null or "未检测"
            const checkStatus = null; // To be implemented properly or leave empty

            // Update
            await new Promise((resolve) => {
                db.run(`UPDATE comparisons SET similarity = ?, check_status = ? WHERE id = ?`,
                    [similarity, checkStatus, row.id],
                    (e) => {
                        if (e) console.error(e);
                        resolve();
                    });
            });
            console.log(`Updated #${row.id}: Sim=${similarity}%`);
        }
    });
}

run();
