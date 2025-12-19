// Simple LLM API health check for Windows/macOS/Linux
// Usage: node scripts/llm-health.js [baseUrl]

const baseUrl = process.argv[2] || process.env.LLM_BASE_URL || 'http://127.0.0.1:8787';

async function main() {
  const url = `${baseUrl.replace(/\/$/, '')}/api/health`;
  const controller = new AbortController();
  const timeoutMs = Number(process.env.LLM_HEALTH_TIMEOUT_MS || 3000);
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    if (!res.ok) {
      console.error(`LLM health not OK: HTTP ${res.status}`);
      console.error(text.slice(0, 800));
      process.exit(1);
    }
    console.log(`OK: ${url}`);
    console.log(text.slice(0, 800));
  } catch (err) {
    const name = err && err.name ? err.name : 'Error';
    const message = err && err.message ? err.message : String(err);
    console.error(`LLM health check failed: ${name}: ${message}`);
    if (err && err.cause) {
      try {
        console.error(`cause: ${err.cause.code || ''} ${err.cause.message || String(err.cause)}`.trim());
      } catch {
        // ignore
      }
    }
    console.error(`Tip: if port 8787 is LISTENING but health hangs, the process may be wedged (often sqlite3 CLI lock/hang).`);
    process.exit(1);
  } finally {
    clearTimeout(t);
  }
}

main();
