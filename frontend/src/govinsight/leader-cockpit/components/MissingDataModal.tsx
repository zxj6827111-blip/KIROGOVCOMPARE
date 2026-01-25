import React from 'react';
import { X, FileQuestion, ServerOff, SearchX, ArrowRight } from 'lucide-react';
import { EntityMetrics, MissingType } from '../types';

interface MissingDataModalProps {
    entity: EntityMetrics;
    onClose: () => void;
}

export const MissingDataModal: React.FC<MissingDataModalProps> = ({ entity, onClose }) => {
    const getMissingInfo = (type?: MissingType) => {
        switch (type) {
            case 'not_connected':
                return {
                    icon: <ServerOff className="w-10 h-10 text-slate-400" />,
                    title: '未接入',
                    desc: '系统检测不到该主体的任何数据源配置。',
                    suggestion: '请联系管理员配置年报抓取源或手动导入数据。'
                };
            case 'not_reported':
                return {
                    icon: <FileQuestion className="w-10 h-10 text-orange-400" />,
                    title: '年报未填报/未公开',
                    desc: '系统已接入该主体，但未采集到指定年份的年报数据。',
                    suggestion: '请核实该主体是否已发布年报，或检查爬虫任务状态。'
                };
            case 'parse_failed':
                return {
                    icon: <SearchX className="w-10 h-10 text-red-400" />,
                    title: '解析失败/字段缺失',
                    desc: '已获取年报，但未能提取到关键指标字段（公开率/纠错率分子分母）。',
                    suggestion: '请检查年报格式是否变更，或优化解析规则配置。'
                };
            default:
                return {
                    icon: <FileQuestion className="w-10 h-10 text-slate-400" />,
                    title: '数据缺失',
                    desc: '年报数据不完整，导致无法计算关键指标。',
                    suggestion: '需进一步排查原始数据质量。'
                };
        }
    };

    const info = getMissingInfo(entity.missingType);

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-[480px] max-w-[90%] rounded-xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
                <div className="flex items-center justify-between px-6 py-4 bg-slate-50 border-b border-slate-100">
                    <h3 className="font-bold text-slate-800 text-lg">数据缺失说明</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors p-1">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-8 text-center">
                    <div className="flex justify-center mb-4">
                        <div className="p-4 bg-slate-50 rounded-full">
                            {info.icon}
                        </div>
                    </div>

                    <h4 className="text-lg font-bold text-slate-900 mb-2">{info.title}</h4>
                    <p className="text-sm text-slate-500 mb-6 max-w-xs mx-auto">
                        {info.desc}
                    </p>

                    <div className="bg-blue-50/50 rounded-lg p-4 border border-blue-100 text-left">
                        <h5 className="text-xs font-bold text-blue-800 mb-2 uppercase tracking-wide">建议操作</h5>
                        <div className="flex items-start gap-2 text-sm text-blue-700">
                            <ArrowRight className="w-4 h-4 mt-0.5 shrink-0" />
                            {info.suggestion}
                        </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-100 flex justify-between items-center text-xs text-slate-400">
                        <span>主体: {entity.name}</span>
                        <span>缺失类型: {entity.missingType || 'unknown'}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
