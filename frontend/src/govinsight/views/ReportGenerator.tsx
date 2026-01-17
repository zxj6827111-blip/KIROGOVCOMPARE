import React, { useContext, useState, useEffect, useRef } from 'react';
import { EntityContext } from '../components/Layout';
import { provinceAvg } from '../data';
import {
  Printer, Sparkles, Target,
  TrendingUp, AlertOctagon, CheckCircle2, Bot, Cpu, Settings,
  Server, Shield, Activity, X, Zap, BrainCircuit, AlertTriangle, FileDown, Bookmark
} from 'lucide-react';
import {
  ReportTrendChart, ReportOutcomeChart, ReportRiskChart, ReportSourceChart, ReportAdminActionChart
} from '../components/ReportCharts';
import {
  generateExecutiveSummary,
  generateStatusCritique,
  generateFutureWorkPlan
} from '../utils/narrativeEngine';
import { GoogleGenAI, Type } from "@google/genai";

// Define the response schema structure for Gemini
interface GeminiReportResponse {
  summary: string;
  critique: {
    strengths: string[];
    weaknesses: string[];
  };
  futurePlan: {
    title: string;
    content: string;
  }[];
}

export const ReportGenerator: React.FC = () => {
  const { entity } = useContext(EntityContext);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportData, setReportData] = useState<GeminiReportResponse | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<number | null>(null);

  // Engine Selection State
  const [engine, setEngine] = useState<'rule' | 'gemini'>('rule');

  // Real Configuration State
  const [modelConfig, setModelConfig] = useState({
    deployment: 'cloud', // Default to cloud for Gemini
    model: 'gemini-3-flash-preview', // Default to Flash for speed
    thinkingBudget: 0 // Default 0 for Flash
  });

  // Timer Logic
  useEffect(() => {
    if (isGenerating) {
      setElapsedTime(0);
      timerRef.current = window.setInterval(() => {
        setElapsedTime(prev => prev + 0.1);
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isGenerating]);

  // Dynamic Year Calculation
  const sortedYears = entity?.data ? entity.data.map(d => d.year).sort((a, b) => b - a) : [];
  const year = sortedYears[0];
  const current = entity?.data ? entity.data.find(d => d.year === year) : null;

  // Robust check for previous year (might not exist)
  const prev = entity?.data?.find(d => d.year === year - 1) || {
    ...current,
    year: year - 1,
    applications: {
      newReceived: 0,
      totalHandled: 1,
      outcomes: { public: 0, partial: 0, unable: 0, notOpen: 0, ignore: 0 },
      sources: { natural: 0, legal: 0 }
    },
    disputes: { reconsideration: { total: 0, corrected: 0 }, litigation: { total: 0, corrected: 0 } }
  } as any;

  const fmt = (n: number) => n.toLocaleString();
  const diffPct = (curr: number, last: number) => {
    if (last === 0) return 'N/A';
    const p = ((curr - last) / last) * 100;
    return `${p > 0 ? '+' : ''}${p.toFixed(1)}%`;
  };

  if (!current) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-center bg-white rounded-lg border border-dashed border-slate-300">
        <h3 className="text-lg font-bold text-slate-800">无法生成报告</h3>
        <p className="text-slate-500 mt-2">选定单位尚未关联年度统计数据，请先完成数据解析工作。</p>
      </div>
    );
  }

  // --- Actions ---

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadMarkdown = () => {
    if (!reportData) return;

    const date = new Date().toLocaleDateString();
    let md = `# ${year}年度政务公开工作绩效评估与风险研判报告\n`;
    md += `**评估对象**: ${entity?.name || '未知单位'}\n`;
    md += `**生成时间**: ${date}\n`;
    md += `**生成引擎**: ${engine === 'gemini' ? modelConfig.model : 'GovGPT-Pro (Local)'}\n\n`;

    md += `## 一、总体研判与核心指标\n\n${reportData.summary}\n\n`;

    md += `## 二、专家深度点评\n\n`;
    md += `### 亮点与成绩\n`;
    reportData.critique?.strengths?.forEach(s => md += `- ${s.replace(/<[^>]*>?/gm, '')}\n`); // simple strip tags
    md += `\n### 短板与不足\n`;
    reportData.critique?.weaknesses?.forEach(w => md += `- ${w.replace(/<[^>]*>?/gm, '')}\n`);

    md += `\n## 三、${year + 1}年工作计划建议\n\n`;
    reportData.futurePlan?.forEach((p, i) => {
      md += `### ${i + 1}. ${p.title}\n${p.content}\n\n`;
    });

    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${entity?.name || '评估报告'}_${year}_评估报告.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // --- Real Gemini Generation Logic ---
  const generateWithGemini = async () => {
    setIsGenerating(true);
    setReportData(null);

    // Timeout Limit (10 min for Pro/Thinking, 3 min for Flash)
    const TIMEOUT_LIMIT = modelConfig.model.includes('pro') ? 600000 : 180000;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const dataContext = JSON.stringify({
        entityName: entity?.name || '未知单位',
        currentYear: current,
        previousYear: prev.applications.totalHandled > 1 ? prev : "无上年数据",
        provinceAverage: provinceAvg.data.find((d: any) => d.year === year)
      });

      // UPGRADED PROMPT FOR RICHER CONTENT
      const prompt = `
        角色设定：你是由省政府办公厅聘请的第三方绩效评估专家组组长，具有深厚的法学背景和公共管理经验。
        任务：请根据提供的JSON数据，为"${entity?.name || '未知单位'}"撰写一份《${year}年度政务公开工作绩效评估与法治风险研判专报》。

        **核心要求：**
        1. **文风要求**：必须使用标准的中国政府公文语体（如：倒逼机制、源头治理、提质增效、常态化、制度性交易成本）。避免口语化，语气要客观、犀利、有深度。
        2. **深度思考（CoT）**：
           - 不要只罗列数字，要分析数字背后的行政行为逻辑。
           - 例如：如果申请量大但公开率低，要分析是否存在“滥用不予公开条款”的风险。
           - 例如：如果败诉率高，要反推是业务部门源头执法不规范，还是法制审核缺位。
           - 对比“全省均值”数据，明确该单位在全省的位次。

        **输出结构要求（请严格按照JSON Schema输出）：**

        1. **summary (总体研判)**：
           - 字数要求：**500字以上**。
           - 结构建议：
             - 第一段（基本面）：概括全年工作体量（申请量、办件量），用“稳中有进”、“压力激增”等词定性。
             - 第二段（质效分析）：结合公开率、结转率，评价办理质量。
             - 第三段（风险研判）：重点分析复议诉讼数据，指出法治风险点。
             - 第四段（结论）：给出年度总体评分倾向（优/良/中/差）。
           - 必须包含同比数据分析。

        2. **critique (专家点评)**：
           - **strengths (亮点)**：列出2-3个成效最显著的领域。不仅要说数据好，还要说这意味着什么（如：优化了营商环境、保障了群众知情权）。每个亮点约100字。
           - **weaknesses (不足)**：列出2-3个深层次问题。语言要犀利，直击痛点（如：程序空转、形式主义、避责思维）。每个短板约100字。

        3. **futurePlan (下一步建议)**：
           - 列出3条高优先级的整改建议。
           - **Title**：必须是四字或六字对仗短语（如“强化源头治理”、“重塑审核机制”）。
           - **Content**：具体的实施路径、抓手和预期目标。不要泛泛而谈，要提到具体机制（如：联席会议、案卷评查、红黑榜）。

        数据上下文：${dataContext}
      `;

      let requestConfig: any = {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            critique: {
              type: Type.OBJECT,
              properties: {
                strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
                weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
              }
            },
            futurePlan: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  content: { type: Type.STRING },
                }
              }
            }
          }
        }
      };

      if (modelConfig.model === 'gemini-3-pro-preview' && modelConfig.thinkingBudget > 0) {
        requestConfig.thinkingConfig = { thinkingBudget: modelConfig.thinkingBudget };
      }

      // Create a timeout promise to race against the API
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), TIMEOUT_LIMIT)
      );

      const apiCall = ai.models.generateContent({
        model: modelConfig.model,
        contents: prompt,
        config: requestConfig
      });

      // Execute with Timeout Protection
      const response = await Promise.race([apiCall, timeoutPromise]) as any;

      if (response.text) {
        const result = JSON.parse(response.text) as GeminiReportResponse;
        setReportData(result);
      }
    } catch (error: any) {
      console.error("Gemini Generation Failed:", error);

      let errorMsg = "生成失败";
      let errorDetail = "未知错误";

      if (error.message === "TIMEOUT") {
        errorMsg = "请求超时";
        errorDetail = `模型在 ${TIMEOUT_LIMIT / 1000} 秒内未响应。Gemini Pro 思维链模式可能需要较长时间(3-10分钟)，请检查网络是否稳定，或切换至 'Flash' 模型以获得更快速度。`;
      } else if (error.message.includes("fetch") || error.message.includes("Network")) {
        errorMsg = "网络连接失败";
        errorDetail = "无法连接到 Google API。请确保您的网络环境支持访问 'generativelanguage.googleapis.com' (通常需要VPN/代理)。";
      } else if (error.message.includes("API key")) {
        errorMsg = "API Key 无效";
        errorDetail = "请检查环境变量中的 API_KEY 是否正确配置。";
      }

      alert(`⚠️ ${errorMsg}\n\n${errorDetail}\n\n已为您自动切换回本地规则引擎，以保证演示继续。`);

      // Fallback to rule engine so user is not stuck with nothing
      setEngine('rule');
      handleGenerateRuleBased();
    } finally {
      setIsGenerating(false);
    }
  };

  // --- Rule-Based Generation Logic (Legacy) ---
  const handleGenerateRuleBased = () => {
    setIsGenerating(true);
    setTimeout(() => {
      setReportData({
        summary: generateExecutiveSummary(entity!, year),
        critique: generateStatusCritique(entity!, year),
        futurePlan: generateFutureWorkPlan(entity!, year)
      });
      setIsGenerating(false);
    }, 800); // Faster mock
  };

  const handleGenerate = () => {
    if (engine === 'gemini') {
      generateWithGemini();
    } else {
      handleGenerateRuleBased();
    }
  };

  const RenderText = ({ text }: { text: string }) => {
    if (!text) return null;
    const parts = text.split(/(\*\*.*?\*\*)/g);
    return (
      <span>
        {parts.map((part, i) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={i} className="font-bold text-slate-900">{part.slice(2, -2)}</strong>;
          }
          return <span key={i}>{part}</span>;
        })}
      </span>
    );
  };

  const SummaryTable = () => (
    <div className="mb-8 break-inside-avoid bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center mb-4 border-b border-slate-100 pb-2">
        <Target className="w-4 h-4 text-indigo-700 mr-2" />
        <h4 className="text-sm font-bold text-slate-800">{year} 年度核心指标监测卡</h4>
      </div>
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="text-slate-500 bg-slate-50/50">
            <th className="py-2 text-left font-semibold pl-2 rounded-l">监测指标</th>
            <th className="py-2 text-right font-semibold">本年实绩</th>
            <th className="py-2 text-right font-semibold">上年同期</th>
            <th className="py-2 text-right font-semibold">同比变化</th>
            <th className="py-2 text-center font-semibold rounded-r">状态评估</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
            <td className="py-3 pl-2 font-medium text-slate-700">依申请公开新收量 (件)</td>
            <td className="py-3 text-right font-bold text-slate-900">{fmt(current.applications.newReceived)}</td>
            <td className="py-3 text-right text-slate-500">{prev.applications.newReceived > 0 ? fmt(prev.applications.newReceived) : '-'}</td>
            <td className={`py-3 text-right font-medium ${current.applications.newReceived > prev.applications.newReceived ? 'text-rose-600' : 'text-emerald-600'}`}>
              {diffPct(current.applications.newReceived, prev.applications.newReceived)}
            </td>
            <td className="py-3 text-center">
              <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${current.applications.newReceived > prev.applications.newReceived * 1.2 ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                {current.applications.newReceived > prev.applications.newReceived * 1.2 ? '压力激增' : '平稳运行'}
              </span>
            </td>
          </tr>
          <tr className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
            <td className="py-3 pl-2 font-medium text-slate-700">实质性公开率 (%)</td>
            <td className="py-3 text-right font-bold text-slate-900">
              {(((current.applications.outcomes?.public || 0) + (current.applications.outcomes?.partial || 0)) / (current.applications.totalHandled || 1) * 100).toFixed(1)}%
            </td>
            <td className="py-3 text-right text-slate-500">
              {prev.applications.totalHandled > 1 ? ((prev.applications.outcomes.public + prev.applications.outcomes.partial) / prev.applications.totalHandled * 100).toFixed(1) + '%' : '-'}
            </td>
            <td className="py-3 text-right text-slate-600">
              {diffPct((current.applications.outcomes.public + current.applications.outcomes.partial) / current.applications.totalHandled, (prev.applications.outcomes.public + prev.applications.outcomes.partial) / prev.applications.totalHandled)}
            </td>
            <td className="py-3 text-center"><span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded text-[10px] font-medium">稳定</span></td>
          </tr>
          <tr>
            <td className="py-3 pl-2 font-medium text-slate-700">复议诉讼纠错率 (%)</td>
            <td className="py-3 text-right font-bold text-slate-900">
              {(((current.disputes?.reconsideration?.corrected || 0) + (current.disputes?.litigation?.corrected || 0)) / (current.disputes?.reconsideration?.total + (current.disputes?.litigation?.total || 0) || 1) * 100).toFixed(1)}%
            </td>
            <td className="py-3 text-right text-slate-500">
              {prev.applications.totalHandled > 1 ? ((prev.disputes.reconsideration.corrected + prev.disputes.litigation.corrected) / (prev.disputes.reconsideration.total + prev.disputes.litigation.total || 1) * 100).toFixed(1) + '%' : '-'}
            </td>
            <td className="py-3 text-right text-rose-600 font-medium">
              {(() => {
                const curr = (current.disputes.reconsideration.corrected + current.disputes.litigation.corrected) / (current.disputes.reconsideration.total + current.disputes.litigation.total || 1) * 100;
                const last = (prev.disputes.reconsideration.corrected + prev.disputes.litigation.corrected) / (prev.disputes.reconsideration.total + prev.disputes.litigation.total || 1) * 100;
                const d = curr - last;
                return d > 0 ? `+${d.toFixed(1)} pp` : `${d.toFixed(1)} pp`;
              })()}
            </td>
            <td className="py-3 text-center">
              <span className="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded text-[10px] font-medium">需关注</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex gap-6 h-full font-sans text-slate-800 relative">

      {/* Configuration Modal */}
      {showConfig && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200 no-print">
          <div className="bg-white rounded-xl shadow-2xl w-[500px] border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h3 className="font-bold text-slate-800 flex items-center">
                <Settings className="w-5 h-5 mr-2 text-indigo-600" />
                大模型算力配置 (AI Configuration)
              </h3>
              <button onClick={() => setShowConfig(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-6">

              {/* Deployment Mode */}
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">部署模式 (Deployment)</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setModelConfig({ ...modelConfig, deployment: 'local' })}
                    className={`p-3 rounded-lg border text-sm font-medium flex items-center justify-center ${modelConfig.deployment === 'local' ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Server className="w-4 h-4 mr-2" />
                    本地私有化部署
                  </button>
                  <button
                    onClick={() => {
                      setModelConfig({ ...modelConfig, deployment: 'cloud' });
                      setEngine('gemini');
                    }}
                    className={`p-3 rounded-lg border text-sm font-medium flex items-center justify-center ${modelConfig.deployment === 'cloud' ? 'border-indigo-600 bg-indigo-50 text-indigo-700 ring-1 ring-indigo-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <Bot className="w-4 h-4 mr-2" />
                    政务云API调用
                  </button>
                </div>
              </div>

              {/* Model Selection */}
              <div>
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">模型内核 (Base Model)</label>
                <select
                  className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                  value={modelConfig.model}
                  onChange={(e) => {
                    const m = e.target.value;
                    // Auto-adjust thinking budget based on model
                    const budget = m === 'gemini-3-pro-preview' ? 1024 : 0;
                    setModelConfig({ ...modelConfig, model: m, thinkingBudget: budget });
                  }}
                >
                  <option value="gemini-3-flash-preview">Gemini 3.0 Flash (极速/推荐)</option>
                  <option value="gemini-3-pro-preview">Gemini 3.0 Pro (深度思考/较慢)</option>
                </select>
                <p className="mt-2 text-xs text-slate-500">
                  {modelConfig.model === 'gemini-3-flash-preview'
                    ? '⚡ 适用于实时演示，平均耗时 3-5秒。'
                    : '🐢 适用于复杂公文写作，含思维链推演，平均耗时 30-180秒。'}
                </p>
              </div>

              {/* Hardware Stats Simulation */}
              <div className="bg-slate-900 rounded-lg p-4 text-slate-300 font-mono text-xs">
                <div className="flex justify-between items-center mb-3 border-b border-slate-700 pb-2">
                  <span className="text-slate-400">HARDWARE MONITOR</span>
                  <span className="text-emerald-400 flex items-center"><Activity className="w-3 h-3 mr-1" /> ONLINE</span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>MODEL:</span>
                    <span className="text-white">{modelConfig.model}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>THINKING BUDGET:</span>
                    <span className={modelConfig.thinkingBudget > 0 ? "text-yellow-400" : "text-slate-500"}>
                      {modelConfig.thinkingBudget > 0 ? `${modelConfig.thinkingBudget} Tokens` : 'DISABLED'}
                    </span>
                  </div>
                </div>
              </div>

            </div>
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                onClick={() => setShowConfig(false)}
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700"
              >
                确认生效
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Control Panel & Model Info (Hidden on Print) */}
      <div className="w-72 flex-shrink-0 flex flex-col gap-4 no-print">

        {/* Engine Switcher */}
        <div className="bg-white p-1 rounded-lg border border-slate-200 shadow-sm flex">
          <button
            onClick={() => setEngine('rule')}
            className={`flex-1 flex items-center justify-center py-2 text-xs font-bold rounded-md transition-all ${engine === 'rule' ? 'bg-slate-800 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <Server className="w-3 h-3 mr-1.5" />
            规则引擎
          </button>
          <button
            onClick={() => {
              setEngine('gemini');
              setModelConfig(c => ({ ...c, deployment: 'cloud' }));
            }}
            className={`flex-1 flex items-center justify-center py-2 text-xs font-bold rounded-md transition-all ${engine === 'gemini' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <BrainCircuit className="w-3 h-3 mr-1.5" />
            AI 大模型
          </button>
        </div>

        {/* Model Info Card */}
        <div className={`p-4 rounded-lg shadow-md border relative group transition-colors duration-300 ${engine === 'gemini' ? 'bg-indigo-900 border-indigo-700' : 'bg-slate-800 border-slate-700'}`}>
          <button
            onClick={() => setShowConfig(true)}
            className="absolute top-3 right-3 p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="算力配置"
          >
            <Settings className="w-4 h-4" />
          </button>

          <div className="flex items-center mb-3">
            <Cpu className={`w-5 h-5 mr-2 ${engine === 'gemini' ? 'text-pink-400' : 'text-indigo-400'}`} />
            <h3 className="font-bold text-white text-sm">
              {engine === 'gemini' ? '云端算力全开' : '本地模型运行中'}
            </h3>
          </div>
          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between items-center">
              <span>当前内核:</span>
              <span className={`font-mono font-bold truncate max-w-[130px] ${engine === 'gemini' ? 'text-pink-300' : 'text-indigo-300'}`} title={modelConfig.model}>
                {engine === 'gemini' ? modelConfig.model : 'GovGPT-Pro (Local)'}
              </span>
            </div>
            {engine === 'gemini' && (
              <div className="flex justify-between">
                <span>思维链 (CoT):</span>
                <span className={`${modelConfig.thinkingBudget > 0 ? 'text-emerald-400' : 'text-slate-500'} flex items-center`}>
                  <Zap className="w-3 h-3 mr-1 fill-current" />
                  {modelConfig.thinkingBudget > 0 ? 'ON' : 'OFF'}
                </span>
              </div>
            )}
            {/* Network Status Warning if slow */}
            {isGenerating && elapsedTime > 5 && engine === 'gemini' && (
              <div className="flex items-center text-yellow-400 mt-2 animate-pulse">
                <AlertTriangle className="w-3 h-3 mr-1" />
                <span>等待响应...</span>
              </div>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-white/10 text-[10px] text-slate-400 leading-tight">
            {engine === 'gemini'
              ? '* 数据加密传输至 Google Vertex AI。请确保网络环境支持 API 连接。'
              : '* 数据存储于本地机房，符合《政务数据安全管理条例》。'}
          </div>
        </div>

        <div className="bg-white p-5 rounded-lg shadow-sm border border-slate-200">
          <div className="flex items-center mb-4">
            <div className={`p-2 rounded-lg mr-3 shadow-md ${engine === 'gemini' ? 'bg-gradient-to-br from-pink-500 to-indigo-600 shadow-indigo-200' : 'bg-slate-700 shadow-slate-200'}`}>
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800">智能辅策生成器</h3>
              <p className="text-xs text-slate-500">
                {engine === 'gemini' ? '专家级深度分析模式' : '标准版报告生成模式'}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-600 space-y-2">
              <p className="font-bold text-slate-800">本次生成策略:</p>
              {engine === 'gemini' ? (
                <>
                  <div className="flex items-center text-indigo-700 font-medium"><CheckCircle2 className="w-3 h-3 text-pink-500 mr-1" /> 复杂归因逻辑推演</div>
                  <div className="flex items-center text-indigo-700 font-medium"><CheckCircle2 className="w-3 h-3 text-pink-500 mr-1" /> 政治话语体系润色</div>
                </>
              ) : (
                <>
                  <div className="flex items-center"><CheckCircle2 className="w-3 h-3 text-slate-400 mr-1" /> 基础数据同比分析</div>
                  <div className="flex items-center"><CheckCircle2 className="w-3 h-3 text-slate-400 mr-1" /> 预设规则风险研判</div>
                </>
              )}
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`w-full py-3 rounded-lg text-sm font-bold text-white transition-all shadow-md active:scale-95 flex items-center justify-center relative overflow-hidden ${isGenerating
                ? 'bg-slate-400 cursor-not-allowed'
                : (engine === 'gemini' ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-lg hover:shadow-indigo-200' : 'bg-slate-800 hover:bg-slate-900')
                }`}
            >
              {isGenerating ? (
                <>
                  <Sparkles className="w-4 h-4 mr-2 animate-spin" />
                  <span className="mr-1">{engine === 'gemini' ? '思考中' : '生成中'}</span>
                  <span className={`font-mono px-1.5 rounded text-xs ml-1 min-w-[30px] text-center ${elapsedTime > 30 ? 'bg-red-500/20 text-red-100' : 'bg-black/10'}`}>
                    {elapsedTime.toFixed(1)}s
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" /> 开始生成报告
                </>
              )}
            </button>
          </div>
        </div>

        {reportData && (
          <div className="bg-white p-5 rounded-lg shadow-sm border border-slate-200 flex-1 overflow-y-auto">
            <h4 className="text-xs font-bold text-slate-400 uppercase mb-4 tracking-wider">目录导航</h4>
            <ul className="space-y-1 text-xs text-slate-600">
              {['核心指标监测', '一、总体研判', '二、专家深度点评', '三、图表可视分析', '四、下一步计划', '附录：统计台账'].map((item, i) => (
                <li key={i} className="flex items-center p-2 rounded hover:bg-slate-50 cursor-pointer transition-colors group">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mr-2 group-hover:bg-indigo-500 transition-colors"></div>
                  <span className="group-hover:text-indigo-700 font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* A4 Preview Area */}
      <div className="flex-1 bg-slate-200 overflow-y-auto p-8 flex justify-center shadow-inner rounded-xl scroll-smooth">
        {reportData ? (
          <div id="printable-report" className="bg-white w-[210mm] min-h-[297mm] shadow-2xl text-slate-800 leading-relaxed animate-in fade-in zoom-in-95 duration-500 flex flex-col relative group">

            {/* Download Toolbar (Visible only on hover, hidden on print) */}
            <div className="absolute top-4 right-4 flex space-x-2 no-print opacity-0 group-hover:opacity-100 transition-opacity z-10 bg-white/90 p-2 rounded-lg shadow border border-slate-200 backdrop-blur-sm">
              <button
                onClick={handleDownloadMarkdown}
                className="flex items-center px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                title="下载可编辑文件 (.md)"
              >
                <FileDown className="w-4 h-4 mr-1.5" />
                下载源文件
              </button>
              <div className="w-px bg-slate-300 h-6"></div>
              <button
                onClick={handlePrint}
                className="flex items-center px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded shadow-sm transition-colors"
                title="打开打印窗口，选择'另存为PDF'"
              >
                <Printer className="w-4 h-4 mr-1.5" />
                打印 / 存为PDF
              </button>
            </div>

            {/* --- Cover Page --- */}
            <div className="min-h-[297mm] p-[25mm] flex flex-col justify-between relative border-b-2 border-slate-100 bg-gradient-to-br from-white to-slate-50/50 break-after-page">
              <div className="mt-24 text-center">
                <div className={`inline-flex items-center justify-center px-4 py-1.5 border rounded-full text-xs font-bold tracking-widest mb-12 uppercase ${engine === 'gemini' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                  Internal Reference · Decision Support
                </div>
                <h1 className="text-4xl font-extrabold text-slate-900 mb-6 tracking-tight leading-tight">
                  {year}年度政务公开工作<br />
                  <span className={engine === 'gemini' ? 'text-indigo-600' : 'text-slate-600'}>绩效评估与风险研判报告</span>
                </h1>
                <div className={`w-24 h-1.5 mx-auto rounded-full mb-8 ${engine === 'gemini' ? 'bg-indigo-600' : 'bg-slate-600'}`}></div>
                <h3 className="text-xl text-slate-500 font-medium">{entity?.name || '未知单位'}</h3>
              </div>

              <div className="mb-20 text-center text-sm space-y-3 text-slate-400 font-mono">
                <p>Generated by {engine === 'gemini' ? modelConfig.model : 'GovGPT-Pro (Local)'}</p>
                <p>Date: {new Date().toLocaleDateString()}</p>
                <p>ID: {(entity?.id || 'UNKNOWN').toUpperCase()}-{year}-V4</p>
              </div>
            </div>

            {/* --- Content Pages --- */}
            <div className="p-[25mm]">

              {/* 1. Executive Summary */}
              <section className="mb-12">
                <div className="flex items-center mb-6">
                  <span className={`flex items-center justify-center w-8 h-8 rounded-lg text-white font-bold mr-3 shadow-md font-mono ${engine === 'gemini' ? 'bg-indigo-600 shadow-indigo-200' : 'bg-slate-700 shadow-slate-200'}`}>01</span>
                  <h2 className="text-xl font-bold text-slate-900">总体研判与核心指标</h2>
                </div>

                <SummaryTable />

                <div className="relative p-8 bg-slate-50 rounded-xl border border-slate-200 text-justify text-sm leading-8 text-slate-700">
                  {/* Decorative Quote Icon */}
                  <div className="absolute top-4 left-4 text-slate-200 transform -scale-x-100">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="currentColor"><path d="M14.017 21L14.017 18C14.017 16.896 14.384 16.035 15.118 15.417C15.852 14.8 16.875 14.491 18.188 14.491L18.785 14.491L18.785 12.592C18.785 11.896 18.575 11.235 18.156 10.609C17.737 9.984 17.151 9.671 16.4 9.671L15.939 9.671L15.939 6.811L16.273 6.811C17.788 6.811 19.043 7.324 20.038 8.35C21.033 9.376 21.531 10.749 21.531 12.469L21.531 21L14.017 21ZM5 21L5 18C5 16.896 5.367 16.035 6.101 15.417C6.835 14.8 7.858 14.491 9.171 14.491L9.768 14.491L9.768 12.592C9.768 11.896 9.558 11.235 9.139 10.609C8.72 9.984 8.134 9.671 7.383 9.671L6.922 9.671L6.922 6.811L7.256 6.811C8.771 6.811 10.026 7.324 11.021 8.35C12.016 9.376 12.514 10.749 12.514 12.469L12.514 21L5 21Z" /></svg>
                  </div>
                  <div className="relative z-10 whitespace-pre-line">
                    <RenderText text={reportData.summary} />
                  </div>
                </div>
              </section>

              {/* 2. Expert Critique */}
              <section className="mb-12 break-inside-avoid">
                <div className="flex items-center mb-6">
                  <span className={`flex items-center justify-center w-8 h-8 rounded-lg text-white font-bold mr-3 shadow-md font-mono ${engine === 'gemini' ? 'bg-indigo-600 shadow-indigo-200' : 'bg-slate-700 shadow-slate-200'}`}>02</span>
                  <h2 className="text-xl font-bold text-slate-900">专家深度点评</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Strengths */}
                  <div>
                    <h4 className="flex items-center text-emerald-700 font-bold mb-4 pb-2 border-b-2 border-emerald-100">
                      <TrendingUp className="w-5 h-5 mr-2" /> 亮点与成绩
                    </h4>
                    <ul className="space-y-4">
                      {reportData.critique?.strengths?.map((s: string, i: number) => (
                        <li key={i} className="flex items-start text-sm leading-6 text-slate-700 bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                          <CheckCircle2 className="w-5 h-5 mr-3 mt-0.5 text-emerald-500 flex-shrink-0" />
                          <span dangerouslySetInnerHTML={{ __html: s }}></span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Weaknesses */}
                  <div>
                    <h4 className="flex items-center text-rose-700 font-bold mb-4 pb-2 border-b-2 border-rose-100">
                      <AlertOctagon className="w-5 h-5 mr-2" /> 短板与不足
                    </h4>
                    <ul className="space-y-4">
                      {reportData.critique?.weaknesses?.map((w: string, i: number) => (
                        <li key={i} className="flex items-start text-sm leading-6 text-slate-700 bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                          <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mr-3 mt-2 flex-shrink-0"></div>
                          <span dangerouslySetInnerHTML={{ __html: w }}></span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>

              {/* 3. Visual Analysis */}
              <section className="mb-12 break-inside-avoid">
                <div className="flex items-center mb-6">
                  <span className={`flex items-center justify-center w-8 h-8 rounded-lg text-white font-bold mr-3 shadow-md font-mono ${engine === 'gemini' ? 'bg-indigo-600 shadow-indigo-200' : 'bg-slate-700 shadow-slate-200'}`}>03</span>
                  <h2 className="text-xl font-bold text-slate-900">重点领域可视分析</h2>
                </div>

                <div className="grid grid-cols-2 gap-8 mb-8">
                  <ReportTrendChart data={entity?.data || []} />
                  <ReportSourceChart data={entity?.data || []} />
                  <ReportOutcomeChart data={entity?.data || []} />
                  <ReportRiskChart data={entity?.data || []} />
                </div>

                <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-inner">
                  <ReportAdminActionChart data={entity?.data || []} />
                </div>
              </section>

              {/* 4. Future Plan */}
              <section className="mb-12 break-inside-avoid">
                <div className="flex items-center mb-8">
                  <span className={`flex items-center justify-center w-8 h-8 rounded-lg text-white font-bold mr-3 shadow-md font-mono ${engine === 'gemini' ? 'bg-indigo-600 shadow-indigo-200' : 'bg-slate-700 shadow-slate-200'}`}>04</span>
                  <h2 className="text-xl font-bold text-slate-900">{year + 1}年 工作计划建议</h2>
                </div>

                <div className="space-y-6">
                  {reportData.futurePlan?.map((plan: any, idx: number) => (
                    <div key={idx} className="flex items-start p-5 bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                      <div className={`flex-shrink-0 w-10 h-10 rounded-full font-bold flex items-center justify-center text-lg mr-5 border ${engine === 'gemini' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                        {idx + 1}
                      </div>
                      <div>
                        <h4 className="text-base font-bold text-slate-800 mb-2">{plan.title}</h4>
                        <p className="text-sm text-slate-600 leading-relaxed">
                          {plan.content}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Appendix */}
              <section className="mb-10 break-before-page">
                <div className="text-center mb-10">
                  <h2 className="text-lg font-bold text-slate-900 border-b-2 border-slate-100 pb-3 inline-block px-12 uppercase tracking-widest">
                    附录：{year}年度政务公开工作统计台账
                  </h2>
                </div>

                {['规章规范性文件与行政管理', '政府信息公开依申请办理情况', '行政复议与诉讼情况'].map((title, i) => (
                  <div key={i} className="mb-10">
                    <div className="flex items-center mb-4">
                      <Bookmark className="w-4 h-4 text-indigo-400 mr-2" />
                      <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Table 0{i + 1} — {title}</h4>
                    </div>

                    {/* Clean Table Style */}
                    <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
                      {i === 0 && (
                        <table className="w-full text-xs text-center">
                          <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                            <tr>
                              <th className="py-3 border-r border-slate-200">规章制发</th>
                              <th className="py-3 border-r border-slate-200">规章现行</th>
                              <th className="py-3 border-r border-slate-200">规范性文件制发</th>
                              <th className="py-3 border-r border-slate-200">规范性文件现行</th>
                              <th className="py-3 border-r border-slate-200">行政许可</th>
                              <th className="py-3">行政处罚</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white text-slate-700">
                            <tr>
                              <td className="py-3 border-r border-slate-100">{current.regulations.published}</td>
                              <td className="py-3 border-r border-slate-100">{current.regulations.active}</td>
                              <td className="py-3 border-r border-slate-100">{current.normativeDocuments.published}</td>
                              <td className="py-3 border-r border-slate-100">{current.normativeDocuments.active}</td>
                              <td className="py-3 border-r border-slate-100">{fmt(current.adminActions.licensing)}</td>
                              <td className="py-3">{fmt(current.adminActions.punishment)}</td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                      {i === 1 && (
                        <table className="w-full text-xs text-center">
                          <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                            <tr>
                              <th className="py-3 border-r border-slate-200">新收申请</th>
                              <th className="py-3 border-r border-slate-200">上年结转</th>
                              <th className="py-3 border-r border-slate-200">自然人</th>
                              <th className="py-3 border-r border-slate-200">予以公开</th>
                              <th className="py-3 border-r border-slate-200">部分公开</th>
                              <th className="py-3 border-r border-slate-200">无法提供</th>
                              <th className="py-3">不予处理</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white text-slate-700">
                            <tr>
                              <td className="py-3 border-r border-slate-100">{fmt(current.applications.newReceived)}</td>
                              <td className="py-3 border-r border-slate-100">{current.applications.carriedOver}</td>
                              <td className="py-3 border-r border-slate-100">{fmt(current.applications.sources.natural)}</td>
                              <td className="py-3 border-r border-slate-100">{fmt(current.applications.outcomes.public)}</td>
                              <td className="py-3 border-r border-slate-100">{fmt(current.applications.outcomes.partial)}</td>
                              <td className="py-3 border-r border-slate-100">{fmt(current.applications.outcomes.unable)}</td>
                              <td className="py-3">{fmt(current.applications.outcomes.ignore)}</td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                      {i === 2 && (
                        <table className="w-full text-xs text-center">
                          <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                            <tr className="border-b border-slate-200">
                              <th className="py-2 border-r border-slate-200 bg-slate-100/50" colSpan={4}>行政复议</th>
                              <th className="py-2 bg-slate-100/50" colSpan={4}>行政诉讼</th>
                            </tr>
                            <tr>
                              <th className="py-2 border-r border-slate-200">总数</th>
                              <th className="py-2 border-r border-slate-200">纠错</th>
                              <th className="py-2 border-r border-slate-200">维持</th>
                              <th className="py-2 border-r border-slate-200">未结</th>
                              <th className="py-2 border-r border-slate-200">总数</th>
                              <th className="py-2 border-r border-slate-200">纠错</th>
                              <th className="py-2 border-r border-slate-200">维持</th>
                              <th className="py-2">未结</th>
                            </tr>
                          </thead>
                          <tbody className="bg-white text-slate-700">
                            <tr>
                              <td className="py-3 border-r border-slate-100">{current.disputes.reconsideration.total}</td>
                              <td className="py-3 border-r border-slate-100 font-bold text-rose-600">{current.disputes.reconsideration.corrected}</td>
                              <td className="py-3 border-r border-slate-100">{current.disputes.reconsideration.maintained}</td>
                              <td className="py-3 border-r border-slate-100">{current.disputes.reconsideration.pending}</td>
                              <td className="py-3 border-r border-slate-100">{current.disputes.litigation.total}</td>
                              <td className="py-3 border-r border-slate-100 font-bold text-rose-600">{current.disputes.litigation.corrected}</td>
                              <td className="py-3 border-r border-slate-100">{current.disputes.litigation.maintained}</td>
                              <td className="py-3">{current.disputes.litigation.pending}</td>
                            </tr>
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                ))}
              </section>

              {/* Footer */}
              <div className="pt-8 flex justify-between text-[10px] text-slate-400 border-t border-slate-200 font-mono">
                <span>CLASSIFICATION: INTERNAL USE ONLY</span>
                <span>GENERATED BY {engine === 'gemini' ? 'GOOGLE VERTEX AI' : 'GOVINSIGHT PRO'} v4.2</span>
              </div>
            </div>
          </div>
        ) : (
          /* Empty State */
          <div className="w-[210mm] min-h-[297mm] flex flex-col items-center justify-center text-slate-400 border border-dashed border-slate-300 rounded-xl bg-slate-50/50">
            <div className="bg-white p-6 rounded-full shadow-sm mb-6 ring-1 ring-slate-100">
              {engine === 'gemini' ? <BrainCircuit className="w-12 h-12 text-pink-500" /> : <Bot className="w-12 h-12 text-indigo-400" />}
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">准备生成决策报告</h3>
            <p className="max-w-md text-center text-sm text-slate-500 leading-relaxed">
              {engine === 'gemini' ? (
                <>
                  当前模式：<span className="font-semibold text-pink-600">Gemini 3.0 Pro (Thinking Mode)</span>
                  <br />将实时调用 Google Cloud 算力，进行深度逻辑推演，
                  <br />生成具备高政治站位与专业归因分析的报告。
                </>
              ) : (
                <>
                  当前模式：<span className="font-semibold text-indigo-600">GovGPT-Pro (Local Rules)</span>
                  <br />基于本地知识库与专家规则引擎，
                  <br />快速生成标准化的制式分析报告。
                </>
              )}
            </p>
            <button
              onClick={handleGenerate}
              disabled={isGenerating}
              className={`mt-8 px-8 py-3 text-white text-sm font-bold rounded-full shadow-lg transition-all active:scale-95 flex items-center ${engine === 'gemini'
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:shadow-indigo-300'
                : 'bg-slate-800 hover:bg-slate-900 shadow-slate-300'
                }`}
            >
              {isGenerating ? <Sparkles className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              {engine === 'gemini' ? '调用大模型生成' : '开始生成'}
            </button>
            {engine === 'gemini' && (
              <div className="mt-8 flex items-center space-x-4 text-xs text-slate-400">
                <span className="flex items-center"><Zap className="w-3 h-3 mr-1 text-yellow-500 fill-current" /> Thinking Enabled</span>
                <span className="flex items-center"><Shield className="w-3 h-3 mr-1 text-emerald-500" /> Enterprise Security</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};