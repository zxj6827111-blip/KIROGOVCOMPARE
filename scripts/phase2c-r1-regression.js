const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:3001';
const API_URL = 'http://127.0.0.1:8787/api';
const REPORT_ID = 3670;
const VERSION_ID = 3448;
const USERNAME = 'admin';
const PASSWORD = 'admin123';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    throw new Error(`${options.method || 'GET'} ${url} failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function apiLogin() {
  return fetchJson(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
}

async function apiGetChecks(token) {
  const payload = await fetchJson(`${API_URL}/reports/${REPORT_ID}/checks?version_id=${VERSION_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return payload.data;
}

async function apiUpdateStatus(token, itemId, humanStatus, humanComment = null) {
  return fetchJson(`${API_URL}/reports/${REPORT_ID}/checks/items/${itemId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version_id: VERSION_ID,
      human_status: humanStatus,
      human_comment: humanComment,
    }),
  });
}

async function restoreAllPending(token) {
  const checks = await apiGetChecks(token);
  const items = (checks.groups || []).flatMap((group) => group.items || []);
  for (const item of items) {
    if (item.auto_status === 'NOT_ASSESSABLE') continue;
    if (item.human_status === 'pending') continue;
    await apiUpdateStatus(token, item.id, 'pending', null);
  }
}

function summarizeChecks(checks) {
  const groups = checks.groups || [];
  const items = groups.flatMap((group) => group.items || []);
  const active = items.filter((item) => item.auto_status !== 'NOT_ASSESSABLE');
  const table3 = groups.find((group) => group.group_key === 'table3');
  const table3Items = table3?.items || [];
  return {
    top: {
      problemCount: active.filter((item) => item.auto_status === 'FAIL' && item.human_status !== 'dismissed').length,
      pendingCount: active.filter((item) => item.human_status === 'pending').length,
      confirmedCount: active.filter((item) => item.human_status === 'confirmed').length,
      notAssessableCount: items.filter((item) => item.auto_status === 'NOT_ASSESSABLE').length,
    },
    table3: {
      ruleCount: table3Items.length,
      problemCount: table3Items.filter((item) => item.auto_status === 'FAIL' && item.human_status !== 'dismissed').length,
      pendingCount: table3Items.filter((item) => item.human_status === 'pending').length,
      confirmedCount: table3Items.filter((item) => item.human_status === 'confirmed').length,
    },
  };
}

async function setupPage(session) {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 1800 },
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.evaluate((auth) => {
    localStorage.setItem('admin_token', auth.token);
    localStorage.setItem('admin_user', JSON.stringify(auth.user));
  }, session);
  await page.goto(`${BASE_URL}/catalog/reports/${REPORT_ID}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForSelector('.tab');
  return { browser, page };
}

async function waitForRefresh(page) {
  await sleep(700);
  await page.waitForNetworkIdle({ idleTime: 300, timeout: 10000 }).catch(() => {});
  await sleep(700);
}

async function switchToChecks(page) {
  await page.$$eval('button.tab', (nodes) => nodes[1]?.click());
  await page.waitForSelector('.consistency-check-view');
  await waitForRefresh(page);
}

async function switchToContent(page) {
  await page.$$eval('button.tab', (nodes) => nodes[0]?.click());
  await page.waitForSelector('.report-content-section');
  await waitForRefresh(page);
}

async function topSummary(page) {
  const raw = await page.$$eval('.check-header .summary .summary-item', (nodes) =>
    nodes.map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
  );
  const map = {};
  for (const item of raw) {
    const [label, value] = item.split(' ');
    map[label] = Number(value);
  }
  return {
    raw,
    problemCount: map['问题'],
    pendingCount: map['待复核'],
    confirmedCount: map['已确认'],
    notAssessableCount: map['不可评估'],
  };
}

async function groupHeaderText(page, index) {
  return page.$$eval('.group-card .group-header', (nodes, i) => (nodes[i]?.textContent || '').replace(/\s+/g, ' ').trim(), index);
}

async function ensureTable3Expanded(page) {
  await page.$$eval('.group-card .group-header', (nodes) => {
    const node = nodes[2];
    if (!node) return;
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text.startsWith('▼')) node.click();
  });
  await sleep(600);
}

async function findIssueIndex(page, titlePart) {
  return page.$$eval(
    '.check-item',
    (nodes, part) => {
      const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();
      return nodes.findIndex((node) => normalize(node.querySelector('.item-title')?.textContent || '').includes(part));
    },
    titlePart
  );
}

async function clickIssueButtonByIndex(page, issueIndex, buttonClass) {
  const ok = await page.$$eval(
    '.check-item',
    (nodes, payload) => {
      const item = nodes[payload.issueIndex];
      if (!item) return false;
      const btn = item.querySelector(payload.buttonClass);
      if (!btn) return false;
      btn.click();
      return true;
    },
    { issueIndex, buttonClass }
  );
  if (!ok) {
    throw new Error(`cannot click ${buttonClass} for issue ${issueIndex}`);
  }
}

async function issueTitles(page) {
  return page.$$eval('.check-item .item-title', (nodes) => nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()));
}

async function contentSummary(page) {
  const heroTitle = await page.$$eval('.tis-panel--table3 .tis-hero-title', (nodes) => (nodes[0]?.textContent || '').replace(/\s+/g, ' ').trim()).catch(() => null);
  const cards = await page.$$eval('.tis-panel--table3 .tis-card', (nodes) => nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim())).catch(() => []);
  return { heroTitle, cards };
}

async function badgeTexts(page) {
  return page.$$eval('.issue-badge', (nodes) => nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()));
}

async function confirmedHighlightCount(page) {
  return page.$$eval('.cell-issue-confirmed', (nodes) => nodes.length).catch(() => 0);
}

async function focusBanner(page) {
  return page.$$eval('.check-focus-banner, .focused-check-banner, .focused-check', (nodes) => {
    const text = nodes.map((n) => (n.textContent || '').replace(/\s+/g, ' ').trim()).find(Boolean);
    return text || null;
  }).catch(() => null);
}

async function runConfirmedScenario(session, token, titlePart) {
  await restoreAllPending(token);
  const { browser, page } = await setupPage(session);
  try {
    await switchToChecks(page);
    await ensureTable3Expanded(page);
    const index = await findIssueIndex(page, titlePart);
    const title = (await issueTitles(page))[index];
    const beforeTop = await topSummary(page);
    await clickIssueButtonByIndex(page, index, '.btn-confirm');
    await waitForRefresh(page);
    const afterTop = await topSummary(page);
    const stillVisible = (await issueTitles(page)).includes(title);
    await switchToContent(page);
    const summary = await contentSummary(page);
    const badges = await badgeTexts(page);
    const confirmedCount = await confirmedHighlightCount(page);
    await restoreAllPending(token);
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await switchToChecks(page);
    const afterResetTop = await topSummary(page);
    return { title, beforeTop, afterTop, stillVisible, summary, badges, confirmedCount, afterResetTop };
  } finally {
    await browser.close();
  }
}

async function runDismissedScenario(session, token, titlePart) {
  await restoreAllPending(token);
  const { browser, page } = await setupPage(session);
  try {
    await switchToChecks(page);
    await ensureTable3Expanded(page);
    const index = await findIssueIndex(page, titlePart);
    const title = (await issueTitles(page))[index];
    const beforeTop = await topSummary(page);
    const beforeTable3 = await groupHeaderText(page, 2);
    await clickIssueButtonByIndex(page, index, '.btn-dismiss');
    await waitForRefresh(page);
    const afterTop = await topSummary(page);
    const afterTable3 = await groupHeaderText(page, 2);
    const titlesAfter = await issueTitles(page);
    await switchToContent(page);
    const summary = await contentSummary(page);
    const badges = await badgeTexts(page);
    await restoreAllPending(token);
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await switchToChecks(page);
    const afterResetTop = await topSummary(page);
    return { title, beforeTop, afterTop, beforeTable3, afterTable3, titlesAfter, summary, badges, afterResetTop };
  } finally {
    await browser.close();
  }
}

async function runBulkScenario(session, token) {
  await restoreAllPending(token);
  const { browser, page } = await setupPage(session);
  let dialogText = null;
  page.on('dialog', async (dialog) => {
    dialogText = dialog.message();
    await dialog.accept();
  });
  try {
    await switchToChecks(page);
    const beforeTop = await topSummary(page);
    await page.$$eval('button', (nodes) => {
      const btn = nodes.find((node) => (node.textContent || '').includes('一键确认'));
      if (btn) btn.click();
    });
    await waitForRefresh(page);
    const afterTop = await topSummary(page);
    await switchToContent(page);
    const summary = await contentSummary(page);
    const badges = await badgeTexts(page);
    const confirmedCount = await confirmedHighlightCount(page);
    await restoreAllPending(token);
    await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
    await switchToChecks(page);
    const afterResetTop = await topSummary(page);
    return { dialogText, beforeTop, afterTop, summary, badges, confirmedCount, afterResetTop };
  } finally {
    await browser.close();
  }
}

async function runLocateScenario(session, token, issueIndex) {
  await restoreAllPending(token);
  const { browser, page } = await setupPage(session);
  try {
    await switchToChecks(page);
    await ensureTable3Expanded(page);
    const titles = await issueTitles(page);
    const title = titles[issueIndex];
    await clickIssueButtonByIndex(page, issueIndex, '.btn-locate');
    await waitForRefresh(page);
    const banner = await focusBanner(page);
    const summary = await contentSummary(page);
    const badges = await badgeTexts(page);
    return { title, banner, summary, badges };
  } finally {
    await browser.close();
  }
}

async function run() {
  const outDir = path.join(process.cwd(), 'tmp', 'phase2c-r1');
  fs.mkdirSync(outDir, { recursive: true });

  const session = await apiLogin();
  const token = session.token;
  await restoreAllPending(token);
  const baseline = summarizeChecks(await apiGetChecks(token));

  const confirmed = await runConfirmedScenario(session, token, '结转下年度继续办理');
  const dismissed = await runDismissedScenario(session, token, '办理结果总计（自然人列）');
  const bulk = await runBulkScenario(session, token);
  const locate1 = await runLocateScenario(session, token, 0);
  const locate2 = await runLocateScenario(session, token, 1);
  const locate3 = await runLocateScenario(session, token, 4);
  await restoreAllPending(token);
  const finalBaseline = summarizeChecks(await apiGetChecks(token));

  const result = {
    reportId: REPORT_ID,
    versionId: VERSION_ID,
    baseline,
    confirmed,
    dismissed,
    bulk,
    locates: [locate1, locate2, locate3],
    finalBaseline,
  };
  fs.writeFileSync(path.join(outDir, 'phase2c-r1-result.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
