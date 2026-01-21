import React, { useContext } from 'react';
import { EntityContext } from '../components/Layout';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area
} from 'recharts';
import { ShieldCheck, Wallet, RefreshCw, TrendingUp, Scale, FileCheck, Landmark, ArrowUpRight, ArrowDownRight } from 'lucide-react';

export const PolicyRegulation: React.FC = () => {
  const { entity } = useContext(EntityContext);

  const chartData = entity?.data ? entity.data.map(d => {
    const totalControl = d.adminActions.punishment + d.adminActions.force;
    const licensing = d.adminActions.licensing;

    return {
      year: d.year,
      // Flow Metrics (增量)
      regPublished: d.regulations.published,
      regAbolished: d.regulations.abolished,
      docPublished: d.normativeDocuments.published,
      docAbolished: d.normativeDocuments.abolished,
      // Action Metrics
      licensing: licensing,
      control: totalControl,
      fees: d.fees.amount,
      serviceRatio: (licensing / (totalControl || 1)).toFixed(2)
    };
  }).sort((a, b) => a.year - b.year) : [];

  const current = chartData[chartData.length - 1];
  const prev = chartData[chartData.length - 2];

  if (!current) return <div className="p-10 text-center text-slate-500">暂无数据</div>;

  return (
    <div className="space-y-6">
      {/* 1. 顶部：营商环境 · 法治体检总览 */}
      <div className="bg-gradient-to-r from-indigo-700 via-blue-800 to-slate-800 rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row justify-between items-center border-b-4 border-emerald-500">
        <div className="flex items-center space-x-4 mb-4 md:mb-0">
          <div className="p-3 bg-white/10 rounded-xl backdrop-blur-md">
            <ShieldCheck className="w-8 h-8 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center">
              营商环境 · 法治体检报告 <span className="ml-3 px-2 py-0.5 bg-emerald-500/20 text-emerald-300 text-xs rounded border border-emerald-500/30">{current.year}</span>
            </h2>
            <p className="text-white/60 text-sm mt-1">基于“放管服”视角的监管效能与制度供给全生命周期分析</p>
          </div>
        </div>

        <div className="flex space-x-8 items-center">
          <div className="text-center">
            <div className="text-xs text-white/50 uppercase tracking-widest mb-1">服务/管控比</div>
            <div className="text-3xl font-black text-emerald-400">{current.serviceRatio}<span className="text-xs font-normal ml-1">: 1</span></div>
          </div>
          <div className="w-px h-10 bg-white/10"></div>
          <div className="text-center">
            <div className="text-xs text-white/50 uppercase tracking-widest mb-1">制度新陈代谢率</div>
            <div className="text-3xl font-black text-blue-400">
              {(((current.regAbolished + current.docAbolished) / (current.regPublished + current.docPublished || 1)) * 100).toFixed(0)}%
            </div>
          </div>
        </div>
      </div>

      {/* 2. 现行有效核心指标 (Refined to 3 cards with sub-stats) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* 规章卡片 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-1">现行有效政府规章</div>
              <div className="text-4xl font-black text-slate-900 tracking-tighter">
                {entity?.data.find(d => d.year === current.year)?.regulations.active} <span className="text-sm font-bold text-slate-400">件</span>
              </div>
            </div>
            <Landmark className="w-8 h-8 text-indigo-500 opacity-20" />
          </div>
          <div className="flex space-x-4 border-t border-slate-50 pt-4">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold">本年制发</span>
              <span className="text-sm font-bold text-indigo-600 flex items-center">
                <ArrowUpRight className="w-3 h-3 mr-0.5" /> +{current.regPublished}
              </span>
            </div>
            <div className="w-px h-8 bg-slate-100"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold">本年废止</span>
              <span className={`text-sm font-bold flex items-center ${current.regAbolished > 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                <ArrowDownRight className="w-3 h-3 mr-0.5" /> -{current.regAbolished}
              </span>
            </div>
          </div>
        </div>

        {/* 规范性文件卡片 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-1">现行有效行政规范性文件</div>
              <div className="text-4xl font-black text-slate-900 tracking-tighter">
                {entity?.data.find(d => d.year === current.year)?.normativeDocuments.active} <span className="text-sm font-bold text-slate-400">件</span>
              </div>
            </div>
            <FileCheck className="w-8 h-8 text-blue-500 opacity-20" />
          </div>
          <div className="flex space-x-4 border-t border-slate-50 pt-4">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold">本年制发</span>
              <span className="text-sm font-bold text-blue-600 flex items-center">
                <ArrowUpRight className="w-3 h-3 mr-0.5" /> +{current.docPublished}
              </span>
            </div>
            <div className="w-px h-8 bg-slate-100"></div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 font-bold">本年废止</span>
              <span className={`text-sm font-bold flex items-center ${current.docAbolished > 0 ? 'text-rose-500' : 'text-slate-400'}`}>
                <ArrowDownRight className="w-3 h-3 mr-0.5" /> -{current.docAbolished}
              </span>
            </div>
          </div>
        </div>

        {/* 收费卡片 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="text-xs font-bold text-slate-400 uppercase mb-1">行政事业收费</div>
              <div className="text-4xl font-black text-slate-900 tracking-tighter">
                {(current.fees / 100).toFixed(1)} <span className="text-sm font-bold text-slate-400">亿元</span>
              </div>
            </div>
            <Wallet className="w-8 h-8 text-amber-500 opacity-20" />
          </div>
          <div className="pt-4 border-t border-slate-50">
            <span className="text-[10px] text-slate-400 font-bold block mb-1">同比变动</span>
            <div className={`text-sm font-bold flex items-center ${current.fees > (prev?.fees || 0) ? 'text-rose-500' : 'text-emerald-500'}`}>
              {current.fees > (prev?.fees || 0) ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
              {Math.abs(((current.fees - (prev?.fees || 0)) / (prev?.fees || 1)) * 100).toFixed(1)}%
            </div>
          </div>
        </div>
      </div>

      {/* 3. 年度制度新陈代谢 (Simplified: Only Flux Bars) */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h3 className="text-xl font-bold text-slate-800 flex items-center">
              <RefreshCw className="w-6 h-6 mr-2 text-blue-500" />
              制度“新陈代谢”年度流向监测
            </h3>
            <p className="text-sm text-slate-500 mt-1">对比各年度规章与规范性文件的制发量与废止清理量。</p>
          </div>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center text-xs font-medium text-slate-600">
              <span className="w-3 h-3 bg-indigo-700 rounded-sm mr-1.5"></span> 规章制发
            </div>
            <div className="flex items-center text-xs font-medium text-slate-600">
              <span className="w-3 h-3 bg-indigo-200 rounded-sm mr-1.5"></span> 规章废止
            </div>
            <div className="flex items-center text-xs font-medium text-slate-600">
              <span className="w-3 h-3 bg-blue-500 rounded-sm mr-1.5"></span> 文件制发
            </div>
            <div className="flex items-center text-xs font-medium text-slate-600">
              <span className="w-3 h-3 bg-blue-100 rounded-sm mr-1.5"></span> 文件废止
            </div>
          </div>
        </div>

        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="year" stroke="#94a3b8" axisLine={false} tickLine={false} tick={{ fontSize: 12, fontWeight: 'bold' }} />
              <YAxis stroke="#94a3b8" axisLine={false} tickLine={false} label={{ value: '件数', angle: -90, position: 'insideLeft', fontSize: 10, fill: '#94a3b8' }} />
              <Tooltip
                cursor={{ fill: '#f8fafc' }}
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
              />
              {/* Flux Bars: Published vs Abolished for both types */}
              <Bar dataKey="regPublished" name="规章:制发" fill="#4338ca" radius={[4, 4, 0, 0]} barSize={16} />
              <Bar dataKey="regAbolished" name="规章:废止" fill="#c7d2fe" radius={[4, 4, 0, 0]} barSize={16} />
              <Bar dataKey="docPublished" name="规范性文件:制发" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={16} />
              <Bar dataKey="docAbolished" name="规范性文件:废止" fill="#dbeafe" radius={[4, 4, 0, 0]} barSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 4. 监管温情度“剪刀差”分析 (Keep existing good logic) */}
      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-100">
        <div className="flex justify-between items-end mb-8">
          <div>
            <h3 className="text-xl font-bold text-slate-800 flex items-center">
              <TrendingUp className="w-6 h-6 mr-2 text-emerald-500" />
              监管温情度“剪刀差”演进
            </h3>
            <p className="text-sm text-slate-500 mt-1">绿色溢出区域越大，代表营商环境中的“服务性响应”越强。</p>
          </div>
          <div className="text-right">
            <span className="text-xs font-bold text-slate-400 uppercase block mb-1">当前服务指数</span>
            <span className="text-3xl font-black text-emerald-600">{current.licensing.toLocaleString()}</span>
            <span className="text-xs text-slate-400 ml-1">次许可办理</span>
          </div>
        </div>

        <div className="h-[350px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorService" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="colorControl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="year" stroke="#94a3b8" axisLine={false} tickLine={false} />
              <YAxis stroke="#94a3b8" axisLine={false} tickLine={false} tickFormatter={(v) => v >= 1000 ? `${v / 1000}k` : v} />
              <Tooltip />
              <Area type="monotone" dataKey="licensing" name="行政许可 (服务)" stroke="#10b981" strokeWidth={4} fillOpacity={1} fill="url(#colorService)" />
              <Area type="monotone" dataKey="control" name="行政执法 (管控)" stroke="#f59e0b" strokeWidth={2} fillOpacity={1} fill="url(#colorControl)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-8 p-5 bg-slate-50 rounded-xl border border-slate-100 flex items-start space-x-4">
          <div className="p-2 bg-emerald-100 rounded-full">
            <Scale className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h4 className="font-bold text-slate-800 text-sm">营商环境诊断：优</h4>
            <p className="text-xs text-slate-600 mt-1 leading-relaxed">
              {current.year}年度，行政许可办理量是行政执法量的 <strong>{current.serviceRatio}</strong> 倍。
              “剪刀差”持续拉大，显示政府职能正从“强力干预”向“高效赋能”精准转型。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};