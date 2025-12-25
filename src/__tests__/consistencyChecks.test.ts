import consistencyCheckService from '../services/ConsistencyCheckService';
import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';

describe('ConsistencyCheckService', () => {
  beforeAll(() => {
    ensureSqliteMigrations();
  });

  // 测试用 fixture
  const createTestFixture = () => {
    return {
      report_id: 999,
      version_id: 999,
      sections: [
        {
          type: 'table_3',
          tableData: {
            naturalPerson: {
              newReceived: 100,
              carriedOver: 20,
              results: {
                granted: 50,
                partialGrant: 10,
                denied: {
                  stateSecret: 5,
                  lawForbidden: 3,
                  safetyStability: 2,
                  thirdPartyRights: 1,
                  internalAffairs: 1,
                  processInfo: 1,
                  enforcementCase: 1,
                  adminQuery: 1,
                },
                unableToProvide: {
                  noInfo: 10,
                  needCreation: 5,
                  unclear: 3,
                },
                notProcessed: {
                  complaint: 2,
                  repeat: 2,
                  publication: 1,
                  massiveRequests: 1,
                  confirmInfo: 1,
                },
                other: {
                  overdueCorrection: 2,
                  overdueFee: 1,
                  otherReasons: 1,
                },
                totalProcessed: 104,
                carriedForward: 16,
              },
            },
            legalPerson: {
              commercial: {
                newReceived: 50,
                carriedOver: 10,
                results: {
                  granted: 25,
                  partialGrant: 5,
                  denied: {
                    stateSecret: 2,
                    lawForbidden: 1,
                    safetyStability: 1,
                    thirdPartyRights: 1,
                    internalAffairs: 1,
                    processInfo: 0,
                    enforcementCase: 0,
                    adminQuery: 0,
                  },
                  unableToProvide: { noInfo: 5, needCreation: 2, unclear: 1 },
                  notProcessed: { complaint: 1, repeat: 1, publication: 0, massiveRequests: 0, confirmInfo: 0 },
                  other: { overdueCorrection: 1, overdueFee: 0, otherReasons: 0 },
                  totalProcessed: 48,
                  carriedForward: 12,
                },
              },
              research: { newReceived: 0, carriedOver: 0, results: { granted: 0, partialGrant: 0, denied: {}, unableToProvide: {}, notProcessed: {}, other: {}, totalProcessed: 0, carriedForward: 0 } },
              social: { newReceived: 0, carriedOver: 0, results: { granted: 0, partialGrant: 0, denied: {}, unableToProvide: {}, notProcessed: {}, other: {}, totalProcessed: 0, carriedForward: 0 } },
              legal: { newReceived: 0, carriedOver: 0, results: { granted: 0, partialGrant: 0, denied: {}, unableToProvide: {}, notProcessed: {}, other: {}, totalProcessed: 0, carriedForward: 0 } },
              other: { newReceived: 0, carriedOver: 0, results: { granted: 0, partialGrant: 0, denied: {}, unableToProvide: {}, notProcessed: {}, other: {}, totalProcessed: 0, carriedForward: 0 } },
            },
            total: {
              newReceived: 150,
              carriedOver: 30,
              results: {
                granted: 75,
                partialGrant: 15,
                denied: {
                  stateSecret: 7,
                  lawForbidden: 4,
                  safetyStability: 3,
                  thirdPartyRights: 2,
                  internalAffairs: 2,
                  processInfo: 1,
                  enforcementCase: 1,
                  adminQuery: 1,
                },
                unableToProvide: { noInfo: 15, needCreation: 7, unclear: 4 },
                notProcessed: { complaint: 3, repeat: 3, publication: 1, massiveRequests: 1, confirmInfo: 1 },
                other: { overdueCorrection: 3, overdueFee: 1, otherReasons: 1 },
                totalProcessed: 152,
                carriedForward: 28,
              },
            },
          },
        },
        {
          type: 'table_4',
          reviewLitigationData: {
            review: { maintain: 10, correct: 5, other: 2, unfinished: 3, total: 20 },
            litigationDirect: { maintain: 8, correct: 3, other: 1, unfinished: 2, total: 14 },
            litigationPostReview: { maintain: 5, correct: 2, other: 1, unfinished: 1, total: 9 },
          },
        },
        {
          type: 'text',
          content: '本年新收150件，上年结转30件，办理结果总计152件，结转下年度继续办理28件。行政复议20件。',
        },
      ],
    };
  };

  const setupTestVersion = () => {
    // 清理旧数据
    querySqlite(`DELETE FROM report_consistency_items WHERE report_version_id = 999;`);
    querySqlite(`DELETE FROM report_consistency_runs WHERE report_version_id = 999;`);
    querySqlite(`DELETE FROM report_versions WHERE id = 999;`);
    querySqlite(`DELETE FROM reports WHERE id = 999;`);
    querySqlite(`DELETE FROM regions WHERE id = 999;`);

    // 创建测试数据
    querySqlite(`INSERT INTO regions (id, name) VALUES (999, 'Test Region');`);
    querySqlite(`INSERT INTO reports (id, region_id, year) VALUES (999, 999, 2024);`);
    
    const fixture = createTestFixture();
    const parsedJson = JSON.stringify(fixture);
    
    querySqlite(`
      INSERT INTO report_versions (id, report_id, storage_path, file_hash, is_active, parsed_json)
      VALUES (999, 999, '/test/path.pdf', 'testhash123', 1, ${sqlValue(parsedJson)});
    `);
  };

  test('能生成表三和表四的校验项', async () => {
    setupTestVersion();

    const runId = await consistencyCheckService.runChecks(999);
    expect(runId).toBeGreaterThan(0);

    // 检查是否生成了表三和表四的 items
    const table3Items = querySqlite(`
      SELECT * FROM report_consistency_items
      WHERE report_version_id = 999 AND group_key = 'table3';
    `);

    const table4Items = querySqlite(`
      SELECT * FROM report_consistency_items
      WHERE report_version_id = 999 AND group_key = 'table4';
    `);

    expect(table3Items.length).toBeGreaterThan(0);
    expect(table4Items.length).toBeGreaterThan(0);
  });

  test('title 符合可读格式（表三：...（总计列/自然人列））', async () => {
    setupTestVersion();

    await consistencyCheckService.runChecks(999);

    const items = querySqlite(`
      SELECT title, group_key FROM report_consistency_items
      WHERE report_version_id = 999;
    `);

    // 检查 title 包含分组信息
    const table3Titles = items.filter((i: any) => i.group_key === 'table3').map((i: any) => i.title);
    const table4Titles = items.filter((i: any) => i.group_key === 'table4').map((i: any) => i.title);

    // 表三 title 应包含 "表三：" 和列信息（如"总计列"、"自然人列"）
    expect(table3Titles.some((t: string) => t.includes('表三：') && t.includes('总计列'))).toBe(true);
    expect(table3Titles.some((t: string) => t.includes('表三：') && t.includes('自然人列'))).toBe(true);

    // 表四 title 应包含 "表四：" 和分类信息（如"行政复议"）
    expect(table4Titles.some((t: string) => t.includes('表四：') && t.includes('行政复议'))).toBe(true);
  });

  test('fingerprint 稳定（同 input 二次运行一致）', async () => {
    setupTestVersion();

    const runId1 = await consistencyCheckService.runChecks(999);
    const items1 = querySqlite(`
      SELECT fingerprint, check_key FROM report_consistency_items
      WHERE report_version_id = 999
      ORDER BY check_key;
    `);

    const runId2 = await consistencyCheckService.runChecks(999);
    const items2 = querySqlite(`
      SELECT fingerprint, check_key FROM report_consistency_items
      WHERE report_version_id = 999
      ORDER BY check_key;
    `);

    expect(items1.length).toBeGreaterThan(0);
    expect(items1.length).toBe(items2.length);

    // fingerprint 应该一致
    for (let i = 0; i < items1.length; i++) {
      expect(items1[i].fingerprint).toBe(items2[i].fingerprint);
      expect(items1[i].check_key).toBe(items2[i].check_key);
    }
  });

  test('upsert 不覆盖 human_status（先置 dismissed，再 rerun，human_status 仍是 dismissed）', async () => {
    setupTestVersion();

    const runId1 = await consistencyCheckService.runChecks(999);

    // 获取第一个 item
    const items = querySqlite(`
      SELECT id, fingerprint, human_status FROM report_consistency_items
      WHERE report_version_id = 999
      LIMIT 1;
    `);

    expect(items.length).toBe(1);
    const itemId = items[0].id;
    expect(items[0].human_status).toBe('pending'); // 初始状态

    // 更新为 dismissed
    querySqlite(`
      UPDATE report_consistency_items
      SET human_status = 'dismissed', human_comment = 'test dismissed'
      WHERE id = ${sqlValue(itemId)};
    `);

    // 验证更新成功
    const updated = querySqlite(`
      SELECT human_status, human_comment FROM report_consistency_items
      WHERE id = ${sqlValue(itemId)};
    `)[0];
    expect(updated.human_status).toBe('dismissed');
    expect(updated.human_comment).toBe('test dismissed');

    // 再次运行 checks
    const runId2 = await consistencyCheckService.runChecks(999);
    expect(runId2).toBeGreaterThan(runId1);

    // 检查 human_status 是否保留
    const afterRerun = querySqlite(`
      SELECT human_status, human_comment FROM report_consistency_items
      WHERE id = ${sqlValue(itemId)};
    `)[0];

    expect(afterRerun.human_status).toBe('dismissed'); // 应该保持 dismissed
    expect(afterRerun.human_comment).toBe('test dismissed'); // 应该保持原 comment
  });

  test('生成的 items 包含 expr 和 evidence_json', async () => {
    setupTestVersion();

    await consistencyCheckService.runChecks(999);

    const items = querySqlite(`
      SELECT expr, evidence_json FROM report_consistency_items
      WHERE report_version_id = 999;
    `);

    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(item.expr).toBeTruthy();
      expect(item.evidence_json).toBeTruthy();

      // 验证 evidence_json 可以解析
      const evidence = JSON.parse(item.evidence_json);
      expect(evidence).toBeTruthy();
      expect(evidence.paths || evidence.matches || evidence.reason).toBeTruthy();
    }
  });

  test('表三恒等式校验能正确计算 PASS/FAIL', async () => {
    setupTestVersion();

    await consistencyCheckService.runChecks(999);

    // 对于 total 列：newReceived(150) + carriedOver(30) = totalProcessed(152) + carriedForward(28)
    // 左 = 180, 右 = 180，应该 PASS
    const identityItems = querySqlite(`
      SELECT auto_status, left_value, right_value, delta
      FROM report_consistency_items
      WHERE report_version_id = 999
        AND check_key LIKE 't3_identity_total%';
    `);

    expect(identityItems.length).toBe(1);
    const item = identityItems[0];
    expect(item.left_value).toBe(180);
    expect(item.right_value).toBe(180);
    expect(item.delta).toBe(0);
    expect(item.auto_status).toBe('PASS');
  });

  test('表四求和校验能正确计算', async () => {
    setupTestVersion();

    await consistencyCheckService.runChecks(999);

    // review: maintain(10) + correct(5) + other(2) + unfinished(3) = total(20)
    const reviewItem = querySqlite(`
      SELECT auto_status, left_value, right_value, delta
      FROM report_consistency_items
      WHERE report_version_id = 999
        AND check_key = 't4_sum_review';
    `);

    expect(reviewItem.length).toBe(1);
    expect(reviewItem[0].left_value).toBe(20);
    expect(reviewItem[0].right_value).toBe(20);
    expect(reviewItem[0].delta).toBe(0);
    expect(reviewItem[0].auto_status).toBe('PASS');
  });
});
