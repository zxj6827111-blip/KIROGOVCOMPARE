
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '..', '.env') });

import pool from '../src/config/database-llm';
import { materializeReportVersion } from '../src/services/MaterializeService';

async function backfill() {
    console.log('Starting backfill of fact tables...');

    const client = await pool.connect();
    try {
        // 1. Get all reports with an active version
        const res = await client.query(`
      SELECT r.id as report_id, r.active_version_id, rv.parsed_json
      FROM reports r
      JOIN report_versions rv ON rv.id = r.active_version_id
      WHERE r.active_version_id IS NOT NULL
    `);

        console.log(`Found ${res.rows.length} reports with active versions.`);

        let successCount = 0;
        let failCount = 0;

        for (const row of res.rows) {
            const { report_id, active_version_id, parsed_json } = row;
            console.log(`Processing Report ID: ${report_id}, Version: ${active_version_id}...`);

            try {
                if (!parsed_json) {
                    console.warn(`  Skipping: parsed_json is empty.`);
                    continue;
                }

                await materializeReportVersion({
                    reportId: report_id,
                    versionId: active_version_id,
                    parsedJson: parsed_json
                });

                // Also ensure derived metrics are updated if possible, but materialize is the critical part for the dashboard view.
                // Derived metrics are for the Data Center dashboard. 
                // We can optionally run derived metrics update if we can import DerivedMetricsService.
                // But let's focus on the "Gov Insight" dashboard first (0s issue).

                console.log(`  Success.`);
                successCount++;
            } catch (err: any) {
                console.error(`  Failed: ${err.message}`);
                failCount++;
            }
        }

        console.log('-----------------------------------');
        console.log(`Backfill complete.`);
        console.log(`Success: ${successCount}`);
        console.log(`Failed:  ${failCount}`);

    } catch (err) {
        console.error('Fatal error during backfill:', err);
    } finally {
        client.release();
        // Allow time for pending IO
        setTimeout(() => {
            process.exit(0);
        }, 1000);
    }
}

backfill();
