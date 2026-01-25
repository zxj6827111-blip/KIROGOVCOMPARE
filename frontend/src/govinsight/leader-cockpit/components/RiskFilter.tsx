import React, { useState } from 'react';
import { Filter } from 'lucide-react';
import type { EntityMetrics } from '../types';

interface RiskFilterProps {
    onFilterChange: (filtered: EntityMetrics[]) => void;
    entities: EntityMetrics[];
}

export const RiskFilter: React.FC<RiskFilterProps> = ({ onFilterChange, entities }) => {
    const [selectedRisks, setSelectedRisks] = useState<Set<string>>(new Set());
    const [showSmallSample, setShowSmallSample] = useState(false);
    const [showMissing, setShowMissing] = useState(false);

    const handleToggle = (risk: string) => {
        const newSelected = new Set(selectedRisks);
        if (newSelected.has(risk)) {
            newSelected.delete(risk);
        } else {
            newSelected.add(risk);
        }
        setSelectedRisks(newSelected);
        applyFilter(newSelected, showSmallSample, showMissing);
    };

    const applyFilter = (risks: Set<string>, smallSample: boolean, missing: boolean) => {
        let filtered = [...entities];

        // 风险等级筛选
        if (risks.size > 0) {
            filtered = filtered.filter(e => risks.has(e.riskLevel || ''));
        }

        // 小样本筛选
        if (smallSample) {
            filtered = filtered.filter(e => !e.isSampleSufficient);
        }

        // 数据缺失筛选
        if (missing) {
            filtered = filtered.filter(e =>
                e.disclosureRateStatus === 'MISSING' ||
                e.correctionRateStatus === 'MISSING'
            );
        }

        onFilterChange(filtered);
    };

    const riskOptions = [
        { value: 'red', label: '红牌', color: 'bg-red-100 text-red-700 border-red-300' },
        { value: 'yellow', label: '黄牌', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
        { value: 'green', label: '绿牌', color: 'bg-green-100 text-green-700 border-green-300' },
    ];

    return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-slate-600">
                <Filter className="w-3.5 h-3.5" />
                <span className="font-medium">筛选：</span>
            </div>

            {riskOptions.map(option => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => handleToggle(option.value)}
                    className={`px-2.5 py-1 rounded border transition-all ${selectedRisks.has(option.value)
                            ? option.color
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                >
                    {option.label}
                </button>
            ))}

            <button
                type="button"
                onClick={() => {
                    setShowSmallSample(!showSmallSample);
                    applyFilter(selectedRisks, !showSmallSample, showMissing);
                }}
                className={`px-2.5 py-1 rounded border transition-all ${showSmallSample
                        ? 'bg-orange-100 text-orange-700 border-orange-300'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
            >
                小样本
            </button>

            <button
                type="button"
                onClick={() => {
                    setShowMissing(!showMissing);
                    applyFilter(selectedRisks, showSmallSample, !showMissing);
                }}
                className={`px-2.5 py-1 rounded border transition-all ${showMissing
                        ? 'bg-slate-200 text-slate-700 border-slate-300'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                    }`}
            >
                数据缺失
            </button>

            {(selectedRisks.size > 0 || showSmallSample || showMissing) && (
                <button
                    type="button"
                    onClick={() => {
                        setSelectedRisks(new Set());
                        setShowSmallSample(false);
                        setShowMissing(false);
                        onFilterChange(entities);
                    }}
                    className="px-2.5 py-1 text-blue-600 hover:text-blue-700 underline"
                >
                    清除筛选
                </button>
            )}
        </div>
    );
};
