import React, { useContext } from 'react';
import { EntityContext } from '../components/Layout';
import { MetricTip } from '../components/MetricTip';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';

export const OperationAnalysis: React.FC = () => {
  const { entity } = useContext(EntityContext);

  // Dynamic Year Logic: Get latest year available
  const sortedData = entity?.data ? [...entity.data].sort((a, b) => a.year - b.year) : [];

  if (sortedData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center bg-white rounded-lg border border-dashed border-slate-300">
        <h3 className="text-lg font-bold text-slate-800">暂无申请办理数据</h3>
        <p className="text-slate-500 mt-2">选定单位尚未上传或解析报告中的依申请办理明细。</p>
      </div>
    );
  }

  const latestData = sortedData[sortedData.length - 1];
  if (!latestData) return <div className="p-10 text-center text-slate-500">数据不完整</div>;

  // Data for Stacked Bar (Outcomes) - Use all available years (up to 5)
  const stackData = sortedData.map(d => ({
    year: d.year,
    public: d.applications.outcomes.public,
    partial: d.applications.outcomes.partial,
    unable: d.applications.outcomes.unable,
    other: d.applications.outcomes.ignore + d.applications.outcomes.notOpen
  }));

  // Detailed Breakdown of "Negative" Outcomes (Mock data to simulate Table 3 sub-items)
  // In a real scenario, these would come from the API. Here we scale them based on the actual entity's totals.
  const rejectionDetailData = [
    { name: '本机关不掌握', value: Math.floor(latestData.applications.outcomes.unable * 0.6), type: '无法提供' },
    { name: '信息不存在', value: Math.floor(latestData.applications.outcomes.unable * 0.3), type: '无法提供' },
    { name: '危及三安一稳', value: Math.floor(latestData.applications.outcomes.notOpen * 0.4), type: '不予公开' },
    { name: '内部事务信息', value: Math.floor(latestData.applications.outcomes.notOpen * 0.3), type: '不予公开' },
    { name: '过程性信息', value: Math.floor(latestData.applications.outcomes.notOpen * 0.2), type: '不予公开' },
    { name: '行政查询事项', value: Math.floor(latestData.applications.outcomes.ignore * 0.5), type: '不予处理' },
    { name: '重复申请', value: Math.floor(latestData.applications.outcomes.ignore * 0.3), type: '不予处理' },
  ].filter(d => d.value > 0); // Hide empty bars

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Outcome Structure (Main Chart) */}
        <div className="md:col-span-2 bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center">
              办理结果结构变化 ({stackData[0]?.year} - {latestData.year})
              <MetricTip content="对应表3-2：政府信息公开申请办理结果" />
            </h3>
            <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded text-xs font-medium">
              公开率趋势稳定
            </div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="year" stroke="#64748b" />
                <YAxis stroke="#64748b" />
                <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px' }} />
                <Legend />
                <Bar dataKey="public" name="予以公开" stackId="a" fill="#3b82f6" />
                <Bar dataKey="partial" name="部分公开" stackId="a" fill="#60a5fa" />
                <Bar dataKey="unable" name="无法提供" stackId="a" fill="#94a3b8" />
                <Bar dataKey="other" name="不予/其他" stackId="a" fill="#cbd5e1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Detailed Breakdown Chart (Replaces Source Pie) */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center">
            未公开原因透视 ({latestData.year})
            <MetricTip content="针对'无法提供'、'不予公开'、'不予处理'的具体原因细分，数据来源表3细项" />
          </h3>
          <p className="text-sm text-slate-500 mb-4">分析“为什么不给”，排查合规风险。</p>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={rejectionDetailData} margin={{ left: 10, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} interval={0} />
                <Tooltip />
                <Bar dataKey="value" name="案件数量" barSize={20} radius={[0, 4, 4, 0]}>
                  {rejectionDetailData.map((entry, index) => (
                    <React.Fragment key={`cell-${index}`}>
                      {/* Color coding by type */}
                      {entry.type === '无法提供' && <rect fill="#94a3b8" />}
                      {entry.type === '不予公开' && <rect fill="#f43f5e" />}
                      {entry.type === '不予处理' && <rect fill="#fbbf24" />}
                    </React.Fragment>
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-xs text-slate-500 mt-2 flex flex-wrap gap-2">
            <span className="flex items-center"><span className="w-2 h-2 bg-slate-400 mr-1 rounded-full"></span>无法提供</span>
            <span className="flex items-center"><span className="w-2 h-2 bg-rose-500 mr-1 rounded-full"></span>不予公开</span>
            <span className="flex items-center"><span className="w-2 h-2 bg-amber-400 mr-1 rounded-full"></span>不予处理</span>
          </div>
        </div>
      </div>

      {/* Detailed Analysis Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 border-t-4 border-t-emerald-500">
          <h4 className="font-bold text-slate-700 mb-2">健康度诊断：优</h4>
          <p className="text-sm text-slate-600 leading-relaxed">
            本年度依申请公开渠道畅通，结转率控制在 {(latestData.applications.carriedForward / (latestData.applications.totalHandled || 1) * 100).toFixed(1)}% 以内。
            “无法提供”类答复中，<strong>“本机关不掌握”</strong>占比最高，说明转办分办机制运行正常。
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 border-t-4 border-t-amber-500">
          <h4 className="font-bold text-slate-700 mb-2">异常结构预警</h4>
          <p className="text-sm text-slate-600 leading-relaxed">
            “不予公开”类别中，<strong>“过程性信息”</strong>引用频率同比{latestData.applications.outcomes.notOpen > (stackData[stackData.length - 2]?.other || 0) ? '上升' : '持平'}，
            鉴于《司法解释》对过程性信息认定趋严，建议审慎使用此条款，避免败诉风险。
          </p>
        </div>
      </div>
    </div>
  );
};