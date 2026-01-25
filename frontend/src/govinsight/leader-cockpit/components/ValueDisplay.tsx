import React from 'react';
import type { ValueStatus } from '../types';

interface ValueDisplayProps {
    value?: number;
    valueStatus?: ValueStatus;
    unit?: string;
    format?: 'number' | 'rate' | 'fraction';
    numerator?: number;
    denominator?: number;
    className?: string;
}

/**
 * 统一的值展示组件
 * - VALUE 且 value=0：显示 0，tooltip "当年统计为0"
 * - MISSING：显示 "—"，tooltip "未接入/未统计"
 * - 支持纠错率格式：0.0% (0/12)
 */
export const ValueDisplay: React.FC<ValueDisplayProps> = ({
    value,
    valueStatus = 'VALUE',
    unit = '',
    format = 'number',
    numerator,
    denominator,
    className = '',
}) => {
    // 数据缺失
    if (valueStatus === 'MISSING' || value === undefined) {
        return (
            <span
                className={`text-slate-400 ${className}`}
                title="未接入/未统计"
            >
                —
            </span>
        );
    }

    // 格式化显示值
    const formatValue = () => {
        if (format === 'rate') {
            return `${value.toFixed(1)}%`;
        }
        if (format === 'number') {
            return value.toLocaleString();
        }
        if (format === 'fraction' && numerator !== undefined && denominator !== undefined) {
            return (
                <span>
                    {value.toFixed(1)}%{' '}
                    <span className="text-xs text-slate-500">
                        ({numerator}/{denominator})
                    </span>
                </span>
            );
        }
        return value.toString();
    };

    // Tooltip 说明
    const getTooltip = () => {
        if (value === 0) {
            return '当年统计为0';
        }
        if (format === 'fraction' && numerator !== undefined && denominator !== undefined) {
            return `纠错数：${numerator}，立案数：${denominator}`;
        }
        return undefined;
    };

    return (
        <span className={className} title={getTooltip()}>
            {formatValue()}
            {unit && ` ${unit}`}
        </span>
    );
};
