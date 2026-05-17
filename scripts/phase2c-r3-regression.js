const crypto = require('crypto');
const puppeteer = require('puppeteer');

const BASE_URL = 'http://127.0.0.1:8787';
const JWT_SECRET = '55b7ebbc951b7b6a5edb90cde458dda51691251c5bf83c023474fd0402e63485';

const REPORT_3670 = { reportId: 3670, versionId: 3448 };
const TABLE4_SAMPLE = {
  reportId: 4304,
  versionId: 3964,
  reportName: '南京徐庄高新技术产业开发区管理委员会_南京徐庄高新技术产业开发区管理委员会2024年政府信息公开工作年度报告.html',
  unitName: '南京徐庄高新技术产业开发区管理委员会',
};

const T3_TARGETS = [
  {
    key: 't3_result_total_naturalPerson',
    label: '明细合计异常',
  },
  {
    key: 't3_identity_naturalPerson',
    label: '收办平衡异常',
  },
  {
    key: 't3_col_sum_results_totalProcessed',
    label: '横向总计异常',
  },
];

const T4_TARGET_KEY = 't4_sum_review';
const T4_DISMISS_KEY = 't4_sum_litigationDirect';

const circledNumbers = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function apiFetch(path, token, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_error) {
    json = null;
  }
  return { ok: response.ok, status: response.status, text, json };
}

async function fetchChecks(token, reportId, versionId) {
  const result = await apiFetch(`/api/reports/${reportId}/checks?version_id=${versionId}`, token);
  if (!result.ok) {
    throw new Error(`fetchChecks failed: ${result.status} ${result.text}`);
  }
  return result.json.data;
}

async function patchItem(token, reportId, versionId, itemId, humanStatus, humanComment) {
  const result = await apiFetch(`/api/reports/${reportId}/checks/items/${itemId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({
      version_id: versionId,
      human_status: humanStatus,
      human_comment: humanComment,
    }),
  });
  if (!result.ok) {
    throw new Error(`patchItem failed: ${result.status} ${result.text}`);
  }
}

async function setAuth(page, token) {
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

async function openReport(page, reportId, versionId) {
  await page.goto(`${BASE_URL}/catalog/reports/${reportId}?version_id=${versionId}`, {
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
  await sleep(600);
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
    () => Boolean(document.querySelector('.structured-content')),
    { timeout: 15000 }
  );
}

async function readChecksSummary(page, groupSnippet) {
  return page.evaluate((snippet) => {
    const parseCounts = (root) => {
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
    const top = topRoot ? parseCounts(topRoot) : null;
    const cards = Array.from(document.querySelectorAll('.group-card'));
    const groupCard = cards.find((card) => card.textContent.includes(snippet));
    return {
      top,
      group: groupCard ? parseCounts(groupCard) : null,
      groupTitle: groupCard ? groupCard.querySelector('h4')?.textContent?.replace(/\s+/g, ' ').trim() : null,
    };
  }, groupSnippet);
}

async function clickItemButton(page, titleSnippet, buttonLabel) {
  const clicked = await page.evaluate(({ snippet, label }) => {
    const items = Array.from(document.querySelectorAll('.check-item'));
    const target = items.find((item) => item.textContent.includes(snippet));
    if (!target) return false;
    const buttons = Array.from(target.querySelectorAll('button'));
    const button = buttons.find((node) => node.textContent.trim() === label);
    if (!button) return false;
    button.click();
    return true;
  }, { snippet: titleSnippet, label: buttonLabel });
  if (!clicked) {
    throw new Error(`Button "${buttonLabel}" not found for item "${titleSnippet}"`);
  }
  await sleep(1000);
}

async function expandGroupIfNeeded(page, groupSnippet) {
  const expanded = await page.evaluate((snippet) => {
    const cards = Array.from(document.querySelectorAll('.group-card'));
    const card = cards.find((node) => node.textContent.includes(snippet));
    if (!card) return false;
    if (card.querySelector('.group-items')) return true;
    const header = card.querySelector('.group-header');
    if (!header) return false;
    header.click();
    return true;
  }, groupSnippet);
  if (!expanded) {
    throw new Error(`Group not found: ${groupSnippet}`);
  }
  await sleep(800);
}

async function waitForFocusBanner(page, titleSnippet) {
  await page.waitForFunction(
    (snippet) => {
      const node = document.querySelector('.focus-title');
      return Boolean(node && node.textContent.includes(snippet));
    },
    { timeout: 15000 },
    titleSnippet
  );
}

async function waitForLocateActivation(page, expectedPaths) {
  await page.waitForFunction(
    (paths) => {
      const hasBanner = Boolean(document.querySelector('.focus-banner'));
      const hasFocusedTarget = Array.from(
        document.querySelectorAll('.cell-focus, .cell-focus-left, .cell-focus-right, .cell-focus-both')
      ).some((node) => paths.includes(node.getAttribute('data-cell-path')));
      const hasStructuredContent = Boolean(document.querySelector('.structured-content'));
      return hasBanner || hasFocusedTarget || hasStructuredContent;
    },
    { timeout: 15000 },
    expectedPaths
  );
}

async function collectLocateEvidence(page, expectedPaths, tableClassName, issueTitleSnippet) {
  return page.evaluate(
    ({ paths, tableClass, titleSnippet, circled }) => {
      const rectOf = (element) => {
        const rect = element.getBoundingClientRect();
        return {
          top: Math.round(rect.top),
          left: Math.round(rect.left),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
      };

      const focusTitle = document.querySelector('.focus-title')?.textContent?.trim() || '';
      const focusBannerVisible = Boolean(document.querySelector('.focus-banner'));
      const focusedCells = Array.from(
        document.querySelectorAll('.cell-focus, .cell-focus-left, .cell-focus-right, .cell-focus-both')
      ).map((node) => ({
        path: node.getAttribute('data-cell-path'),
        side: node.getAttribute('data-hl-side'),
        className: node.className,
        text: node.textContent.replace(/\s+/g, ' ').trim(),
        rect: rectOf(node),
        visible: (() => {
          const rect = node.getBoundingClientRect();
          return rect.bottom > 0 && rect.top < window.innerHeight;
        })(),
      }));

      const matchedFocusedPaths = focusedCells
        .filter((cell) => paths.includes(cell.path))
        .map((cell) => cell.path);

      const tableNode = document.querySelector(tableClass);
      const tableVisible = Boolean(tableNode && (() => {
        const rect = tableNode.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      })());

      const sectionTitles = Array.from(document.querySelectorAll('.section-title, .gov-table-card'))
        .map((node) => node.textContent.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter((text) => text.includes('表三') || text.includes('表四'))
        .slice(0, 6);

      const summaryPanel = document.querySelector(tableClass === '.gov-table-card--table3' ? '.tis-panel--table3' : '.tis-panel--table4');
      const summaryBadges = summaryPanel
        ? Array.from(summaryPanel.querySelectorAll('.tis-badge')).map((node) => node.textContent.trim())
        : [];
      const summaryTexts = summaryPanel
        ? Array.from(summaryPanel.querySelectorAll('.tis-card-title')).map((node) => node.textContent.replace(/\s+/g, ' ').trim())
        : [];

      const circledMatch = circled.find((token) => focusTitle.includes(token)) || null;
      const issueDisplayNo = focusTitle.match(/问题\s*(\d+)/)?.[1] || null;

      const badgeCells = Array.from(document.querySelectorAll(`${tableClass} .issue-badge`))
        .map((node) => ({
          text: node.textContent.trim(),
          path: node.closest('td')?.getAttribute('data-cell-path') || null,
        }))
        .filter((item) => item.text);

      const matchedBadges = badgeCells.filter((item) =>
        matchedFocusedPaths.includes(item.path) || (circledMatch ? item.text.includes(circledMatch) : false)
      );

      return {
        focusTitle,
        focusBannerVisible,
        issueDisplayNo,
        tableVisible,
        sectionTitles,
        focusedCells,
        matchedFocusedPaths,
        summaryBadges,
        summaryTexts,
        badgeCells: badgeCells.slice(0, 20),
        matchedBadges,
        issueTitleSnippetFound: summaryTexts.some((text) => text.includes(titleSnippet)),
      };
    },
    {
      paths: expectedPaths,
      tableClass: tableClassName,
      titleSnippet: issueTitleSnippet,
      circled: circledNumbers,
    }
  );
}

async function readContentIssueSummary(page, tableNo) {
  return page.evaluate((tableLabel) => {
    const bodyText = document.body.innerText || '';
    const match = bodyText.match(new RegExp(`${tableLabel}发现\\s*(\\d+)\\s*处需处理问题`));
    const issueCount = match ? Number(match[1]) : null;
    const confirmedTagCount = Array.from(document.querySelectorAll('*')).filter(
      (node) => node.textContent && node.textContent.trim() === '已确认'
    ).length;
    const confirmedCells = document.querySelectorAll('.cell-issue-confirmed').length;
    const badgeTexts = Array.from(document.querySelectorAll('.issue-badge, .tis-badge'))
      .map((node) => (node.textContent || '').trim())
      .filter((text) => /①|②|③|④|⑤|⑥|⑦|⑧|⑨|⑩|\+\d+/.test(text));
    return {
      issueCount,
      confirmedTagCount,
      confirmedCells,
      badgeTexts: Array.from(new Set(badgeTexts)).slice(0, 20),
      bodyHasTable2Empty: bodyText.includes('暂无可评估规则'),
    };
  }, tableNo);
}

async function runTable3LocateRegression(page, token) {
  const checksData = await fetchChecks(token, REPORT_3670.reportId, REPORT_3670.versionId);
  const table3Items = checksData.groups.find((group) => group.group_key === 'table3').items;
  const selected = T3_TARGETS.map((target) => {
    const item = table3Items.find((entry) => entry.check_key === target.key);
    if (!item) {
      throw new Error(`Table3 item not found: ${target.key}`);
    }
    return { ...target, item };
  });

  await openReport(page, REPORT_3670.reportId, REPORT_3670.versionId);
  await ensureChecksTab(page);

  const baseline = await readChecksSummary(page, '表三');

  const records = [];
  for (const target of selected) {
    await ensureChecksTab(page);
    await expandGroupIfNeeded(page, '表三');
    await clickItemButton(page, target.item.title, '定位到表格');
    await waitForLocateActivation(
      page,
      [...(target.item.evidence?.leftPaths || []), ...(target.item.evidence?.rightPaths || [])]
    );
    await ensureContentTab(page);
    const evidence = await collectLocateEvidence(
      page,
      [...(target.item.evidence?.leftPaths || []), ...(target.item.evidence?.rightPaths || [])],
      '.gov-table-card--table3',
      target.item.title.slice(0, 20)
    );
    const contentSummary = await readContentIssueSummary(page, '表三');
    records.push({
      category: target.label,
      checkKey: target.key,
      displayNo: target.item.displayNo,
      title: target.item.title,
      expectedPaths: {
        left: target.item.evidence?.leftPaths || [],
        right: target.item.evidence?.rightPaths || [],
      },
      evidence,
      contentSummary,
    });
  }

  return { baseline, records };
}

async function runTable4Regression(page, token) {
  const checksData = await fetchChecks(token, TABLE4_SAMPLE.reportId, TABLE4_SAMPLE.versionId);
  const table4Group = checksData.groups.find((group) => group.group_key === 'table4');
  const focusItem = table4Group.items.find((item) => item.check_key === T4_TARGET_KEY);
  const dismissItem = table4Group.items.find((item) => item.check_key === T4_DISMISS_KEY);
  if (!focusItem || !dismissItem) {
    throw new Error('Table4 regression targets not found');
  }

  await patchItem(token, TABLE4_SAMPLE.reportId, TABLE4_SAMPLE.versionId, focusItem.id, 'pending', 'Phase 2C-R3 baseline restore');
  await patchItem(token, TABLE4_SAMPLE.reportId, TABLE4_SAMPLE.versionId, dismissItem.id, 'pending', 'Phase 2C-R3 baseline restore');

  await openReport(page, TABLE4_SAMPLE.reportId, TABLE4_SAMPLE.versionId);
  await ensureChecksTab(page);
  await expandGroupIfNeeded(page, '表四');
  const baseline = await readChecksSummary(page, '表四');

  await clickItemButton(page, focusItem.title, '定位到表格');
  await waitForLocateActivation(
    page,
    [...(focusItem.evidence?.leftPaths || []), ...(focusItem.evidence?.rightPaths || [])]
  );
  await ensureContentTab(page);
  const locateEvidence = await collectLocateEvidence(
    page,
    [...(focusItem.evidence?.leftPaths || []), ...(focusItem.evidence?.rightPaths || [])],
    '.gov-table-card--table4',
    '行政复议'
  );
  const contentBaseline = await readContentIssueSummary(page, '表四');

  await ensureChecksTab(page);
  await expandGroupIfNeeded(page, '表四');
  await clickItemButton(page, focusItem.title, '确认问题');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await ensureChecksTab(page);
  const confirmedChecks = await readChecksSummary(page, '表四');
  await ensureContentTab(page);
  const confirmedContent = await readContentIssueSummary(page, '表四');

  await ensureChecksTab(page);
  await expandGroupIfNeeded(page, '表四');
  await clickItemButton(page, focusItem.title, '恢复待复核');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await ensureChecksTab(page);
  const afterConfirmedReset = await readChecksSummary(page, '表四');

  await expandGroupIfNeeded(page, '表四');
  await clickItemButton(page, dismissItem.title, '忽略');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await ensureChecksTab(page);
  const dismissedChecks = await readChecksSummary(page, '表四');
  await ensureContentTab(page);
  const dismissedContent = await readContentIssueSummary(page, '表四');

  await ensureChecksTab(page);
  await expandGroupIfNeeded(page, '表四');
  await clickItemButton(page, dismissItem.title, '恢复待复核');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForApp(page);
  await ensureChecksTab(page);
  const finalBaseline = await readChecksSummary(page, '表四');

  return {
    sample: {
      reportId: TABLE4_SAMPLE.reportId,
      versionId: TABLE4_SAMPLE.versionId,
      reportName: TABLE4_SAMPLE.reportName,
      unitName: TABLE4_SAMPLE.unitName,
      failRuleCount: table4Group.items.filter((item) => item.auto_status === 'FAIL').length,
      failItems: table4Group.items
        .filter((item) => item.auto_status === 'FAIL')
        .map((item) => ({
          id: item.id,
          checkKey: item.check_key,
          title: item.title,
        })),
    },
    baseline,
    locateEvidence,
    contentBaseline,
    confirmedChecks,
    confirmedContent,
    afterConfirmedReset,
    dismissedChecks,
    dismissedContent,
    finalBaseline,
  };
}

async function main() {
  const token = createToken();
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: { width: 1440, height: 1200 },
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  const result = {};

  try {
    await setAuth(page, token);
    result.table3Locate = await runTable3LocateRegression(page, token);
    result.table4 = await runTable4Regression(page, token);
  } finally {
    try {
      const latest3670 = await fetchChecks(token, REPORT_3670.reportId, REPORT_3670.versionId);
      const item3670 = latest3670.groups.find((group) => group.group_key === 'table3').items.find((item) => item.check_key === 't3_result_total_naturalPerson');
      if (item3670) {
        await patchItem(token, REPORT_3670.reportId, REPORT_3670.versionId, item3670.id, 'pending', 'Phase 2C-R3 cleanup');
      }
      const latest4687 = await fetchChecks(token, TABLE4_SAMPLE.reportId, TABLE4_SAMPLE.versionId);
      const t4Items = latest4687.groups.find((group) => group.group_key === 'table4').items;
      for (const item of t4Items) {
        if (item.human_status !== 'pending') {
          await patchItem(token, TABLE4_SAMPLE.reportId, TABLE4_SAMPLE.versionId, item.id, 'pending', 'Phase 2C-R3 cleanup');
        }
      }
    } catch (_error) {
      // ignore cleanup failures in script result
    }
    await browser.close();
  }

  process.stdout.write(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
