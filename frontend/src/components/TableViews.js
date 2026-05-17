import React from 'react';
import { TrendingUp } from 'lucide-react';
import { analyzeTable3Diagnostics, getTable3SuspiciousCell } from '../utils/table3Diagnostics';
import { Table3IssueSummary, Table4IssueSummary, toCircledNumber } from './TableIssueSummary';
import { classifyTable3Issue } from '../utils/consistencyDisplay';
import './GovDataTable.css';

const cx = (...classes) => classes.filter(Boolean).join(' ');

const getIssueCategory = (item) => {
  const key = String(item?.check_key || item?.checkKey || '').toLowerCase();
  const title = String(item?.title || '');
  if (key.startsWith('t3_')) return item?.table3Category || classifyTable3Issue(item);

  if (key.includes('identity') || title.includes('本年新收+上年结转')) return 'identity';
  if (key.includes('column_sum') || key.includes('col_sum') || title.includes('各列求和=总计')) return 'col_sum';
  if (key.includes('result_total') || key.includes('results_total')) return 'result_total';
  if (key.includes('t4_sum_')) return 'table4';
  return 'other';
};

const pathEndsWith = (fullPath, suffix) => (
  typeof fullPath === 'string' &&
  (fullPath === suffix || fullPath.endsWith(`.${suffix}`) || fullPath.endsWith(suffix))
);

const getDefaultIssueEmphasis = (item, fullPath, role = '') => {
  const category = getIssueCategory(item);

  switch (category) {
    case 'identity':
      if (
        pathEndsWith(fullPath, 'newReceived') ||
        pathEndsWith(fullPath, 'carriedOver') ||
        pathEndsWith(fullPath, 'results.totalProcessed') ||
        pathEndsWith(fullPath, 'results.carriedForward')
      ) {
        return 'primary';
      }
      return 'none';
    case 'result_total':
      return pathEndsWith(fullPath, 'results.totalProcessed') ? 'primary' : 'none';
    case 'col_sum':
      return typeof fullPath === 'string' && fullPath.startsWith('tableData.total.') ? 'primary' : 'none';
    case 'table4':
      return pathEndsWith(fullPath, '.total') ? 'primary' : 'none';
    default:
      return role === 'primary' ? 'primary' : 'none';
  }
};

const buildIssueBadgeTokens = (issueIndexes = []) => {
  if (!issueIndexes.length) return [];
  if (issueIndexes.length === 1) return [toCircledNumber(issueIndexes[0])];
  if (issueIndexes.length === 2) {
    return [
      toCircledNumber(issueIndexes[0]),
      toCircledNumber(issueIndexes[1]),
    ];
  }
  return [`${toCircledNumber(issueIndexes[0])}+${issueIndexes.length - 1}`];
};

const getOcrCorrectionMeta = (fullPath, ocrCorrections = []) => {
  if (!fullPath || !Array.isArray(ocrCorrections)) return null;
  return ocrCorrections.find((item) => item?.fieldPath === fullPath && item.status !== 'rejected') || null;
};

const renderCellContent = (value, correction) => {
  if (!correction) return value;
  const confirmed = correction.status === 'confirmed';
  return (
    <span className="ocr-correction-cell-content">
      <span className="ocr-correction-value">{correction.ocrValue}</span>
      {!confirmed && <span className="ocr-correction-original">原 {correction.parsedValue ?? '-'}</span>}
      <span className={`ocr-correction-badge ${confirmed ? 'ocr-correction-badge--confirmed' : ''}`}>
        {confirmed ? 'OCR已确认' : 'OCR待确认'}
      </span>
    </span>
  );
};

// Table 2: Active Disclosure - Matched to PDF format
const Table2View = ({ data, highlightCells = [], ocrCorrections = [], tableIssues = [] }) => {
  if (!data) return null;
  const activeTable2Issues = tableIssues.filter((item) => item?.human_status !== 'dismissed');

  const getTable2CellMeta = (fullPath) => {
    const matches = activeTable2Issues
      .filter((item) => {
        const paths = [
          ...(item?.evidence?.leftPaths || []),
          ...(item?.evidence?.rightPaths || []),
          ...(item?.evidence?.paths || []),
        ];
        return paths.includes(fullPath) || item?.fieldPath === fullPath;
      })
      .map((item, idx) => ({
        item,
        displayNo: item?.displayNo ?? idx + 1,
        confirmed: item?.human_status === 'confirmed',
        primary:
          (item?.evidence?.rightPaths || []).includes(fullPath) ||
          (item?.evidence?.paths || []).includes(fullPath) ||
          item?.fieldPath === fullPath,
      }));

    const primaryMatches = matches.filter((entry) => entry.primary);
    const effectiveMatches = primaryMatches.length > 0 ? primaryMatches : matches;
    return {
      displayNos: effectiveMatches.map((entry) => entry.displayNo).filter(Boolean),
      hasConfirmed: effectiveMatches.some((entry) => entry.confirmed),
      tooltip: effectiveMatches
        .map((entry) => `${toCircledNumber(entry.displayNo)} ${entry.item?.title || ''}`)
        .join('\n'),
    };
  };

  const renderCell = (value, path, colSpan = 1) => {
    const fullPath = path ? `activeDisclosureData.${path}` : null;
    const meta = fullPath ? getHighlightMeta(fullPath, highlightCells) : { className: '', sideLabel: '' };
    const correction = fullPath ? getOcrCorrectionMeta(fullPath, ocrCorrections) : null;
    const issueMeta = fullPath ? getTable2CellMeta(fullPath) : { displayNos: [], hasConfirmed: false, tooltip: '' };
    const badgeTokens = buildIssueBadgeTokens(issueMeta.displayNos);
    const badgeMode = badgeTokens.length > 1 ? 'pair' : (issueMeta.displayNos.length >= 3 ? 'count' : 'single');

    return (
      <td
        colSpan={colSpan}
        className={cx(
          'gov-table-number-cell',
          meta.className,
          correction && 'cell-ocr-corrected',
          correction?.status === 'confirmed' && 'cell-ocr-confirmed',
          issueMeta.hasConfirmed && 'cell-issue-confirmed'
        )}
        data-cell-path={fullPath || undefined}
        data-hl-side={meta.sideLabel || undefined}
        title={
          [
            correction ? `OCR修正：原解析值 ${correction.parsedValue ?? '-'}，OCR值 ${correction.ocrValue ?? '-'}` : '',
            issueMeta.tooltip,
          ]
            .filter(Boolean)
            .join('\n')
            || undefined
        }
      >
        {badgeTokens.length > 0 && (
          <span
            className={cx('issue-badge-cluster', badgeMode === 'pair' && 'issue-badge-cluster--pair')}
            title={issueMeta.tooltip || undefined}
          >
            {badgeTokens.map((token, tokenIdx) => (
              <span
                key={`${fullPath || 'cell'}-${token}-${tokenIdx}`}
                className={cx(
                  'issue-badge issue-badge--circled',
                  badgeMode === 'pair' && 'issue-badge--pair',
                  badgeMode === 'count' && 'issue-badge--count'
                )}
              >
                {token}
              </span>
            ))}
          </span>
        )}
        {renderCellContent(value, correction)}
      </td>
    );
  };

  return (
    <div className="comparison-table-container gov-table-card gov-table-card--table2">
      {activeTable2Issues.length > 0 && (
        <div className="tis-panel tis-panel--table2">
          <div className="tis-hero">
            <span className="tis-hero-icon">!</span>
            <div className="tis-hero-body">
              <div className="tis-hero-title">表二发现 {activeTable2Issues.length} 条需处理提示</div>
              <div className="tis-hero-chips">
                <span className="tis-chip tis-chip--table4">问题 {activeTable2Issues.filter((item) => item.auto_status === 'FAIL').length}</span>
                <span className="tis-chip tis-chip--other">待复核 {activeTable2Issues.filter((item) => item.auto_status === 'UNCERTAIN').length}</span>
              </div>
            </div>
          </div>
          <div className="tis-cards">
            {activeTable2Issues.map((item, index) => {
              const displayNo = item?.displayNo ?? index + 1;
              const isConfirmed = item?.human_status === 'confirmed';
              return (
                <div
                  key={item?.stableIssueId || item?.id || `${item?.check_key || 'table2'}-${index}`}
                  className={cx('tis-card', 'tis-card--other', isConfirmed && 'tis-card--confirmed')}
                  style={{
                    background: isConfirmed ? '#f8fafc' : '#fffbeb',
                    borderColor: isConfirmed ? '#cbd5e1' : '#fde68a',
                  }}
                >
                  <span className="tis-badge" style={{ background: isConfirmed ? '#64748b' : '#d97706' }}>
                    {toCircledNumber(displayNo)}
                  </span>
                  <div className="tis-card-body">
                    <span className="tis-card-title" style={{ color: isConfirmed ? '#64748b' : '#92400e' }}>
                      {item?.title || item?.check_key || '表二勾稽提示'}
                      {isConfirmed && <span className="tis-confirmed-tag">已确认</span>}
                    </span>
                    <span className="tis-card-formula">
                      {item?.auto_status === 'FAIL' ? '问题项：仍计入问题数。' : '待复核项：不计入问题数。'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="gov-table-scroll">
        <table className="comparison-table gov-data-table gov-data-table--table2">
        <thead>
          {/* Header 1 */}
          <tr className="gov-table-section-row">
            <th colSpan={4} className="gov-table-section-heading">第二十条第（一）项</th>
          </tr>
          <tr className="gov-table-column-row">
            <th width="25%" className="gov-table-text-header">信息内容</th>
            <th width="25%">本年制发件数</th>
            <th width="25%">本年废止件数</th>
            <th width="25%">现行有效件数</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="gov-table-text-cell">规章</td>
            {renderCell(data.regulations?.made, 'regulations.made')}
            {renderCell(data.regulations?.repealed, 'regulations.repealed')}
            {renderCell(data.regulations?.valid, 'regulations.valid')}
          </tr>
          <tr>
            <td className="gov-table-text-cell">行政规范性文件</td>
            {renderCell(data.normativeDocuments?.made, 'normativeDocuments.made')}
            {renderCell(data.normativeDocuments?.repealed, 'normativeDocuments.repealed')}
            {renderCell(data.normativeDocuments?.valid, 'normativeDocuments.valid')}
          </tr>

          {/* Header 2 */}
          <tr className="gov-table-section-row">
            <th colSpan={4} className="gov-table-section-heading">第二十条第（五）项</th>
          </tr>
          <tr className="gov-table-column-row">
            <th className="gov-table-text-header">信息内容</th>
            <th colSpan={3}>本年处理决定数量</th>
          </tr>
          <tr>
            <td className="gov-table-text-cell">行政许可</td>
            {renderCell(data.licensing?.processed, 'licensing.processed', 3)}
          </tr>

          {/* Header 3 */}
          <tr className="gov-table-section-row">
            <th colSpan={4} className="gov-table-section-heading">第二十条第（六）项</th>
          </tr>
          <tr className="gov-table-column-row">
            <th className="gov-table-text-header">信息内容</th>
            <th colSpan={3}>本年处理决定数量</th>
          </tr>
          <tr>
            <td className="gov-table-text-cell">行政处罚</td>
            {renderCell(data.punishment?.processed, 'punishment.processed', 3)}
          </tr>
          <tr>
            <td className="gov-table-text-cell">行政强制</td>
            {renderCell(data.coercion?.processed, 'coercion.processed', 3)}
          </tr>

          {/* Header 4 */}
          <tr className="gov-table-section-row">
            <th colSpan={4} className="gov-table-section-heading">第二十条第（八）项</th>
          </tr>
          <tr className="gov-table-column-row">
            <th className="gov-table-text-header">信息内容</th>
            <th colSpan={3}>本年收费金额（单位：万元）</th>
          </tr>
          <tr>
            <td className="gov-table-text-cell">行政事业性收费</td>
            {renderCell(data.fees?.amount, 'fees.amount', 3)}
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  );
};

// Helper to determine highlight class + side label
const getHighlightMeta = (fullPath, highlightCells) => {
  if (!highlightCells || highlightCells.length === 0 || !fullPath) {
    return { className: '', sideLabel: '' };
  }

  const matches = highlightCells.filter(item => {
    const p = typeof item === 'string' ? item : item.path;
    return p === fullPath || (p && fullPath && (p.includes(fullPath) || fullPath.includes(p)));
  });

  if (matches.length === 0) return { className: '', sideLabel: '' };

  const focusMatches = matches.filter(m => typeof m === 'object' && m.scope === 'focus');
  const effectiveMatches = focusMatches.length > 0 ? focusMatches : matches;
  const types = new Set(effectiveMatches.map(m => typeof m === 'string' ? 'diff' : m.type));
  const isConfirmed = effectiveMatches.some(m => typeof m === 'object' && m.confirmed);

  if (focusMatches.length > 0) {
    const hasLeft = types.has('left');
    const hasRight = types.has('right');
    let sideLabel = '';
    if (hasLeft && hasRight) sideLabel = '左右';
    else if (hasLeft) sideLabel = '参与值';
    else if (hasRight) sideLabel = '目标值';

    if (isConfirmed) sideLabel = '已确认';

    let focusClass = '';
    if (hasLeft && hasRight) focusClass = 'cell-focus-both';
    else if (hasLeft) focusClass = 'cell-focus-left';
    else if (hasRight) focusClass = 'cell-focus-right';
    else focusClass = 'cell-focus';

    if (isConfirmed) focusClass += ' cell-issue-confirmed';

    return { className: focusClass, sideLabel };
  }

  let sideLabel = isConfirmed ? '已确认' : '';

  if (types.has('source')) {
    return { className: 'cell-source-anomaly' + (isConfirmed ? ' cell-issue-confirmed' : ''), sideLabel: isConfirmed ? '已确认' : '源表异常' };
  }

  let baseClass = '';
  if (types.has('left') && types.has('right')) {
    baseClass = 'cell-issue-both';
  } else if (types.has('left')) {
    baseClass = 'cell-issue-related';
  } else if (types.has('right')) {
    baseClass = 'cell-issue-primary';
  } else {
    baseClass = 'cell-issue-generic';
  }

  if (isConfirmed) baseClass += ' cell-issue-confirmed';

  return { className: baseClass, sideLabel };
};

// Table 3 View
const Table3View = ({ data, compact = false, highlightCells = [], ocrCorrections = [], tableIssues = [] }) => {
  if (!data) return null;
  const diagnostics = analyzeTable3Diagnostics(data);
  const splitWarnings = diagnostics.suspiciousRows || [];

  const hasChecksData = tableIssues && tableIssues.length > 0;

  let reconciliationWarnings = [];
  if (hasChecksData) {
    reconciliationWarnings = tableIssues.map((item, idx) => {
      const paths = [...(item.evidence?.leftPaths || []), ...(item.evidence?.rightPaths || []), ...(item.evidence?.paths || [])];
      let entityFullPath = 'unknown';
      const samplePath = paths.find(p => p.includes('tableData.')) || '';
      if (samplePath.includes('legalPerson.')) {
         const sub = samplePath.split('legalPerson.')[1]?.split('.')[0];
         if (sub) entityFullPath = `legalPerson.${sub}`;
      } else if (samplePath.includes('naturalPerson')) {
         entityFullPath = 'naturalPerson';
      } else if (samplePath.includes('total')) {
         entityFullPath = 'total';
      }
      return {
        key: item.check_key || `check_${idx}`,
        title: item.title || '表三勾稽异常',
        entityFullPath,
        rowLabel: item.title,
        message: item.message || '',
        paths,
        formulaText: '见下方说明',
        direction: '',
        originalItem: item,
      };
    });
  } else {
    reconciliationWarnings = diagnostics.identityRows || [];
  }

  const getData = (key) => {
    if (key === 'naturalPerson') return data.naturalPerson;
    if (key === 'total') return data.total;
    return data.legalPerson?.[key];
  };

  const val = (cat, path) => {
    const category = getData(cat);
    if (!category) return 0;
    if (!path.includes('.')) return category[path] || 0;
    const [p1, p2] = path.split('.');
    return category[p1]?.[p2] || 0;
  };

  const deniedVal = (cat, key) => {
    const category = getData(cat);
    return category?.results?.denied?.[key] || 0;
  };

  const unableVal = (cat, key) => {
    const category = getData(cat);
    return category?.results?.unableToProvide?.[key] || 0;
  };

  const notProcessedVal = (cat, key) => {
    const category = getData(cat);
    return category?.results?.notProcessed?.[key] || 0;
  };

  const otherVal = (cat, key) => {
    const category = getData(cat);
    return category?.results?.other?.[key] || 0;
  };

  const renderCell = (v, category = null, fieldPath = null) => {
    const fullPath = category && fieldPath ? `tableData.${category}.${fieldPath}` : null;
    const meta = fullPath ? getHighlightMeta(fullPath, highlightCells) : { className: '', sideLabel: '' };
    const correction = fullPath ? getOcrCorrectionMeta(fullPath, ocrCorrections) : null;

    let suspicious = null;
    let issueIndexes = [];     // 0-based indices into reconciliationWarnings
    let issueRoles = [];       // parallel array: 'primary' | 'related'
    let issueEmphases = [];
    let primaryCategories = [];

    if (hasChecksData) {
      for (let i = 0; i < reconciliationWarnings.length; i++) {
        const item = reconciliationWarnings[i].originalItem;
        let matched = false;
        let role = '';
        if (item.evidence?.leftPaths?.includes(fullPath)) {
          matched = true; role = 'related';
        } else if (item.evidence?.rightPaths?.includes(fullPath) || item.evidence?.paths?.includes(fullPath)) {
          matched = true; role = 'primary';
        }
        if (matched) {
          if (!suspicious) suspicious = { type: 'mismatch', role, title: item.title, marker: role === 'primary' ? 'R' : 'L' };
          issueIndexes.push(item.displayNo ?? i + 1);
          issueRoles.push(role);
          const emphasis = getDefaultIssueEmphasis(item, fullPath, role);
          issueEmphases.push(emphasis);
          if (emphasis === 'primary') {
            primaryCategories.push(getIssueCategory(item));
          }
        }
      }

      if (!suspicious) {
        const diagSus = getTable3SuspiciousCell(diagnostics, fullPath);
        if (diagSus && diagSus.type === 'split') suspicious = diagSus;
      }
    } else {
      suspicious = fullPath ? getTable3SuspiciousCell(diagnostics, fullPath) : null;
      if (suspicious?.type === 'mismatch') {
        const idx = reconciliationWarnings.findIndex((item) => item.key === suspicious.identityKey);
        if (idx >= 0) { issueIndexes.push(reconciliationWarnings[idx]?.originalItem?.displayNo ?? idx + 1); issueRoles.push('primary'); }
      }
    }

    // Build tooltip
    const correctionTitle = correction
      ? `OCR修正：原解析值 ${correction.parsedValue ?? '-'}，OCR值 ${correction.ocrValue ?? '-'}`
      : '';
    let issueTooltip = '';
    if (issueIndexes.length > 0) {
      const lines = issueIndexes.map((idx, pos) => {
        const w = reconciliationWarnings.find((entry) => (entry?.originalItem?.displayNo ?? null) === idx) || reconciliationWarnings[idx - 1];
        const num = toCircledNumber(idx);
        const roleLabel = issueRoles[pos] === 'primary' ? '目标值' : '参与值';
        return `${num} ${w?.title || ''}（${roleLabel}）`;
      });
      issueTooltip = `该单元格涉及 ${issueIndexes.length} 个问题：\n${lines.join('\n')}`;
    }
    const cellTitle = [correctionTitle, issueTooltip, suspicious?.type === 'split' ? suspicious.title : ''].filter(Boolean).join('\n');

    const effectiveEmphasis = issueEmphases.includes('primary')
      ? 'primary'
      : issueEmphases.includes('related')
        ? 'related'
        : null;
    const dominantCategory = primaryCategories.includes('identity')
      ? 'identity'
      : primaryCategories.includes('result_total')
        ? 'result_total'
        : primaryCategories.includes('col_sum')
          ? 'col_sum'
          : primaryCategories[0] || null;
    const badgeTokens = effectiveEmphasis === 'primary' ? buildIssueBadgeTokens(issueIndexes) : [];
    const badgeMode = badgeTokens.length > 1 ? 'pair' : (issueIndexes.length >= 3 ? 'count' : 'single');

    return (
      <td
        className={cx(
          'text-center table3-number-cell gov-table-number-cell',
          category === 'total' && 'gov-table-total-cell',
          meta.className,
          suspicious && 'cell-suspicious-fragment',
          suspicious?.type === 'split' && 'cell-suspicious-fragment--split',
          suspicious?.type === 'mismatch' && 'cell-suspicious-fragment--mismatch',
          effectiveEmphasis === 'primary' && 'cell-issue-primary',
          effectiveEmphasis === 'related' && 'cell-issue-related cell-issue-related--weak',
          dominantCategory && `cell-issue-tone--${dominantCategory}`,
          correction && 'cell-ocr-corrected',
          correction?.status === 'confirmed' && 'cell-ocr-confirmed'
        )}
        data-cell-path={fullPath || undefined}
        data-hl-side={meta.sideLabel || undefined}
        data-suspicious-label={suspicious?.marker || undefined}
        data-issue-role={effectiveEmphasis || undefined}
        title={cellTitle || undefined}
        aria-label={cellTitle || undefined}
      >
        {badgeTokens.length > 0 && (
          <span
            className={cx('issue-badge-cluster', badgeMode === 'pair' && 'issue-badge-cluster--pair')}
            title={issueTooltip || undefined}
            aria-label={issueTooltip || undefined}
          >
            {badgeTokens.map((token, tokenIdx) => (
              <span
                key={`${fullPath || 'cell'}-${token}-${tokenIdx}`}
                className={cx(
                  'issue-badge issue-badge--circled',
                  badgeMode === 'pair' && 'issue-badge--pair',
                  badgeMode === 'count' && 'issue-badge--count'
                )}
              >
                {token}
              </span>
            ))}
          </span>
        )}
        {renderCellContent(v, correction)}
      </td>
    );
  };

  return (
    <div className={cx('comparison-table-container gov-table-card gov-table-card--table3', compact && 'shadow-none gov-table-card--compact')}>
      {/* Issue guidance: structured summary banner (replaces old crude reconciliation text) */}
      {hasChecksData && <Table3IssueSummary issues={tableIssues} />}

      {/* Legacy split-cell warnings preserved */}
      {splitWarnings.length > 0 && (
        <div className="table-diagnostic-banner">
          <div className="table-diagnostic-title">疑似拆格告警</div>
          {splitWarnings.map((item) => (
            <div key={item.key} className="table-diagnostic-item">
              {item.message}
            </div>
          ))}
        </div>
      )}

      {/* Fallback: no checks data, show diagnostics inline */}
      {!hasChecksData && reconciliationWarnings.length > 0 && (
        <div className="table-diagnostic-banner">
          <div className="table-diagnostic-title table-diagnostic-title--reconciliation">表格数据勾稽异常</div>
          {reconciliationWarnings.map((item) => (
            <div key={item.key} className="table-diagnostic-item">{item.message}</div>
          ))}
        </div>
      )}
      <div className={cx('gov-table-scroll gov-table-scroll--wide', compact ? 'gov-table-scroll--fit' : 'overflow-x-auto min-w-[900px]')}>
        <table className="comparison-table table-fixed gov-data-table gov-data-table--table3">
          {/* Columns Config */}
          <colgroup>
            {/* Approximate widths */}
            <col style={{ width: compact ? '5%' : '50px' }} />
            <col style={{ width: compact ? '10%' : '150px' }} />
            <col style={{ width: compact ? '26%' : '300px' }} />
            <col span={7} style={{ width: compact ? '8.43%' : 'auto' }} />
          </colgroup>

          <thead>
            <tr className="gov-table-header-row gov-table-header-row--level1">
              <th rowSpan={3} colSpan={3} className="bg-gray-50 font-normal text-left align-top leading-tight gov-table-note-cell gov-table-header-level-1">
                <div style={{ transform: 'scale(0.9)', transformOrigin: 'top left', width: '110%' }}>
                  （本列数据的勾稽关系为：第一项加第二项之和，等于第三项加第四项之和）
                </div>
              </th>
              <th colSpan={7} className="text-center bg-gray-50 gov-table-header-level-1">申请人情况</th>
            </tr>

            <tr className="gov-table-header-row gov-table-header-row--level2">
              <th rowSpan={2} className="bg-gray-50 gov-table-header-level-2 gov-table-group-start">自然人</th>
              <th colSpan={5} className="text-center bg-gray-50 gov-table-header-level-2 gov-table-group-start gov-table-group-end">法人或其他组织</th>
              <th rowSpan={2} className="bg-gray-50 gov-table-header-level-2 gov-table-total-header gov-table-group-start">总计</th>
            </tr>

            <tr className="gov-table-header-row gov-table-header-row--level3">
              <th className="font-normal bg-gray-50 gov-table-header-level-3 gov-table-group-start">商业<br />企业</th>
              <th className="font-normal bg-gray-50 gov-table-header-level-3">科研<br />机构</th>
              <th className="font-normal bg-gray-50 gov-table-header-level-3">社会公益<br />组织</th>
              <th className="font-normal bg-gray-50 gov-table-header-level-3">法律服务<br />机构</th>
              <th className="font-normal bg-gray-50 gov-table-header-level-3 gov-table-group-end">其他</th>
            </tr>
          </thead>

          <tbody>
            <tr className="gov-table-major-row">
              <td className="font-bold gov-table-text-cell gov-table-primary-label" colSpan={3}>一、本年新收政府信息公开申请数量</td>
              {renderCell(val('naturalPerson', 'newReceived'), 'naturalPerson', 'newReceived')}
              {renderCell(val('commercial', 'newReceived'), 'legalPerson.commercial', 'newReceived')}
              {renderCell(val('research', 'newReceived'), 'legalPerson.research', 'newReceived')}
              {renderCell(val('social', 'newReceived'), 'legalPerson.social', 'newReceived')}
              {renderCell(val('legal', 'newReceived'), 'legalPerson.legal', 'newReceived')}
              {renderCell(val('other', 'newReceived'), 'legalPerson.other', 'newReceived')}
              {renderCell(val('total', 'newReceived'), 'total', 'newReceived')}
            </tr>

            <tr className="gov-table-major-row">
              <td className="font-bold gov-table-text-cell gov-table-primary-label" colSpan={3}>二、上年结转政府信息公开申请数量</td>
              {renderCell(val('naturalPerson', 'carriedOver'), 'naturalPerson', 'carriedOver')}
              {renderCell(val('commercial', 'carriedOver'), 'legalPerson.commercial', 'carriedOver')}
              {renderCell(val('research', 'carriedOver'), 'legalPerson.research', 'carriedOver')}
              {renderCell(val('social', 'carriedOver'), 'legalPerson.social', 'carriedOver')}
              {renderCell(val('legal', 'carriedOver'), 'legalPerson.legal', 'carriedOver')}
              {renderCell(val('other', 'carriedOver'), 'legalPerson.other', 'carriedOver')}
              {renderCell(val('total', 'carriedOver'), 'total', 'carriedOver')}
            </tr>

            {/* Results Section */}
            <tr>
              <td rowSpan={22} className="align-top pt-4 font-bold text-center gov-table-section-cell gov-table-vertical-section">三<br />、<br />本<br />年<br />度<br />办<br />理<br />结<br />果</td>
              <td colSpan={2} className="gov-table-text-cell gov-table-subsection-label">（一）予以公开</td>
              {renderCell(val('naturalPerson', 'results.granted'), 'naturalPerson', 'results.granted')}
              {renderCell(val('commercial', 'results.granted'), 'legalPerson.commercial', 'results.granted')}
              {renderCell(val('research', 'results.granted'), 'legalPerson.research', 'results.granted')}
              {renderCell(val('social', 'results.granted'), 'legalPerson.social', 'results.granted')}
              {renderCell(val('legal', 'results.granted'), 'legalPerson.legal', 'results.granted')}
              {renderCell(val('other', 'results.granted'), 'legalPerson.other', 'results.granted')}
              {renderCell(val('total', 'results.granted'), 'total', 'results.granted')}
            </tr>

            <tr>
              <td colSpan={2} className="gov-table-text-cell gov-table-subsection-label">（二）部分公开</td>
              {renderCell(val('naturalPerson', 'results.partialGrant'), 'naturalPerson', 'results.partialGrant')}
              {renderCell(val('commercial', 'results.partialGrant'), 'legalPerson.commercial', 'results.partialGrant')}
              {renderCell(val('research', 'results.partialGrant'), 'legalPerson.research', 'results.partialGrant')}
              {renderCell(val('social', 'results.partialGrant'), 'legalPerson.social', 'results.partialGrant')}
              {renderCell(val('legal', 'results.partialGrant'), 'legalPerson.legal', 'results.partialGrant')}
              {renderCell(val('other', 'results.partialGrant'), 'legalPerson.other', 'results.partialGrant')}
              {renderCell(val('total', 'results.partialGrant'), 'total', 'results.partialGrant')}
            </tr>

            {[
              { label: '1.属于国家秘密', k: 'stateSecret' },
              { label: '2.其他法律行政法规禁止公开', k: 'lawForbidden' },
              { label: '3.危及“三安全一稳定”', k: 'safetyStability' },
              { label: '4.保护第三方合法权益', k: 'thirdPartyRights' },
              { label: '5.属于三类内部事务信息', k: 'internalAffairs' },
              { label: '6.属于四类过程性信息', k: 'processInfo' },
              { label: '7.属于行政执法案卷', k: 'enforcementCase' },
              { label: '8.属于行政查询事项', k: 'adminQuery' },
            ].map((item, i) => (
              <tr key={item.k}>
                {i === 0 && <td rowSpan={8} className="text-center gov-table-section-cell">（三）<br />不予<br />公开</td>}
                <td className="gov-table-text-cell">{item.label}</td>
                {renderCell(deniedVal('naturalPerson', item.k), 'naturalPerson', `results.denied.${item.k}`)}
                {renderCell(deniedVal('commercial', item.k), 'legalPerson.commercial', `results.denied.${item.k}`)}
                {renderCell(deniedVal('research', item.k), 'legalPerson.research', `results.denied.${item.k}`)}
                {renderCell(deniedVal('social', item.k), 'legalPerson.social', `results.denied.${item.k}`)}
                {renderCell(deniedVal('legal', item.k), 'legalPerson.legal', `results.denied.${item.k}`)}
                {renderCell(deniedVal('other', item.k), 'legalPerson.other', `results.denied.${item.k}`)}
                {renderCell(deniedVal('total', item.k), 'total', `results.denied.${item.k}`)}
              </tr>
            ))}

            {[
              { label: '1.本机关不掌握相关政府信息', k: 'noInfo' },
              { label: '2.没有现成信息需要另行制作', k: 'needCreation' },
              { label: '3.补正后申请内容仍不明确', k: 'unclear' },
            ].map((item, i) => (
              <tr key={item.k}>
                {i === 0 && <td rowSpan={3} className="text-center gov-table-section-cell">（四）<br />无法<br />提供</td>}
                <td className="gov-table-text-cell">{item.label}</td>
                {renderCell(unableVal('naturalPerson', item.k), 'naturalPerson', `results.unableToProvide.${item.k}`)}
                {renderCell(unableVal('commercial', item.k), 'legalPerson.commercial', `results.unableToProvide.${item.k}`)}
                {renderCell(unableVal('research', item.k), 'legalPerson.research', `results.unableToProvide.${item.k}`)}
                {renderCell(unableVal('social', item.k), 'legalPerson.social', `results.unableToProvide.${item.k}`)}
                {renderCell(unableVal('legal', item.k), 'legalPerson.legal', `results.unableToProvide.${item.k}`)}
                {renderCell(unableVal('other', item.k), 'legalPerson.other', `results.unableToProvide.${item.k}`)}
                {renderCell(unableVal('total', item.k), 'total', `results.unableToProvide.${item.k}`)}
              </tr>
            ))}

            {[
              { label: '1.信访举报投诉类申请', k: 'complaint' },
              { label: '2.重复申请', k: 'repeat' },
              { label: '3.要求提供公开出版物', k: 'publication' },
              { label: '4.无正当理由大量反复申请', k: 'massiveRequests' },
              { label: '5.要求行政机关确认或重新出具已获取信息', k: 'confirmInfo' },
            ].map((item, i) => (
              <tr key={item.k}>
                {i === 0 && <td rowSpan={5} className="text-center gov-table-section-cell">（五）<br />不予<br />处理</td>}
                <td className="gov-table-text-cell">{item.label}</td>
                {renderCell(notProcessedVal('naturalPerson', item.k), 'naturalPerson', `results.notProcessed.${item.k}`)}
                {renderCell(notProcessedVal('commercial', item.k), 'legalPerson.commercial', `results.notProcessed.${item.k}`)}
                {renderCell(notProcessedVal('research', item.k), 'legalPerson.research', `results.notProcessed.${item.k}`)}
                {renderCell(notProcessedVal('social', item.k), 'legalPerson.social', `results.notProcessed.${item.k}`)}
                {renderCell(notProcessedVal('legal', item.k), 'legalPerson.legal', `results.notProcessed.${item.k}`)}
                {renderCell(notProcessedVal('other', item.k), 'legalPerson.other', `results.notProcessed.${item.k}`)}
                {renderCell(notProcessedVal('total', item.k), 'total', `results.notProcessed.${item.k}`)}
              </tr>
            ))}

            {[
              { label: '1.逾期不补正', k: 'overdueCorrection' },
              { label: '2.逾期不缴费', k: 'overdueFee' },
              { label: '3.其他', k: 'otherReasons' },
            ].map((item, i) => (
              <tr key={item.k}>
                {i === 0 && <td rowSpan={3} className="text-center gov-table-section-cell">（六）<br />其他<br />处理</td>}
                <td className="gov-table-text-cell">{item.label}</td>
                {renderCell(otherVal('naturalPerson', item.k), 'naturalPerson', `results.other.${item.k}`)}
                {renderCell(otherVal('commercial', item.k), 'legalPerson.commercial', `results.other.${item.k}`)}
                {renderCell(otherVal('research', item.k), 'legalPerson.research', `results.other.${item.k}`)}
                {renderCell(otherVal('social', item.k), 'legalPerson.social', `results.other.${item.k}`)}
                {renderCell(otherVal('legal', item.k), 'legalPerson.legal', `results.other.${item.k}`)}
                {renderCell(otherVal('other', item.k), 'legalPerson.other', `results.other.${item.k}`)}
                {renderCell(otherVal('total', item.k), 'total', `results.other.${item.k}`)}
              </tr>
            ))}

            <tr className="bg-gray-50 gov-table-total-row">
              <td className="font-bold gov-table-text-cell gov-table-primary-label" colSpan={2}>（七）总计</td>
              {renderCell(val('naturalPerson', 'results.totalProcessed'), 'naturalPerson', 'results.totalProcessed')}
              {renderCell(val('commercial', 'results.totalProcessed'), 'legalPerson.commercial', 'results.totalProcessed')}
              {renderCell(val('research', 'results.totalProcessed'), 'legalPerson.research', 'results.totalProcessed')}
              {renderCell(val('social', 'results.totalProcessed'), 'legalPerson.social', 'results.totalProcessed')}
              {renderCell(val('legal', 'results.totalProcessed'), 'legalPerson.legal', 'results.totalProcessed')}
              {renderCell(val('other', 'results.totalProcessed'), 'legalPerson.other', 'results.totalProcessed')}
              {renderCell(val('total', 'results.totalProcessed'), 'total', 'results.totalProcessed')}
            </tr>

            <tr className="gov-table-major-row">
              <td className="font-bold gov-table-text-cell gov-table-primary-label" colSpan={3}>四、结转下年度继续办理</td>
              {renderCell(val('naturalPerson', 'results.carriedForward'), 'naturalPerson', 'results.carriedForward')}
              {renderCell(val('commercial', 'results.carriedForward'), 'legalPerson.commercial', 'results.carriedForward')}
              {renderCell(val('research', 'results.carriedForward'), 'legalPerson.research', 'results.carriedForward')}
              {renderCell(val('social', 'results.carriedForward'), 'legalPerson.social', 'results.carriedForward')}
              {renderCell(val('legal', 'results.carriedForward'), 'legalPerson.legal', 'results.carriedForward')}
              {renderCell(val('other', 'results.carriedForward'), 'legalPerson.other', 'results.carriedForward')}
              {renderCell(val('total', 'results.carriedForward'), 'total', 'results.carriedForward')}
            </tr>

          </tbody>
        </table>
      </div>

      {/* Table 3 legend */}
      {(hasChecksData && tableIssues.some(i => i.human_status !== 'dismissed')) && (
        <div className="tis-table-legend">
          <span className="tis-table-legend-item"><strong>实线框：</strong>重点核对值</span>
          <span className="tis-table-legend-sep" />
          <span className="tis-table-legend-item"><span className="tis-legend-swatch tis-legend-swatch--solid" />重点核对值</span>
          <span className="tis-table-legend-item"><span className="tis-legend-swatch tis-legend-swatch--dashed" />淡色提示</span>
          <span className="tis-table-legend-item"><strong>编号：</strong>对应上方问题</span>
          <span className="tis-table-legend-item"><strong>+</strong>：该格涉及多个问题，悬停查看详情</span>
          <span className="tis-table-legend-item tis-table-legend-note">建议优先核对实线框单元格；淡色/虚线单元格仅表示参与计算。</span>
        </div>
      )}
    </div>
  );
};

// Table 4 View
const Table4View = ({ data, highlightCells = [], ocrCorrections = [], tableIssues = [] }) => {
  if (!data) return null;

  const activeTable4Issues = tableIssues.filter(i => i.human_status !== 'dismissed');

  // Build a map: fullPath → [{issueIndex (0-based), role}]
  const t4CellIssueMap = {};
  activeTable4Issues.forEach((item, idx) => {
    (item.evidence?.leftPaths || []).forEach(p => {
      if (!t4CellIssueMap[p]) t4CellIssueMap[p] = [];
      t4CellIssueMap[p].push({ idx, role: 'related', category: getIssueCategory(item) });
    });
    (item.evidence?.rightPaths || []).forEach(p => {
      if (!t4CellIssueMap[p]) t4CellIssueMap[p] = [];
      t4CellIssueMap[p].push({ idx, role: 'primary', category: getIssueCategory(item) });
    });
    (item.evidence?.paths || []).forEach(p => {
      if (!t4CellIssueMap[p] && !item.evidence?.leftPaths?.length && !item.evidence?.rightPaths?.length) {
        t4CellIssueMap[p] = [];
        t4CellIssueMap[p].push({ idx, role: 'related', category: getIssueCategory(item) });
      }
    });
  });

  const renderCell = (value, category, field, extraClass = '') => {
    const fullPath = `reviewLitigationData.${category}.${field}`;
    const meta = getHighlightMeta(fullPath, highlightCells);
    const correction = getOcrCorrectionMeta(fullPath, ocrCorrections);
    const cellMatches = t4CellIssueMap[fullPath] || [];
    const issueIndexes = cellMatches.map(m => activeTable4Issues[m.idx]?.displayNo ?? m.idx + 1);
    const issueRoles   = cellMatches.map(m => m.role);
    const issueEmphases = cellMatches.map(m => getDefaultIssueEmphasis(activeTable4Issues[m.idx], fullPath, m.role));
    const primaryCategories = cellMatches
      .filter((m, idx) => issueEmphases[idx] === 'primary')
      .map(m => m.category)
      .filter(Boolean);
    const effectiveEmphasis = issueEmphases.includes('primary')
      ? 'primary'
      : issueEmphases.includes('related')
        ? 'related'
        : null;
    const dominantCategory = primaryCategories[0] || null;
    const badgeTokens = effectiveEmphasis === 'primary' ? buildIssueBadgeTokens(issueIndexes) : [];
    const badgeMode = badgeTokens.length > 1 ? 'pair' : (issueIndexes.length >= 3 ? 'count' : 'single');

    let issueTooltip = '';
    if (issueIndexes.length > 0) {
      const lines = issueIndexes.map((idx, pos) => {
        const it = activeTable4Issues.find((entry) => (entry?.displayNo ?? null) === idx) || activeTable4Issues[idx - 1];
        const num = toCircledNumber(idx);
        const roleLabel = issueRoles[pos] === 'primary' ? '目标值' : '参与值';
        return `${num} ${it?.title || ''}（${roleLabel}）`;
      });
      issueTooltip = `该单元格涉及 ${issueIndexes.length} 个问题：\n${lines.join('\n')}`;
    }

    const correctionTitle = correction
      ? `OCR修正：原解析值 ${correction.parsedValue ?? '-'}，OCR值 ${correction.ocrValue ?? '-'}`
      : '';
    const cellTitle = [correctionTitle, issueTooltip].filter(Boolean).join('\n');

    return (
      <td
        className={cx(
          'gov-table-number-cell',
          extraClass,
          meta.className,
          effectiveEmphasis === 'primary' && 'cell-issue-primary',
          effectiveEmphasis === 'related' && 'cell-issue-related cell-issue-related--weak',
          dominantCategory && `cell-issue-tone--${dominantCategory}`,
          correction && 'cell-ocr-corrected',
          correction?.status === 'confirmed' && 'cell-ocr-confirmed'
        )}
        data-cell-path={fullPath}
        data-hl-side={meta.sideLabel || undefined}
        data-issue-role={effectiveEmphasis || undefined}
        title={cellTitle || undefined}
      >
        {badgeTokens.length > 0 && (
          <span
            className={cx('issue-badge-cluster', badgeMode === 'pair' && 'issue-badge-cluster--pair')}
            title={issueTooltip || undefined}
          >
            {badgeTokens.map((token, tokenIdx) => (
              <span
                key={`${fullPath}-${token}-${tokenIdx}`}
                className={cx(
                  'issue-badge issue-badge--circled',
                  badgeMode === 'pair' && 'issue-badge--pair',
                  badgeMode === 'count' && 'issue-badge--count'
                )}
              >
                {token}
              </span>
            ))}
          </span>
        )}
        {renderCellContent(value, correction)}
      </td>
    );
  };

  return (
    <div className="comparison-table-container gov-table-card gov-table-card--table4">
      {/* Issue guidance for table4 */}
      <Table4IssueSummary issues={tableIssues} />
      <div className="gov-table-scroll gov-table-scroll--legal">
      <table className="comparison-table text-center table-fixed gov-data-table gov-data-table--table4">
        <colgroup>
          {Array.from({ length: 15 }).map((_, i) => (
            <col key={i} style={{ width: '6.66%' }} />
          ))}
        </colgroup>
        <thead>
          <tr className="gov-table-header-row gov-table-header-row--level1">
            <th colSpan={5} className="text-center gov-table-header-level-1 gov-table-group-end">行政复议</th>
            <th colSpan={10} className="text-center gov-table-header-level-1">行政诉讼</th>
          </tr>
          <tr className="gov-table-header-row gov-table-header-row--level2">
            <th rowSpan={2} className="gov-table-header-level-2">结果维持</th>
            <th rowSpan={2} className="gov-table-header-level-2">结果纠正</th>
            <th rowSpan={2} className="gov-table-header-level-2">其他结果</th>
            <th rowSpan={2} className="gov-table-header-level-2">尚未审结</th>
            <th rowSpan={2} className="gov-table-header-level-2 gov-table-total-header gov-table-group-end">总计</th>
            <th colSpan={5} className="text-center gov-table-header-level-2 gov-table-group-start gov-table-group-end">未经复议直接起诉</th>
            <th colSpan={5} className="text-center gov-table-header-level-2 gov-table-group-start">复议后起诉</th>
          </tr>
          <tr className="gov-table-header-row gov-table-header-row--level3">
            {/* Sub-headers */}
            <th className="gov-table-header-level-3">结果维持</th>
            <th className="gov-table-header-level-3">结果纠正</th>
            <th className="gov-table-header-level-3">其他结果</th>
            <th className="gov-table-header-level-3">尚未审结</th>
            <th className="gov-table-header-level-3 gov-table-total-header gov-table-group-end">总计</th>
            <th className="gov-table-header-level-3">结果维持</th>
            <th className="gov-table-header-level-3">结果纠正</th>
            <th className="gov-table-header-level-3">其他结果</th>
            <th className="gov-table-header-level-3">尚未审结</th>
            <th className="gov-table-header-level-3 gov-table-total-header">总计</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {/* Review Data */}
            {renderCell(data.review?.maintain, 'review', 'maintain')}
            {renderCell(data.review?.correct, 'review', 'correct')}
            {renderCell(data.review?.other, 'review', 'other')}
            {renderCell(data.review?.unfinished, 'review', 'unfinished')}
            {renderCell(data.review?.total, 'review', 'total', 'font-bold gov-table-total-cell gov-table-group-end')}
            {/* Litigation Direct Data */}
            {renderCell(data.litigationDirect?.maintain, 'litigationDirect', 'maintain')}
            {renderCell(data.litigationDirect?.correct, 'litigationDirect', 'correct')}
            {renderCell(data.litigationDirect?.other, 'litigationDirect', 'other')}
            {renderCell(data.litigationDirect?.unfinished, 'litigationDirect', 'unfinished')}
            {renderCell(data.litigationDirect?.total, 'litigationDirect', 'total', 'font-bold gov-table-total-cell gov-table-group-end')}
            {/* Litigation Post-Review Data */}
            {renderCell(data.litigationPostReview?.maintain, 'litigationPostReview', 'maintain')}
            {renderCell(data.litigationPostReview?.correct, 'litigationPostReview', 'correct')}
            {renderCell(data.litigationPostReview?.other, 'litigationPostReview', 'other')}
            {renderCell(data.litigationPostReview?.unfinished, 'litigationPostReview', 'unfinished')}
            {renderCell(data.litigationPostReview?.total, 'litigationPostReview', 'total', 'font-bold gov-table-total-cell')}
          </tr>
        </tbody>
      </table>
      </div>

      {/* Table 4 legend */}
      {activeTable4Issues.length > 0 && (
        <div className="tis-table-legend">
          <span className="tis-table-legend-item"><strong>实线框：</strong>重点核对值</span>
          <span className="tis-table-legend-sep" />
          <span className="tis-table-legend-item"><span className="tis-legend-swatch tis-legend-swatch--solid" />重点核对值</span>
          <span className="tis-table-legend-item"><span className="tis-legend-swatch tis-legend-swatch--dashed" />淡色提示</span>
          <span className="tis-table-legend-item"><strong>编号：</strong>对应上方问题</span>
          <span className="tis-table-legend-item"><strong>+</strong>：该格涉及多个问题，悬停查看详情</span>
          <span className="tis-table-legend-item tis-table-legend-note">建议优先核对实线框单元格；淡色/虚线单元格仅表示参与计算。</span>
        </div>
      )}
    </div>
  );
};

// Simple Diff Table for numeric comparisons
const SimpleDiffTable = ({ title, headers, rows }) => {
  if (!rows || rows.length === 0) return null;

  const formatNum = (num) => {
    if (num === null || num === undefined || num === '') return '-';
    // eslint-disable-next-line eqeqeq
    if (num == 0) return '0';
    const numVal = typeof num === 'number' ? num : parseFloat(num);
    if (isNaN(numVal)) return '-';
    return numVal % 1 === 0 ? numVal.toString() : numVal.toFixed(2);
  };

  return (
    <div className="comparison-table-container">
      <div className="p-3 bg-gray-50 border-b border-gray-200">
        <h4 className="font-bold text-gray-700 flex items-center gap-2">
          <TrendingUp size={18} className="text-blue-500" /> {title} - 差异分析
        </h4>
      </div>
      <table className="comparison-table text-sm">
        <thead>
          <tr>
            <th className="text-left" width="40%">指标名称</th>
            <th className="text-right" width="20%">{headers[1]}</th>
            <th className="text-right" width="20%">{headers[2]}</th>
            <th className="text-right" width="20%">增减值</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const valA = typeof row.valA === 'number' ? row.valA : parseFloat(row.valA) || 0;
            const valB = typeof row.valB === 'number' ? row.valB : parseFloat(row.valB) || 0;
            const diff = valB - valA;
            const isDiff = Math.abs(diff) > 0.001;

            // Red for Increase (+), Green for Decrease (-)
            const colorClass = diff > 0 ? 'text-red-600' : diff < 0 ? 'text-green-600' : 'text-gray-900';
            const diffColorClass = diff > 0 ? 'text-red-600' : diff < 0 ? 'text-green-600' : 'text-gray-400';

            return (
              <tr key={idx} className={isDiff ? 'bg-indigo-50/30' : ''}>
                <td className="text-gray-900">{row.label}</td>
                {/* Year A: Gray, standard weight */}
                <td className="text-right text-gray-500 font-mono">{formatNum(valA)}</td>
                {/* Year B: Colored based on diff, standard weight (removed font-bold) */}
                <td className={`text-right font-mono ${colorClass}`}>{formatNum(valB)}</td>
                {/* Diff: Colored, standard weight */}
                <td className={`text-right font-mono font-medium ${diffColorClass}`}>
                  {isDiff ? (diff > 0 ? `+${formatNum(diff)}` : formatNum(diff)) : '-'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export { Table2View, Table3View, Table4View, SimpleDiffTable };
