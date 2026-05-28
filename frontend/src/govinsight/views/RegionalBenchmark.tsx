import React, { useContext } from 'react';
import { EntityContext } from '../components/Layout';
import { MetricTip } from '../components/MetricTip';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip
} from 'recharts';
// TODO: Replace with real benchmark API when available

export const RegionalBenchmark: React.FC = () => {
  const { entity } = useContext(EntityContext);

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

  const getMetrics = (profile: any) => {
    const d = profile.data?.find((x: any) => x.year === year);
    if (!d) return { volume: 0, openness: 0, safety: 0, efficiency: 0, enforcement: 0 };

    const totalDisputes = d.disputes.reconsideration.total + d.disputes.litigation.total;
    const corrected = d.disputes.reconsideration.corrected + d.disputes.litigation.corrected;
    const correctionRate = totalDisputes > 0 ? (corrected / totalDisputes) * 100 : 0;

    const outcomes = d.applications.outcomes || { public: 0, partial: 0, unable: 0, notOpen: 0, ignore: 0 };
    const totalHandled = d.applications.totalHandled || (outcomes.public + outcomes.partial + outcomes.unable + outcomes.notOpen + outcomes.ignore) || 1;

    return {
      volume: Math.min(100, (d.applications.newReceived / 1000) * 100),
      openness: ((outcomes.public + outcomes.partial) / totalHandled) * 100,
      safety: Math.max(0, 100 - (correctionRate * 2)),
      efficiency: Math.max(0, 100 - ((d.applications.carriedForward / totalHandled) * 500)),
      enforcement: Math.min(100, (d.adminActions.punishment / 5000) * 100)
    };
  };

  const currentMetrics = entity?.data ? getMetrics(entity) : { volume: 0, openness: 0, safety: 0, efficiency: 0, enforcement: 0 };

  const radarData = [
    { subject: '受理规模', Current: currentMetrics.volume, fullMark: 100 },
    { subject: '公开力度', Current: currentMetrics.openness, fullMark: 100 },
    { subject: '法治安全', Current: currentMetrics.safety, fullMark: 100 },
    { subject: '清零效能', Current: currentMetrics.efficiency, fullMark: 100 },
    { subject: '执法活跃', Current: currentMetrics.enforcement, fullMark: 100 }
  ];

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
      {/* Radar Section — Current Entity Only */}
      <div className="bg-white p-8 rounded-lg shadow-sm border border-slate-200 flex flex-col items-center">
        <div className="w-full max-w-2xl h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
              <PolarGrid stroke="#e2e8f0" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 12, fontWeight: 500 }} />
              <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#cbd5e1', fontSize: 10 }} />
              <Radar name={entity?.name || '未知单位'} dataKey="Current" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.6} />
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
        {/* Current Entity Metrics */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <div className="flex items-center mb-4">
            <h3 className="text-lg font-bold text-slate-800">本单位指标纵览</h3>
            <MetricTip content="当前单位的核心治理指标。" />
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
                <div className="text-center">
                  <div className="text-[10px] text-slate-400 mb-1">{entity?.name || '本单位'}</div>
                  <div className="text-lg font-bold text-indigo-600">
                    {m.rawMethod ? m.rawMethod(entity) : (getRawData(entity).applications[m.rawKey!] || currentMetrics[m.key as keyof typeof currentMetrics].toFixed(1))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* No Benchmark Data Placeholder */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-4">核心指标区域排行榜 ({year})</h3>
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <span className="text-2xl text-slate-400">📊</span>
            </div>
            <h4 className="text-base font-bold text-slate-800 mb-2">暂无对标数据</h4>
            <p className="text-sm text-slate-500 max-w-sm">
              当前系统尚未接入区域对标基准数据。待对标数据接口就绪后，将支持与上海、苏州等标杆城市的横向对比分析。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};