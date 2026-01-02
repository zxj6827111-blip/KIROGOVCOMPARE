import React from 'react';

// Table 2: Active Disclosure - Matched to PDF format
const Table2View = ({ data }) => {
  if (!data) return null;

  return (
    <div className="comparison-table-container">
      <table className="comparison-table">
        <thead>
          {/* Header 1 */}
          <tr>
            <th colSpan={4}>第二十条第（一）项</th>
          </tr>
          <tr>
            <th width="25%">信息内容</th>
            <th width="25%">本年制发件数</th>
            <th width="25%">本年废止件数</th>
            <th width="25%">现行有效件数</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>规章</td>
            <td>{data.regulations?.made}</td>
            <td>{data.regulations?.repealed}</td>
            <td>{data.regulations?.valid}</td>
          </tr>
          <tr>
            <td>行政规范性文件</td>
            <td>{data.normativeDocuments?.made}</td>
            <td>{data.normativeDocuments?.repealed}</td>
            <td>{data.normativeDocuments?.valid}</td>
          </tr>

          {/* Header 2 */}
          <tr>
            <th colSpan={4}>第二十条第（五）项</th>
          </tr>
          <tr>
            <th>信息内容</th>
            <th colSpan={3}>本年处理决定数量</th>
          </tr>
          <tr>
            <td>行政许可</td>
            <td colSpan={3}>{data.licensing?.processed}</td>
          </tr>

          {/* Header 3 */}
          <tr>
            <th colSpan={4}>第二十条第（六）项</th>
          </tr>
          <tr>
            <th>信息内容</th>
            <th colSpan={3}>本年处理决定数量</th>
          </tr>
          <tr>
            <td>行政处罚</td>
            <td colSpan={3}>{data.punishment?.processed}</td>
          </tr>
          <tr>
            <td>行政强制</td>
            <td colSpan={3}>{data.coercion?.processed}</td>
          </tr>

          {/* Header 4 */}
          <tr>
            <th colSpan={4}>第二十条第（八）项</th>
          </tr>
          <tr>
            <th>信息内容</th>
            <th colSpan={3}>本年收费金额（单位：万元）</th>
          </tr>
          <tr>
            <td>行政事业性收费</td>
            <td colSpan={3}>{data.fees?.amount}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// Table 3 View
const Table3View = ({ data, compact = false, highlightCells = [] }) => {
  if (!data) return null;

  const getData = (key) => {
    if (key === 'naturalPerson') return data.naturalPerson;
    if (key === 'total') return data.total;
    return data.legalPerson?.[key];
  };

  const shouldHighlight = (category, fieldPath) => {
    if (!highlightCells || highlightCells.length === 0) return false;
    const fullPath = `tableData.${category}.${fieldPath}`;
    return highlightCells.some(p => p === fullPath || p.includes(fullPath) || fullPath.includes(p));
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
    const highlight = category && fieldPath ? shouldHighlight(category, fieldPath) : false;
    const highlightClass = highlight ? 'cell-warning' : '';
    return (
      <td className={`text-center ${highlightClass}`}>
        {v}
      </td>
    );
  };

  return (
    <div className={`comparison-table-container ${compact ? 'shadow-none' : ''}`}>
      <div className={compact ? 'overflow-x-auto' : 'overflow-x-auto min-w-[900px]'}>
        <table className="comparison-table table-fixed">
          {/* Columns Config */}
          <colgroup>
            {/* Approximate widths */}
            <col style={{ width: compact ? '40px' : '50px' }} />
            <col style={{ width: compact ? '100px' : '150px' }} />
            <col style={{ width: compact ? '200px' : '300px' }} />
            <col span={7} style={{ width: 'auto' }} />
          </colgroup>

          <thead>
            <tr>
              <th rowSpan={3} colSpan={3} className="bg-gray-50 font-normal text-left align-top leading-tight">
                <div style={{ transform: 'scale(0.9)', transformOrigin: 'top left', width: '110%' }}>
                  （本列数据的勾稽关系为：第一项加第二项之和，等于第三项加第四项之和）
                </div>
              </th>
              <th colSpan={7} className="text-center bg-gray-50">申请人情况</th>
            </tr>

            <tr>
              <th rowSpan={2} className="bg-gray-50">自然人</th>
              <th colSpan={5} className="text-center bg-gray-50">法人或其他组织</th>
              <th rowSpan={2} className="bg-gray-50">总计</th>
            </tr>

            <tr>
              <th className="font-normal bg-gray-50">商业<br />企业</th>
              <th className="font-normal bg-gray-50">科研<br />机构</th>
              <th className="font-normal bg-gray-50">社会公益<br />组织</th>
              <th className="font-normal bg-gray-50">法律服务<br />机构</th>
              <th className="font-normal bg-gray-50">其他</th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td className="font-bold" colSpan={3}>一、本年新收政府信息公开申请数量</td>
              {renderCell(val('naturalPerson', 'newReceived'), 'naturalPerson', 'newReceived')}
              {renderCell(val('commercial', 'newReceived'), 'legalPerson.commercial', 'newReceived')}
              {renderCell(val('research', 'newReceived'), 'legalPerson.research', 'newReceived')}
              {renderCell(val('social', 'newReceived'), 'legalPerson.social', 'newReceived')}
              {renderCell(val('legal', 'newReceived'), 'legalPerson.legal', 'newReceived')}
              {renderCell(val('other', 'newReceived'), 'legalPerson.other', 'newReceived')}
              {renderCell(val('total', 'newReceived'), 'total', 'newReceived')}
            </tr>

            <tr>
              <td className="font-bold" colSpan={3}>二、上年结转政府信息公开申请数量</td>
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
              <td rowSpan={22} className="align-top pt-4 font-bold text-center">三<br />、<br />本<br />年<br />度<br />办<br />理<br />结<br />果</td>
              <td colSpan={2}>（一）予以公开</td>
              {renderCell(val('naturalPerson', 'results.granted'), 'naturalPerson', 'results.granted')}
              {renderCell(val('commercial', 'results.granted'), 'legalPerson.commercial', 'results.granted')}
              {renderCell(val('research', 'results.granted'), 'legalPerson.research', 'results.granted')}
              {renderCell(val('social', 'results.granted'), 'legalPerson.social', 'results.granted')}
              {renderCell(val('legal', 'results.granted'), 'legalPerson.legal', 'results.granted')}
              {renderCell(val('other', 'results.granted'), 'legalPerson.other', 'results.granted')}
              {renderCell(val('total', 'results.granted'), 'total', 'results.granted')}
            </tr>

            <tr>
              <td colSpan={2}>（二）部分公开</td>
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
                {i === 0 && <td rowSpan={8} className="text-center">（三）<br />不予<br />公开</td>}
                <td>{item.label}</td>
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
                {i === 0 && <td rowSpan={3} className="text-center">（四）<br />无法<br />提供</td>}
                <td>{item.label}</td>
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
                {i === 0 && <td rowSpan={5} className="text-center">（五）<br />不予<br />处理</td>}
                <td>{item.label}</td>
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
                {i === 0 && <td rowSpan={3} className="text-center">（六）<br />其他<br />处理</td>}
                <td>{item.label}</td>
                {renderCell(otherVal('naturalPerson', item.k), 'naturalPerson', `results.other.${item.k}`)}
                {renderCell(otherVal('commercial', item.k), 'legalPerson.commercial', `results.other.${item.k}`)}
                {renderCell(otherVal('research', item.k), 'legalPerson.research', `results.other.${item.k}`)}
                {renderCell(otherVal('social', item.k), 'legalPerson.social', `results.other.${item.k}`)}
                {renderCell(otherVal('legal', item.k), 'legalPerson.legal', `results.other.${item.k}`)}
                {renderCell(otherVal('other', item.k), 'legalPerson.other', `results.other.${item.k}`)}
                {renderCell(otherVal('total', item.k), 'total', `results.other.${item.k}`)}
              </tr>
            ))}

            <tr className="bg-gray-50">
              <td className="font-bold" colSpan={2}>（七）总计</td>
              {renderCell(val('naturalPerson', 'results.totalProcessed'), 'naturalPerson', 'results.totalProcessed')}
              {renderCell(val('commercial', 'results.totalProcessed'), 'legalPerson.commercial', 'results.totalProcessed')}
              {renderCell(val('research', 'results.totalProcessed'), 'legalPerson.research', 'results.totalProcessed')}
              {renderCell(val('social', 'results.totalProcessed'), 'legalPerson.social', 'results.totalProcessed')}
              {renderCell(val('legal', 'results.totalProcessed'), 'legalPerson.legal', 'results.totalProcessed')}
              {renderCell(val('other', 'results.totalProcessed'), 'legalPerson.other', 'results.totalProcessed')}
              {renderCell(val('total', 'results.totalProcessed'), 'total', 'results.totalProcessed')}
            </tr>

            <tr>
              <td className="font-bold" colSpan={3}>四、结转下年度继续办理</td>
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
    </div>
  );
};

// Table 4 View
const Table4View = ({ data, highlightCells = [] }) => {
  if (!data) return null;

  const shouldHighlight = (category, field) => {
    if (!highlightCells || highlightCells.length === 0) return false;
    const fullPath = `reviewLitigationData.${category}.${field}`;
    return highlightCells.some(p => p === fullPath || p.includes(fullPath) || fullPath.includes(p));
  };

  const renderCell = (value, category, field, extraClass = '') => {
    const highlight = shouldHighlight(category, field);
    const highlightClass = highlight ? 'cell-warning' : '';
    return (
      <td className={`${extraClass} ${highlightClass}`}>
        {value}
      </td>
    );
  };

  return (
    <div className="comparison-table-container">
      <table className="comparison-table text-center">
        <thead>
          <tr>
            <th colSpan={5} className="text-center">行政复议</th>
            <th colSpan={10} className="text-center">行政诉讼</th>
          </tr>
          <tr>
            <th rowSpan={2} width="8%">结果维持</th>
            <th rowSpan={2} width="8%">结果纠正</th>
            <th rowSpan={2} width="8%">其他结果</th>
            <th rowSpan={2} width="8%">尚未审结</th>
            <th rowSpan={2} width="8%">总计</th>
            <th colSpan={5} className="text-center">未经复议直接起诉</th>
            <th colSpan={5} className="text-center">复议后起诉</th>
          </tr>
          <tr>
            {/* Sub-headers */}
            <th width="8%">结果维持</th>
            <th width="8%">结果纠正</th>
            <th width="8%">其他结果</th>
            <th width="8%">尚未审结</th>
            <th width="8%">总计</th>
            <th width="8%">结果维持</th>
            <th width="8%">结果纠正</th>
            <th width="8%">其他结果</th>
            <th width="8%">尚未审结</th>
            <th width="8%">总计</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {/* Review Data */}
            {renderCell(data.review?.maintain, 'review', 'maintain')}
            {renderCell(data.review?.correct, 'review', 'correct')}
            {renderCell(data.review?.other, 'review', 'other')}
            {renderCell(data.review?.unfinished, 'review', 'unfinished')}
            {renderCell(data.review?.total, 'review', 'total', 'font-bold')}
            {/* Litigation Direct Data */}
            {renderCell(data.litigationDirect?.maintain, 'litigationDirect', 'maintain')}
            {renderCell(data.litigationDirect?.correct, 'litigationDirect', 'correct')}
            {renderCell(data.litigationDirect?.other, 'litigationDirect', 'other')}
            {renderCell(data.litigationDirect?.unfinished, 'litigationDirect', 'unfinished')}
            {renderCell(data.litigationDirect?.total, 'litigationDirect', 'total', 'font-bold')}
            {/* Litigation Post-Review Data */}
            {renderCell(data.litigationPostReview?.maintain, 'litigationPostReview', 'maintain')}
            {renderCell(data.litigationPostReview?.correct, 'litigationPostReview', 'correct')}
            {renderCell(data.litigationPostReview?.other, 'litigationPostReview', 'other')}
            {renderCell(data.litigationPostReview?.unfinished, 'litigationPostReview', 'unfinished')}
            <td className="font-bold">{data.litigationPostReview?.total}</td>
          </tr>
        </tbody>
      </table>
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
          <span>📊</span> {title} - 差异分析
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

            return (
              <tr key={idx} className={isDiff ? 'bg-yellow-50' : ''}>
                <td className="text-gray-900">{row.label}</td>
                <td className="text-right text-gray-500 font-mono">{formatNum(valA)}</td>
                <td className="text-right font-bold font-mono text-gray-900">{formatNum(valB)}</td>
                <td className={`text-right font-mono font-medium ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
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
