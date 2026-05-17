const crypto = require('crypto');
const puppeteer = require('puppeteer');

const BASE_URL = 'http://127.0.0.1:8787';
const REPORT_ID = 3670;
const VERSION_ID = 3448;
const ITEM_ID = 272749;
const JWT_SECRET = '55b7ebbc951b7b6a5edb90cde458dda51691251c5bf83c023474fd0402e63485';

function createToken(userId = 1, username = 'admin') {
  const payload = {
    id: userId,
    username,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  };
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(payloadStr).digest('base64url');
  return `${payloadStr}.${signature}`;
}

async function setAuth(page) {
  const token = createToken();
  const user = { id: 1, username: 'admin', displayName: 'System Admin' };
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ authToken, authUser }) => {
      localStorage.setItem('admin_token', authToken);
      localStorage.setItem('admin_user', JSON.stringify(authUser));
    },
    { authToken: token, authUser: user }
  );
}

async function apiPatch(page, itemId, humanStatus, humanComment) {
  return page.evaluate(
    async ({ baseUrl, reportId, versionId, targetItemId, status, comment }) => {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(`${baseUrl}/api/reports/${reportId}/checks/items/${targetItemId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          version_id: versionId,
          human_status: status,
          human_comment: comment,
        }),
      });
      const text = await response.text();
      return { ok: response.ok, status: response.status, text };
    },
    {
      baseUrl: BASE_URL,
      reportId: REPORT_ID,
      versionId: VERSION_ID,
      targetItemId: itemId,
      status: humanStatus,
      comment: humanComment,
    }
  );
}

async function waitForApp(page) {
  await page.waitForFunction(
    () => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some((button) => button.textContent.includes('年报内容')) &&
        buttons.some((button) => button.textContent.includes('勾稽关系校验'));
    },
    { timeout: 30000 }
  );
}

async function openReport(page) {
  await page.goto(`${BASE_URL}/catalog/reports/${REPORT_ID}?version_id=${VERSION_ID}`, {
    waitUntil: 'domcontentloaded',
  });
  await waitForApp(page);
}

async function clickTab(page, label) {
  const clicked = await page.evaluate((tabLabel) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find((button) => button.textContent.trim() === tabLabel);
    if (!target) return false;
    target.click();
    return true;
  }, label);
  if (!clicked) {
    throw new Error(`Tab not found: ${label}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}

async function ensureChecksTab(page) {
  await clickTab(page, '勾稽关系校验');
  await page.waitForFunction(
    () => Boolean(document.querySelector('.consistency-check-view')),
    { timeout: 15000 }
  );
}

async function ensureContentTab(page) {
  await clickTab(page, '年报内容');
  await page.waitForFunction(
    () => Array.from(document.body.querySelectorAll('*')).some((node) => node.textContent.includes('表三发现')),
    { timeout: 15000 }
  );
}

async function readChecksSummary(page) {
  return page.evaluate(() => {
    const readSummary = (root) => {
      const items = Array.from(root.querySelectorAll('.summary-item, .group-summary-pill'));
      const map = {};
      items.forEach((node) => {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        const match = text.match(/^(问题|待复核|已确认|不可评估|规则)\s+(\d+)$/);
        if (match) {
          map[match[1]] = Number(match[2]);
        }
      });
      return map;
    };

    const topRoot = document.querySelector('.check-header');
    const top = topRoot ? readSummary(topRoot) : null;

    const cards = Array.from(document.querySelectorAll('.group-card'));
    const table3Card = cards.find((card) => card.textContent.includes('表三'));
    const table3 = table3Card ? readSummary(table3Card) : null;

    return { top, table3 };
  });
}

async function readContentSummary(page) {
  return page.evaluate(() => {
    const bodyText = document.body.innerText || '';
    const match = bodyText.match(/表三发现\s*(\d+)\s*处需处理问题/);
    const issueCount = match ? Number(match[1]) : null;
    const confirmedTagCount = Array.from(document.querySelectorAll('*')).filter(
      (node) => node.textContent && node.textContent.trim() === '已确认'
    ).length;
    const badgeTexts = Array.from(document.querySelectorAll('[class*="issue-badge"], [class*="diag-badge"], [class*="badge"]'))
      .map((node) => (node.textContent || '').trim())
      .filter((text) => /①|②|③|④|⑤|\+\d+/.test(text));
    const confirmedCells = document.querySelectorAll('.cell-issue-confirmed').length;
    return {
      issueCount,
      confirmedTagCount,
      confirmedCells,
      badgeTexts: Array.from(new Set(badgeTexts)).slice(0, 10),
    };
  });
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 1200 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const result = {};

  try {
    await setAuth(page);

    await apiPatch(page, ITEM_ID, 'pending', 'Phase 2C-R2 baseline restore');
    await openReport(page);
    await ensureChecksTab(page);
    result.baseline = await readChecksSummary(page);

    await apiPatch(page, ITEM_ID, 'dismissed', 'Phase 2C-R2 dismissed regression');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await ensureChecksTab(page);
    result.dismissedChecks = await readChecksSummary(page);
    await ensureContentTab(page);
    result.dismissedContent = await readContentSummary(page);

    await apiPatch(page, ITEM_ID, 'pending', 'Phase 2C-R2 reset after dismissed');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await ensureChecksTab(page);
    result.afterDismissedReset = await readChecksSummary(page);

    await apiPatch(page, ITEM_ID, 'confirmed', 'Phase 2C-R2 confirmed regression');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await ensureChecksTab(page);
    result.confirmedChecks = await readChecksSummary(page);
    await ensureContentTab(page);
    result.confirmedContent = await readContentSummary(page);

    await apiPatch(page, ITEM_ID, 'pending', 'Phase 2C-R2 final reset');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForApp(page);
    await ensureChecksTab(page);
    result.finalBaseline = await readChecksSummary(page);
  } finally {
    try {
      await apiPatch(page, ITEM_ID, 'pending', 'Phase 2C-R2 cleanup');
    } catch (_error) {
      // ignore cleanup error in script output
    }
    await browser.close();
  }

  process.stdout.write(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
