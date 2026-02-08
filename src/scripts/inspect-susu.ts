
import pool from '../config/database-llm';

async function inspectSuzhouSuqian() {
    try {
        console.log('--- Inspecting Suzhou Suqian Industrial Park ---');

        // 1. Find the parent node (Direct child of Suqian City)
        // Suqian City ID is 720 (from previous steps)
        const parentRes = await pool.query(
            `SELECT id, name, level, parent_id FROM regions WHERE parent_id = 720 AND name LIKE '%苏州宿迁%'`
        );

        if (parentRes.rows.length === 0) {
            console.log('Could not find Suzhou Suqian Industrial Park under Suqian City (720).');
            return;
        }

        const parent = parentRes.rows[0];
        console.log(`Parent: [${parent.id}] ${parent.name} (Level ${parent.level})`);

        // 2. Check for children of this node
        const childrenRes = await pool.query(
            `SELECT id, name, level, parent_id FROM regions WHERE parent_id = $1`,
            [parent.id]
        );
        console.log(`Children count: ${childrenRes.rows.length}`);

        // 3. Check for duplicates (same name or known patterns)
        const duplicates = childrenRes.rows.filter(c => c.name === parent.name);

        if (duplicates.length > 0) {
            console.log(`!!! FOUND DUPLICATE CHILD NODES !!!`);
            duplicates.forEach(d => console.log(`  - Child: [${d.id}] ${d.name} (Level ${d.level})`));

            // Check reports
            const dupIds = duplicates.map(d => d.id);
            const reportRes = await pool.query(`SELECT id, region_id, year FROM reports WHERE region_id = ANY($1::int[])`, [dupIds]);
            console.log(`  -> Reports on child nodes: ${reportRes.rows.length}`);
            reportRes.rows.forEach(r => console.log(`     Report [${r.id}] Year ${r.year}`));
        } else {
            console.log('No direct same-name duplicates found. Listing all children just in case:');
            childrenRes.rows.forEach(c => console.log(`  - ${c.name} [${c.id}]`));
        }

        // Check reports on parent
        const parentReportRes = await pool.query(`SELECT count(*) FROM reports WHERE region_id = $1`, [parent.id]);
        console.log(`  -> Reports on PARENT node: ${parentReportRes.rows[0].count}`);

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

inspectSuzhouSuqian();
