
import pool from '../src/config/database-llm';

async function verifyData() {
  try {
    console.log('Verifying data for Huai\'an and its districts...');

    // 1. Find Huai'an Org ID
    const huaianRes = await pool.query(`
      SELECT org_id, org_name, org_type 
      FROM gov_open_annual_stats 
      WHERE org_name LIKE '%淮安%' AND org_type = 'city'
      LIMIT 1
    `);

    if (huaianRes.rows.length === 0) {
      console.log('Huai\'an city not found in gov_open_annual_stats view.');
      // Try finding ANY city to see what's in there
       const anyCity = await pool.query(`SELECT * FROM gov_open_annual_stats LIMIT 1`);
       console.log('Sample row:', anyCity.rows[0]);
       return;
    }

    const huaian = huaianRes.rows[0];
    console.log('Found Huai\'an:', huaian);

    // 2. Find Children Data
    const childrenRes = await pool.query(`
      SELECT org_id, org_name, year, app_new
      FROM gov_open_annual_stats
      WHERE parent_id = $1
      ORDER BY year DESC, org_name
    `, [huaian.org_id]);

    console.log(`Found ${childrenRes.rows.length} records for children of ${huaian.org_name} (${huaian.org_id})`);
    
    // Group by child
    const childMap = new Map();
    childrenRes.rows.forEach(row => {
        if (!childMap.has(row.org_name)) {
            childMap.set(row.org_name, []);
        }
        childMap.get(row.org_name).push(row.year);
    });

    childMap.forEach((years, name) => {
        console.log(`- ${name}: ${years.join(', ')}`);
    });

  } catch (err) {
    console.error('Error verifying data:', err);
  } finally {
    await pool.end();
  }
}

verifyData();
