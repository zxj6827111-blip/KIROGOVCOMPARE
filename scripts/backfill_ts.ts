import sqlite3 from 'sqlite3';
import path from 'path';
import { calculateReportMetrics } from '../src/utils/reportAnalysis';

const dbPath = path.resolve(__dirname, '../data/llm_ingestion.db');
const db = new sqlite3.Database(dbPath);

const run = async () => {
    console.log('Starting Backfill...');

    // Get all comparisons
    const comparisons: any[] = await new Promise((resolve, reject) => {
        db.all(`SELECT id, left_report_id, right_report_id, region_id FROM comparisons`, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    console.log(`Found ${comparisons.length} comparisons.`);

    for (const cmp of comparisons) {
        try {
            // Fetch JSONs
            const getJson = (rid: number): Promise<any> => new Promise((resolve) => {
                db.get(`SELECT parsed_json FROM report_versions WHERE report_id = ? AND is_active = 1`, [rid], (err, row: any) => {
                    if (row && row.parsed_json) {
                        try { resolve(JSON.parse(row.parsed_json)); }
                        catch { resolve({ sections: [] }); }
                    } else {
                        resolve({ sections: [] });
                    }
                });
            });

            const leftJson = await getJson(cmp.left_report_id);
            const rightJson = await getJson(cmp.right_report_id);

            const metrics = calculateReportMetrics(leftJson, rightJson);

            console.log(`Comp #${cmp.id}: Sim=${metrics.similarity}%, Status=${metrics.checkStatus}`);

            await new Promise<void>((resolve, reject) => {
                db.run(
                    `UPDATE comparisons SET similarity = ?, check_status = ? WHERE id = ?`,
                    [metrics.similarity, metrics.checkStatus, cmp.id],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            });

        } catch (error) {
            console.error(`Error processing #${cmp.id}:`, error);
        }
    }

    console.log('Backfill Complete.');
};

run();
