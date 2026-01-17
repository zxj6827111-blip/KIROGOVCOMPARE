import React, { useContext } from 'react';
import { EntityContext } from '../components/Layout';
import { mockShanghai, mockSuzhou, provinceAvg as mockProvinceAvg } from '../data';
import { MetricTip } from '../components/MetricTip';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip
} from 'recharts';

export const RegionalBenchmark: React.FC = () => {
  const { entity } = useContext(EntityContext);

  // Dynamic Year: Use the latest year of the current entity
  const availableYears = entity?.data ? entity.data.map(d => d.year).sort((a, b) => b - a) : [];
  const year = availableYears[0];

  if (!year) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center bg-white rounded-lg border border-dashed border-slate-300">
        <h3 className="text-lg font-bold text-slate-800">暂无区域对标数据</h3>
        <p className="text-slate-500 mt-2">选定单位尚未关联任何年度数据，无法执行跨区域对标分析。</p>
      </div>
    );
  }

  // Normalized calculation for Radar
  const getMetrics = (profile: any) => {
    const d = profile.data?.find((x: any) => x.year === year);
    // If benchmark target doesn't have data for this year, fallback or return 0
    if (!d) return { volume: 0, openness: 0, safety: 0, efficiency: 0, enforcement: 0 };

    const totalDisputes = d.disputes.reconsideration.total + d.disputes.litigation.total;
    const corrected = d.disputes.reconsideration.corrected + d.disputes.litigation.corrected;
    const correctionRate = totalDisputes > 0 ? (corrected / totalDisputes) * 100 : 0;

    // Normalize to 0-100 scale where 100 is best
    const outcomes = d.applications.outcomes || { public: 0, partial: 0, unable: 0, notOpen: 0, ignore: 0 };
    const totalHandled = d.applications.totalHandled || (outcomes.public + outcomes.partial + outcomes.unable + outcomes.notOpen + outcomes.ignore) || 1;

    return {
      volume: Math.min(100, (d.applications.newReceived / 1000) * 100), // Scale: 1000 apps = 100
      openness: ((outcomes.public + outcomes.partial) / totalHandled) * 100, // Raw %
      safety: Math.max(0, 100 - (correctionRate * 2)), // 0% correction = 100 score; 50% correction = 0 score
      efficiency: Math.max(0, 100 - ((d.applications.carriedForward / totalHandled) * 500)), // Lower carryover is better
      enforcement: Math.min(100, (d.adminActions.punishment / 5000) * 100) // Scale: 5000 punishments = 100
    };
  };

  const currentMetrics = entity?.data ? getMetrics(entity) : { volume: 0, openness: 0, safety: 0, efficiency: 0, enforcement: 0 };
  const sh = getMetrics(mockShanghai);
  const sz = getMetrics(mockSuzhou);
  const avg = getMetrics(mockProvinceAvg);

  const radarData = [
    { subject: '受理规模', Current: currentMetrics.volume, Shanghai: sh.volume, Suzhou: sz.volume, Avg: avg.volume, fullMark: 100 },
    { subject: '公开力度', Current: currentMetrics.openness, Shanghai: sh.openness, Suzhou: sz.openness, Avg: avg.openness, fullMark: 100 },
    { subject: '法治安全', Current: currentMetrics.safety, Shanghai: sh.safety, Suzhou: sz.safety, Avg: avg.safety, fullMark: 100 },
    { subject: '清零效能', Current: currentMetrics.efficiency, Shanghai: sh.efficiency, Suzhou: sz.efficiency, Avg: avg.efficiency, fullMark: 100 },
    { subject: '执法活跃', Current: currentMetrics.enforcement, Shanghai: sh.enforcement, Suzhou: sz.enforcement, Avg: avg.enforcement, fullMark: 100 }
  ];

  // Helper to safely get raw values for table
  const getRawData = (profile: any) => profile.data?.find((x: any) => x.year === year) || {
    applications: { newReceived: 0, outcomes: { public: 0, partial: 0 } },
    disputes: { litigation: { corrected: 0, total: 0 }, reconsideration: { corrected: 0, total: 0 } }
  };

  const getCorrectionRate = (p: any) => {
    const d = getRawData(p);
    const corr = (d.disputes?.reconsideration?.corrected || 0) + (d.disputes?.litigation?.corrected || 0);
    const tot = (d.disputes?.reconsideration?.total || 0) + (d.disputes?.litigation?.total || 0);
    return tot > 0 ? (corr / tot * 100).toFixed(2) : "0.00";
  };

  return (
    <div className="space-y-6">
      {/* Overview Radar Section */}
      <div className="bg-white p-8 rounded-lg shadow-sm border border-slate-200 flex flex-col items-center">
        <div className="w-full max-w-2xl h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#cbd5e1', fontSize: 10 }} />
              <Radar name={entity?.name || '未知单位'} dataKey="Current" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.6} />
              <Radar name="上海市" dataKey="Shanghai" stroke="#10b981" fill="#10b981" fillOpacity={0.2} />
              <Radar name="苏州市" dataKey="Suzhou" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} />
              <Radar name="全省均值" dataKey="Avg" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.1} />
              <Tooltip
                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
              />
              <Legend wrapperStyle={{ paddingTop: '20px' }} />
            </RadarChart>
          </ResponsiveContainer>
        </div>
        <p className="max-w-md text-center text-sm text-slate-500 leading-relaxed mb-4">
          当前基准：<span className="font-bold text-slate-800">{entity?.name || '未知单位'}</span> ({year}年度数据) <br />
          雷达图展示了该单位在各维度的百分位表现（100为顶尖）。
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Metric Table vs Benchmarks */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <div className="flex items-center mb-4">
            <h3 className="text-lg font-bold text-slate-800">对标指标纵览</h3>
            <MetricTip content="对比标杆城市的实绩数据，识别关键差距。" />
          </div>
          <div className="space-y-4">
            {[
              { label: '依申请受理量', key: 'volume', unit: '件', rawKey: 'newReceived' },
              { label: '实质性公开率', key: 'openness', unit: '%' },
              { label: '纠错控制力', key: 'safety', unit: '%', rawMethod: getCorrectionRate }
            ].map((m, idx) => (
              <div key={idx} className="p-4 rounded-xl border border-slate-100 bg-slate-50/50">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-sm font-bold text-slate-600">{m.label}</span>
                  <span className="text-xs text-slate-400">单位: {m.unit}</span>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">本单位</div>
                    <div className="text-sm font-bold text-indigo-600">
                      {m.rawMethod ? m.rawMethod(entity) : (getRawData(entity).applications[m.rawKey!] || currentMetrics[m.key as keyof typeof currentMetrics].toFixed(1))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">上海</div>
                    <div className="text-sm font-medium text-slate-600">{sh[m.key as keyof typeof sh].toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">苏州</div>
                    <div className="text-sm font-medium text-slate-600">{sz[m.key as keyof typeof sz].toFixed(1)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400 mb-1">均值</div>
                    <div className="text-sm font-medium text-slate-600">{avg[m.key as keyof typeof avg].toFixed(1)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Ranking Table */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-4">核心指标区域排行榜 ({year})</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">排名</th>
                  <th className="px-4 py-3 font-semibold">城市</th>
                  <th className="px-4 py-3 font-semibold">申请受理量</th>
                  <th className="px-4 py-3 font-semibold">主动公开率</th>
                  <th className="px-4 py-3 font-semibold">复议纠错率</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 border-t border-slate-100">
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-3"><span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded text-xs font-bold">1</span></td>
                  <td className="px-4 py-3 font-medium text-slate-700">上海市</td>
                  <td className="px-4 py-3">{getRawData(mockShanghai).applications.newReceived.toLocaleString()}</td>
                  <td className="px-4 py-3">{sh.openness.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-emerald-600">{getCorrectionRate(mockShanghai)}%</td>
                </tr>
                <tr className="hover:bg-slate-50">
                  <td className="px-4 py-3"><span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs font-bold">2</span></td>
                  <td className="px-4 py-3 font-medium text-slate-700">苏州市</td>
                  <td className="px-4 py-3">{getRawData(mockSuzhou).applications.newReceived.toLocaleString()}</td>
                  <td className="px-4 py-3">{sz.openness.toFixed(1)}%</td>
                  <td className="px-4 py-3">{getCorrectionRate(mockSuzhou)}%</td>
                </tr>
                {/* Highlight Selected Entity */}
                <tr className="hover:bg-blue-50 bg-blue-50/30">
                  <td className="px-4 py-3"><span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-xs font-bold">-</span></td>
                  <td className="px-4 py-3 font-bold text-blue-700">{entity?.name || '未知单位'}</td>
                  <td className="px-4 py-3 font-medium">{(getRawData(entity).applications.newReceived || 0).toLocaleString()}</td>
                  <td className="px-4 py-3">{currentMetrics.openness.toFixed(1)}%</td>
                  <td className="px-4 py-3 text-rose-600">{getCorrectionRate(entity)}%</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 p-3 bg-blue-50 rounded text-xs text-blue-800">
            <strong>洞察：</strong> 对标显示，{entity?.name || '该单位'}在"法治安全"（纠错控制）方面相比标杆城市仍有差距，需重点加强败诉案件的源头治理。
          </div>
        </div>
      </div>
    </div>
  );
};