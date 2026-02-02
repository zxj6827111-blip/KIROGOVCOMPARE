
import pool from '../config/database-llm';

async function fixHuaianJinhu() {
    const client = await pool.connect();
    try {
        console.log('--- Starting Data Fix for Huaian & Jinhu (Move & Delete) ---');
        await client.query('BEGIN');

        // Helper function to process a region
        const processRegion = async (parentRegionId: number, parentRegionName: string) => {
            console.log(`\nProcessing ${parentRegionName} (ID: ${parentRegionId})...`);

            // Find "Government" child nodes (e.g., "Huaian District People's Government")
            const childQuery = `
                SELECT id, name FROM regions 
                WHERE parent_id = $1 AND name LIKE '%人民政府'
            `;
            const childRes = await client.query(childQuery, [parentRegionId]);

            if (childRes.rows.length === 0) {
                console.log(`  No 'Government' child node found for ${parentRegionName}.`);
                return;
            }

            for (const child of childRes.rows) {
                console.log(`  Found Child Node: ID ${child.id} (${child.name})`);

                // 1. Move Reports
                const updateRes = await client.query(`
                    UPDATE reports 
                    SET region_id = $1 
                    WHERE region_id = $2
                    RETURNING id
                `, [parentRegionId, child.id]);
                console.log(`    Moved ${updateRes.rowCount} reports from Child ${child.id} to Parent ${parentRegionId}.`);

                // 2. Handle Comparisons (Move comparisons linked to this child node)
                // This is needed because `comparisons` table references region_id.
                const compUpdateRes = await client.query(`
                    UPDATE comparisons 
                    SET region_id = $1 
                    WHERE region_id = $2
                `, [parentRegionId, child.id]);
                console.log(`    Moved ${compUpdateRes.rowCount} comparisons from Child ${child.id} to Parent ${parentRegionId}.`);

                // 3. Delete Child Node
                try {
                    const deleteRes = await client.query(`DELETE FROM regions WHERE id = $1`, [child.id]);
                    console.log(`    Deleted Child Node ${child.id}.`);
                } catch (delErr: any) {
                    console.warn(`    WARNING: Could not delete node ${child.id}. It might have other dependencies (e.g. users). Error: ${delErr.message}`);
                }
            }
        };

        // 1. Fix Huaian District (Target Region ID: 819)
        await processRegion(819, 'Huaian District');

        // 2. Fix Jinhu County (Target Region ID: 820)
        await processRegion(820, 'Jinhu County');

        // 3. Fix Lianshui County (Target Region ID: 821)
        // Checking for '涟水县' just in case
        await processRegion(821, 'Lianshui County');

        await client.query('COMMIT');
        console.log('\n--- Fix Completed Successfully ---');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Transaction Rolled Back:', err);
    } finally {
        client.release();
        await pool.end();
    }
}

fixHuaianJinhu();
