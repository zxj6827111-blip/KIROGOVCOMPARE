import sqlite3 from 'sqlite3';
import path from 'path';
import { calculateReportMetrics } from '../src/utils/reportAnalysis';
import { calculateTextSimilarity } from '../src/utils/diffRenderer';

const dbPath = path.resolve(__dirname, '../data/llm_ingestion.db');
const db = new sqlite3.Database(dbPath);

const run = async () => {
    // ID 60
    const cmpId = 60;

    // Fetch IDs
    const cmp: any = await new Promise((resolve) => {
        db.get(`SELECT * FROM comparisons WHERE id = ?`, [cmpId], (err, row) => resolve(row));
    });

    if (!cmp) { console.log('No comparison 60'); return; }

    const getJson = (rid: number): Promise<any> => new Promise((resolve) => {
        db.get(`SELECT parsed_json FROM report_versions WHERE report_id = ? AND is_active = 1`, [rid], (err, row: any) => {
            if (row && row.parsed_json) resolve(JSON.parse(row.parsed_json));
            else resolve({ sections: [] });
        });
    });

    const leftJson = await getJson(cmp.left_report_id);
    const rightJson = await getJson(cmp.right_report_id);

    // Replicate Logic from reportAnalysis.ts carefully and LOG
    const sections: { title: string, oldSec?: any, newSec?: any }[] = [];
    const leftSections: any[] = leftJson?.sections || [];
    const rightSections: any[] = rightJson?.sections || [];

    leftSections.forEach(s => sections.push({ title: s.title, oldSec: s }));
    rightSections.forEach(s => {
        const existing = sections.find(a => a.title === s.title);
        if (existing) existing.newSec = s;
        else sections.push({ title: s.title, newSec: s });
    });

    let totalTextSim = 0;
    let textSectionsCount = 0;

    console.log('--- Section Breakdown ---');
    console.log(`Left Sections: ${leftSections.length}, Right Sections: ${rightSections.length}`);
    console.log(`Aligned Sections: ${sections.length}`);

    sections.forEach(sec => {
        const title = sec.title || 'NoTitle';
        // filter
        const isFiltered = (title === '标题' || title.includes('年度报告'));

        const oldType = sec.oldSec?.type;
        const newType = sec.newSec?.type;

        let sim = -1;
        let used = false;

        if (!isFiltered) {
            if (oldType === 'text' && newType === 'text') {
                sim = calculateTextSimilarity(sec.oldSec.content || '', sec.newSec.content || '');
                totalTextSim += sim;
                textSectionsCount++;
                used = true;
            }
        }

        console.log(`Sec: "${title}" | Types: ${oldType}/${newType} | Sim: ${sim === -1 ? 'N/A' : sim + '%'} | Used: ${used} | Filtered: ${isFiltered}`);
    });

    const avg = textSectionsCount > 0 ? Math.round(totalTextSim / textSectionsCount) : 0;
    console.log('--- Summary ---');
    console.log(`Used Sections Count: ${textSectionsCount}`);
    console.log(`Total Sim Sum: ${totalTextSim}`);
    console.log(`Average: ${avg}%`);
};

run();
