import React from 'react';
import {
  classifyTable3Issue,
  isDismissedConsistencyItem,
  TABLE3_CATEGORY_LABELS,
  TABLE3_CATEGORY_SHORT_LABELS,
} from '../utils/consistencyDisplay';

const CIRCLED_NUMBERS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];

export const toCircledNumber = (n) => {
  if (Number.isInteger(n) && n >= 1 && n <= CIRCLED_NUMBERS.length) {
    return CIRCLED_NUMBERS[n - 1];
  }
  return `(${n})`;
};

const ENTITY_LABELS = {
  naturalPerson: '自然人',
  total: '总计',
  commercial: '商业企业',
  research: '科研机构',
  social: '社会公益组织',
  legal: '法律服务机构',
  other: '其他',
};

const TABLE3_CATEGORY_COLORS = {
  identity: {
    text: '#b91c1c',
    bg: '#fef2f2',
    border: '#fecaca',
    badgeBg: '#dc2626',
  },
  result_total: {
    text: '#1d4ed8',
    bg: '#eff6ff',
    border: '#bfdbfe',
    badgeBg: '#2563eb',
  },
  col_sum: {
    text: '#7c3aed',
    bg: '#f5f3ff',
    border: '#d8b4fe',
    badgeBg: '#9333ea',
  },
  other: {
    text: '#92400e',
    bg: '#fffbeb',
    border: '#fde68a',
    badgeBg: '#d97706',
  },
};

const TABLE4_COLORS = {
  text: '#7c3aed',
  bg: '#f5f3ff',
  border: '#d8b4fe',
  badgeBg: '#9333ea',
};

const TABLE4_ROW_LABELS = {
  review: '行政复议',
  litigationDirect: '未经复议直接起诉',
  litigationPostReview: '复议后起诉',
};

const formatValue = (value) => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  const num = Number(value);
  if (Number.isNaN(num)) {
    return String(value);
  }
  return String(num);
};

const formatDelta = (delta) => {
  if (delta === null || delta === undefined || delta === '') {
    return '';
  }
  const num = Number(delta);
  if (Number.isNaN(num)) {
    return '';
  }
  return num > 0 ? `+${num}` : String(num);
};

const getDelta = (item) => {
  if (item?.delta !== null && item?.delta !== undefined && item?.delta !== '') {
    return item.delta;
  }
  const left = Number(item?.left_value ?? item?.leftValue);
  const right = Number(item?.right_value ?? item?.rightValue);
  if (Number.isNaN(left) || Number.isNaN(right)) {
    return null;
  }
  return left - right;
};

const appendDelta = (text, delta) => {
  const deltaText = formatDelta(delta);
  return deltaText ? `${text}，差值 ${deltaText}` : text;
};

const getParenLabel = (title = '') => {
  const match = String(title).match(/[（(]([^（）()]+)[）)]/);
  return match?.[1]?.trim() || '';
};

const deriveEntityLabel = (item) => {
  const checkKey = String(item?.check_key || item?.checkKey || '');
  const titleLabel = getParenLabel(item?.title || '');
  if (titleLabel) {
    return titleLabel;
  }

  const identityMatch = checkKey.match(/(?:identity|result_total)_([^_]+(?:_[^_]+)*)$/);
  const rawKey = identityMatch?.[1]?.replace(/^legalPerson_/, '')?.replace(/^tableData_/, '');
  return ENTITY_LABELS[rawKey] || rawKey || '对应行';
};

const buildTable3FormulaLines = (item, category) => {
  const values = item?.evidence?.values || {};
  const leftValue = item?.left_value ?? item?.leftValue ?? null;
  const rightValue = item?.right_value ?? item?.rightValue ?? null;
  const delta = getDelta(item);

  if (category === 'identity') {
    const newReceived = values.newReceived;
    const carriedOver = values.carriedOver;
    const totalProcessed = values.totalProcessed;
    const carriedForward = values.carriedForward;
    if ([newReceived, carriedOver, totalProcessed, carriedForward].every((v) => v !== null && v !== undefined)) {
      return [
        appendDelta(
          `本年新收 ${formatValue(newReceived)} + 上年结转 ${formatValue(carriedOver)} = 办理结果总计 ${formatValue(totalProcessed)} + 结转下年 ${formatValue(carriedForward)}`,
          delta
        ),
      ];
    }
  }

  if (category === 'result_total') {
    const leftSum = values.leftSum ?? leftValue;
    const totalProcessed = values.totalProcessed ?? rightValue;
    if (leftSum !== null && leftSum !== undefined && totalProcessed !== null && totalProcessed !== undefined) {
      return [
        appendDelta(
          `办理结果明细合计 ${formatValue(leftSum)} = 办理结果总计 ${formatValue(totalProcessed)}`,
          delta
        ),
      ];
    }
  }

  if (category === 'col_sum') {
    const sumValue = leftValue;
    const total = values.total ?? rightValue;
    if (sumValue !== null && sumValue !== undefined && total !== null && total !== undefined) {
      return [
        appendDelta(`各申请人类别合计 ${formatValue(sumValue)} = 总计 ${formatValue(total)}`, delta),
      ];
    }
  }

  if (leftValue !== null && leftValue !== undefined && rightValue !== null && rightValue !== undefined) {
    return [appendDelta(`左侧 ${formatValue(leftValue)}，右侧 ${formatValue(rightValue)}`, delta)];
  }

  return [item?.title || item?.expr || '请核对该规则'];
};

const buildTable4FormulaLines = (item) => {
  const values = item?.evidence?.values || {};
  const leftValue = item?.left_value ?? item?.leftValue ?? null;
  const rightValue = item?.right_value ?? item?.rightValue ?? null;
  const delta = getDelta(item);

  const maintain = values.maintain;
  const correct = values.correct;
  const other = values.other;
  const unfinished = values.unfinished;
  const total = values.total ?? rightValue;

  if ([maintain, correct, other, unfinished, total].every((v) => v !== null && v !== undefined)) {
    return [
      appendDelta(
        `结果维持 ${formatValue(maintain)} + 结果纠正 ${formatValue(correct)} + 其他结果 ${formatValue(other)} + 尚未审结 ${formatValue(unfinished)} = 总计 ${formatValue(total)}`,
        delta
      ),
    ];
  }

  if (leftValue !== null && leftValue !== undefined && rightValue !== null && rightValue !== undefined) {
    return [appendDelta(`行内合计 ${formatValue(leftValue)}，总计 ${formatValue(rightValue)}`, delta)];
  }

  return [item?.title || item?.expr || '请核对该规则'];
};

const buildTable3Card = (item, category) => {
  const shortLabel = TABLE3_CATEGORY_SHORT_LABELS[category] || TABLE3_CATEGORY_SHORT_LABELS.other || '规则';
  const entityLabel = deriveEntityLabel(item);
  return {
    title: `${shortLabel}（${entityLabel}）`,
    formulaLines: buildTable3FormulaLines(item, category),
  };
};

const buildTable4Card = (item) => {
  const checkKey = String(item?.check_key || item?.checkKey || '');
  const rowKey = checkKey.replace('t4_sum_', '');
  const rowLabel = TABLE4_ROW_LABELS[rowKey] || getParenLabel(item?.title || '') || '对应行';
  return {
    title: `行内合计（${rowLabel}）`,
    formulaLines: buildTable4FormulaLines(item),
  };
};

const renderLegend = ({ badgeBg, dots = [] }) => (
  <div className="tis-legend">
    <span className="tis-legend-item">
      <span className="tis-legend-badge" style={{ background: badgeBg }}>①</span>
      编号对应上方问题卡片
    </span>
    <span className="tis-legend-sep" />
    <span className="tis-legend-item">
      <span className="tis-legend-swatch tis-legend-swatch--solid" />
      实线框 = 重点核对值
    </span>
    <span className="tis-legend-item">
      <span className="tis-legend-swatch tis-legend-swatch--dashed" />
      虚线框 = 参与计算值
    </span>
    {dots.length > 0 && <span className="tis-legend-sep" />}
    {dots.map((dot) => (
      <span key={dot.label} className="tis-legend-item">
        <span className="tis-legend-dot" style={{ background: dot.color }} />
        {dot.label}
      </span>
    ))}
  </div>
);

const SummaryCard = ({ item, index, card, colors, category }) => {
  const isConfirmed = item?.human_status === 'confirmed';
  const issueKey = item?.stableIssueId || item?.id || item?.check_key || item?.checkKey || `${category}-${index}`;
  const displayNo = item?.displayNo ?? index + 1;

  return (
    <div
      key={issueKey}
      className={`tis-card tis-card--${category}${isConfirmed ? ' tis-card--confirmed' : ''}`}
      style={{
        background: isConfirmed ? '#f8fafc' : colors.bg,
        borderColor: isConfirmed ? '#cbd5e1' : colors.border,
      }}
    >
      <span className="tis-badge" style={{ background: isConfirmed ? '#64748b' : colors.badgeBg }}>
        {toCircledNumber(displayNo)}
      </span>
      <div className="tis-card-body">
        <span className="tis-card-title" style={{ color: isConfirmed ? '#64748b' : colors.text }}>
          {card.title}
          {isConfirmed && <span className="tis-confirmed-tag">已确认</span>}
        </span>
        {card.formulaLines.map((line, lineIndex) => (
          <span key={`${issueKey}-${lineIndex}`} className="tis-card-formula">{line}</span>
        ))}
      </div>
    </div>
  );
};

export const Table3IssueSummary = ({ issues = [] }) => {
  const activeIssues = issues.filter((item) => !isDismissedConsistencyItem(item));

  if (activeIssues.length === 0) {
    return null;
  }

  const groups = {
    identity: [],
    result_total: [],
    col_sum: [],
    other: [],
  };

  activeIssues.forEach((item) => {
    const category = item?.table3Category || classifyTable3Issue(item);
    if (!groups[category]) {
      groups.other.push(item);
      return;
    }
    groups[category].push(item);
  });

  const dots = [
    { label: '收办平衡', color: TABLE3_CATEGORY_COLORS.identity.text },
    { label: '明细合计', color: TABLE3_CATEGORY_COLORS.result_total.text },
    { label: '横向总计', color: TABLE3_CATEGORY_COLORS.col_sum.text },
  ];

  return (
    <div className="tis-panel tis-panel--table3">
      <div className="tis-hero">
        <span className="tis-hero-icon">!</span>
        <div className="tis-hero-body">
          <div className="tis-hero-title">表三发现 {activeIssues.length} 处需处理问题</div>
          <div className="tis-hero-chips">
            {Object.entries(groups).map(([category, items]) => (
              items.length > 0 ? (
                <span key={category} className={`tis-chip tis-chip--${category}`}>
                  {(TABLE3_CATEGORY_LABELS[category] || TABLE3_CATEGORY_LABELS.other)} {items.length}
                </span>
              ) : null
            ))}
          </div>
        </div>
      </div>

      {['identity', 'result_total', 'col_sum', 'other'].map((category) => {
        const items = groups[category];
        if (!items.length) {
          return null;
        }

        const colors = TABLE3_CATEGORY_COLORS[category] || TABLE3_CATEGORY_COLORS.other;
        return (
          <div key={category} className={`tis-group tis-group--${category}`} style={{ borderLeftColor: colors.text }}>
            <div className="tis-group-title" style={{ color: colors.text }}>
              {TABLE3_CATEGORY_LABELS[category] || TABLE3_CATEGORY_LABELS.other}
            </div>
            <div className="tis-cards">
              {items.map((item, index) => (
                <SummaryCard
                  key={item?.stableIssueId || item?.id || index}
                  item={item}
                  index={index}
                  card={buildTable3Card(item, category)}
                  colors={colors}
                  category={category}
                />
              ))}
            </div>
          </div>
        );
      })}

      {renderLegend({
        badgeBg: TABLE3_CATEGORY_COLORS.identity.badgeBg,
        dots,
      })}
    </div>
  );
};

export const Table4IssueSummary = ({ issues = [] }) => {
  const activeIssues = issues.filter((item) => !isDismissedConsistencyItem(item));

  if (activeIssues.length === 0) {
    return null;
  }

  return (
    <div className="tis-panel tis-panel--table4">
      <div className="tis-hero tis-hero--table4">
        <span className="tis-hero-icon tis-hero-icon--table4">!</span>
        <div className="tis-hero-body">
          <div className="tis-hero-title">表四发现 {activeIssues.length} 处需处理问题</div>
          <div className="tis-hero-chips">
            <span className="tis-chip tis-chip--table4">行内合计异常 {activeIssues.length}</span>
          </div>
        </div>
      </div>

      <div className="tis-group tis-group--table4" style={{ borderLeftColor: TABLE4_COLORS.text }}>
        <div className="tis-group-title" style={{ color: TABLE4_COLORS.text }}>行内合计异常</div>
        <div className="tis-cards">
          {activeIssues.map((item, index) => (
            <SummaryCard
              key={item?.stableIssueId || item?.id || index}
              item={item}
              index={index}
              card={buildTable4Card(item)}
              colors={TABLE4_COLORS}
              category="table4"
            />
          ))}
        </div>
      </div>

      {renderLegend({ badgeBg: TABLE4_COLORS.badgeBg })}
    </div>
  );
};
