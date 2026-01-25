import React, { useContext, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EntityContext } from '../components/Layout';
import { KPICard } from '../components/KPICard';
import { MetricTip } from '../components/MetricTip';
import { districts } from '../data';
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ScatterChart, Scatter, ZAxis, Cell, ReferenceLine, Label
} from 'recharts';
import { Layers, HelpCircle, ArrowRight, CheckCircle2 } from 'lucide-react';

export const DashboardHome: React.FC = () => {
  const { entity, setEntity } = useContext(EntityContext);
  const navigate = useNavigate();

  // 1. 智能获取最新年份（不再写死2024）
  // 如果数据库里只有2022年数据，就显示2022
  const availableYears = entity?.data ? Array.from(new Set(entity.data.map(d => d.year))).sort((a, b) => b - a) : [];

  // State for Year Selection
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const availableYearsKey = availableYears.join(',');

  // Update selected year when entity changes or availableYears changes
  React.useEffect(() => {
    if (availableYears.length > 0 && (!selectedYear || !availableYears.includes(selectedYear))) {
      setSelectedYear(availableYears[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableYearsKey, selectedYear]);

  // Fallback to first available or 2024
  const currentYear = selectedYear || availableYears[0] || 2024;

  // State for Quadrant Selection
  const [selectedNode, setSelectedNode] = useState<any>(null);

  // State for Heat Map Filter (District vs Department)
  const [heatMapFilter, setHeatMapFilter] = useState<'district' | 'department'>('district');

  const isDistrict = (name: string) => {
    return name.endsWith('区') || name.endsWith('县') || name.endsWith('市') || name.endsWith('开发区') || name.endsWith('园区') || name.endsWith('新区') || name.endsWith('新城');
  };

  // Guard clause: If no data at all
  if (!entity || !entity.data || entity.data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center bg-white rounded-lg border border-dashed border-slate-300">
        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mb-4 text-slate-300">
          <Layers size={32} />
        </div>
        <h3 className="text-lg font-bold text-slate-800">暂无政务公开数据</h3>
        <p className="text-slate-500 max-w-sm mt-2">
          当前单位 {entity?.name} 尚未关联任何已发布的年度报告。请在"上传报告"模块中上传并完成解析。
        </p>
      </div>
    );
  }

  const currentData = entity.data.find(d => d.year === currentYear);
  const prevData = entity.data.find(d => d.year === currentYear - 1);

  // Guard clause: If current data not found
  if (!currentData) {
    return (
      <div className="p-10 text-center text-slate-500">
        <div className="mb-4">
          <select
            value={currentYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-1.5 border border-slate-300 rounded text-sm bg-white"
          >
            {availableYears.map(y => <option key={y} value={y}>{y}年</option>)}
          </select>
        </div>
        未能找到 {currentYear} 年的数据记录
      </div>
    );
  }

  // 2. 安全计算同比 (Safe Math)
  const calculateTrend = (curr: number, prev: number | undefined): number | null => {
    if (prev === undefined || prev === 0) return null; // Return null to hide arrow
    return Number(((curr - prev) / prev * 100).toFixed(1));
  };

  const appTrend = calculateTrend(currentData.applications.newReceived, prevData?.applications.newReceived);
  const activeRegs = currentData.regulations.active + currentData.normativeDocuments.active;

  const getCorrectionRate = (d: any) => {
    const totalDisputes = d.disputes.reconsideration.total + d.disputes.litigation.total;
    const corrected = d.disputes.reconsideration.corrected + d.disputes.litigation.corrected;
    return totalDisputes > 0 ? (corrected / totalDisputes * 100) : 0;
  };

  const correctionRate = getCorrectionRate(currentData);
  const prevCorrectionRate = prevData ? getCorrectionRate(prevData) : null;

  // Risk trend logic
  const riskTrend = prevCorrectionRate !== null
    ? Number((correctionRate - prevCorrectionRate).toFixed(1))
    : null;

  // 3. Chart Data: Recharts automatically adapts to array length (1 item or 5 items)
  const mainTrendData = entity.data.map(d => {
    const totalHandled = d.applications.totalHandled || (d.applications.outcomes.public + d.applications.outcomes.partial + d.applications.outcomes.unable + d.applications.outcomes.notOpen + d.applications.outcomes.ignore) || 1;
    return {
      year: d.year,
      pressure: d.applications.newReceived,
      quality: (d.applications.outcomes.public / totalHandled * 100).toFixed(1),
      risk: getCorrectionRate(d).toFixed(2)
    };
  });

  // Quadrant Data (Requires children data)
  const quadrantData = entity.children ? entity.children
    .map(child => {
      const d = child.data.find(x => x.year === currentYear);
      if (!d) {
        console.log('[DashboardHome] Child', child.name, 'has no data for year', currentYear, '- available years:', child.data.map(x => x.year));
        return null;
      }
      return {
        name: child.name,
        x: d.applications.newReceived, // Workload
        y: parseFloat(getCorrectionRate(d).toFixed(1)), // Risk
        z: d.adminActions.punishment + d.adminActions.licensing // Volume
      };
    })
    .filter(Boolean) as any[] : [];

  console.log('[DashboardHome] Entity children count:', entity.children?.length || 0);
  console.log('[DashboardHome] Children with data:', entity.children?.filter(c => c.data && c.data.length > 0).length || 0);
  console.log('[DashboardHome] quadrantData count:', quadrantData.length);

  const avgPressure = quadrantData.length > 0 ? quadrantData.reduce((acc, curr) => acc + curr.x, 0) / quadrantData.length : 0;
  const avgRisk = quadrantData.length > 0 ? quadrantData.reduce((acc, curr) => acc + curr.y, 0) / quadrantData.length : 0;

  const handleDrillDown = (name: string) => {
    const target = districts.find(d => d.name === name);
    if (target) {
      setEntity(target);
      navigate('/portrait');
    }
  };

  const ZONE_COLORS = {
    critical: '#ef4444',
    warning: '#f97316',
    elite: '#3b82f6',
    safe: '#10b981'
  };

  const getZoneInfo = (x: number, y: number) => {
    if (y > avgRisk) {
      return x > avgPressure
        ? { name: '重点督办区', color: ZONE_COLORS.critical, desc: '高压高险·需重点监管', action: '建议开展专项案卷评查，重点检查"滥用不予公开"条款情况。' }
        : { name: '关注整改区', color: ZONE_COLORS.warning, desc: '低压高险·需能力排查', action: '案件基数小但败诉率高，建议加强法制审核人员配备。' };
    } else {
      return x > avgPressure
        ? { name: '优质效能区', color: ZONE_COLORS.elite, desc: '高压低险·建议表彰推广', action: '依申请办理规范，建议提炼其答复模板向全市推广。' }
        : { name: '平稳观察区', color: ZONE_COLORS.safe, desc: '低压低险·运行平稳正常', action: '定期抽查即可，保持当前运行状态。' };
    }
  };

  const sortedDistricts = entity.children ? [...entity.children]
    .filter(child => {
      if (heatMapFilter === 'district') return isDistrict(child.name);
      if (heatMapFilter === 'department') return !isDistrict(child.name);
      return true;
    })
    .sort((a, b) => {
      const da = a.data.find(x => x.year === currentYear);
      const db = b.data.find(x => x.year === currentYear);
      return (db?.applications.newReceived || 0) - (da?.applications.newReceived || 0);
    }) : [];

  return (
    <div className="space-y-6">
      {/* 0. Year Selector Row */}
      <div className="flex justify-between items-center bg-white p-4 rounded-lg shadow-sm border border-slate-200">
        <div className="flex items-center space-x-2">
          <span className="text-sm font-bold text-slate-700">当前分析年份:</span>
          <select
            value={currentYear}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="px-3 py-1.5 border border-slate-300 rounded-md text-sm font-medium text-slate-700 bg-slate-50 hover:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
          >
            {availableYears.map(y => <option key={y} value={y}>{y}年度</option>)}
          </select>
        </div>
        <div className="text-xs text-slate-400">
          {entity.children?.length || 0} 个下辖区域 | 数据更新至 {availableYears[0]}
        </div>
      </div>

      {/* 1. KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="依申请新收总量"
          value={currentData.applications.newReceived.toLocaleString()}
          unit="件"
          trend={appTrend}
          color="blue"
          tooltip="本年度新收到的政府信息公开申请数量"
          source="表3-1"
        />
        <KPICard
          title="行政事业性收费"
          value={(currentData.fees.amount / 100).toFixed(1)}
          unit="亿元"
          trend={null} // Mock data doesn't fully support trend calc unless I improved types.ts more, but relying on mocked data.ts logic 
          color="amber"
          tooltip="本年度根据国家规定收取的行政事业性收费总额"
          source="表2-20-(8)"
        />
        <KPICard
          title="规章/规范性文件"
          value={activeRegs}
          unit="件"
          color="indigo"
          tooltip="现行有效规章数 + 现行有效规范性文件数"
          source="表2"
        />
        <KPICard
          title="复议诉讼纠错率"
          value={correctionRate.toFixed(2)}
          unit="%"
          trend={riskTrend}
          trendLabel="风险变动"
          color="rose"
          tooltip="败诉纠错案件占比"
          source="表4"
        />
      </div>

      {/* 2. Main Trend & Ranking */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-slate-800 flex items-center">
              治理效能趋势分析
              <MetricTip content="压力、质量与风险的综合演进趋势" />
            </h3>
            <div className="flex space-x-4 text-sm hidden sm:flex text-slate-500">
              <div className="flex items-center"><span className="w-2 h-2 bg-blue-400 mr-1.5 rounded-full"></span> 申请压力</div>
              <div className="flex items-center"><span className="w-2 h-2 bg-emerald-500 mr-1.5 rounded-full"></span> 公开质量</div>
              <div className="flex items-center"><span className="w-2 h-2 bg-rose-500 mr-1.5 rounded-full"></span> 法律风险</div>
            </div>
          </div>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={mainTrendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="year" stroke="#64748b" />
                <YAxis yAxisId="left" stroke="#64748b" />
                <YAxis yAxisId="right" orientation="right" stroke="#64748b" unit="%" />
                <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Area yAxisId="left" type="monotone" dataKey="pressure" name="申请量" fill="#dbeafe" stroke="#3b82f6" fillOpacity={0.6} />
                <Line yAxisId="right" type="monotone" dataKey="quality" name="公开率" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                <Line yAxisId="right" type="monotone" dataKey="risk" name="纠错率" stroke="#f43f5e" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 3. Conditional Right Panel */}
        <div className="space-y-6">
          {entity.type === 'city' && (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 h-full flex flex-col">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800 flex items-center">
                  <Layers className="w-5 h-5 text-indigo-500 mr-2" />
                  区域受理量热力榜
                  <MetricTip content="依据表3'新收政府信息公开申请数量'排名" />
                </h3>
                <div className="flex bg-slate-100 p-0.5 rounded-lg">
                  <button
                    onClick={() => setHeatMapFilter('department')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${heatMapFilter === 'department' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    部门
                  </button>
                  <button
                    onClick={() => setHeatMapFilter('district')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${heatMapFilter === 'district' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    区县
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto pr-2 space-y-2">
                {sortedDistricts.map((dist, idx) => {
                  const d = dist.data.find(x => x.year === currentYear);
                  if (!d) return null;
                  const percent = (d.applications.newReceived / currentData.applications.newReceived * 100).toFixed(1);
                  return (
                    <div
                      key={dist.id}
                      onClick={() => handleDrillDown(dist.name)}
                      className="flex items-center justify-between p-2 rounded hover:bg-slate-50 cursor-pointer transition-colors group"
                    >
                      <div className="flex items-center">
                        <span className={`w-5 h-5 rounded text-[10px] flex items-center justify-center mr-2 font-bold ${idx < 3 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{idx + 1}</span>
                        <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600">{dist.name}</span>
                      </div>
                      <div className="flex items-center space-x-2">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-indigo-500" style={{ width: `${parseFloat(percent) * 3}%` }}></div>
                        </div>
                        <span className="text-xs font-bold text-slate-800">{d.applications.newReceived}</span>
                      </div>
                    </div>
                  );
                })}
                {sortedDistricts.length === 0 && (
                  <div className="text-center text-slate-400 py-10">暂无下辖区域数据</div>
                )}
              </div>
            </div>
          )}

          {entity.type === 'department' && (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-slate-200 h-full">
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center">
                运营健康度监测
                <MetricTip content="基于办结率、结转率与人均办件量的综合评分" />
              </h3>
              <div className="space-y-4">
                <div className="p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
                  <div className="text-xs text-emerald-600 mb-1">按期办结率</div>
                  <div className="text-2xl font-bold text-emerald-800">100%</div>
                  <div className="text-xs text-emerald-600 mt-1">无超期未结案件</div>
                </div>
                <div className="p-3 bg-amber-50 border border-amber-100 rounded-lg">
                  <div className="text-xs text-amber-600 mb-1">结转下年数量</div>
                  <div className="text-2xl font-bold text-amber-800">{currentData.applications.carriedForward} 件</div>
                  <div className="text-xs text-amber-600 mt-1">
                    {/* Robust comparison logic */}
                    {prevData
                      ? (currentData.applications.carriedForward > prevData.applications.carriedForward
                        ? '较上年增加 (需关注堆积风险)'
                        : '较上年减少')
                      : '暂无上年对比'
                    }
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 4. Deep Dive: Scenario A Quadrant (ACTION ORIENTED) */}
      {entity.type === 'city' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 bg-white p-6 rounded-lg shadow-sm border border-slate-200">
          {/* Left: Chart */}
          <div className="lg:col-span-2 border-r border-slate-100 pr-4">
            <div className="flex justify-between items-start mb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-800 flex items-center">
                  区域绩效风险四象限
                  <MetricTip content="X轴: 受理量(压力); Y轴: 纠错率(风险). 虚线为全市平均值." />
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  <span className="font-semibold text-slate-700">点击气泡</span> 查看右侧诊断建议
                </p>
              </div>
            </div>
            <div className="h-80">
              {quadrantData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
                    <CartesianGrid />
                    <XAxis type="number" dataKey="x" name="受理量" unit="件" stroke="#94a3b8" />
                    <YAxis type="number" dataKey="y" name="纠错率" unit="%" stroke="#94a3b8" />
                    <ZAxis type="number" dataKey="z" range={[100, 800]} name="执法量" />
                    <Tooltip cursor={{ strokeDasharray: '3 3' }} content={<></>} />

                    <ReferenceLine x={avgPressure} stroke="#94a3b8" strokeDasharray="3 3">
                      <Label value="平均压力" position="insideTopRight" fill="#94a3b8" fontSize={10} />
                    </ReferenceLine>
                    <ReferenceLine y={avgRisk} stroke="#94a3b8" strokeDasharray="3 3">
                      <Label value="平均风险" position="insideTopRight" fill="#94a3b8" fontSize={10} />
                    </ReferenceLine>

                    <Scatter name="Districts" data={quadrantData} onClick={(node) => setSelectedNode(node.payload)}>
                      {quadrantData.map((entry, index) => {
                        const zone = getZoneInfo(entry.x, entry.y);
                        const isSelected = selectedNode && selectedNode.name === entry.name;
                        return (
                          <Cell
                            key={`cell-${index}`}
                            fill={zone.color}
                            stroke={isSelected ? '#000' : 'none'}
                            strokeWidth={isSelected ? 2 : 0}
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                          />
                        );
                      })}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 bg-slate-50 border border-dashed border-slate-200">
                  数据不足，无法生成四象限图
                </div>
              )}
            </div>
          </div>

          {/* Right: Diagnosis Panel */}
          <div className="flex flex-col justify-center pl-2">
            {selectedNode ? (
              (() => {
                const zone = getZoneInfo(selectedNode.x, selectedNode.y);
                return (
                  <div className="animate-in fade-in slide-in-from-left-4 duration-300">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xl font-bold text-slate-800">{selectedNode.name}</h4>
                      <span className="text-xs px-2 py-1 rounded text-white font-bold" style={{ backgroundColor: zone.color }}>
                        {zone.name}
                      </span>
                    </div>

                    <div className="space-y-4">
                      <div className="p-3 bg-slate-50 rounded border border-slate-100">
                        <div className="text-xs text-slate-500 mb-1">关键数据</div>
                        <div className="flex justify-between items-end">
                          <div>
                            <span className="text-lg font-bold text-slate-700">{selectedNode.x}</span>
                            <span className="text-xs text-slate-400 ml-1">件受理</span>
                          </div>
                          <div className="h-4 w-px bg-slate-300 mx-2"></div>
                          <div>
                            <span className="text-lg font-bold text-rose-600">{selectedNode.y}%</span>
                            <span className="text-xs text-slate-400 ml-1">纠错率</span>
                          </div>
                        </div>
                      </div>

                      <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                        <h5 className="font-bold text-blue-800 text-sm mb-2 flex items-center">
                          <CheckCircle2 className="w-4 h-4 mr-1" /> 建议行动
                        </h5>
                        <p className="text-sm text-blue-700 leading-relaxed">
                          {zone.action}
                        </p>
                      </div>

                      <button
                        onClick={() => handleDrillDown(selectedNode.name)}
                        className="w-full flex items-center justify-center space-x-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 py-2 rounded transition-colors text-sm font-medium"
                      >
                        <span>查看该区域详细画像</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center p-4 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                <HelpCircle className="w-8 h-8 mb-2 opacity-50" />
                {quadrantData.length > 0
                  ? <p className="text-sm">点击左侧图表中的气泡<br />查看具体诊断建议</p>
                  : <p className="text-sm">下级区域数据不足<br />无法进行对比分析</p>
                }
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};