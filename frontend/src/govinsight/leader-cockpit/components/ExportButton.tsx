import React from 'react';
import { Download } from 'lucide-react';
import type { EntityMetrics, ViewLevel, DisclosureMethod, CorrectionMethod } from '../types';
import { exportRiskList, exportTaskList } from '../utils/csvExport';
import { useToast } from '../../../components/common/ToastProvider';

type ToastApi = {
    success: (title: string, message?: string) => void;
    info: (title: string, message?: string) => void;
};

interface ExportButtonProps {
    entities: EntityMetrics[];
    calibration: {
        disclosureMethod: DisclosureMethod;
        correctionMethod: CorrectionMethod;
    };
    viewLevel: ViewLevel;
}

export const ExportButton: React.FC<ExportButtonProps> = ({
    entities,
    calibration,
    viewLevel,
}) => {
    const toast = useToast() as ToastApi;
    if (viewLevel === 'city') return null;

    const handleExportRiskList = () => {
        const result = exportRiskList(entities, calibration, viewLevel);
        if (result.ok) {
            toast.success('导出完成', result.message);
        } else {
            toast.info('暂无可导出数据', result.message);
        }
    };

    const handleExportTaskList = () => {
        const result = exportTaskList(entities, calibration, viewLevel);
        if (result.ok) {
            toast.success('导出完成', result.message);
        } else {
            toast.info('暂无可导出数据', result.message);
        }
    };

    return (
        <div className="flex items-center gap-2">
            <button
                type="button"
                onClick={handleExportRiskList}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition-colors"
            >
                <Download className="w-3.5 h-3.5" />
                导出红黄牌清单
            </button>
            <button
                type="button"
                onClick={handleExportTaskList}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded hover:bg-green-100 transition-colors"
            >
                <Download className="w-3.5 h-3.5" />
                导出任务清单
            </button>
        </div>
    );
};
