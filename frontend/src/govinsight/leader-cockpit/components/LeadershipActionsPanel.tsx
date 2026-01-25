import React from 'react';
import { AlertCircle, Target, Lightbulb, Download } from 'lucide-react';
import { ManagementActionItem, GovernanceSuggestion } from '../types';

interface LeadershipActionsPanelProps {
    interviewList: ManagementActionItem[];
    commonShortcomings: { name: string; count: number }[];
    governanceSuggestions: GovernanceSuggestion[];
    onExportInterviewList?: () => void;
}

export const LeadershipActionsPanel: React.FC<LeadershipActionsPanelProps> = ({
    interviewList,
    commonShortcomings,
    governanceSuggestions,
    onExportInterviewList
}) => {
    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
            {/* Card 1: Interview Suggestion List */}
            <div className="bg-white rounded-xl border border-red-100 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-gradient-to-r from-red-50 to-white px-5 py-4 border-b border-red-100 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-red-600">
                            <AlertCircle className="w-5 h-5" />
                        </div>
                        <h3 className="font-bold text-slate-900">重点约谈建议 (Top {interviewList.length})</h3>
                    </div>
                    {onExportInterviewList && (
                        <button
                            onClick={onExportInterviewList}
                            className="text-xs flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                            <Download className="w-3.5 h-3.5" />
                            导出清单
                        </button>
                    )}
                </div>
                <div className="flex-1 p-0 overflow-y-auto max-h-80">
                    {interviewList.length > 0 ? (
                        <div className="divide-y divide-slate-100">
                            {interviewList.map((item, idx) => (
                                <div key={item.id} className="p-4 hover:bg-slate-50 transition-colors">
                                    <div className="flex justify-between items-start mb-1">
                                        <span className="font-bold text-slate-800 text-sm flex items-center gap-2">
                                            {idx + 1}. {item.entityName}
                                        </span>
                                        <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                            {item.metrics}
                                        </span>
                                    </div>
                                    <p className="text-xs text-red-600/90 leading-snug">
                                        触发原因: {item.reason}
                                    </p>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="p-8 text-center text-slate-400 text-sm">
                            当前暂无建议约谈对象
                        </div>
                    )}
                </div>
            </div>

            {/* Card 2: Common Shortcomings */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-gradient-to-r from-slate-50 to-white px-5 py-4 border-b border-slate-100 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600">
                        <Target className="w-5 h-5" />
                    </div>
                    <h3 className="font-bold text-slate-900">共性短板分析</h3>
                </div>
                <div className="flex-1 p-5">
                    {commonShortcomings.length > 0 ? (
                        <div className="space-y-4">
                            {commonShortcomings.map((item, idx) => (
                                <div key={idx} className="relative">
                                    <div className="flex justify-between items-end mb-1 text-sm">
                                        <span className="font-medium text-slate-700">{item.name}</span>
                                        <span className="font-bold text-slate-900">{item.count} <span className="text-xs font-normal text-slate-400">次</span></span>
                                    </div>
                                    <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 rounded-full"
                                            style={{ width: `${Math.min(100, (item.count / 20) * 100)}%` }}
                                        ></div>
                                    </div>
                                </div>
                            ))}
                            <div className="pt-4 text-xs text-slate-400 border-t border-slate-100">
                                * 数据基于AI解析的败诉纠错原因归类
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 text-sm gap-2">
                            <Target className="w-8 h-8 opacity-20" />
                            <span>暂无原因数据，需接入详细年报</span>
                            <button className="text-xs text-blue-600 hover:underline">查看接入指南</button>
                        </div>
                    )}
                </div>
            </div>

            {/* Card 3: Governance Suggestions */}
            <div className="bg-white rounded-xl border border-blue-100 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-gradient-to-r from-blue-50 to-white px-5 py-4 border-b border-blue-100 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600">
                        <Lightbulb className="w-5 h-5" />
                    </div>
                    <h3 className="font-bold text-slate-900">专项治理建议</h3>
                </div>
                <div className="flex-1 p-0 overflow-y-auto">
                    <div className="divide-y divide-slate-100">
                        {governanceSuggestions.map((item) => (
                            <div key={item.id} className="p-4 hover:bg-slate-50 transition-colors group">
                                <h4 className="font-bold text-slate-800 text-sm mb-1 group-hover:text-blue-700 transition-colors">
                                    {item.title}
                                </h4>
                                <p className="text-xs text-slate-600 mb-2 leading-relaxed">
                                    {item.content}
                                </p>
                                <div className="flex flex-wrap gap-2 text-[10px]">
                                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded border border-blue-100">
                                        KPI: {item.kpi}
                                    </span>
                                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">
                                        {item.ownerSuggestion}
                                    </span>
                                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded border border-slate-200">
                                        {item.cycle}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};
