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

  let created;
  try {
    created = JSON.parse(postBody);
  } catch {
    created = null;
  }

  if (created) {
    console.log('Created report_id:', created.report_id, 'version_id:', created.version_id, 'job_id:', created.job_id);
  }

  if (created?.job_id) {
    let attempts = 0;
    let jobStatus = 'queued';
    while (attempts < 30 && jobStatus !== 'succeeded' && jobStatus !== 'failed') {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const jobResp = await fetch(`${base}/api/jobs/${created.job_id}`);
      const jobText = await jobResp.text();
      try {
        const jobJson = JSON.parse(jobText);
        jobStatus = jobJson?.status || jobStatus;
        console.log('Job status:', jobStatus);
        if (jobJson?.error_message) {
          console.log('Job error:', jobJson.error_message.slice(0, 400));
        }
      } catch {
        console.log('Job raw response:', jobText.slice(0, 400));
      }
      attempts += 1;
      if (jobStatus === 'succeeded' || jobStatus === 'failed') break;
    }
  }

  const list = await fetch(`${base}/api/reports`).then(r => r.text());
  console.log('GET /api/reports:', list.slice(0, 1200));

  if (created?.report_id) {
    const reportDetailRes = await fetch(`${base}/api/reports/${created.report_id}`);
    const detailText = await reportDetailRes.text();
    console.log('GET /api/reports/:id status:', reportDetailRes.status);
    try {
      const detailJson = JSON.parse(detailText);
      const parsed = detailJson?.active_version?.parsed_json;
      console.log('Parsed JSON keys:', parsed ? Object.keys(parsed).slice(0, 20) : 'missing');
      if (parsed?.tableData && parsed?.reviewLitigationData) {
        console.log('tableData & reviewLitigationData present');
      }
    } catch {
      console.log('Report detail raw:', detailText.slice(0, 800));
    }
  }

  if (!post.ok && post.status !== 409) process.exit(1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
