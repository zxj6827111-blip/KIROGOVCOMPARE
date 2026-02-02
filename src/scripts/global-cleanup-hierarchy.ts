
import pool from '../config/database-llm';

async function globalCleanup() {
    const client = await pool.connect();
    try {
        console.log('--- Starting Global Hierarchy Cleanup ---');
        await client.query('BEGIN');

        const scanQuery = `
            SELECT c.id as child_id, c.name as child_name, c.parent_id, p.name as parent_name
            FROM regions c
            JOIN regions p ON c.parent_id = p.id
            WHERE c.name LIKE '%人民政府'
        `;

        const res = await client.query(scanQuery);
        console.log(`Scanned ${res.rows.length} 'Government' nodes.`);

        let processedCount = 0;

        for (const row of res.rows) {
            const { child_id, child_name, parent_id, parent_name } = row;

            // Strict check
            if (!child_name.includes(parent_name)) {
                console.log(`[SKIP] Child '${child_name}' does not contain Parent '${parent_name}'. unsafe to merge.`);
                continue;
            }

            console.log(`\n[MATCH] Merge '${child_name}' (${child_id}) -> '${parent_name}' (${parent_id})`);

            // Move Reports
            const repUpdate = await client.query(`
                UPDATE reports SET region_id = $1 WHERE region_id = $2
            `, [parent_id, child_id]);
            if ((repUpdate.rowCount || 0) > 0) console.log(`   Moved ${repUpdate.rowCount} reports.`);

            // Move Comparisons (Safe Mode with SAVEPOINT)
            try {
                await client.query('SAVEPOINT move_comparisons');
                const compUpdate = await client.query(`
                    UPDATE comparisons SET region_id = $1 WHERE region_id = $2
                `, [parent_id, child_id]);
                if ((compUpdate.rowCount || 0) > 0) console.log(`   Moved ${compUpdate.rowCount} comparisons.`);
                await client.query('RELEASE SAVEPOINT move_comparisons');
            } catch (err: any) {
                await client.query('ROLLBACK TO SAVEPOINT move_comparisons');
                if (err.code === '23505') { // unique_violation
                    console.log(`   [WARN] Comparison merge conflict. Deleting duplicates from child.`);
                    const delComp = await client.query(`DELETE FROM comparisons WHERE region_id = $1`, [child_id]);
                    console.log(`   Deleted ${delComp.rowCount} conflicting comparisons.`);
                } else {
                    throw err; // Rethrow other errors
                }
            }

            // Delete Child Node
            try {
                await client.query(`DELETE FROM regions WHERE id = $1`, [child_id]);
                console.log(`   Deleted node ${child_id}.`);
                processedCount++;
            } catch (err: any) {
                console.warn(`   [ERROR] Could not delete ${child_id}: ${err.message}`);
            }
        }

        await client.query('COMMIT');
        console.log(`\n--- Cleanup Complete. Processed ${processedCount} regions. ---`);

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration execution failed, rolled back.', err);
    } finally {
        client.release();
        await pool.end();
    }
}

globalCleanup();
