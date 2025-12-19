// Smoke test: POST /api/reports/text then GET /api/reports
// Usage: node scripts/llm-smoke-insert.js [baseUrl] [regionId] [year]

const baseUrl = process.argv[2] || process.env.LLM_BASE_URL || 'http://127.0.0.1:8787';
const requestedRegionId = process.argv[3] ? Number(process.argv[3]) : null;
const year = Number(process.argv[4] || new Date().getFullYear());

async function main() {
  const base = baseUrl.replace(/\/$/, '');
  const health = await fetch(`${base}/api/health`).then(r => r.text());
  console.log('health:', health.slice(0, 200));

  const regionsRes = await fetch(`${base}/api/regions`).then(r => r.text());
  let regionsJson;
  try {
    regionsJson = JSON.parse(regionsRes);
  } catch {
    regionsJson = null;
  }

  const regions = Array.isArray(regionsJson?.data) ? regionsJson.data : [];
  let regionId = requestedRegionId && Number.isFinite(requestedRegionId) ? requestedRegionId : null;
  if (!regionId) {
    regionId = regions?.[0]?.id ?? null;
  }

  if (!regionId) {
    const code = `SMOKE_${Date.now()}`;
    const createRes = await fetch(`${base}/api/regions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name: 'Smoke City' }),
    });
    const createBody = await createRes.text();
    console.log('POST /api/regions status:', createRes.status);
    console.log(createBody.slice(0, 800));
    const created = JSON.parse(createBody);
    regionId = created?.id;
  }

  if (!regionId) {
    throw new Error('No region available for smoke test');
  }

  const payload = {
    region_id: regionId,
    year,
    unit_name: `SMOKE_${Date.now()}`,
    raw_text: `Smoke test raw text at ${new Date().toISOString()}`,
  };

  const post = await fetch(`${base}/api/reports/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const postBody = await post.text();
  console.log('POST /api/reports/text status:', post.status);
  console.log(postBody.slice(0, 800));

  const list = await fetch(`${base}/api/reports`).then(r => r.text());
  console.log('GET /api/reports:', list.slice(0, 1200));

  if (!post.ok && post.status !== 409) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
