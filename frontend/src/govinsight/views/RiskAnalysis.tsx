import React, { useContext } from 'react';
import { EntityContext } from '../components/Layout';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Line, Bar, ComposedChart
} from 'recharts';
import { AlertTriangle, Users, GitMerge, Gavel } from 'lucide-react';

export const RiskAnalysis: React.FC = () => {
  const { entity } = useContext(EntityContext);

  if (!entity || !entity.data || entity.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center bg-white rounded-lg border border-dashed border-slate-300">
        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
          <AlertTriangle size={32} />
        </div>
        <h3 className="text-lg font-bold text-slate-800">暂无政务公开数据</h3>
        <p className="text-slate-500 max-w-sm mt-2">
          当前单位 {entity?.name || '未选定'} 尚未成功加载年度统计数据，无法进行风险分析。
        </p>
      </div>
    );
  }

  const chartData = entity.data.map(d => ({
    year: d.year,
    naturalApp: (d.applications.sources?.natural || 0),
    legalApp: (d.applications.sources?.legal || 0),
    totalApp: d.applications.newReceived || 1,
    disputes: (d.disputes?.reconsideration?.total || 0) + (d.disputes?.litigation?.total || 0),
    corrections: (d.disputes?.reconsideration?.corrected || 0) + (d.disputes?.litigation?.corrected || 0),
    // Risk Index
    conversionRate: (((d.disputes?.reconsideration?.total || 0) + (d.disputes?.litigation?.total || 0)) / (d.applications.newReceived || 1) * 100).toFixed(1)
  }));

  const current = chartData.length > 0 ? chartData[chartData.length - 1] : { totalApp: 0, disputes: 0, corrections: 0, percent: 0 };

  // Funnel Data (Snapshot of current year)
  const funnelData = [
    { stage: '依申请新收', value: current.totalApp, fill: '#3b82f6', percent: 100 },
    { stage: '引发争议(复议+诉讼)', value: current.disputes, fill: '#f59e0b', percent: (current.disputes / current.totalApp * 100).toFixed(1) },
    { stage: '败诉/纠错', value: current.corrections, fill: '#f43f5e', percent: (current.corrections / current.totalApp * 100).toFixed(1) }
  ];

  return (
    <div className="space-y-6">
      {/* Conflict Funnel Section */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
        <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center">
          <GitMerge className="w-5 h-5 mr-2 text-slate-500" />
          社会矛盾转化漏斗 (2024)
        </h3>
        <div className="flex flex-col md:flex-row justify-center items-center space-y-4 md:space-y-0 md:space-x-8">
          {funnelData.map((item, idx) => (
            <div key={idx} className="flex-1 w-full max-w-xs flex flex-col items-center">
              <div
                className="w-full rounded-lg shadow-md flex flex-col justify-center items-center text-white font-bold transition-all hover:scale-105"
                style={{
                  height: '100px',
                  backgroundColor: item.fill,
                  width: `${100 - (idx * 20)}%` // Visual narrowing
                }}
              >
                <span className="text-2xl">{item.value}</span>
                <span className="text-xs opacity-90 font-normal">{item.stage}</span>
              </div>
              {idx > 0 && (
                <div className="mt-2 text-xs text-slate-500 font-medium">
                  转化率: {item.percent}%
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="mt-6 text-sm text-slate-500 text-center">
          <span className="font-bold text-slate-700">解读：</span> 每收到 100 件政府信息公开申请，会引发 {funnelData[1].percent} 起行政争议，最终导致 {funnelData[2].percent} 起败诉纠错。
          {Number(funnelData[2].percent) > 2 ? <span className="text-rose-600 ml-1">败诉转化率偏高，需警惕源头办理质量。</span> : <span className="text-emerald-600 ml-1">处于低风险安全区间。</span>}
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Social Mindset Analysis */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <div className="mb-4">
            <h3 className="text-lg font-bold text-slate-800 flex items-center">
              <Users className="w-5 h-5 mr-2 text-blue-500" />
              申请人结构与争议关联分析
            </h3>
            <p className="text-sm text-slate-500">观察“自然人”申请占比与争议发生的关联性</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="year" stroke="#94a3b8" />
                <YAxis yAxisId="left" stroke="#94a3b8" />
                <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" unit="%" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="naturalApp" name="自然人申请数" stackId="a" fill="#93c5fd" />
                <Bar yAxisId="left" dataKey="legalApp" name="法人申请数" stackId="a" fill="#cbd5e1" />
                <Line yAxisId="right" type="monotone" dataKey="conversionRate" name="争议转化率(%)" stroke="#f43f5e" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Litigation Trend */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <div className="mb-4">
            <h3 className="text-lg font-bold text-slate-800 flex items-center">
              <Gavel className="w-5 h-5 mr-2 text-rose-500" />
              行政诉讼败诉风险监测
            </h3>
            <p className="text-sm text-slate-500">败诉案件绝对值趋势</p>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorCorrection" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="year" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="corrections" name="败诉/纠错案件数" stroke="#be123c" fill="url(#colorCorrection)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Insight Box */}
      <div className="bg-rose-50 border border-rose-100 p-4 rounded-lg flex items-start">
        <AlertTriangle className="w-5 h-5 text-rose-500 mt-1 mr-3 flex-shrink-0" />
        <div>
          <h4 className="font-bold text-rose-800 text-sm">风险预警提示</h4>
          <p className="text-sm text-rose-700 mt-1">
            数据显示，2023-2024年间，尽管自然人申请数量趋于平稳，但<strong>“争议转化率”</strong>却呈现上升趋势。
            这表明单件申请引发的行政成本在增加，可能存在依申请公开回复模板老化、缺乏针对性解释工作等问题，
            极易引发“程序空转”类诉讼。建议加强与申请人的沟通机制。
          </p>
        </div>
      </div>
    </div>
  );
};
