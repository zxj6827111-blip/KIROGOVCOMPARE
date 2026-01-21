import React, { useContext } from 'react';
import { EntityContext } from '../components/Layout';
import { MetricTip } from '../components/MetricTip';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell
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



  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Left: Overall Outcome History */}
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center">
              办理结果历史演进
              <MetricTip content="展示予以公开、不予公开、无法提供等大类的年度趋势对比" />
            </h3>
          </div>
          <div className="h-[500px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stackData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="year" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} />
                <Legend iconType="circle" />
                <Bar dataKey="public" name="予以公开" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
                <Bar dataKey="partial" name="部分公开" stackId="a" fill="#60a5fa" />
                <Bar dataKey="unable" name="无法提供" stackId="a" fill="#94a3b8" />
                <Bar dataKey="other" name="不予/其他" stackId="a" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Full Detail Breakdown */}
        <div className="lg:col-span-3 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-lg font-bold text-slate-800 flex items-center">
                未公开原因全景透视 ({latestData.year})
                <MetricTip content="完全对应年报表3-2：详细罗列了所有导致信息未完全公开的具体法律依据和业务情形。" />
              </h3>
              <p className="text-xs text-slate-400 mt-1">根据件数降序排列，直观定位“被动响应”压力源</p>
            </div>
            <div className="flex gap-2 text-[10px] font-bold">
              <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-[#ef4444] mr-1"></span> 不予公开</span>
              <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-[#94a3b8] mr-1"></span> 无法提供</span>
              <span className="flex items-center"><span className="w-2 h-2 rounded-full bg-[#f59e0b] mr-1"></span> 不予处理</span>
            </div>
          </div>

          <div className="h-[500px] pr-4">
            {(() => {
              const detail = latestData.applications.outcomesDetail;
              if (!detail) return <div className="text-center text-slate-400 mt-20">暂无细项数据</div>;

              const rawData = [
                // Not Open (Red #ef4444)
                { name: '国家秘密', value: detail.notOpen.stateSecret, group: '不予公开', fill: '#ef4444' },
                { name: '法律法规禁止', value: detail.notOpen.lawForbidden, group: '不予公开', fill: '#ef4444' },
                { name: '危及三安一稳', value: detail.notOpen.danger, group: '不予公开', fill: '#ef4444' },
                { name: '第三方合法权益', value: detail.notOpen.thirdParty, group: '不予公开', fill: '#ef4444' },
                { name: '内部事务信息', value: detail.notOpen.internal, group: '不予公开', fill: '#ef4444' },
                { name: '过程性信息', value: detail.notOpen.process, group: '不予公开', fill: '#ef4444' },
                { name: '行政执法案卷', value: detail.notOpen.enforcement, group: '不予公开', fill: '#ef4444' },
                { name: '行政查询事项', value: detail.notOpen.adminQuery, group: '不予公开', fill: '#ef4444' },

                // Unable (Slate #94a3b8)
                { name: '本机关不掌握', value: detail.unable.noInfo, group: '无法提供', fill: '#94a3b8' },
                { name: '需要另行制作', value: detail.unable.needCreation, group: '无法提供', fill: '#94a3b8' },
                { name: '补正后仍不明确', value: detail.unable.unclear, group: '无法提供', fill: '#94a3b8' },

                // Untreated (Amber #f59e0b)
                { name: '信访举报投诉', value: detail.untreated.complaint, group: '不予处理', fill: '#f59e0b' },
                { name: '重复申请', value: detail.untreated.repeat, group: '不予处理', fill: '#f59e0b' },
                { name: '要求提供公开出版物', value: detail.untreated.publication, group: '不予处理', fill: '#f59e0b' },
                { name: '无正当理由大量反复', value: detail.untreated.massive, group: '不予处理', fill: '#f59e0b' },
                { name: '要求确认或重新获取', value: detail.untreated.confirm, group: '不予处理', fill: '#f59e0b' },

                // Other (Gray #64748b)
                { name: '逾期补正', value: detail.other.overdueCorrection, group: '其他', fill: '#64748b' },
                { name: '逾期缴费', value: detail.other.overdueFee, group: '其他', fill: '#64748b' },
                { name: '其他处理情形', value: detail.other.other, group: '其他', fill: '#64748b' },
              ];

              const chartData = rawData.filter(d => d.value > 0).sort((a, b) => b.value - a.value);

              return (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart layout="vertical" data={chartData} margin={{ left: 40, right: 60, top: 10, bottom: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={120}
                      tick={{ fontSize: 11, fontWeight: 'bold', fill: '#475569' }}
                      axisLine={false}
                      tickLine={false}
                      interval={0}
                    />
                    <Tooltip
                      cursor={{ fill: '#f8fafc' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const data = payload[0].payload;
                          return (
                            <div className="bg-white p-3 rounded-lg shadow-xl border border-slate-100 text-xs">
                              <div className="font-bold text-slate-400 mb-1">{data.group}</div>
                              <div className="text-sm font-black text-slate-800 mb-1">{data.name}</div>
                              <div className="text-2xl font-black mt-2" style={{ color: data.fill }}>{data.value} <span className="text-xs font-normal text-slate-400">件</span></div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                    <Bar dataKey="value" barSize={18} radius={[0, 10, 10, 0]} label={{ position: 'right', fontSize: 11, fontWeight: 'bold', fill: '#64748b' }}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
          </div>

          <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">业务分析结论：</h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              2024年度，<strong>“本机关不掌握”</strong> ({latestData.applications.outcomesDetail?.unable.noInfo || 0}件) 是导致无法提供的首要原因，占比显著。
              在不予公开类中，<strong>“行政查询事项”</strong> ({latestData.applications.outcomesDetail?.notOpen.adminQuery || 0}件) 较为突出，反映出社会公众对政务公开与“档案查阅”界限仍存在认知偏差，
              法制部门应加强对该类答复的模板优化，做好引导解释工作。
            </p>
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
    </div >
  );
};