import React, { useState } from 'react';
import { Info, ArrowUp, ArrowDown, FileText, Eye, AlertTriangle } from 'lucide-react';
import type { EntityComparisonModel, EntityMetrics, DisclosureMethod, CorrectionMethod } from '../types';
import { ValueDisplay } from './ValueDisplay';
import { RiskFilter } from './RiskFilter';
import { ExportButton } from './ExportButton';
import { MIN_N_FOR_RANKING, GAP_MIN_SAMPLES, DEFAULT_GAP_MODE } from '../riskPolicy';

import { RiskRuleModal } from './RiskRuleModal';
import { MetricMethodBar } from './MetricMethodBar';
import { MissingDataModal } from './MissingDataModal';

interface EntityComparisonTableProps {
    model: EntityComparisonModel;
    onCreateTask?: (entity: EntityMetrics) => void;
    onViewEvidence?: (entity: EntityMetrics) => void;

    // Calibration Handlers
    onDisclosureMethodChange?: (method: DisclosureMethod) => void;
    onCorrectionMethodChange?: (method: CorrectionMethod) => void;
    onToggleCarryOver?: () => void;
}

type SortKey = 'name' | 'newApplications' | 'acceptedTotal' | 'disclosureRate' | 'correctionRate';
type SortOrder = 'asc' | 'desc';

export const EntityComparisonTable: React.FC<EntityComparisonTableProps> = ({
    model,
    onCreateTask,
    onViewEvidence,
    onDisclosureMethodChange,
    onCorrectionMethodChange,
    onToggleCarryOver
}) => {
    const { entities, viewLevel, statistics, calibration } = model;
    const [filteredEntities, setFilteredEntities] = useState<EntityMetrics[]>(entities);
    const [sortKey, setSortKey] = useState<SortKey>('acceptedTotal');
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

    const [useWeightedAvg, setUseWeightedAvg] = useState(true);
    const [gapMode, setGapMode] = useState<'P90_P10' | 'MAX_MIN'>(DEFAULT_GAP_MODE === 'P90_P10' ? 'P90_P10' : 'MAX_MIN');
    const [showRiskRules, setShowRiskRules] = useState(false);
    const [missingDataEntity, setMissingDataEntity] = useState<EntityMetrics | null>(null);

    const entityLabel = viewLevel === 'district' ? '区县' : '部门';

    // Update filtered entities when model changes
    React.useEffect(() => {
        setFilteredEntities(entities);
        // Reset or smart-preserve sorting could go here, for now reset to default
        setSortKey('acceptedTotal');
        setSortOrder('desc');
    }, [entities, viewLevel]);

    if (entities.length === 0) {
        return (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500 shadow-sm">
                暂无{entityLabel}数据
            </div>
        );
    }

    const handleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortOrder('desc');
        }
    };

    const sortedEntities = [...filteredEntities].sort((a, b) => {
        let aVal: any = a[sortKey];
        let bVal: any = b[sortKey];

        if (aVal === undefined) aVal = -Infinity;
        if (bVal === undefined) bVal = -Infinity;

        if (sortOrder === 'asc') {
            return aVal > bVal ? 1 : -1;
        } else {
            return aVal < bVal ? 1 : -1;
        }
    });

    const getRiskBadge = (entity: EntityMetrics) => {
        if (!entity.riskLevel || entity.riskLevel === 'green') return null;

        const styles = {
            red: 'bg-red-50 text-red-700 border-red-200',
            yellow: 'bg-yellow-50 text-yellow-700 border-yellow-200',
            missing: 'bg-slate-50 text-slate-600 border-slate-200',
        };

        const labels = {
            red: '红牌',
            yellow: '黄牌',
            missing: '缺失',
        };

        return (
            <span
                className={`inline-flex items-center justify-center min-w-[36px] px-1.5 py-0.5 rounded text-[10px] font-medium border ${styles[entity.riskLevel]}`}
                title={entity.riskReason}
            >
                {labels[entity.riskLevel]}
            </span>
        );
    };

    const avgDisclosureRate = useWeightedAvg
        ? statistics.avgDisclosureRateWeighted
        : statistics.avgDisclosureRate;

    const avgCorrectionRate = useWeightedAvg
        ? statistics.avgCorrectionRateWeighted
        : statistics.avgCorrectionRate;

    return (
        <div className="space-y-6">
            {/* 1. Method Bar & Risk Rules */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                {calibration && (
                    <MetricMethodBar
                        disclosureMethod={calibration.disclosureMethod}
                        correctionMethod={calibration.correctionMethod}
                    />
                )}

                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowRiskRules(true)}
                        className="text-xs flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-800 transition-colors bg-white shadow-sm"
                    >
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        风险评级规则
                    </button>
                    {onToggleCarryOver && (
                        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none px-3 py-1.5 rounded-lg border border-transparent hover:bg-slate-100/50 transition-colors">
                            <input
                                type="checkbox"
                                checked={calibration?.includesCarryOver}
                                onChange={onToggleCarryOver}
                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            />
                            含结转案件
                        </label>
                    )}
                </div>
            </div>

            {/* 2. Statistics Bar with Export */}
            <div className="bg-gradient-to-r from-blue-50/80 to-indigo-50/80 rounded-xl border border-blue-100 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                    <div className="grid grid-cols-4 gap-6 text-center flex-1">
                        <div>
                            <div className="text-xs font-medium text-slate-500 mb-1 tracking-wide uppercase">{entityLabel}总数</div>
                            <div className="text-3xl font-bold text-slate-900">{statistics.total}</div>
                        </div>
                        <div className="relative group cursor-help" title={`当前列表的平均值（${useWeightedAvg ? '按受理量加权' : '简单算术平均'}）`}>
                            <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
                                <span>平均实质公开率</span>
                                <Info className="w-3.5 h-3.5 text-blue-400 group-hover:text-blue-600" />
                            </div>
                            <div
                                className="text-3xl font-bold text-blue-600 cursor-pointer hover:opacity-80 transition-opacity"
                                onClick={() => setUseWeightedAvg(!useWeightedAvg)}
                            >
                                {avgDisclosureRate !== undefined
                                    ? `${avgDisclosureRate.toFixed(1)}%`
                                    : '-'}
                            </div>
                            <div className="text-[10px] font-medium text-slate-400 mt-1 uppercase tracking-wider">
                                {useWeightedAvg ? '加权平均' : '简单平均'}
                            </div>
                        </div>
                        <div className="relative group cursor-help" title={`当前列表的平均值（${useWeightedAvg ? '按受理量加权' : '简单算术平均'}）`}>
                            <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500 mb-1">
                                <span>平均复议纠错率</span>
                                <Info className="w-3.5 h-3.5 text-indigo-400 group-hover:text-indigo-600" />
                            </div>
                            <div className="text-3xl font-bold text-indigo-600">
                                {avgCorrectionRate !== undefined
                                    ? `${avgCorrectionRate.toFixed(1)}%`
                                    : '-'}
                            </div>
                            <div className="text-[10px] font-medium text-slate-400 mt-1 uppercase tracking-wider">
                                {useWeightedAvg ? '加权平均' : '简单平均'}
                            </div>
                        </div>
                        <div title={gapMode === 'P90_P10' ? '排除极端值影响，反映主体分布差异' : '敏感，易受极端值影响'}>
                            <div className="flex items-center justify-center gap-1.5 text-xs font-medium text-slate-500 mb-1 cursor-help">
                                <span>公开率差距</span>
                                <button
                                    onClick={() => setGapMode(prev => prev === 'P90_P10' ? 'MAX_MIN' : 'P90_P10')}
                                    className="text-[10px] px-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 border border-slate-200 transition-colors"
                                    title="点击切换统计口径"
                                >
                                    {gapMode === 'P90_P10' ? 'P90-P10' : 'MAX-MIN'}
                                </button>
                            </div>
                            <div className="text-3xl font-bold text-slate-700">
                                {(() => {
                                    if (model.statistics.total < GAP_MIN_SAMPLES) {
                                        return <span className="text-xs text-slate-400 font-normal">样本不足(N&lt;{GAP_MIN_SAMPLES})</span>;
                                    }
                                    const val = gapMode === 'P90_P10'
                                        ? statistics.disclosureRateGapP90P10
                                        : (statistics.maxDisclosureRate !== undefined && statistics.minDisclosureRate !== undefined
                                            ? statistics.maxDisclosureRate - statistics.minDisclosureRate
                                            : null);

                                    return val !== null && val !== undefined ? `${val.toFixed(1)}%` : '-';
                                })()}
                            </div>
                            <div className="text-[10px] font-medium text-slate-400 mt-1 uppercase tracking-wider">
                                {gapMode === 'P90_P10' ? 'N>=30' : 'MAX - MIN'}
                            </div>
                        </div>
                    </div>
                    <div className="ml-6 pl-6 border-l border-blue-200/60">
                        <div className="text-xs font-medium text-slate-500 mb-2">数据质量概览</div>
                        <div className="space-y-1.5 text-[10px] text-slate-600">
                            <div className="flex justify-between gap-6" title="已接入年报的主体比例">
                                <span>年报接入:</span>
                                <span className="font-mono font-bold text-slate-800">{statistics.reportCoverage || '-/-'}</span>
                            </div>
                            <div className="flex justify-between gap-6" title="关键字段完整的主体比例">
                                <span>字段完整:</span>
                                <span className="font-mono font-bold text-slate-800">{statistics.fieldCoverage || '-/-'}</span>
                            </div>
                            <div className="flex justify-between gap-6" title="已接入年报中成功解析出关键数据的比例">
                                <span>解析成功:</span>
                                <span className="font-mono font-bold text-emerald-600">{statistics.parseSuccessRate || '-'}</span>
                            </div>
                        </div>
                    </div>
                    <div className="ml-6 pl-6 border-l border-blue-200/60">
                        <ExportButton
                            entities={entities}
                            calibration={calibration || { disclosureMethod: '(公开+部分公开)/办结', correctionMethod: '复议纠错率' }}
                            viewLevel={viewLevel}
                        />
                    </div>
                </div>

                {/* Risk Filter */}
                <div className="pt-4 border-t border-blue-100">
                    <RiskFilter
                        entities={entities}
                        onFilterChange={setFilteredEntities}
                    />
                </div>
            </div>

            {/* Comparison Table */}
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow duration-300">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50/80 border-b border-slate-200">
                                <th
                                    className="text-left px-5 py-3.5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors group select-none"
                                    onClick={() => handleSort('name')}
                                >
                                    <div className="flex items-center gap-1.5">
                                        {entityLabel}名称
                                        <span className="text-slate-400 group-hover:text-slate-600 transition-colors">
                                            {sortKey === 'name' && (
                                                sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
                                            )}
                                        </span>
                                    </div>
                                </th>
                                <th
                                    className="text-right px-5 py-3.5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors group select-none"
                                    onClick={() => handleSort('newApplications')}
                                >
                                    <div className="flex items-center justify-end gap-1.5">
                                        新收（件）
                                        <span className="text-slate-400 group-hover:text-slate-600 transition-colors">
                                            {sortKey === 'newApplications' && (
                                                sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
                                            )}
                                        </span>
                                    </div>
                                </th>
                                <th
                                    className="text-right px-5 py-3.5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors group select-none"
                                    onClick={() => handleSort('acceptedTotal')}
                                >
                                    <div className="flex items-center justify-end gap-1.5">
                                        受理合计（件）
                                        <span className="text-slate-400 group-hover:text-slate-600 transition-colors">
                                            {sortKey === 'acceptedTotal' && (
                                                sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
                                            )}
                                        </span>
                                    </div>
                                </th>
                                <th
                                    className="text-right px-5 py-3.5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors group select-none"
                                    onClick={() => handleSort('disclosureRate')}
                                >
                                    <div className="flex items-center justify-end gap-1.5">
                                        实质公开率
                                        <span className="text-slate-400 group-hover:text-slate-600 transition-colors">
                                            {sortKey === 'disclosureRate' && (
                                                sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
                                            )}
                                        </span>
                                    </div>
                                </th>
                                <th
                                    className="text-right px-5 py-3.5 font-semibold text-slate-900 cursor-pointer hover:bg-slate-100 transition-colors group select-none"
                                    onClick={() => handleSort('correctionRate')}
                                >
                                    <div className="flex items-center justify-end gap-1.5">
                                        复议纠错率
                                        <span className="text-slate-400 group-hover:text-slate-600 transition-colors">
                                            {sortKey === 'correctionRate' && (
                                                sortOrder === 'asc' ? <ArrowUp className="w-3.5 h-3.5" /> : <ArrowDown className="w-3.5 h-3.5" />
                                            )}
                                        </span>
                                    </div>
                                </th>
                                <th className="text-center px-5 py-3.5 font-semibold text-slate-900">
                                    风险等级
                                </th>
                                <th className="text-center px-5 py-3.5 font-semibold text-slate-900">
                                    操作
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {sortedEntities.map((entity, idx) => (
                                <tr
                                    key={entity.id}
                                    className="group hover:bg-blue-50/30 transition-colors duration-150"
                                >
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center gap-2">
                                            <span className="font-medium text-slate-700 group-hover:text-slate-900 transition-colors">
                                                {entity.name}
                                            </span>
                                            {!entity.isSampleSufficient && entity.acceptedTotal !== undefined && (
                                                <span
                                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-amber-50 text-amber-600 border border-amber-200/50"
                                                    title={`样本量不足（${entity.acceptedTotal}件 < ${MIN_N_FOR_RANKING}件）`}
                                                >
                                                    <AlertTriangle className="w-2.5 h-2.5" />
                                                    小样本
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-5 py-3.5 text-right text-slate-600 tabular-nums">
                                        <ValueDisplay
                                            value={entity.newApplications}
                                            valueStatus={entity.newApplicationsStatus}
                                            format="number"
                                        />
                                    </td>
                                    <td className="px-5 py-3.5 text-right text-slate-600 tabular-nums">
                                        <ValueDisplay
                                            value={entity.acceptedTotal}
                                            valueStatus={entity.acceptedTotalStatus}
                                            format="number"
                                        />
                                    </td>
                                    <td className="px-5 py-3.5 text-right tabular-nums">
                                        <ValueDisplay
                                            value={entity.disclosureRate}
                                            valueStatus={entity.disclosureRateStatus}
                                            format="rate"
                                            className={
                                                entity.disclosureRate !== undefined
                                                    ? entity.disclosureRate >= 80
                                                        ? 'text-green-600 font-bold'
                                                        : entity.disclosureRate >= 60
                                                            ? 'text-blue-600 font-medium'
                                                            : 'text-orange-600 font-medium'
                                                    : 'text-slate-400'
                                            }
                                        />
                                    </td>
                                    <td className="px-5 py-3.5 text-right tabular-nums">
                                        <ValueDisplay
                                            value={entity.correctionRate}
                                            valueStatus={entity.correctionRateStatus}
                                            format="fraction"
                                            numerator={entity.correctionNumerator}
                                            denominator={entity.correctionDenominator}
                                            className={
                                                entity.correctionRate !== undefined
                                                    ? entity.correctionRate <= 10
                                                        ? 'text-green-600 font-bold'
                                                        : entity.correctionRate <= 20
                                                            ? 'text-blue-600 font-medium'
                                                            : 'text-orange-600 font-medium'
                                                    : 'text-slate-400'
                                            }
                                        />
                                    </td>
                                    <td className="px-5 py-3.5 text-center">
                                        {getRiskBadge(entity)}
                                    </td>
                                    <td className="px-5 py-3.5">
                                        <div className="flex items-center justify-center gap-1 opacity-100">
                                            {/* Show Explain Missing if status is missing or risky? No just separate button */}
                                            {entity.status === 'missing' || entity.acceptedTotalStatus === 'MISSING' || entity.disclosureRateStatus === 'MISSING' ? (
                                                <button
                                                    type="button"
                                                    onClick={() => setMissingDataEntity(entity)}
                                                    className="p-1 px-2 text-xs bg-white text-orange-600 border border-orange-200 hover:bg-orange-50 rounded-md transition-colors shadow-sm"
                                                    title="查看缺数原因与补救建议"
                                                >
                                                    数据缺失说明
                                                </button>
                                            ) : (
                                                <>
                                                    {onCreateTask && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); onCreateTask(entity); }}
                                                            className="p-1.5 text-blue-600 hover:bg-blue-50 hover:text-blue-700 rounded-md transition-colors"
                                                            title="生成整改任务"
                                                        >
                                                            <FileText className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                    {onViewEvidence && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); onViewEvidence(entity); }}
                                                            className="p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 rounded-md transition-colors"
                                                            title="查看证据"
                                                        >
                                                            <Eye className="w-4 h-4" />
                                                        </button>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            {/* Modals */}
            {showRiskRules && (
                <RiskRuleModal onClose={() => setShowRiskRules(false)} />
            )}

            {missingDataEntity && (
                <MissingDataModal
                    entity={missingDataEntity}
                    onClose={() => setMissingDataEntity(null)}
                />
            )}
        </div>
    );
};
