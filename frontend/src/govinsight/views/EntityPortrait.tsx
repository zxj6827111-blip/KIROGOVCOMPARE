import React, { useContext } from 'react';
import { EntityProfile } from '../types';
import { EntityContext } from '../components/Layout';
import { districts, departments } from '../data';
import { MetricTip } from '../components/MetricTip';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, ComposedChart, Bar
} from 'recharts';
import {
  AlertTriangle, CheckCircle2, FileText
} from 'lucide-react';

// Comparison Component
const MetricComparisonRow = ({ label, value, median, unit = '%', inverse = false }: any) => {
  if (value === undefined || median === undefined) return null;
  const diff = value - median;
  let statusText = '正常';
  let colorClass = 'bg-blue-500';
  let textClass = 'text-blue-600';

  const threshold = 5;

  if (inverse) { // Lower is better
    if (diff > threshold) { statusText = '偏高'; colorClass = 'bg-rose-500'; textClass = 'text-rose-600'; }
    else if (diff < -threshold) { statusText = '优异'; colorClass = 'bg-emerald-500'; textClass = 'text-emerald-600'; }
  } else { // Higher is better
    if (diff < -threshold) { statusText = '偏低'; colorClass = 'bg-rose-500'; textClass = 'text-rose-600'; }
    else if (diff > threshold) { statusText = '优异'; colorClass = 'bg-emerald-500'; textClass = 'text-emerald-600'; }
  }

  const maxVal = Math.max(value, median) * 1.5 || 100;

  return (
    <div className="flex items-center text-sm py-3 border-b border-slate-50 last:border-0">
      <div className="w-32 font-medium text-slate-700">{label}</div>
      <div className="flex-1 flex flex-col px-4">
        <div className="flex justify-between text-xs mb-1 text-slate-500">
          <span>本单位: {value.toFixed(1)}{unit}</span>
          <span>同级中位: {median.toFixed(1)}{unit}</span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden relative">
          <div className="absolute top-0 bottom-0 w-0.5 bg-slate-400 z-10" style={{ left: `${(median / maxVal) * 100}%` }}></div>
          <div className={`h-full rounded-full ${colorClass}`} style={{ width: `${(value / maxVal) * 100}%` }}></div>
        </div>
      </div>
      <div className="w-24 text-right">
        <span className={`text-xs px-2 py-0.5 rounded font-bold bg-slate-50 ${textClass}`}>
          {diff > 0 ? '+' : ''}{diff.toFixed(1)} {statusText}
        </span>
      </div>
    </div>
  );
};

export const EntityPortrait: React.FC = () => {
  const { entity } = useContext(EntityContext);

  // 1. Dynamic Latest Year
  const sortedYears = entity?.data ? [...entity.data].map(d => d.year).sort((a, b) => b - a) : [];
  if (sortedYears.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center bg-white rounded-lg border border-dashed border-slate-300">
        <h3 className="text-lg font-bold text-slate-800">暂无年度数据</h3>
        <p className="text-slate-500 mt-2">无法生成单位 {entity?.name || ''} 的画像，请先上传并解析报告。</p>
      </div>
    );
  }
  const currentYear = sortedYears[0];
  const currentData = entity?.data?.find(d => d.year === currentYear);

  if (!currentData) return <div className="p-10 text-center text-slate-500">数据不完整</div>;

  const peers = (entity?.type === 'district' ? districts : (entity?.type === 'department' ? departments : [entity])).filter(Boolean) as EntityProfile[];

  const calculateMetrics = (d: any) => {
    if (!d) return null;
    const totalHandled = d.applications.totalHandled || 1;
    const disputes = d.disputes.reconsideration.total + d.disputes.litigation.total;
    const corrected = d.disputes.reconsideration.corrected + d.disputes.litigation.corrected;
    return {
      total: d.applications.newReceived,
      openRate: ((d.applications.outcomes.public + d.applications.outcomes.partial) / totalHandled) * 100,
      notOpenRate: (d.applications.outcomes.notOpen / totalHandled) * 100,
      unableRate: (d.applications.outcomes.unable / totalHandled) * 100,
      correctionRate: disputes > 0 ? (corrected / disputes) * 100 : 0,
      disputeRatio: (disputes / d.applications.newReceived) * 100,
      carriedRate: (d.applications.carriedForward / totalHandled) * 100
    };
  };

  const myMetrics = calculateMetrics(currentData)!;

  // Filter peers who actually have data for the current year
  const peerMetricsList = peers
    .map(p => {
      const d = p.data?.find(x => x.year === currentYear);
      return calculateMetrics(d);
    })
    .filter((m): m is NonNullable<ReturnType<typeof calculateMetrics>> => m !== null);

  const getMedian = (key: keyof typeof myMetrics) => {
    if (peerMetricsList.length <= 1) return myMetrics[key];
    const sorted = peerMetricsList.map(m => m[key]).sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  const medians = {
    openRate: getMedian('openRate'),
    unableRate: getMedian('unableRate'),
    correctionRate: getMedian('correctionRate'),
    disputeRatio: getMedian('disputeRatio'),
    total: getMedian('total')
  };

  // --- 2. Advanced Diagnosis Logic (Dual Thresholds) ---
  const shortcomings = [];
  const suggestions = [];

  // 1. Correction Risk (Absolute > 15% OR Relative > 5%)
  if (myMetrics.correctionRate > 15) {
    shortcomings.push(`<strong>败诉风险高企</strong>：复议诉讼纠错率达 ${myMetrics.correctionRate.toFixed(1)}%，超过 15% 警戒红线。`);
    suggestions.push("启动败诉案件复盘机制，重点审查'程序性瑕疵'（如超期、告知不全）。");
  } else if (myMetrics.correctionRate - medians.correctionRate > 5) {
    shortcomings.push(`<strong>败诉率相对偏高</strong>：虽未破红线，但高出同级中位数 ${(myMetrics.correctionRate - medians.correctionRate).toFixed(1)}个百分点。`);
    suggestions.push("建议加强法制审核力量，引入法律顾问前置审查机制。");
  }

  // 2. Structural Issue: High Volume + High Rejection (Archives Issue)
  if (myMetrics.total > medians.total && myMetrics.unableRate > 20) {
    shortcomings.push(`<strong>档案管理隐患</strong>：申请量大且'无法提供'占比高(${myMetrics.unableRate.toFixed(1)}%)，可能存在以查代复问题。`);
    suggestions.push("核查'无法提供'案件真实性，完善信息检索登记台账。");
  }

  // 3. Efficiency Issue (Carried Over)
  if (myMetrics.carriedRate > 10) {
    shortcomings.push(`<strong>积压风险</strong>：结转下年办理占比达 ${myMetrics.carriedRate.toFixed(1)}%，可能造成次年年初超期。`);
    suggestions.push("年底前开展清理积压件专项行动，确保依法延期手续完备。");
  }

  // Fallback if truly good
  if (shortcomings.length === 0) {
    shortcomings.push("核心指标未见显著异常，整体运行平稳。");
    suggestions.push("总结当前标准化办理经验，建议申报法治政府建设示范项目。");
    suggestions.push("挖掘依申请公开数据价值，定期向业务部门报送'群众关注热点'月报。");
  }

  // Chart Data Prep - Sort by year for chart
  const appTrendData = entity?.data ? [...entity.data].sort((a, b) => a.year - b.year).map(d => ({
    year: d.year,
    new: d.applications.newReceived,
    carried: d.applications.carriedOver,
    total: d.applications.totalHandled,
    natural: d.applications.sources.natural
  })) : [];

  const riskTrendData = entity?.data ? [...entity.data].sort((a, b) => a.year - b.year).map(d => {
    const disputes = d.disputes.reconsideration.total + d.disputes.litigation.total;
    const corrected = d.disputes.reconsideration.corrected + d.disputes.litigation.corrected;
    return {
      year: d.year,
      disputes,
      corrected,
      rate: disputes > 0 ? ((corrected / disputes) * 100).toFixed(1) : 0
    };
  }) : [];

  return (
    <div className="space-y-6">
      {/* Top Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: Auto Diagnosis Report */}
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6 flex flex-col h-full">
          <h3 className="text-lg font-bold text-slate-800 mb-1 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-indigo-600" />
            智能诊断报告 ({currentYear})
          </h3>
          <p className="text-xs text-slate-400 mb-4">基于双阈值算法 (绝对红线 + 相对排名)</p>

          <div className="flex-1 space-y-4 overflow-y-auto pr-2">
            <div>
              <h4 className="text-xs font-bold text-rose-700 uppercase mb-2 flex items-center bg-rose-50 p-1 rounded w-fit">
                <span>{entity?.name || '未知单位'} 画像</span>
                <AlertTriangle className="w-3 h-3 mr-1" /> 重点关注问题
              </h4>
              {shortcomings.length > 0 ? (
                <ul className="list-disc list-inside text-xs text-slate-700 space-y-2 leading-relaxed">
                  {shortcomings.map((c, i) => <li key={i} dangerouslySetInnerHTML={{ __html: c }}></li>)}
                </ul>
              ) : <span className="text-xs text-slate-400">无明显异常</span>}
            </div>

            <div className="bg-blue-50 p-3 rounded border border-blue-100 mt-4">
              <h4 className="text-xs font-bold text-blue-700 uppercase mb-2 flex items-center">
                <CheckCircle2 className="w-3 h-3 mr-1" /> 改进建议
              </h4>
              <ol className="list-decimal list-inside text-xs text-blue-800 space-y-2 leading-relaxed">
                {suggestions.map((c, i) => <li key={i}>{c}</li>)}
              </ol>
            </div>
          </div>
        </div>

        {/* Right: Key KPI & Median Comparison */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <h3 className="text-sm font-bold text-slate-700 mb-4 border-l-4 border-indigo-500 pl-3 flex items-center">
              关键 KPI ({currentYear})
              <MetricTip content="展示本年度核心业务数据，红字提示高风险项。" />
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-2xl font-bold text-slate-800">{currentData.applications.totalHandled}</div>
                <div className="text-xs text-slate-500 mt-1">依申请受理合计</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800">{currentData.disputes.litigation.total + currentData.disputes.reconsideration.total}</div>
                <div className="text-xs text-slate-500 mt-1">引发争议总数</div>
              </div>
              <div>
                <div className={`text-2xl font-bold ${myMetrics.correctionRate > 15 ? 'text-rose-600' : 'text-slate-800'}`}>{myMetrics.correctionRate.toFixed(1)}%</div>
                <div className="text-xs text-slate-500 mt-1">复议诉讼纠错率</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-slate-800">{myMetrics.openRate.toFixed(1)}%</div>
                <div className="text-xs text-slate-500 mt-1">实质性公开率</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
            <h3 className="text-sm font-bold text-slate-700 mb-4 border-l-4 border-blue-500 pl-3">
              同类单位横向对标 (差距分析)
            </h3>
            <div className="space-y-1">
              <MetricComparisonRow label="公开率 (高优)" value={myMetrics.openRate} median={medians.openRate} />
              <MetricComparisonRow label="无法提供率 (低优)" value={myMetrics.unableRate} median={medians.unableRate} inverse />
              <MetricComparisonRow label="纠错率 (低优)" value={myMetrics.correctionRate} median={medians.correctionRate} inverse />
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
            表三：依申请办理趋势
            <MetricTip content="对应年报第三表格中'新收'与'结转'数据" source="表3-1" />
          </h3>
          <div className="h-60 mb-2">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={appTrendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="year" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total" name="受理合计" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="new" name="新收申请" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="carried" name="上年结转" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-slate-200 p-6">
          <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
            表四：行政争议趋势
            <MetricTip content="对应年报第四表格中复议与诉讼结果" source="表4-1, 4-2" />
          </h3>
          <div className="h-60 mb-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={riskTrendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="year" stroke="#94a3b8" />
                <YAxis yAxisId="left" stroke="#94a3b8" />
                <YAxis yAxisId="right" orientation="right" unit="%" stroke="#f43f5e" />
                <Tooltip />
                <Bar yAxisId="left" dataKey="disputes" name="争议总量" fill="#cbd5e1" barSize={30} />
                <Line yAxisId="right" type="monotone" dataKey="rate" name="纠错率(%)" stroke="#f43f5e" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};