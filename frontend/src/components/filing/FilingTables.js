import React from 'react';
import { parsePastedNumbers, parseNumCell } from './tablePaste';

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function NumInput({ value, disabled, onChange, onPaste, className = '', ariaLabel }) {
  return (
    <input
      type="text"
      inputMode="decimal"
      className={`filing-num-input ${className}`.trim()}
      disabled={disabled}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      onPaste={onPaste}
      aria-label={ariaLabel}
    />
  );
}

/** 表二：国办子表矩阵 */
export function FilingTable2({ data = {}, disabled, onChange }) {
  const update = (cat, field, raw) => {
    const next = JSON.parse(JSON.stringify(data || {}));
    if (!next[cat]) next[cat] = {};
    next[cat][field] = parseNumCell(raw === '' ? '' : raw);
    onChange?.(next);
  };

  const pasteRow = (cat, fields, e) => {
    if (disabled) return;
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    const nums = parsePastedNumbers(text, fields.length);
    if (nums.length === 0) return;
    e.preventDefault();
    const next = JSON.parse(JSON.stringify(data || {}));
    if (!next[cat]) next[cat] = {};
    fields.forEach((field, i) => {
      if (i < nums.length) next[cat][field] = parseNumCell(nums[i]);
    });
    onChange?.(next);
  };

  const cell = (cat, field, fields) => (
    <NumInput
      value={data?.[cat]?.[field] ?? ''}
      disabled={disabled}
      onChange={(v) => update(cat, field, v)}
      onPaste={(e) => pasteRow(cat, fields, e)}
    />
  );

  const fields3 = ['made', 'repealed', 'valid'];
  const fields1 = ['processed'];
  const fieldsFee = ['amount'];

  return (
    <div className="filing-matrix-stack">
      <div className="filing-matrix-card">
        <div className="filing-matrix-card__title">
          第二十条第（一）项
          <span className="filing-matrix-card__meta">支持粘贴整行数字</span>
        </div>
        <div className="filing-matrix-scroll">
          <table className="filing-matrix filing-matrix--fill">
            <thead>
              <tr>
                <th className="filing-matrix__rowhead">项目</th>
                <th>本年制发件数</th>
                <th>本年废止件数</th>
                <th>现行有效件数</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="filing-matrix__label">规章</td>
                <td>{cell('regulations', 'made', fields3)}</td>
                <td>{cell('regulations', 'repealed', fields3)}</td>
                <td>{cell('regulations', 'valid', fields3)}</td>
              </tr>
              <tr>
                <td className="filing-matrix__label">行政规范性文件</td>
                <td>{cell('normativeDocuments', 'made', fields3)}</td>
                <td>{cell('normativeDocuments', 'repealed', fields3)}</td>
                <td>{cell('normativeDocuments', 'valid', fields3)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="filing-matrix-row2">
        <div className="filing-matrix-card">
          <div className="filing-matrix-card__title">第二十条第（五）项</div>
          <div className="filing-matrix-scroll">
            <table className="filing-matrix filing-matrix--fill">
              <thead>
                <tr>
                  <th className="filing-matrix__rowhead">项目</th>
                  <th>本年处理决定数量</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="filing-matrix__label">行政许可</td>
                  <td>{cell('licensing', 'processed', fields1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="filing-matrix-card">
          <div className="filing-matrix-card__title">第二十条第（六）项</div>
          <div className="filing-matrix-scroll">
            <table className="filing-matrix filing-matrix--fill">
              <thead>
                <tr>
                  <th className="filing-matrix__rowhead">项目</th>
                  <th>本年处理决定数量</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="filing-matrix__label">行政处罚</td>
                  <td>{cell('punishment', 'processed', fields1)}</td>
                </tr>
                <tr>
                  <td className="filing-matrix__label">行政强制</td>
                  <td>{cell('coercion', 'processed', fields1)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="filing-matrix-card">
          <div className="filing-matrix-card__title">第二十条第（八）项</div>
          <div className="filing-matrix-scroll">
            <table className="filing-matrix filing-matrix--fill">
              <thead>
                <tr>
                  <th className="filing-matrix__rowhead">项目</th>
                  <th>本年收费金额（万元）</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="filing-matrix__label">行政事业性收费</td>
                  <td>{cell('fees', 'amount', fieldsFee)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const TABLE3_COLUMNS = [
  { key: 'naturalPerson', label: '自然人' },
  { key: 'legalPerson.commercial', label: '商业企业' },
  { key: 'legalPerson.research', label: '科研机构' },
  { key: 'legalPerson.social', label: '社会公益组织' },
  { key: 'legalPerson.legal', label: '法律服务机构' },
  { key: 'legalPerson.other', label: '其他' },
  { key: 'total', label: '合计' },
];

const TABLE3_ROWS = [
  { type: 'group', label: '一、收到申请' },
  { type: 'data', path: 'newReceived', label: '本年新收政府信息公开申请数量' },
  { type: 'data', path: 'carriedOver', label: '上年结转政府信息公开申请数量' },
  { type: 'group', label: '二、办理结果' },
  { type: 'data', path: 'results.granted', label: '（一）予以公开' },
  { type: 'data', path: 'results.partialGrant', label: '（二）部分公开' },
  { type: 'group', label: '（三）不予公开' },
  { type: 'data', path: 'results.denied.stateSecret', label: '1. 属于国家秘密' },
  { type: 'data', path: 'results.denied.lawForbidden', label: '2. 其他法律行政法规禁止公开' },
  { type: 'data', path: 'results.denied.safetyStability', label: '3. 危及“三安全一稳定”' },
  { type: 'data', path: 'results.denied.thirdPartyRights', label: '4. 保护第三方合法权益' },
  { type: 'data', path: 'results.denied.internalAffairs', label: '5. 属于三类内部事务信息' },
  { type: 'data', path: 'results.denied.processInfo', label: '6. 属于四类过程性信息' },
  { type: 'data', path: 'results.denied.enforcementCase', label: '7. 属于行政执法案卷' },
  { type: 'data', path: 'results.denied.adminQuery', label: '8. 属于行政查询事项' },
  { type: 'group', label: '（四）无法提供' },
  { type: 'data', path: 'results.unableToProvide.noInfo', label: '1. 本机关不掌握相关政府信息' },
  { type: 'data', path: 'results.unableToProvide.needCreation', label: '2. 没有现成信息需要另行制作' },
  { type: 'data', path: 'results.unableToProvide.unclear', label: '3. 补正后申请内容仍不明确' },
  { type: 'group', label: '（五）不予处理' },
  { type: 'data', path: 'results.notProcessed.complaint', label: '1. 信访举报投诉类申请' },
  { type: 'data', path: 'results.notProcessed.repeat', label: '2. 重复申请' },
  { type: 'data', path: 'results.notProcessed.publication', label: '3. 要求提供公开出版物' },
  { type: 'data', path: 'results.notProcessed.massiveRequests', label: '4. 无正当理由大量反复申请' },
  { type: 'data', path: 'results.notProcessed.confirmInfo', label: '5. 要求确认或重新出具已获取信息' },
  { type: 'group', label: '（六）其他处理' },
  { type: 'data', path: 'results.other.overdueCorrection', label: '1. 逾期不补正不再处理' },
  { type: 'data', path: 'results.other.overdueFee', label: '2. 逾期未缴费不再处理' },
  { type: 'data', path: 'results.other.otherReasons', label: '3. 其他原因' },
  { type: 'group', label: '三、办结与结转' },
  { type: 'data', path: 'results.totalProcessed', label: '本年度办理结果总计' },
  { type: 'data', path: 'results.carriedForward', label: '结转下年度继续办理' },
];

/** 表三：国办横向矩阵（行=指标，列=申请人类型） */
export function FilingTable3({ data = {}, disabled, onChange }) {
  const updateCell = (colKey, fieldPath, raw) => {
    const next = JSON.parse(JSON.stringify(data || {}));
    const colParts = colKey.split('.');
    let col = next;
    for (const part of colParts) {
      if (!col[part] || typeof col[part] !== 'object') col[part] = {};
      col = col[part];
    }
    setByPath(col, fieldPath, parseNumCell(raw === '' ? '' : raw));
    onChange?.(next);
  };

  const pasteRow = (fieldPath, e) => {
    if (disabled) return;
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    const nums = parsePastedNumbers(text, TABLE3_COLUMNS.length);
    if (nums.length === 0) return;
    e.preventDefault();

    const next = JSON.parse(JSON.stringify(data || {}));
    TABLE3_COLUMNS.forEach((col, i) => {
      if (i >= nums.length) return;
      const colParts = col.key.split('.');
      let entity = next;
      for (const part of colParts) {
        if (!entity[part] || typeof entity[part] !== 'object') entity[part] = {};
        entity = entity[part];
      }
      setByPath(entity, fieldPath, parseNumCell(nums[i]));
    });
    onChange?.(next);
  };

  const colSpan = TABLE3_COLUMNS.length + 1;

  return (
    <div className="filing-matrix-card filing-matrix-card--table3">
      <div className="filing-matrix-card__title">
        收到和处理政府信息公开申请情况
        <span className="filing-matrix-card__meta">选中任意单元格粘贴整行（如网页/Excel 一行数字）</span>
      </div>
      <div className="filing-matrix-scroll">
        <table className="filing-matrix filing-matrix--table3">
          <colgroup>
            <col className="col-label" />
            {TABLE3_COLUMNS.map((col) => (
              <col key={col.key} className="col-data" />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} className="filing-matrix__sticky filing-matrix__rowhead">
                指标项目
              </th>
              <th rowSpan={2}>自然人</th>
              <th colSpan={5}>法人或其他组织</th>
              <th rowSpan={2}>合计</th>
            </tr>
            <tr>
              <th>商业企业</th>
              <th>科研机构</th>
              <th>社会公益组织</th>
              <th>法律服务机构</th>
              <th>其他</th>
            </tr>
          </thead>
          <tbody>
            {TABLE3_ROWS.map((row) => {
              if (row.type === 'group') {
                return (
                  <tr key={`g-${row.label}`} className="filing-matrix__group-row">
                    <td colSpan={colSpan}>{row.label}</td>
                  </tr>
                );
              }
              return (
                <tr key={row.path}>
                  <td className="filing-matrix__label filing-matrix__sticky">{row.label}</td>
                  {TABLE3_COLUMNS.map((col) => {
                    const entity = getByPath(data, col.key) || {};
                    const value = getByPath(entity, row.path);
                    return (
                      <td key={`${col.key}.${row.path}`}>
                        <NumInput
                          value={value ?? ''}
                          disabled={disabled}
                          onChange={(v) => updateCell(col.key, row.path, v)}
                          onPaste={(e) => pasteRow(row.path, e)}
                          ariaLabel={`${row.label}-${col.label}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 表四：复议/诉讼矩阵 */
export function FilingTable4({ data = {}, disabled, onChange }) {
  const fields = [
    { key: 'maintain', label: '结果维持' },
    { key: 'correct', label: '结果纠正' },
    { key: 'other', label: '其他结果' },
    { key: 'unfinished', label: '尚未审结' },
    { key: 'total', label: '总计' },
  ];
  const groups = [
    { key: 'review', title: '行政复议' },
    { key: 'litigationDirect', title: '行政诉讼（未经复议直接起诉）' },
    { key: 'litigationPostReview', title: '行政诉讼（复议后起诉）' },
  ];

  const update = (group, field, raw) => {
    const next = JSON.parse(JSON.stringify(data || {}));
    if (!next[group]) next[group] = {};
    next[group][field] = parseNumCell(raw === '' ? '' : raw);
    onChange?.(next);
  };

  const pasteRow = (groupKey, e) => {
    if (disabled) return;
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    const nums = parsePastedNumbers(text, fields.length);
    if (nums.length === 0) return;
    e.preventDefault();
    const next = JSON.parse(JSON.stringify(data || {}));
    if (!next[groupKey]) next[groupKey] = {};
    fields.forEach((f, i) => {
      if (i < nums.length) next[groupKey][f.key] = parseNumCell(nums[i]);
    });
    onChange?.(next);
  };

  return (
    <div className="filing-matrix-card">
      <div className="filing-matrix-card__title">
        政府信息公开行政复议、行政诉讼情况
        <span className="filing-matrix-card__meta">支持粘贴整行数字</span>
      </div>
      <div className="filing-matrix-scroll">
        <table className="filing-matrix filing-matrix--table4 filing-matrix--fill">
          <thead>
            <tr>
              <th className="filing-matrix__rowhead">类别</th>
              {fields.map((f) => (
                <th key={f.key}>{f.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => (
              <tr key={group.key}>
                <td className="filing-matrix__label">{group.title}</td>
                {fields.map((f) => (
                  <td key={f.key}>
                    <NumInput
                      value={data?.[group.key]?.[f.key] ?? ''}
                      disabled={disabled}
                      onChange={(v) => update(group.key, f.key, v)}
                      onPaste={(e) => pasteRow(group.key, e)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
