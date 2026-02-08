
import pool from '../src/config/database-llm';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function checkFailedJobs() {
    try {
        const res = await pool.query(`
            SELECT id, kind, status, provider, model, error_message, created_at, finished_at 
            FROM jobs 
            WHERE status = 'failed' 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        
        console.log('--- Recent Failed Jobs ---');
        if (res.rows.length === 0) {
            console.log('No failed jobs found in the last 5 records.');
        } else {
            res.rows.forEach(job => {
                console.log(`Job ID: ${job.id}`);
                console.log(`Type: ${job.kind}`);
                console.log(`Provider: ${job.provider}`);
                console.log(`Model: ${job.model}`);
                console.log(`Error: ${job.error_message}`);
                console.log(`Created: ${job.created_at}`);
                console.log('-------------------------');
            });
        }
    } catch (err) {
        console.error('Error querying database:', err);
    } finally {
        await pool.end();
    }
}

checkFailedJobs();
