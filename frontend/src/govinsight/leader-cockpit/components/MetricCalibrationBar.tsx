import React from 'react';
import { Info, Check } from 'lucide-react';
import { DisclosureMethod, CorrectionMethod } from '../types';

interface MetricCalibrationBarProps {
    disclosureMethod?: DisclosureMethod;
    correctionMethod?: CorrectionMethod;
    includesCarryOver?: boolean;
    onDisclosureMethodChange?: (method: DisclosureMethod) => void;
    onCorrectionMethodChange?: (method: CorrectionMethod) => void;
    onToggleCarryOver?: () => void;
}

/**
 * 口径条组件
 * 展示并与用户交互，切换指标计算口径
 */
export const MetricCalibrationBar: React.FC<MetricCalibrationBarProps> = ({
    disclosureMethod = 'substantive',
    correctionMethod = 'reconsideration',
    includesCarryOver = false,
    onDisclosureMethodChange,
    onCorrectionMethodChange,
    onToggleCarryOver,
}) => {

    // Helper to render toggle items
    const renderToggle = (
        label: string,
        isActive: boolean,
        onClick: () => void,
        title: string
    ) => (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={`px-2 py-0.5 text-xs rounded border transition-all flex items-center gap-1 ${isActive
                ? 'bg-blue-600 text-white border-blue-700 shadow-sm'
                : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                }`}
        >
            {label}
            {isActive && <Check className="w-3 h-3" />}
        </button>
    );

    return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 shadow-sm select-none">
            <div className="flex flex-wrap items-center gap-6 text-xs">
                {/* 标题 */}
                <div className="flex items-center gap-2 mr-2">
                    <span className="text-slate-800 font-bold">口径配置：</span>
                </div>

                {/* 公开率口径 */}
                <div className="flex items-center gap-2">
                    <span className="text-slate-600 font-medium">公开率</span>
                    <div className="flex bg-slate-100 p-0.5 rounded border border-slate-200">
                        {renderToggle(
                            '实质公开率',
                            disclosureMethod === 'substantive',
                            () => onDisclosureMethodChange?.('substantive'),
                            "分子：公开数+部分公开数；分母：办结总数"
                        )}
                        {renderToggle(
                            '绝对公开率',
                            disclosureMethod === 'absolute',
                            () => onDisclosureMethodChange?.('absolute'),
                            "分子：公开数；分母：办结总数"
                        )}
                    </div>
                </div>

                {/* 纠错率口径 */}
                <div className="flex items-center gap-2">
                    <span className="text-slate-600 font-medium">纠错率</span>
                    <div className="flex bg-slate-100 p-0.5 rounded border border-slate-200">
                        {renderToggle(
                            '复议纠错',
                            correctionMethod === 'reconsideration',
                            () => onCorrectionMethodChange?.('reconsideration'),
                            "分子：复议纠错数；分母：复议立案数"
                        )}
                        {renderToggle(
                            '综合纠错',
                            correctionMethod === 'comprehensive',
                            () => onCorrectionMethodChange?.('comprehensive'),
                            "分子：复议+诉讼纠错；分母：复议+诉讼立案"
                        )}
                    </div>
                </div>

                {/* 结转件口径 */}
                <div className="flex items-center gap-2">
                    <span className="text-slate-600 font-medium">结转件</span>
                    <button
                        type="button"
                        onClick={onToggleCarryOver}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${includesCarryOver ? 'bg-blue-600' : 'bg-slate-200'
                            }`}
                        title={includesCarryOver ? "当前包含结转件" : "当前仅计算当年新收"}
                    >
                        <span
                            aria-hidden="true"
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${includesCarryOver ? 'translate-x-4' : 'translate-x-0'
                                }`}
                        />
                    </button>
                    <span className="text-slate-500 text-[10px]">
                        {includesCarryOver ? '含结转' : '不含结转'}
                    </span>
                    <span title="开启后，受理总量将包含上年结转案件；关闭则仅统计当年新收" className="cursor-help flex items-center">
                        <Info className="w-3.5 h-3.5 text-slate-400" />
                    </span>
                </div>
            </div>
        </div>
    );
};
