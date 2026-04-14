import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  PieChart,
  Pie,
  Legend,
  ComposedChart,
  Line,
  LineChart,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  LabelList,
} from 'recharts';
import { AnnualData, EntityProfile } from '../types';

interface ChartProps {
  data: AnnualData[];
  isPrinting?: boolean;
}

interface BenchmarkProps {
  entity: EntityProfile;
  avgProfile: EntityProfile;
}

// 通用配置：字体颜色、网格线颜色
const AXIS_STYLE = { fontSize: 10, fill: '#64748b' };
const GRID_STYLE = { stroke: '#f1f5f9', strokeDasharray: '4 4' };
const PRINT_AXIS_STYLE = { fontSize: 9, fill: '#64748b' };

const chartContainerClass = (isPrinting?: boolean, heightClass = 'h-64') =>
  `${heightClass} w-full min-w-0 overflow-hidden border ${isPrinting ? 'border-slate-300 rounded-none shadow-none bg-white p-3' : 'border-slate-100 rounded-xl shadow-sm bg-white p-4'} break-inside-avoid`;

const chartTitleClass = (isPrinting?: boolean, compact = false) =>
  isPrinting
    ? `font-sans text-[15px] font-semibold text-slate-900 tracking-normal ${compact ? 'mb-2 text-left' : 'mb-3 text-left'}`
    : `font-sans text-xs font-bold text-slate-700 tracking-wide ${compact ? 'mb-2 text-center' : 'mb-4 text-center'}`;

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-800 text-white text-xs p-2 rounded shadow-lg opacity-90 border border-slate-700">
        <p className="font-bold mb-1">{label}年</p>
        {payload.map((p: any, idx: number) => (
          <div key={idx} className="flex items-center space-x-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }}></span>
            <span>
              {p.name}: {p.value}
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

// 1. 趋势图 (Area Gradient)
export const ReportTrendChart: React.FC<ChartProps> = ({ data, isPrinting }) => {
  const axisStyle = isPrinting ? PRINT_AXIS_STYLE : AXIS_STYLE;
  const chartData = data.map((d) => ({
    year: d.year,
    value: d.applications.newReceived,
  }));
  const animationDuration = isPrinting ? 0 : 1500;
  const isAnimationActive = !isPrinting;
  return (
    <div className={chartContainerClass(isPrinting)}>
      <h4 className={chartTitleClass(isPrinting)}>图 1：近五年政府信息公开申请接收量趋势</h4>
      <ResponsiveContainer width="100%" height="85%" minWidth={0} minHeight={180}>
        <AreaChart
          data={chartData}
          margin={
            isPrinting
              ? { top: 18, right: 12, left: 6, bottom: 6 }
              : { top: 20, right: 30, left: 0, bottom: 0 }
          }
        >
          <defs>
            <linearGradient id="colorApps" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis tick={axisStyle} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="value"
            name="申请数量"
            stroke="#2563eb"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorApps)"
            animationDuration={animationDuration}
            isAnimationActive={isAnimationActive}
            label={
              isPrinting
                ? false
                : {
                    position: 'top',
                    dy: -5,
                    fill: '#2563eb',
                    fontSize: 11,
                    fontWeight: 'bold',
                    formatter: (v: any) => v.toLocaleString(),
                  }
            }
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

// 2. 结果构成图 (Donut with Center Label)
export const ReportOutcomeChart: React.FC<ChartProps> = ({ data, isPrinting }) => {
  const current = data[data.length - 1];
  const animationDuration = isPrinting ? 0 : 1500;
  const isAnimationActive = !isPrinting;

  const pieData = [
    { name: '予以公开', value: current.applications.outcomes.public, color: '#10b981' },
    { name: '部分公开', value: current.applications.outcomes.partial, color: '#3b82f6' },
    { name: '无法提供', value: current.applications.outcomes.unable, color: '#94a3b8' },
    { name: '不予公开', value: current.applications.outcomes.notOpen, color: '#f43f5e' },
    { name: '其他处理', value: current.applications.outcomes.ignore, color: '#f59e0b' },
  ];

  return (
    <div className={chartContainerClass(isPrinting)}>
      <h4 className={chartTitleClass(isPrinting, true)}>图 2：{current.year}年度办理结果构成</h4>
      <ResponsiveContainer width="100%" height="90%" minWidth={0} minHeight={190}>
        <PieChart>
          <Pie
            data={pieData}
            cx="50%"
            cy={isPrinting ? '44%' : '50%'}
            innerRadius={isPrinting ? 42 : 50}
            outerRadius={isPrinting ? 58 : 65}
            paddingAngle={3}
            dataKey="value"
            animationDuration={animationDuration}
            isAnimationActive={isAnimationActive}
            stroke="none"
            label={isPrinting ? false : ({ name, value }) => `${name}: ${value}`}
            labelLine={!isPrinting}
          >
            {pieData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip />
          <Legend
            layout={isPrinting ? 'horizontal' : 'vertical'}
            verticalAlign={isPrinting ? 'bottom' : 'middle'}
            align={isPrinting ? 'center' : 'right'}
            iconType="circle"
            wrapperStyle={{
              fontSize: isPrinting ? '9px' : '10px',
              color: '#475569',
              paddingTop: isPrinting ? '10px' : 0,
            }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

// 3. 风险监测图 (Composed: Bar + Smooth Line)
export const ReportRiskChart: React.FC<ChartProps> = ({ data, isPrinting }) => {
  const axisStyle = isPrinting ? PRINT_AXIS_STYLE : AXIS_STYLE;
  const chartData = data.map((d) => {
    const disputes = d.disputes.reconsideration.total + d.disputes.litigation.total;
    const corrected = d.disputes.reconsideration.corrected + d.disputes.litigation.corrected;
    return {
      year: d.year,
      disputes: disputes,
      rate: disputes > 0 ? ((corrected / disputes) * 100).toFixed(1) : 0,
    };
  });
  return (
    <div className={chartContainerClass(isPrinting)}>
      <h4 className={chartTitleClass(isPrinting)}>图 5：行政争议总量与纠错率监测</h4>
      <ResponsiveContainer width="100%" height="85%" minWidth={0} minHeight={180}>
        <ComposedChart
          data={chartData}
          margin={
            isPrinting
              ? { top: 22, right: 30, left: 6, bottom: 10 }
              : { top: 30, right: 10, left: -20, bottom: 0 }
          }
        >
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="left"
            width={isPrinting ? 28 : undefined}
            tick={axisStyle}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="right"
            width={isPrinting ? 32 : undefined}
            orientation="right"
            tick={axisStyle}
            axisLine={false}
            tickLine={false}
            unit="%"
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{
              fontSize: isPrinting ? '9px' : '10px',
              paddingTop: isPrinting ? '8px' : 0,
            }}
          />
          <Bar
            yAxisId="left"
            dataKey="disputes"
            name="争议总量"
            fill="#cbd5e1"
            barSize={20}
            radius={[4, 4, 0, 0]}
            isAnimationActive={!isPrinting}
            animationDuration={isPrinting ? 0 : 1500}
          >
            {isPrinting ? null : (
              <LabelList
                dataKey="disputes"
                position="top"
                offset={5}
                style={{ fill: '#475569', fontSize: 11, fontWeight: 'bold' }}
              />
            )}
          </Bar>
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="rate"
            name="纠错率"
            stroke="#e11d48"
            strokeWidth={3}
            isAnimationActive={!isPrinting}
            animationDuration={isPrinting ? 0 : 1500}
            dot={{ r: 3, fill: '#e11d48', strokeWidth: 2, stroke: '#fff' }}
            label={
              isPrinting
                ? false
                : {
                    position: 'top',
                    dy: -10,
                    fill: '#e11d48',
                    fontSize: 11,
                    fontWeight: 'bold',
                    formatter: (val: any) => `${val}%`,
                    stroke: '#fff',
                    strokeWidth: 3,
                    paintOrder: 'stroke',
                  }
            }
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

// 4. 来源结构 (Stacked Bar)
export const ReportSourceChart: React.FC<ChartProps> = ({ data, isPrinting }) => {
  const axisStyle = isPrinting ? PRINT_AXIS_STYLE : AXIS_STYLE;
  const chartData = data.map((d) => ({
    year: d.year,
    natural: d.applications.sources.natural,
    legal: d.applications.sources.legal,
  }));
  const animationDuration = isPrinting ? 0 : 1500;
  const isAnimationActive = !isPrinting;

  return (
    <div className={chartContainerClass(isPrinting)}>
      <h4 className={chartTitleClass(isPrinting)}>图 3：申请人来源结构（自然人 vs 法人）</h4>
      <ResponsiveContainer width="100%" height="85%" minWidth={0} minHeight={180}>
        <BarChart
          data={chartData}
          margin={
            isPrinting
              ? { top: 18, right: 10, left: 6, bottom: 8 }
              : { top: 20, right: 10, left: -20, bottom: 0 }
          }
        >
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis
            width={isPrinting ? 28 : undefined}
            tick={axisStyle}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{
              fontSize: isPrinting ? '9px' : '10px',
              paddingTop: isPrinting ? '8px' : 0,
            }}
          />
          <Bar
            dataKey="natural"
            name="自然人"
            stackId="a"
            fill="#60a5fa"
            barSize={24}
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
          >
            {isPrinting ? null : (
              <LabelList
                dataKey="natural"
                position="inside"
                style={{
                  fill: '#000',
                  fontSize: 11,
                  fontWeight: 'bold',
                  textShadow: '0 0 2px #fff',
                }}
                formatter={(v: any) => (v > 50 ? v : '')}
              />
            )}
          </Bar>
          <Bar
            dataKey="legal"
            name="法人/其他"
            stackId="a"
            fill="#1e40af"
            barSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
          >
            {isPrinting ? null : (
              <LabelList
                dataKey="legal"
                position="inside"
                style={{
                  fill: '#000',
                  fontSize: 11,
                  fontWeight: 'bold',
                  textShadow: '0 0 2px #fff',
                }}
                formatter={(v: any) => (v > 50 ? v : '')}
              />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

// 5. 许可处罚对比 (Dual Line)
const CustomizedLineLabel = (props: any) => {
  const { x, y, value, index, total, dy, fill, formatter } = props;

  // 首尾点水平偏移，避免与坐标轴重叠
  let dx = 0;
  if (index === 0) dx = 25;
  if (index === total - 1) dx = -25;

  return (
    <text
      x={x}
      y={y}
      dy={dy}
      dx={dx}
      fill={fill}
      fontSize={11}
      fontWeight="bold"
      textAnchor="middle"
      stroke="#fff"
      strokeWidth={3}
      paintOrder="stroke"
    >
      {formatter ? formatter(value) : value}
    </text>
  );
};

export const ReportAdminActionChart: React.FC<ChartProps> = ({ data, isPrinting }) => {
  const axisStyle = isPrinting ? PRINT_AXIS_STYLE : AXIS_STYLE;
  const chartData = data.map((d) => ({
    year: d.year,
    licensing: d.adminActions.licensing,
    punishment: d.adminActions.punishment,
  }));
  const animationDuration = isPrinting ? 0 : 1500;
  const isAnimationActive = !isPrinting;

  return (
    <div className={chartContainerClass(isPrinting, 'h-80')}>
      <h4 className={chartTitleClass(isPrinting)}>图 4：行政许可与行政处罚趋势对比</h4>
      <ResponsiveContainer width="100%" height="85%" minWidth={0} minHeight={220}>
        <LineChart
          data={chartData}
          margin={
            isPrinting
              ? { top: 18, right: 46, left: 12, bottom: 18 }
              : { top: 24, right: 18, left: 0, bottom: 0 }
          }
        >
          <CartesianGrid {...GRID_STYLE} vertical={false} />
          <XAxis dataKey="year" tick={axisStyle} axisLine={false} tickLine={false} />
          <YAxis
            yAxisId="left"
            width={isPrinting ? 38 : undefined}
            tick={axisStyle}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (v >= 10000 ? `${(v / 10000).toFixed(0)}万` : v)}
          />
          <YAxis
            yAxisId="right"
            width={isPrinting ? 42 : undefined}
            orientation="right"
            tick={axisStyle}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => (v >= 10000 ? `${(v / 10000).toFixed(0)}万` : v)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="bottom"
            align="center"
            wrapperStyle={{
              fontSize: isPrinting ? '9px' : '10px',
              paddingTop: isPrinting ? '10px' : 0,
            }}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="licensing"
            name="行政许可(左轴)"
            stroke="#10b981"
            strokeWidth={3}
            dot={
              isPrinting ? { r: 2, fill: '#10b981', stroke: '#ffffff', strokeWidth: 1.5 } : false
            }
            label={
              isPrinting
                ? false
                : {
                    content: (props: any) => (
                      <CustomizedLineLabel
                        {...props}
                        total={chartData.length}
                        dy={25}
                        fill="#10b981"
                        formatter={(v: any) => `${(v / 10000).toFixed(1)}万`}
                      />
                    ),
                  }
            }
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="punishment"
            name="行政处罚(右轴)"
            stroke="#f59e0b"
            strokeWidth={3}
            dot={
              isPrinting ? { r: 2, fill: '#f59e0b', stroke: '#ffffff', strokeWidth: 1.5 } : false
            }
            label={
              isPrinting
                ? false
                : {
                    content: (props: any) => (
                      <CustomizedLineLabel
                        {...props}
                        total={chartData.length}
                        dy={-20}
                        fill="#f59e0b"
                        formatter={(v: any) => `${(v / 10000).toFixed(1)}万`}
                      />
                    ),
                  }
            }
            isAnimationActive={isAnimationActive}
            animationDuration={animationDuration}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};

// 6. 雷达图
export const ReportBenchmarkRadar: React.FC<BenchmarkProps> = ({ entity, avgProfile }) => {
  const year = 2024;
  const d = entity.data.find((x) => x.year === year)!;
  const avg = avgProfile.data.find((x) => x.year === year)!;

  const normalize = (val: number, max: number) => Math.min(100, (val / max) * 100);

  const radarData = [
    {
      subject: '依申请受理量',
      A: normalize(d.applications.newReceived, 2000),
      B: normalize(avg.applications.newReceived, 2000),
      fullMark: 100,
    },
    {
      subject: '主动公开量',
      A: normalize(d.regulations.published + d.normativeDocuments.published, 50),
      B: normalize(avg.regulations.published + avg.normativeDocuments.published, 50),
      fullMark: 100,
    },
    {
      subject: '法治安全度',
      A: 100 - (d.disputes.litigation.corrected / (d.disputes.litigation.total || 1)) * 100,
      B: 100 - (avg.disputes.litigation.corrected / (avg.disputes.litigation.total || 1)) * 100,
      fullMark: 100,
    },
    {
      subject: '办理效率',
      A: 100 - normalize(d.applications.carriedForward, 100),
      B: 100 - normalize(avg.applications.carriedForward, 100),
      fullMark: 100,
    },
    { subject: '平台响应', A: 90, B: 85, fullMark: 100 },
  ];

  return (
    <div className={chartContainerClass(true)}>
      <h4 className={chartTitleClass(true, true)}>图 6：{year}年度区域竞争力雷达</h4>
      <ResponsiveContainer width="100%" height="90%" minWidth={0} minHeight={190}>
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: '#475569', fontSize: 11 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            name="本单位"
            dataKey="A"
            stroke="#3b82f6"
            strokeWidth={2}
            fill="#3b82f6"
            fillOpacity={0.2}
          />
          <Radar
            name="全省均值"
            dataKey="B"
            stroke="#94a3b8"
            strokeWidth={1}
            fill="transparent"
            strokeDasharray="3 3"
          />
          <Legend wrapperStyle={{ fontSize: '10px' }} />
          <Tooltip />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
};
