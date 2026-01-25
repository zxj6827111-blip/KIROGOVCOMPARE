import React, { useState } from 'react';
import { Info, X, Calculator, Database, AlertCircle } from 'lucide-react';
import { DisclosureMethod, CorrectionMethod } from '../types';

interface MetricMethodBarProps {
    disclosureMethod: DisclosureMethod;
    correctionMethod: CorrectionMethod;
}

export const MetricMethodBar: React.FC<MetricMethodBarProps> = ({ disclosureMethod, correctionMethod }) => {
    const [showDetail, setShowDetail] = useState(false);

    const labels = {
        disclosure: disclosureMethod === 'substantive' ? '(公开+部分公开)/办结' : '公开/办结',
        correction: correctionMethod === 'reconsideration' ? '复议纠错' : '综合纠错(复议+诉讼)'
    };

    return (
        <div className="flex items-center gap-4 text-xs bg-slate-50/50 p-2 rounded-lg border border-slate-100">
            <div className="flex items-center gap-2">
                <span className="text-slate-400">公开率口径:</span>
                <span className="font-medium text-slate-700">{labels.disclosure}</span>
            </div>
            <div className="w-px h-3 bg-slate-200"></div>
            <div className="flex items-center gap-2">
                <span className="text-slate-400">纠错率口径:</span>
                <span className="font-medium text-slate-700">{labels.correction}</span>
            </div>

            <div className="relative">
                <button
                    onClick={() => setShowDetail(!showDetail)}
                    className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium transition-colors"
                >
                    <Info className="w-3.5 h-3.5" />
                    口径说明
                </button>

                {showDetail && (
                    <div className="absolute top-8 left-0 z-50 w-96 bg-white rounded-xl shadow-xl border border-slate-200 p-5 transform transition-all animate-in fade-in zoom-in-95 origin-top-left">
                        <div className="flex justify-between items-center mb-4 border-b border-slate-100 pb-2">
                            <h3 className="font-bold text-slate-900">统计口径与规则说明</h3>
                            <button onClick={() => setShowDetail(false)} className="text-slate-400 hover:text-slate-600">
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-2">
                                    <Calculator className="w-3.5 h-3.5 text-blue-500" />
                                    计算公式
                                </h4>
                                <div className="space-y-2 pl-5 text-xs text-slate-600">
                                    <div>
                                        <span className="font-medium text-slate-900">实质公开率:</span>
                                        <div className="mt-0.5 p-1.5 bg-slate-50 rounded border border-slate-100 font-mono text-[10px]">
                                            (结果公开 + 结果部分公开) / 办理结果总数
                                        </div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-slate-900">复议纠错率:</span>
                                        <div className="mt-0.5 p-1.5 bg-slate-50 rounded border border-slate-100 font-mono text-[10px]">
                                            (复议纠错 + 复议败诉) / 复议审结总数
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-2">
                                    <Database className="w-3.5 h-3.5 text-indigo-500" />
                                    数据来源
                                </h4>
                                <div className="pl-5 text-xs text-slate-600 leading-relaxed">
                                    数据来源于年报结构化字段：
                                    <ul className="list-disc pl-3 mt-1 space-y-0.5 text-slate-500">
                                        <li>表二：政府信息公开申请情况（办理结果）</li>
                                        <li>表三：行政复议情况（结果纠正情况）</li>
                                    </ul>
                                </div>
                            </div>

                            <div>
                                <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-2">
                                    <AlertCircle className="w-3.5 h-3.5 text-amber-500" />
                                    特殊处理规则
                                </h4>
                                <div className="pl-5 text-xs text-slate-600 space-y-1.5">
                                    <p><span className="font-medium text-slate-700">缺数降级:</span> 缺失关键指标时显示“—”，不默认为0。</p>
                                    <p><span className="font-medium text-slate-700">小样本保护:</span> 申请量 &lt; 30件时，不参与红黄牌评定，仅作“观察”。</p>
                                </div>
                            </div>
                        </div>

                        <div className="mt-4 pt-3 border-t border-slate-100 text-[10px] text-slate-400 text-center">
                            规则集版本: RiskRuleSet v1.2
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
