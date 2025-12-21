import React from 'react';

// Table 2: Active Disclosure - Matched to PDF format
const Table2View = ({ data }) => {
  if (!data) return null;

  return (
    <div className="overflow-hidden border border-gray-400 mb-6 font-serif-sc">
      <table className="min-w-full border-collapse border border-gray-400 text-center">
        <tbody className="text-sm">
          {/* Header 1 */}
          <tr className="bg-blue-50 font-bold border-b border-gray-400 text-left">
            <td colSpan={4} className="py-1.5 px-4 bg-blue-50">第二十条第（一）项</td>
          </tr>
          <tr className="border-b border-gray-400 font-bold bg-white">
            <td className="w-1/4 border-r border-gray-400 py-1.5">信息内容</td>
            <td className="w-1/4 border-r border-gray-400 py-1.5">本年制发件数</td>
            <td className="w-1/4 border-r border-gray-400 py-1.5">本年废止件数</td>
            <td className="w-1/4 py-1.5">现行有效件数</td>
          </tr>
          <tr className="border-b border-gray-400">
            <td className="border-r border-gray-400 py-1.5">规章</td>
            <td className="border-r border-gray-400 py-1.5">{data.regulations?.made}</td>
            <td className="border-r border-gray-400 py-1.5">{data.regulations?.repealed}</td>
            <td className="py-1.5">{data.regulations?.valid}</td>
          </tr>
          <tr className="border-b border-gray-400">
            <td className="border-r border-gray-400 py-1.5">行政规范性文件</td>
            <td className="border-r border-gray-400 py-1.5">{data.normativeDocuments?.made}</td>
            <td className="border-r border-gray-400 py-1.5">{data.normativeDocuments?.repealed}</td>
            <td className="py-1.5">{data.normativeDocuments?.valid}</td>
          </tr>

          {/* Header 2 */}
          <tr className="bg-blue-50 font-bold border-b border-gray-400 text-left">
            <td colSpan={4} className="py-1.5 px-4">第二十条第（五）项</td>
          </tr>
          <tr className="border-b border-gray-400 font-bold bg-white">
            <td className="border-r border-gray-400 py-1.5">信息内容</td>
            <td colSpan={3} className="py-1.5">本年处理决定数量</td>
          </tr>
          <tr className="border-b border-gray-400">
            <td className="border-r border-gray-400 py-1.5">行政许可</td>
            <td colSpan={3} className="py-1.5">{data.licensing?.processed}</td>
          </tr>

          {/* Header 3 */}
          <tr className="bg-blue-50 font-bold border-b border-gray-400 text-left">
            <td colSpan={4} className="py-1.5 px-4">第二十条第（六）项</td>
          </tr>
          <tr className="border-b border-gray-400 font-bold bg-white">
            <td className="border-r border-gray-400 py-1.5">信息内容</td>
            <td colSpan={3} className="py-1.5">本年处理决定数量</td>
          </tr>
          <tr className="border-b border-gray-400">
            <td className="border-r border-gray-400 py-1.5">行政处罚</td>
            <td colSpan={3} className="py-1.5">{data.punishment?.processed}</td>
          </tr>
          <tr className="border-b border-gray-400">
            <td className="border-r border-gray-400 py-1.5">行政强制</td>
            <td colSpan={3} className="py-1.5">{data.coercion?.processed}</td>
          </tr>

          {/* Header 4 */}
          <tr className="bg-blue-50 font-bold border-b border-gray-400 text-left">
            <td colSpan={4} className="py-1.5 px-4">第二十条第（八）项</td>
          </tr>
          <tr className="border-b border-gray-400 font-bold bg-white">
            <td className="border-r border-gray-400 py-1.5">信息内容</td>
            <td colSpan={3} className="py-1.5">本年收费金额（单位：万元）</td>
          </tr>
          <tr>
            <td className="border-r border-gray-400 py-1.5">行政事业性收费</td>
            <td colSpan={3} className="py-1.5">{data.fees?.amount}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// Table 3 View
const Table3View = ({ data, compact = false }) => {
  if (!data) return null;

  const getData = (key) => {
    if (key === 'naturalPerson') return data.naturalPerson;
    if (key === 'total') return data.total;
    return data.legalPerson?.[key];
  };

  // Safe access helper
  const val = (cat, path) => {
    const category = getData(cat);
    if (!category) return 0;

    // Path e.g. "newReceived" or "results.granted"
    if (!path.includes('.')) return category[path] || 0;

    const [p1, p2] = path.split('.');
    return category[p1]?.[p2] || 0;
  };

  // Denied access helper
  const deniedVal = (cat, key) => {
    const category = getData(cat);
    return category?.results?.denied?.[key] || 0;
  };

  // Unable access helper
  const unableVal = (cat, key) => {
    const category = getData(cat);
    return category?.results?.unableToProvide?.[key] || 0;
  };

  // Not processed access helper
  const notProcessedVal = (cat, key) => {
    const category = getData(cat);
    return category?.results?.notProcessed?.[key] || 0;
  };

  // Other access helper
  const otherVal = (cat, key) => {
    const category = getData(cat);
    return category?.results?.other?.[key] || 0;
  };

  const textSize = compact ? 'text-xs' : 'text-xs'; // Keep readable
  const py = compact ? 'py-1' : 'py-1.5';
  const px = compact ? 'px-1' : 'px-1';

  const renderCell = (v) => (
    <td className={`${px} ${py} ${textSize} text-gray-700 border-b border-r border-gray-400 text-center font-mono align-middle`}>
      {v}
    </td>
  );

  return (
    <div className={`overflow-x-auto border border-gray-400 mb-6 bg-white ${compact ? 'shadow-none' : ''}`}>
      <div className={compact ? 'min-w-0' : 'min-w-[900px]'}>
        <table className="w-full border-collapse bg-white table-fixed">
          {/* 10 Columns Total */}
          <colgroup>
            <col className={compact ? 'w-6' : 'w-8'} />
            <col className={compact ? 'w-16' : 'w-24'} />
            <col className={compact ? 'w-24' : 'w-48'} />
            <col className={compact ? 'w-12' : 'w-16'} />
            <col className={compact ? 'w-12' : 'w-16'} />
            <col className={compact ? 'w-12' : 'w-16'} />
            <col className={compact ? 'w-12' : 'w-16'} />
            <col className={compact ? 'w-12' : 'w-16'} />
            <col className={compact ? 'w-12' : 'w-16'} />
            <col className={compact ? 'w-12' : 'w-16'} />
          </colgroup>

          <thead>
            <tr className={`bg-white ${textSize} font-serif-sc text-gray-900 border-b border-gray-400`}>
              <th rowSpan={3} colSpan={3} className={`${px} ${py} border-r border-gray-400 font-normal text-left align-top leading-tight bg-gray-50`}>
                <div style={{ transform: 'scale(0.9)', transformOrigin: 'top left', width: '110%' }}>
                  （本列数据的勾稽关系为：第一项加第二项之和，等于第三项加第四项之和）
                </div>
              </th>
              <th colSpan={7} className={`${px} ${py} border-b border-r border-gray-400 text-center bg-gray-50 font-bold`}>
                申请人情况
              </th>
            </tr>

            <tr className={`bg-white ${textSize} font-serif-sc text-gray-800 border-b border-gray-400`}>
              <th rowSpan={2} className={`${px} ${py} border-r border-gray-400 bg-gray-50 font-bold`}>自然人</th>
              <th colSpan={5} className={`${px} ${py} border-b border-r border-gray-400 text-center bg-gray-50 font-bold`}>法人或其他组织</th>
              <th rowSpan={2} className={`${px} ${py} bg-gray-50 font-bold`}>总计</th>
            </tr>

            <tr className={`bg-white ${textSize} font-serif-sc text-gray-800 border-b border-gray-400`}>
              <th className={`${px} ${py} border-r border-gray-400 font-normal bg-gray-50`}>商业<br />企业</th>
              <th className={`${px} ${py} border-r border-gray-400 font-normal bg-gray-50`}>科研<br />机构</th>
              <th className={`${px} ${py} border-r border-gray-400 font-normal bg-gray-50`}>社会公益<br />组织</th>
              <th className={`${px} ${py} border-r border-gray-400 font-normal bg-gray-50`}>法律服务<br />机构</th>
              <th className={`${px} ${py} border-r border-gray-400 font-normal bg-gray-50`}>其他</th>
            </tr>
          </thead>

          <tbody>
            <tr className="border-b border-gray-400">
              <td className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400 font-bold`} colSpan={3}>一、本年新收政府信息公开申请数量</td>
              {renderCell(val('naturalPerson', 'newReceived'))}
              {renderCell(val('commercial', 'newReceived'))}
              {renderCell(val('research', 'newReceived'))}
              {renderCell(val('social', 'newReceived'))}
              {renderCell(val('legal', 'newReceived'))}
              {renderCell(val('other', 'newReceived'))}
              {renderCell(val('total', 'newReceived'))}
            </tr>

            <tr className="border-b border-gray-400">
              <td className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400 font-bold`} colSpan={3}>二、上年结转政府信息公开申请数量</td>
              {renderCell(val('naturalPerson', 'carriedOver'))}
              {renderCell(val('commercial', 'carriedOver'))}
              {renderCell(val('research', 'carriedOver'))}
              {renderCell(val('social', 'carriedOver'))}
              {renderCell(val('legal', 'carriedOver'))}
              {renderCell(val('other', 'carriedOver'))}
              {renderCell(val('total', 'carriedOver'))}
            </tr>

            <tr className="border-b border-gray-400">
              <td rowSpan={22} className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400 align-top pt-4 font-bold text-center`}>三<br />、<br />本<br />年<br />度<br />办<br />理<br />结<br />果</td>
              <td colSpan={2} className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400`}>（一）予以公开</td>
              {renderCell(val('naturalPerson', 'results.granted'))}
              {renderCell(val('commercial', 'results.granted'))}
              {renderCell(val('research', 'results.granted'))}
              {renderCell(val('social', 'results.granted'))}
              {renderCell(val('legal', 'results.granted'))}
              {renderCell(val('other', 'results.granted'))}
              {renderCell(val('total', 'results.granted'))}
            </tr>

            <tr className="border-b border-gray-400">
              <td colSpan={2} className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400`}>（二）部分公开</td>
              {renderCell(val('naturalPerson', 'results.partialGrant'))}
              {renderCell(val('commercial', 'results.partialGrant'))}
              {renderCell(val('research', 'results.partialGrant'))}
              {renderCell(val('social', 'results.partialGrant'))}
              {renderCell(val('legal', 'results.partialGrant'))}
              {renderCell(val('other', 'results.partialGrant'))}
              {renderCell(val('total', 'results.partialGrant'))}
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
              <tr key={item.k} className="border-b border-gray-400">
                {i === 0 && <td rowSpan={8} className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400 text-center`}>（三）<br />不予<br />公开</td>}
                <td className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400`}>{item.label}</td>
                {renderCell(deniedVal('naturalPerson', item.k))}
                {renderCell(deniedVal('commercial', item.k))}
                {renderCell(deniedVal('research', item.k))}
                {renderCell(deniedVal('social', item.k))}
                {renderCell(deniedVal('legal', item.k))}
                {renderCell(deniedVal('other', item.k))}
                {renderCell(deniedVal('total', item.k))}
              </tr>
            ))}

            {[
              { label: '1.本机关不掌握相关政府信息', k: 'noInfo' },
              { label: '2.没有现成信息需要另行制作', k: 'needCreation' },
              { label: '3.补正后申请内容仍不明确', k: 'unclear' },
            ].map((item, i) => (
              <tr key={item.k} className="border-b border-gray-400">
                {i === 0 && <td rowSpan={3} className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400 text-center`}>（四）<br />无法<br />提供</td>}
                <td className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400`}>{item.label}</td>
                {renderCell(unableVal('naturalPerson', item.k))}
                {renderCell(unableVal('commercial', item.k))}
                {renderCell(unableVal('research', item.k))}
                {renderCell(unableVal('social', item.k))}
                {renderCell(unableVal('legal', item.k))}
                {renderCell(unableVal('other', item.k))}
                {renderCell(unableVal('total', item.k))}
              </tr>
            ))}

            {[
              { label: '1.信访举报投诉类申请', k: 'complaint' },
              { label: '2.重复申请', k: 'repeat' },
              { label: '3.要求提供公开出版物', k: 'publication' },
              { label: '4.无正当理由大量反复申请', k: 'massiveRequests' },
              { label: '5.要求行政机关确认或重新出具已获取信息', k: 'confirmInfo' },
            ].map((item, i) => (
              <tr key={item.k} className="border-b border-gray-400">
                {i === 0 && <td rowSpan={5} className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400 text-center`}>（五）<br />不予<br />处理</td>}
                <td className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400`}>{item.label}</td>
                {renderCell(notProcessedVal('naturalPerson', item.k))}
                {renderCell(notProcessedVal('commercial', item.k))}
                {renderCell(notProcessedVal('research', item.k))}
                {renderCell(notProcessedVal('social', item.k))}
                {renderCell(notProcessedVal('legal', item.k))}
                {renderCell(notProcessedVal('other', item.k))}
                {renderCell(notProcessedVal('total', item.k))}
              </tr>
            ))}

            {[
              { label: '1.逾期不补正', k: 'overdueCorrection' },
              { label: '2.逾期不缴费', k: 'overdueFee' },
              { label: '3.其他', k: 'otherReasons' },
            ].map((item, i) => (
              <tr key={item.k} className="border-b border-gray-400">
                {i === 0 && <td rowSpan={3} className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400 text-center`}>（六）<br />其他<br />处理</td>}
                <td className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400`}>{item.label}</td>
                {renderCell(otherVal('naturalPerson', item.k))}
                {renderCell(otherVal('commercial', item.k))}
                {renderCell(otherVal('research', item.k))}
                {renderCell(otherVal('social', item.k))}
                {renderCell(otherVal('legal', item.k))}
                {renderCell(otherVal('other', item.k))}
                {renderCell(otherVal('total', item.k))}
              </tr>
            ))}

            <tr className="border-b border-gray-400 bg-gray-50">
              <td className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400 font-bold`} colSpan={2}>（七）总计</td>
              {renderCell(val('naturalPerson', 'results.totalProcessed'))}
              {renderCell(val('commercial', 'results.totalProcessed'))}
              {renderCell(val('research', 'results.totalProcessed'))}
              {renderCell(val('social', 'results.totalProcessed'))}
              {renderCell(val('legal', 'results.totalProcessed'))}
              {renderCell(val('other', 'results.totalProcessed'))}
              {renderCell(val('total', 'results.totalProcessed'))}
            </tr>

            <tr className="border-b border-gray-400">
              <td className={`${px} ${py} ${textSize} font-serif-sc border-r border-gray-400 font-bold`} colSpan={3}>四、结转下年度继续办理</td>
              {renderCell(val('naturalPerson', 'results.carriedForward'))}
              {renderCell(val('commercial', 'results.carriedForward'))}
              {renderCell(val('research', 'results.carriedForward'))}
              {renderCell(val('social', 'results.carriedForward'))}
              {renderCell(val('legal', 'results.carriedForward'))}
              {renderCell(val('other', 'results.carriedForward'))}
              {renderCell(val('total', 'results.carriedForward'))}
            </tr>

          </tbody>
        </table>
      </div>
    </div>
  );
};

// Table 4: Review Litigation - Matched to PDF format
const Table4View = ({ data }) => {
  if (!data) return null;
  return (
    <div className="overflow-x-auto border border-gray-400 mb-6 font-serif-sc">
      <table className="min-w-full border-collapse border border-gray-400 text-center text-sm">
        <thead>
          <tr className="bg-blue-50 border-b border-gray-400 text-left">
            <th colSpan={5} className="border-r border-gray-400 py-1.5 px-4">行政复议</th>
            <th colSpan={10} className="py-1.5 px-4">行政诉讼</th>
          </tr>
          <tr className="bg-white border-b border-gray-400 text-xs">
            <th rowSpan={2} className="border-r border-gray-400 w-16 px-1">结果维持</th>
            <th rowSpan={2} className="border-r border-gray-400 w-16 px-1">结果纠正</th>
            <th rowSpan={2} className="border-r border-gray-400 w-16 px-1">其他结果</th>
            <th rowSpan={2} className="border-r border-gray-400 w-16 px-1">尚未审结</th>
            <th rowSpan={2} className="border-r border-gray-400 w-16 px-1">总计</th>
            <th colSpan={5} className="border-r border-gray-400 border-b py-1">未经复议直接起诉</th>
            <th colSpan={5} className="border-b py-1">复议后起诉</th>
          </tr>
          <tr className="bg-white border-b border-gray-400 text-xs">
            {/* Sub-headers for Litigation Direct */}
            <th className="border-r border-gray-400 w-16 px-1">结果维持</th>
            <th className="border-r border-gray-400 w-16 px-1">结果纠正</th>
            <th className="border-r border-gray-400 w-16 px-1">其他结果</th>
            <th className="border-r border-gray-400 w-16 px-1">尚未审结</th>
            <th className="border-r border-gray-400 w-16 px-1">总计</th>
            {/* Sub-headers for Litigation Post-Review */}
            <th className="border-r border-gray-400 w-16 px-1">结果维持</th>
            <th className="border-r border-gray-400 w-16 px-1">结果纠正</th>
            <th className="border-r border-gray-400 w-16 px-1">其他结果</th>
            <th className="border-r border-gray-400 w-16 px-1">尚未审结</th>
            <th className="w-16 px-1">总计</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            {/* Review Data */}
            <td className="border-r border-gray-400 py-2">{data.review?.maintain}</td>
            <td className="border-r border-gray-400 py-2">{data.review?.correct}</td>
            <td className="border-r border-gray-400 py-2">{data.review?.other}</td>
            <td className="border-r border-gray-400 py-2">{data.review?.unfinished}</td>
            <td className="border-r border-gray-400 py-2 font-bold">{data.review?.total}</td>
            {/* Litigation Direct Data */}
            <td className="border-r border-gray-400 py-2">{data.litigationDirect?.maintain}</td>
            <td className="border-r border-gray-400 py-2">{data.litigationDirect?.correct}</td>
            <td className="border-r border-gray-400 py-2">{data.litigationDirect?.other}</td>
            <td className="border-r border-gray-400 py-2">{data.litigationDirect?.unfinished}</td>
            <td className="border-r border-gray-400 py-2 font-bold">{data.litigationDirect?.total}</td>
            {/* Litigation Post-Review Data */}
            <td className="border-r border-gray-400 py-2">{data.litigationPostReview?.maintain}</td>
            <td className="border-r border-gray-400 py-2">{data.litigationPostReview?.correct}</td>
            <td className="border-r border-gray-400 py-2">{data.litigationPostReview?.other}</td>
            <td className="border-r border-gray-400 py-2">{data.litigationPostReview?.unfinished}</td>
            <td className="py-2 font-bold">{data.litigationPostReview?.total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

// Simple Diff Table for numeric comparisons
const SimpleDiffTable = ({ title, headers, rows }) => {
  if (!rows || rows.length === 0) return null;

  return (
    <div className="mt-2 border border-yellow-200 bg-yellow-50 rounded-lg p-4 shadow-sm break-inside-avoid mb-6">
      <h4 className="text-sm font-bold text-yellow-900 mb-2 flex items-center">
        <span className="mr-2">📊</span> {title} - 差异分析
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="border-b-2 border-yellow-200 text-yellow-800">
              <th className="text-left py-1.5 px-2 font-serif-sc">指标名称</th>
              <th className="text-right py-1.5 px-2 font-mono">{headers[1]}</th>
              <th className="text-right py-1.5 px-2 font-mono">{headers[2]}</th>
              <th className="text-right py-1.5 px-2 font-mono">增减值</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const valA = typeof row.valA === 'number' ? row.valA : parseFloat(row.valA) || 0;
              const valB = typeof row.valB === 'number' ? row.valB : parseFloat(row.valB) || 0;
              const diff = valB - valA;
              const isDiff = diff !== 0;

              return (
                <tr key={idx} className={`border-b border-yellow-100 last:border-0 ${isDiff ? 'bg-yellow-100' : ''}`}>
                  <td className="py-1.5 px-2 text-yellow-900">{row.label}</td>
                  <td className="py-1.5 px-2 text-right text-gray-500 font-mono">{row.valA}</td>
                  <td className={`py-1.5 px-2 text-right font-bold font-mono ${isDiff ? 'text-gray-900' : 'text-gray-600'}`}>{row.valB}</td>
                  <td className={`py-1.5 px-2 text-right font-mono font-medium ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                    {isDiff ? (diff > 0 ? `+${diff}` : diff) : '-'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export { Table2View, Table3View, Table4View, SimpleDiffTable };
