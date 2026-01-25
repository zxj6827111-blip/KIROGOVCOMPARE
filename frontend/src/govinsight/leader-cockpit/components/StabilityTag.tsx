import React from 'react';
import { Activity } from 'lucide-react';

export type StabilityLevel = 'high' | 'medium' | 'low';

interface StabilityTagProps {
    level: StabilityLevel;
    n?: number;
    showIcon?: boolean;
}

export const StabilityTag: React.FC<StabilityTagProps> = ({ level, n, showIcon = true }) => {
    const config = {
        high: { color: 'bg-emerald-50 text-emerald-600 border-emerald-200', text: '样本充足', tooltip: '置信度高：样本充足(N>=100)且数据完整' },
        medium: { color: 'bg-blue-50 text-blue-600 border-blue-200', text: '样本一般', tooltip: '置信度中：样本一般(30<=N<100)或缺失轻微' },
        low: { color: 'bg-orange-50 text-orange-600 border-orange-200', text: '样本偏少', tooltip: '置信度低：样本不足(N<30)或关键数据缺失，易受个案影响' }
    };

    const { color, text, tooltip } = config[level || 'low'];

    return (
        <span
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-medium border cursor-help ${color}`}
            title={`${tooltip}${n !== undefined ? ` (N=${n})` : ''}`}
        >
            {showIcon && <Activity className="w-2.5 h-2.5" />}
            {text}
        </span>
    );
};
