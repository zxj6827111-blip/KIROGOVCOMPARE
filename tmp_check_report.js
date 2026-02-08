require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.PG_URL });

(async () => {
  const sql = `
    select r.id, r.year, r.unit_name, r.active_version_id, reg.name as region_name
    from reports r
    left join regions reg on reg.id = r.region_id
    where r.unit_name like '%长风%' or reg.name like '%长风%'
    order by r.id desc
    limit 20
  `;
  const r = await pool.query(sql);
  console.log(JSON.stringify(r.rows, null, 2));
  await pool.end();
})().catch(async (e) => {
  console.error(e);
  try { await pool.end(); } catch {}
  process.exit(1);
});
