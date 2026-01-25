import React from 'react';
import { Trophy, Award, Medal, TrendingUp, TrendingDown, AlertCircle } from 'lucide-react';
import type { EntityComparisonModel } from '../types';
import { ValueDisplay } from './ValueDisplay';
import { MIN_N_FOR_RANKING, DEFAULT_STABLE_SAMPLE } from '../riskPolicy';
import { StabilityTag } from './StabilityTag';

interface RankingCardsProps {
    model: EntityComparisonModel;
    onToggleStableSample?: () => void;
}

export const RankingCards: React.FC<RankingCardsProps> = ({ model, onToggleStableSample }) => {
    const { rankings, calibration } = model;

    const isStableSampleEnabled = calibration?.enableStableSample ?? DEFAULT_STABLE_SAMPLE;

    const renderRankBadge = (idx: number) => {
        const badges = [
            { bg: 'bg-yellow-50', text: 'text-yellow-600', icon: Trophy, label: '1st' },
            { bg: 'bg-slate-50', text: 'text-slate-500', icon: Award, label: '2nd' },
            { bg: 'bg-orange-50', text: 'text-orange-600', icon: Medal, label: '3rd' },
        ];
        const badge = badges[idx];
        if (!badge) return null;

        const Icon = badge.icon;

        return (
            <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${badge.bg} ${badge.text} shadow-sm border border-opacity-50 border-current`}>
                <Icon className="w-4 h-4" />
            </div>
        );
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Disclosure Rate Ranking (Higher is better) */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all duration-300 flex flex-col">
                <div className="flex items-center gap-3 mb-4 h-12">
                    <div className="flex items-center justify-center w-10 h-10 bg-blue-50 rounded-lg shadow-sm border border-blue-100 shrink-0">
                        <TrendingUp className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-900 text-sm">实质公开率 TOP 3</h3>
                            {isStableSampleEnabled && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
                                    稳定样本
                                </span>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-500 font-medium mt-0.5">排名越高，公开透明度越好</p>
                    </div>
                </div>
                <div className="flex-1 space-y-2.5">
                    {rankings.byDisclosureRate.slice(0, 3).map((entity, idx) => (
                        <div
                            key={entity.id}
                            className="group flex items-center justify-between p-3 rounded-lg bg-slate-50/50 border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all cursor-default h-[68px]"
                        >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                {renderRankBadge(idx)}
                                <div className="flex flex-col min-w-0 flex-1 pr-2">
                                    <span
                                        className="text-sm font-bold text-slate-700 group-hover:text-slate-900 truncate transition-colors"
                                        title={entity.name}
                                    >
                                        {entity.name}
                                    </span>
                                    {entity.stability && (
                                        <div className="mt-1">
                                            <StabilityTag level={entity.stability} n={entity.acceptedTotal} showIcon={false} />
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-0.5 shrink-0">
                                <ValueDisplay
                                    value={entity.disclosureRate}
                                    valueStatus={entity.disclosureRateStatus}
                                    format="fraction"
                                    numerator={entity.disclosureNumerator}
                                    denominator={entity.disclosureDenominator}
                                    className="text-lg font-bold text-slate-900 font-mono leading-none"
                                />
                                <span className="text-[10px] text-slate-400 font-medium">实质公开率</span>
                            </div>
                        </div>
                    ))}
                    {rankings.byDisclosureRate.length === 0 && (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400 py-6 bg-slate-50/50 rounded-lg border border-dashed border-slate-200">暂无数据</div>
                    )}
                    {rankings.byDisclosureRate.length < 3 && rankings.byDisclosureRate.length > 0 && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50/50 border border-red-100 text-xs text-red-600">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span className="leading-snug">样本量不足（受理≥{MIN_N_FOR_RANKING}件）不参与排名</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Correction Rate Ranking (Lower is better) */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all duration-300 flex flex-col">
                <div className="flex items-center gap-3 mb-4 h-12">
                    <div className="flex items-center justify-center w-10 h-10 bg-indigo-50 rounded-lg shadow-sm border border-indigo-100 shrink-0">
                        <TrendingDown className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-slate-900 text-sm">复议纠错率 TOP 3</h3>
                            {isStableSampleEnabled && (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
                                    稳定样本
                                </span>
                            )}
                        </div>
                        <p className="text-[10px] text-slate-500 font-medium mt-0.5">排名越高，执法规范度越好</p>
                    </div>
                </div>
                <div className="flex-1 space-y-2.5">
                    {rankings.byCorrectionRate.slice(0, 3).map((entity, idx) => (
                        <div
                            key={entity.id}
                            className="group flex items-center justify-between p-3 rounded-lg bg-slate-50/50 border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 transition-all cursor-default h-[68px]"
                        >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                {renderRankBadge(idx)}
                                <div className="flex flex-col min-w-0 flex-1 pr-2">
                                    <span
                                        className="text-sm font-bold text-slate-700 group-hover:text-slate-900 truncate transition-colors"
                                        title={entity.name}
                                    >
                                        {entity.name}
                                    </span>
                                    {entity.stability && (
                                        <div className="mt-1">
                                            <StabilityTag level={entity.stability} n={entity.acceptedTotal} showIcon={false} />
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-0.5 shrink-0">
                                <ValueDisplay
                                    value={entity.correctionRate}
                                    valueStatus={entity.correctionRateStatus}
                                    format="fraction"
                                    numerator={entity.correctionNumerator}
                                    denominator={entity.correctionDenominator}
                                    className="text-lg font-bold text-slate-900 font-mono leading-none"
                                />
                                <span className="text-[10px] text-slate-400 font-medium">复议纠错率</span>
                            </div>
                        </div>
                    ))}
                    {rankings.byCorrectionRate.length === 0 && (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400 py-6 bg-slate-50/50 rounded-lg border border-dashed border-slate-200">暂无数据</div>
                    )}
                    {rankings.byCorrectionRate.length < 3 && rankings.byCorrectionRate.length > 0 && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50/50 border border-red-100 text-xs text-red-600">
                            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                            <span className="leading-snug">样本量不足（受理≥{MIN_N_FOR_RANKING}件）不参与排名</span>
                        </div>
                    )}
                </div>
            </div>

            {/* New Applications Ranking */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-[0_2px_8px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.06)] transition-all duration-300 flex flex-col">
                <div className="flex items-center gap-3 mb-4 h-12">
                    <div className="flex items-center justify-center w-10 h-10 bg-emerald-50 rounded-lg shadow-sm border border-emerald-100 shrink-0">
                        <TrendingUp className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-900 text-sm">新收案件量 TOP 3</h3>
                        <p className="text-[10px] text-slate-500 font-medium mt-0.5">反映行政争议活跃度</p>
                    </div>
                </div>
                <div className="flex-1 space-y-2.5">
                    {rankings.byNewApplications.slice(0, 3).map((entity, idx) => (
                        <div
                            key={entity.id}
                            className="group flex items-center justify-between p-3 rounded-lg bg-slate-50/50 border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/30 transition-all cursor-default h-[68px]"
                        >
                            <div className="flex items-center gap-3 min-w-0 flex-1">
                                {renderRankBadge(idx)}
                                <div className="flex flex-col min-w-0 flex-1 pr-2">
                                    <span
                                        className="text-sm font-bold text-slate-700 group-hover:text-slate-900 truncate transition-colors"
                                        title={entity.name}
                                    >
                                        {entity.name}
                                    </span>
                                </div>
                            </div>
                            <div className="flex flex-col items-end gap-0.5 shrink-0">
                                <div className="flex items-baseline gap-1">
                                    <ValueDisplay
                                        value={entity.newApplications}
                                        valueStatus={entity.newApplicationsStatus}
                                        format="number"
                                        className="text-lg font-bold text-slate-900 font-mono leading-none"
                                    />
                                    <span className="text-[10px] text-slate-400">件</span>
                                </div>
                                <span className="text-[10px] text-slate-400 font-medium">新收案件</span>
                            </div>
                        </div>
                    ))}
                    {rankings.byNewApplications.length === 0 && (
                        <div className="h-full flex items-center justify-center text-xs text-slate-400 py-6 bg-slate-50/50 rounded-lg border border-dashed border-slate-200">暂无数据</div>
                    )}
                </div>
            </div>
        </div>
    );
};
