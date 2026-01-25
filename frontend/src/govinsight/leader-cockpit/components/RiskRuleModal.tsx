import React from 'react';
import { X, ShieldAlert, CheckCircle, AlertTriangle } from 'lucide-react';
import { RISK_RULE_SET } from '../riskRuleSet';

interface RiskRuleModalProps {
    onClose: () => void;
}

export const RiskRuleModal: React.FC<RiskRuleModalProps> = ({ onClose }) => {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-[500px] max-w-[90%] rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-100">
                    <div>
                        <h3 className="font-bold text-slate-800 text-lg">风险评估规则</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{RISK_RULE_SET.version} ({RISK_RULE_SET.name})</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {/* Thresholds */}
                    <div>
                        <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
                            <span className="w-1 h-4 bg-blue-500 rounded-full"></span>
                            分档阈值
                        </h4>
                        <div className="space-y-3">
                            <div className="flex items-start gap-4 p-3 bg-red-50/50 rounded-lg border border-red-100">
                                <div className="mt-0.5">
                                    <ShieldAlert className="w-4 h-4 text-red-500" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-bold text-red-700 text-sm">红牌 (高风险)</span>
                                    </div>
                                    <div className="text-xs text-red-600/80 space-y-0.5">
                                        <p>纠错率 {RISK_RULE_SET.thresholds.red.correction}</p>
                                        <p>公开率 {RISK_RULE_SET.thresholds.red.disclosure}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-start gap-4 p-3 bg-yellow-50/50 rounded-lg border border-yellow-100">
                                <div className="mt-0.5">
                                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="font-bold text-yellow-700 text-sm">黄牌 (中风险)</span>
                                    </div>
                                    <div className="text-xs text-yellow-600/80 space-y-0.5">
                                        <p>纠错率 {RISK_RULE_SET.thresholds.yellow.correction}</p>
                                        <p>公开率 {RISK_RULE_SET.thresholds.yellow.disclosure}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Guardrails */}
                    <div>
                        <h4 className="flex items-center gap-2 text-sm font-bold text-slate-900 mb-3">
                            <span className="w-1 h-4 bg-emerald-500 rounded-full"></span>
                            保护机制 (Guardrails)
                        </h4>
                        <ul className="space-y-2">
                            {RISK_RULE_SET.guardrails.map((rule, idx) => (
                                <li key={idx} className="flex items-start gap-2 text-xs text-slate-600">
                                    <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                                    <span>{rule}</span>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 text-right">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-white border border-slate-200 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};
