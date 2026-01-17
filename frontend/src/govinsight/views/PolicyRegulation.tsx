import React, { useContext } from 'react';
import { EntityContext } from '../components/Layout';
import {
  Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, AreaChart, Area, ComposedChart
} from 'recharts';
import { FileText, ShieldCheck } from 'lucide-react';

export const PolicyRegulation: React.FC = () => {
  const { entity } = useContext(EntityContext);

  const chartData = entity?.data ? entity.data.map(d => ({
    year: d.year,
    published: (d.regulations?.published || 0) + (d.normativeDocuments?.published || 0),
    abolished: (d.regulations?.abolished || 0) + (d.normativeDocuments?.abolished || 0),
    active: (d.regulations?.active || 0) + (d.normativeDocuments?.active || 0),
    // Service (Licensing) vs Control (Punishment)
    licensing: d.adminActions?.licensing || 0,
    punishment: (d.adminActions?.punishment || 0) * 5, // Scaling for visualization comparison
    rawPunishment: d.adminActions?.punishment || 0,
    ratio: (d.adminActions?.licensing / (d.adminActions?.punishment || 1)).toFixed(1)
  })).sort((a, b) => a.year - b.year) : [];

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center bg-white rounded-lg border border-dashed border-slate-300">
        <h3 className="text-lg font-bold text-slate-800">暂无制度供给数据</h3>
        <p className="text-slate-500 mt-2">选定单位尚未上传或解析报告中的规章与规范性文件明细。</p>
      </div>
    );
  }

  const current = chartData[chartData.length - 1];
  if (!current) return <div className="p-10 text-center text-slate-500">数据不完整</div>;

  return (
    <div className="space-y-6">
      {/* Header Insight */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-700 rounded-xl p-6 text-white shadow-md flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold flex items-center">
            <ShieldCheck className="w-6 h-6 mr-2" />
            营商环境 · 法治体检 ({current.year})
          </h2>
          <p className="opacity-80 mt-1 text-sm">
            基于“放管服”视角的监管效能与制度供给分析
          </p>
        </div>
        <div className="flex space-x-8 text-center">
          <div>
            <div className="text-3xl font-bold">{current.ratio} : 1</div>
            <div className="text-xs opacity-70 uppercase tracking-wider">服务/管控比 (许可/处罚)</div>
          </div>
          <div className="w-px bg-white/20 h-10"></div>
          <div>
            <div className="text-3xl font-bold">{(current.abolished / (current.published || 1) * 100).toFixed(0)}%</div>
            <div className="text-xs opacity-70 uppercase tracking-wider">制度新陈代谢率 (废止/制发)</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Chart 1: Service vs Control Gap */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <div className="mb-4">
            <h3 className="text-lg font-bold text-slate-800">监管温情度“剪刀差”分析</h3>
            <p className="text-sm text-slate-500">
              <span className="text-emerald-500 font-bold">绿色区域</span>面积越大，代表“重服务、轻处罚”的营商环境越优。
            </p>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorLicensing" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorPunish" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="year" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" tickFormatter={(val) => val >= 1000 ? `${val / 1000}k` : val} />
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <Tooltip />
                <Legend />
                <Area type="monotone" dataKey="licensing" name="行政许可 (服务)" stroke="#10b981" fillOpacity={1} fill="url(#colorLicensing)" />
                <Area type="monotone" dataKey="punishment" name="行政处罚 (管控-放大5倍)" stroke="#f59e0b" fillOpacity={1} fill="url(#colorPunish)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Chart 2: Regulation Metabolism */}
        <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <div className="mb-4 flex justify-between items-start">
            <div>
              <h3 className="text-lg font-bold text-slate-800">制度供给与清理</h3>
              <p className="text-sm text-slate-500">
                监测“僵尸文件”清理力度，防止过时政策阻碍发展。
              </p>
            </div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="year" stroke="#94a3b8" />
                <YAxis yAxisId="left" stroke="#94a3b8" />
                <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="published" name="新增文件" fill="#3b82f6" barSize={20} />
                <Bar yAxisId="left" dataKey="abolished" name="废止清理" fill="#94a3b8" barSize={20} />
                <Line yAxisId="right" type="monotone" dataKey="active" name="现行有效总量" stroke="#1e293b" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Analysis Card */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 border-l-4 border-l-indigo-500">
        <h4 className="font-bold text-slate-800 flex items-center mb-3">
          <FileText className="w-5 h-5 mr-2 text-indigo-500" />
          深度研判结论
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-slate-600">
          <div>
            <p className="font-semibold text-slate-800 mb-1">监管趋势：</p>
            <p className="leading-relaxed">
              近五年“服务/管控比”由 {chartData[0].ratio} 变化至 {current.ratio}，
              {parseFloat(current.ratio) > parseFloat(chartData[0].ratio) ? '行政许可增速远超行政处罚，体现了“宽进严管”向“包容审慎”的监管模式转变。' : '监管力度有所加强。'}
            </p>
          </div>
          <div>
            <p className="font-semibold text-slate-800 mb-1">制度活力：</p>
            <p className="leading-relaxed">
              文件废止率保持在 {(current.abolished / (current.published || 1) * 100).toFixed(0)}% 左右的区间，
              {current.active > 100 ? '说明政策库具备良好的“新陈代谢”能力。' : '政策库规模较小。'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};