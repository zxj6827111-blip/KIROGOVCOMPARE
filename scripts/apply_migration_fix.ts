
import { runLLMMigrations } from '../src/db/migrations-llm';
import pool from '../src/config/database-llm';

async function run() {
    try {
        console.log('Applying database fix...');
        await runLLMMigrations();
        console.log('Fix applied successfully.');
    } catch (err) {
        console.error('Failed to apply fix:', err);
    } finally {
        await pool.end();
    }
}

run();
