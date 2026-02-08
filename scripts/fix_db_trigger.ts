
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../.env') });
import pool from '../src/config/database-llm';

async function run() {
    try {
        console.log('Attempting to drop problematic trigger and function...');

        // First, try to find the trigger name if it's not exactly what we guessed
        // But error log said "PL/pgSQL functions sync_report_versions_active()"
        // Triggers are usually named differently than function but often similar.
        // The previous error didn't explicitly name the trigger, just the function.
        // However, usually triggers call functions.

        // Attempt 1: Drop trigger by name if we can guess, or Drop Trigger on table...
        // We can query pg_trigger to find it.

        const triggerRes = await pool.query(`
      SELECT tgname 
      FROM pg_trigger 
      WHERE tgrelid = 'reports'::regclass 
      AND tgfoid = 'sync_report_versions_active'::regproc;
    `);

        if (triggerRes.rows.length > 0) {
            const triggerName = triggerRes.rows[0].tgname;
            console.log(`Found trigger: ${triggerName}`);
            await pool.query(`DROP TRIGGER IF EXISTS "${triggerName}" ON reports;`);
            console.log(`Dropped trigger: ${triggerName}`);
        } else {
            console.log('No trigger found linked to function sync_report_versions_active');
        }

        // Also try to drop the function itself
        await pool.query('DROP FUNCTION IF EXISTS sync_report_versions_active() CASCADE;');
        console.log('Dropped function sync_report_versions_active()');

        // Also, let's verify if the unique index "uq_report_versions_active" exists and if we should keep it.
        // If the trigger is gone, the application code handles uniqueness. 
        // Ideally we KEEP the unique index for safety, but if it causes issues with the update flow...
        // The application logic updates one to false THEN one to true, so it should be fine with unique index.
        // The failure was due to bulk update in trigger.
        // So we KEEP the unique index if possible.

        console.log('Done.');
        process.exit(0);
    } catch (err) {
        console.error('Error:', err);
        process.exit(1);
    }
}

run();
