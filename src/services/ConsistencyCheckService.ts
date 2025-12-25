import { ensureSqliteMigrations, querySqlite, sqlValue } from '../config/sqlite';
import crypto from 'crypto';

interface CheckItem {
  group_key: string;
  check_key: string;
  title: string;
  expr: string;
  left_value: number | null;
  right_value: number | null;
  delta: number | null;
  tolerance: number;
  auto_status: 'PASS' | 'FAIL' | 'UNCERTAIN' | 'NOT_ASSESSABLE';
  evidence_json: string;
  fingerprint: string;
}

interface ParsedData {
  sections?: Array<{
    type: string;
    tableData?: any;
    reviewLitigationData?: any;
    content?: string;
  }>;
}

/**
 * ConsistencyCheckService - 规则引擎，不依赖 AI，完全可解释
 */
export class ConsistencyCheckService {
  
  /**
   * 运行一致性校验并保存结果
   */
  public async runChecks(reportVersionId: number): Promise<number> {
    ensureSqliteMigrations();

    // 获取 parsed_json
    const versionRow = querySqlite(`
      SELECT id, parsed_json FROM report_versions
      WHERE id = ${sqlValue(reportVersionId)} LIMIT 1;
    `)[0];

    if (!versionRow || !versionRow.parsed_json) {
      throw new Error('report_version_not_found_or_no_parsed_json');
    }

    const parsed = this.parseJsonSafe(versionRow.parsed_json);

    // 创建 run 记录
    const runResult = querySqlite(`
      INSERT INTO report_consistency_runs (report_version_id, status, engine_version, created_at)
      VALUES (${sqlValue(reportVersionId)}, 'running', 'v1', datetime('now'))
      RETURNING id;
    `);
    const runId = runResult[0].id;

    try {
      // 生成所有校验项
      const items = this.generateAllChecks(parsed, reportVersionId);

      // Upsert items（严禁覆盖 human_status/human_comment）
      for (const item of items) {
        this.upsertCheckItem(runId, reportVersionId, item);
      }

      // 计算汇总
      const summary = this.calculateSummary(reportVersionId);

      // 更新 run 状态
      querySqlite(`
        UPDATE report_consistency_runs
        SET status = 'succeeded',
            summary_json = ${sqlValue(JSON.stringify(summary))},
            finished_at = datetime('now')
        WHERE id = ${sqlValue(runId)};
      `);

      return runId;
    } catch (error) {
      querySqlite(`
        UPDATE report_consistency_runs
        SET status = 'failed', finished_at = datetime('now')
        WHERE id = ${sqlValue(runId)};
      `);
      throw error;
    }
  }

  /**
   * 生成所有校验项
   */
  private generateAllChecks(parsed: ParsedData, reportVersionId: number): CheckItem[] {
    const items: CheckItem[] = [];

    const sections = parsed.sections || [];
    const sec3 = sections.find(s => s.type === 'table_3')?.tableData;
    const sec4 = sections.find(s => s.type === 'table_4')?.reviewLitigationData;
    const texts = sections
      .filter(s => s.type === 'text' && typeof s.content === 'string')
      .map(s => s.content)
      .join('\n');

    // 表二（暂无规则，但必须返回分组）
    items.push(...this.checkTable2(sections));

    // 表三
    items.push(...this.checkTable3(sec3));

    // 表四
    items.push(...this.checkTable4(sec4));

    // 正文一致性
    items.push(...this.checkTextConsistency(texts, sec3, sec4));

    return items;
  }

  /**
   * 表二校验（占位）
   */
  private checkTable2(sections: any[]): CheckItem[] {
    // 暂无规则，返回空或一个占位 item
    return [];
  }

  /**
   * 表三校验
   */
  private checkTable3(sec3: any): CheckItem[] {
    const items: CheckItem[] = [];

    if (!sec3) {
      // 表三缺失
      items.push({
        group_key: 'table3',
        check_key: 't3_missing',
        title: '表三：数据缺失',
        expr: 'N/A',
        left_value: null,
        right_value: null,
        delta: null,
        tolerance: 0,
        auto_status: 'NOT_ASSESSABLE',
        evidence_json: JSON.stringify({ reason: '表三数据缺失' }),
        fingerprint: this.computeFingerprint('table3', 't3_missing', 'N/A'),
      });
      return items;
    }

    // 实体集合
    const entityKeys = [
      { path: 'naturalPerson', label: '自然人列' },
      { path: 'legalPerson.commercial', label: '商业企业列' },
      { path: 'legalPerson.research', label: '科研机构列' },
      { path: 'legalPerson.social', label: '社会公益组织列' },
      { path: 'legalPerson.legal', label: '法律服务机构列' },
      { path: 'legalPerson.other', label: '其他法人列' },
      { path: 'total', label: '总计列' },
    ];

    for (const ent of entityKeys) {
      const data = this.getNestedValue(sec3, ent.path);
      if (!data) continue;

      // 1) 办理结果总计校验
      items.push(this.checkTable3ResultSum(data, ent.path, ent.label));

      // 2) 恒等式校验
      items.push(this.checkTable3Identity(data, ent.path, ent.label));
    }

    // 3) 总计列 = 各列求和（对 newReceived、carriedOver、totalProcessed、carriedForward）
    items.push(...this.checkTable3ColumnSums(sec3, entityKeys));

    return items;
  }

  /**
   * 表三：办理结果总计校验
   */
  private checkTable3ResultSum(data: any, entityPath: string, label: string): CheckItem {
    const evidence: any = { paths: [], values: {} };

    const granted = this.parseNumber(data.results?.granted);
    const partialGrant = this.parseNumber(data.results?.partialGrant);

    const denied = data.results?.denied || {};
    const deniedSum = this.sumObjectValues(denied);
    const deniedPaths = Object.keys(denied).map(k => `${entityPath}.results.denied.${k}`);

    const unableToProvide = data.results?.unableToProvide || {};
    const unableSum = this.sumObjectValues(unableToProvide);
    const unablePaths = Object.keys(unableToProvide).map(k => `${entityPath}.results.unableToProvide.${k}`);

    const notProcessed = data.results?.notProcessed || {};
    const notProcessedSum = this.sumObjectValues(notProcessed);
    const notProcessedPaths = Object.keys(notProcessed).map(k => `${entityPath}.results.notProcessed.${k}`);

    const other = data.results?.other || {};
    const otherSum = this.sumObjectValues(other);
    const otherPaths = Object.keys(other).map(k => `${entityPath}.results.other.${k}`);

    const totalProcessed = this.parseNumber(data.results?.totalProcessed);

    // 计算左值
    const leftComponents = [granted, partialGrant, deniedSum, unableSum, notProcessedSum, otherSum];
    const leftValue = leftComponents.every(v => v !== null)
      ? leftComponents.reduce((a, b) => a! + b!, 0)
      : null;

    const rightValue = totalProcessed;
    const delta = leftValue !== null && rightValue !== null ? leftValue - rightValue : null;

    // 收集证据
    evidence.paths = [
      `${entityPath}.results.granted`,
      `${entityPath}.results.partialGrant`,
      ...deniedPaths,
      ...unablePaths,
      ...notProcessedPaths,
      ...otherPaths,
      `${entityPath}.results.totalProcessed`,
    ];
    evidence.values = {
      granted,
      partialGrant,
      deniedSum,
      unableSum,
      notProcessedSum,
      otherSum,
      totalProcessed,
    };

    let auto_status: CheckItem['auto_status'];
    if (leftValue === null || rightValue === null) {
      auto_status = 'UNCERTAIN';
    } else if (Math.abs(delta!) <= 0.0001) {
      auto_status = 'PASS';
    } else {
      auto_status = 'FAIL';
    }

    const expr = 'granted + partialGrant + sum(denied.*) + sum(unableToProvide.*) + sum(notProcessed.*) + sum(other.*) = totalProcessed';
    const check_key = `t3_result_sum_${entityPath.replace(/\./g, '_')}`;

    return {
      group_key: 'table3',
      check_key,
      title: `表三：予以公开+部分公开+不予公开(8项)+无法提供(3项)+不予处理(5项)+其他(3项)=办理结果总计（${label}）`,
      expr,
      left_value: leftValue,
      right_value: rightValue,
      delta,
      tolerance: 0,
      auto_status,
      evidence_json: JSON.stringify(evidence),
      fingerprint: this.computeFingerprint('table3', check_key, expr),
    };
  }

  /**
   * 表三：恒等式校验
   */
  private checkTable3Identity(data: any, entityPath: string, label: string): CheckItem {
    const evidence: any = { paths: [], values: {} };

    const newReceived = this.parseNumber(data.newReceived);
    const carriedOver = this.parseNumber(data.carriedOver);
    const totalProcessed = this.parseNumber(data.results?.totalProcessed);
    const carriedForward = this.parseNumber(data.results?.carriedForward);

    const leftValue = newReceived !== null && carriedOver !== null
      ? newReceived + carriedOver
      : null;
    const rightValue = totalProcessed !== null && carriedForward !== null
      ? totalProcessed + carriedForward
      : null;

    const delta = leftValue !== null && rightValue !== null ? leftValue - rightValue : null;

    evidence.paths = [
      `${entityPath}.newReceived`,
      `${entityPath}.carriedOver`,
      `${entityPath}.results.totalProcessed`,
      `${entityPath}.results.carriedForward`,
    ];
    evidence.values = { newReceived, carriedOver, totalProcessed, carriedForward };

    let auto_status: CheckItem['auto_status'];
    if (leftValue === null || rightValue === null) {
      auto_status = 'UNCERTAIN';
    } else if (Math.abs(delta!) <= 0.0001) {
      auto_status = 'PASS';
    } else {
      auto_status = 'FAIL';
    }

    const expr = 'newReceived + carriedOver = totalProcessed + carriedForward';
    const check_key = `t3_identity_${entityPath.replace(/\./g, '_')}`;

    return {
      group_key: 'table3',
      check_key,
      title: `表三：本年新收+上年结转=办理结果总计+结转下年度继续办理（${label}）`,
      expr,
      left_value: leftValue,
      right_value: rightValue,
      delta,
      tolerance: 0,
      auto_status,
      evidence_json: JSON.stringify(evidence),
      fingerprint: this.computeFingerprint('table3', check_key, expr),
    };
  }

  /**
   * 表三：总计列 = 各列求和
   */
  private checkTable3ColumnSums(sec3: any, entityKeys: any[]): CheckItem[] {
    const items: CheckItem[] = [];
    const total = sec3.total;
    if (!total) return items;

    const fields = [
      { key: 'newReceived', label: '本年新收' },
      { key: 'carriedOver', label: '上年结转' },
      { key: 'results.totalProcessed', label: '办理结果总计' },
      { key: 'results.carriedForward', label: '结转下年度继续办理' },
    ];

    for (const field of fields) {
      const evidence: any = { paths: [], values: {} };
      let sumValue: number | null = 0;
      let hasNull = false;

      // 排除 total 本身
      const nonTotalEntities = entityKeys.filter(e => e.path !== 'total');

      for (const ent of nonTotalEntities) {
        const data = this.getNestedValue(sec3, ent.path);
        const val = this.parseNumber(this.getNestedValue(data, field.key));
        if (val === null) {
          hasNull = true;
        } else {
          sumValue = sumValue! + val;
        }
        evidence.paths.push(`${ent.path}.${field.key}`);
        evidence.values[ent.path] = val;
      }

      if (hasNull) sumValue = null;

      const totalValue = this.parseNumber(this.getNestedValue(total, field.key));
      const delta = sumValue !== null && totalValue !== null ? sumValue - totalValue : null;

      evidence.paths.push(`total.${field.key}`);
      evidence.values['total'] = totalValue;

      let auto_status: CheckItem['auto_status'];
      if (sumValue === null || totalValue === null) {
        auto_status = 'UNCERTAIN';
      } else if (Math.abs(delta!) <= 0.0001) {
        auto_status = 'PASS';
      } else {
        auto_status = 'FAIL';
      }

      const expr = `sum(naturalPerson.${field.key}, legalPerson.*.${field.key}) = total.${field.key}`;
      const check_key = `t3_col_sum_${field.key.replace(/\./g, '_')}`;

      items.push({
        group_key: 'table3',
        check_key,
        title: `表三：自然人+商业企业+科研机构+社会公益组织+法律服务机构+其他=总计（${field.label}，合计校验）`,
        expr,
        left_value: sumValue,
        right_value: totalValue,
        delta,
        tolerance: 0,
        auto_status,
        evidence_json: JSON.stringify(evidence),
        fingerprint: this.computeFingerprint('table3', check_key, expr),
      });
    }

    return items;
  }

  /**
   * 表四校验
   */
  private checkTable4(sec4: any): CheckItem[] {
    const items: CheckItem[] = [];

    if (!sec4) {
      items.push({
        group_key: 'table4',
        check_key: 't4_missing',
        title: '表四：数据缺失',
        expr: 'N/A',
        left_value: null,
        right_value: null,
        delta: null,
        tolerance: 0,
        auto_status: 'NOT_ASSESSABLE',
        evidence_json: JSON.stringify({ reason: '表四数据缺失' }),
        fingerprint: this.computeFingerprint('table4', 't4_missing', 'N/A'),
      });
      return items;
    }

    const categories = [
      { path: 'review', label: '行政复议' },
      { path: 'litigationDirect', label: '行政诉讼-未经复议' },
      { path: 'litigationPostReview', label: '行政诉讼-复议后起诉' },
    ];

    for (const cat of categories) {
      const data = this.getNestedValue(sec4, cat.path);
      if (!data) continue;

      const evidence: any = { paths: [], values: {} };

      const maintain = this.parseNumber(data.maintain);
      const correct = this.parseNumber(data.correct);
      const other = this.parseNumber(data.other);
      const unfinished = this.parseNumber(data.unfinished);
      const total = this.parseNumber(data.total);

      const leftComponents = [maintain, correct, other, unfinished];
      const leftValue = leftComponents.every(v => v !== null)
        ? leftComponents.reduce((a, b) => a! + b!, 0)
        : null;

      const rightValue = total;
      const delta = leftValue !== null && rightValue !== null ? leftValue - rightValue : null;

      evidence.paths = [
        `${cat.path}.maintain`,
        `${cat.path}.correct`,
        `${cat.path}.other`,
        `${cat.path}.unfinished`,
        `${cat.path}.total`,
      ];
      evidence.values = { maintain, correct, other, unfinished, total };

      let auto_status: CheckItem['auto_status'];
      if (leftValue === null || rightValue === null) {
        auto_status = 'UNCERTAIN';
      } else if (Math.abs(delta!) <= 0.0001) {
        auto_status = 'PASS';
      } else {
        auto_status = 'FAIL';
      }

      const expr = 'maintain + correct + other + unfinished = total';
      const check_key = `t4_sum_${cat.path}`;

      items.push({
        group_key: 'table4',
        check_key,
        title: `表四：结果维持+结果纠正+其他结果+尚未审结=总计（${cat.label}）`,
        expr,
        left_value: leftValue,
        right_value: rightValue,
        delta,
        tolerance: 0,
        auto_status,
        evidence_json: JSON.stringify(evidence),
        fingerprint: this.computeFingerprint('table4', check_key, expr),
      });
    }

    return items;
  }

  /**
   * 正文一致性校验
   */
  private checkTextConsistency(texts: string, sec3: any, sec4: any): CheckItem[] {
    const items: CheckItem[] = [];

    if (!texts || texts.trim() === '') {
      return items;
    }

    // 基础版：正则抽取数字
    const checks = [
      { pattern: /本年新收[^\d]*(\d+)[^\d]*件/g, key: 'text_newReceived', label: '本年新收', tablePath: 'total.newReceived', tableData: sec3 },
      { pattern: /上年结转[^\d]*(\d+)[^\d]*件/g, key: 'text_carriedOver', label: '上年结转', tablePath: 'total.carriedOver', tableData: sec3 },
      { pattern: /办理结果总计[^\d]*(\d+)[^\d]*件|办结[^\d]*(\d+)[^\d]*件/g, key: 'text_totalProcessed', label: '办理结果总计', tablePath: 'total.results.totalProcessed', tableData: sec3 },
      { pattern: /结转下年度继续办理[^\d]*(\d+)[^\d]*件/g, key: 'text_carriedForward', label: '结转下年度继续办理', tablePath: 'total.results.carriedForward', tableData: sec3 },
      { pattern: /行政复议[^\d]*(\d+)[^\d]*件/g, key: 'text_review', label: '行政复议', tablePath: 'review.total', tableData: sec4 },
    ];

    for (const check of checks) {
      const matches = Array.from(texts.matchAll(check.pattern));
      if (matches.length === 0) continue;

      const evidence: any = { matches: [], paths: [], values: {} };

      // 提取匹配的数字
      const nums = matches.map(m => parseInt(m[1] || m[2], 10)).filter(n => !isNaN(n));
      if (nums.length === 0) continue;

      const textValue = nums.length === 1 ? nums[0] : null;
      const tableValue = this.parseNumber(this.getNestedValue(check.tableData, check.tablePath));

      evidence.matches = matches.map(m => ({ text: m[0], index: m.index }));
      evidence.paths = [check.tablePath];
      evidence.values = { text: textValue, table: tableValue };

      let auto_status: CheckItem['auto_status'];
      if (nums.length > 1) {
        auto_status = 'UNCERTAIN'; // 多处匹配
      } else if (textValue === null || tableValue === null) {
        auto_status = 'UNCERTAIN';
      } else if (Math.abs(textValue - tableValue) <= 0.0001) {
        auto_status = 'PASS';
      } else {
        auto_status = 'FAIL';
      }

      const expr = `text.${check.label} = table.${check.tablePath}`;

      items.push({
        group_key: 'text',
        check_key: check.key,
        title: `正文一致性：${check.label}（正文 vs 表格）`,
        expr,
        left_value: textValue,
        right_value: tableValue,
        delta: textValue !== null && tableValue !== null ? textValue - tableValue : null,
        tolerance: 0,
        auto_status,
        evidence_json: JSON.stringify(evidence),
        fingerprint: this.computeFingerprint('text', check.key, expr),
      });
    }

    return items;
  }

  /**
   * Upsert check item（严禁覆盖 human_status/human_comment）
   */
  private upsertCheckItem(runId: number, reportVersionId: number, item: CheckItem): void {
    querySqlite(`
      INSERT INTO report_consistency_items (
        run_id, report_version_id, group_key, check_key, title, expr,
        left_value, right_value, delta, tolerance, auto_status,
        evidence_json, fingerprint, human_status, created_at, updated_at
      )
      VALUES (
        ${sqlValue(runId)}, ${sqlValue(reportVersionId)}, ${sqlValue(item.group_key)},
        ${sqlValue(item.check_key)}, ${sqlValue(item.title)}, ${sqlValue(item.expr)},
        ${sqlValue(item.left_value)}, ${sqlValue(item.right_value)}, ${sqlValue(item.delta)},
        ${sqlValue(item.tolerance)}, ${sqlValue(item.auto_status)},
        ${sqlValue(item.evidence_json)}, ${sqlValue(item.fingerprint)},
        'pending', datetime('now'), datetime('now')
      )
      ON CONFLICT(report_version_id, fingerprint) DO UPDATE SET
        run_id = excluded.run_id,
        group_key = excluded.group_key,
        check_key = excluded.check_key,
        title = excluded.title,
        expr = excluded.expr,
        left_value = excluded.left_value,
        right_value = excluded.right_value,
        delta = excluded.delta,
        tolerance = excluded.tolerance,
        auto_status = excluded.auto_status,
        evidence_json = excluded.evidence_json,
        updated_at = datetime('now');
    `);
  }

  /**
   * 计算汇总统计
   */
  private calculateSummary(reportVersionId: number): any {
    const counts = querySqlite(`
      SELECT
        SUM(CASE WHEN auto_status = 'FAIL' THEN 1 ELSE 0 END) as fail,
        SUM(CASE WHEN auto_status = 'UNCERTAIN' THEN 1 ELSE 0 END) as uncertain,
        SUM(CASE WHEN human_status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN human_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
        SUM(CASE WHEN human_status = 'dismissed' THEN 1 ELSE 0 END) as dismissed
      FROM report_consistency_items
      WHERE report_version_id = ${sqlValue(reportVersionId)};
    `)[0];

    return {
      fail: counts.fail || 0,
      uncertain: counts.uncertain || 0,
      pending: counts.pending || 0,
      confirmed: counts.confirmed || 0,
      dismissed: counts.dismissed || 0,
    };
  }

  /**
   * 安全解析 JSON
   */
  private parseJsonSafe(value: any): ParsedData {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  /**
   * 安全解析数字
   */
  private parseNumber(value: any): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '' || trimmed === '-' || trimmed === '—') return null;
      const num = parseFloat(trimmed);
      return isNaN(num) ? null : num;
    }
    return null;
  }

  /**
   * 获取嵌套值
   */
  private getNestedValue(obj: any, path: string): any {
    if (!obj) return null;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return null;
      current = current[part];
    }
    return current;
  }

  /**
   * 对象所有值求和
   */
  private sumObjectValues(obj: any): number | null {
    if (!obj || typeof obj !== 'object') return null;
    const values = Object.values(obj).map(v => this.parseNumber(v));
    if (values.some(v => v === null)) return null;
    return values.reduce((a, b) => a! + b!, 0);
  }

  /**
   * 计算稳定指纹
   */
  private computeFingerprint(groupKey: string, checkKey: string, expr: string): string {
    const input = `${groupKey}:${checkKey}:${expr}`;
    return crypto.createHash('sha256').update(input).digest('hex').substring(0, 16);
  }
}

export default new ConsistencyCheckService();
