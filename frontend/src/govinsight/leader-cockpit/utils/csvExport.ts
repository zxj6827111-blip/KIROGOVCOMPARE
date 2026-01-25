import type { EntityMetrics, DisclosureMethod, CorrectionMethod } from '../types';

const DISCLOSURE_LABELS: Record<DisclosureMethod, string> = {
    'substantive': '实质公开率',
    'absolute': '绝对公开率'
};

const CORRECTION_LABELS: Record<CorrectionMethod, string> = {
    'reconsideration': '复议纠错率',
    'comprehensive': '综合纠错率'
};

/**
 * 导出红黄牌清单 CSV
 */
export function exportRiskList(
    entities: EntityMetrics[],
    calibration: { disclosureMethod: DisclosureMethod; correctionMethod: CorrectionMethod },
    viewLevel: 'district' | 'department'
): void {
    const riskEntities = entities.filter(e => e.riskLevel === 'red' || e.riskLevel === 'yellow');

    if (riskEntities.length === 0) {
        alert('暂无红黄牌区县/部门');
        return;
    }

    const entityLabel = viewLevel === 'district' ? '区县' : '部门';

    // CSV 表头
    const headers = [
        entityLabel,
        '受理合计（件）',
        '实质公开率',
        '复议纠错率',
        '风险等级',
        '风险原因',
        '口径说明'
    ];

    // CSV 数据行
    const rows = riskEntities.map(entity => {
        const dLabel = DISCLOSURE_LABELS[calibration.disclosureMethod] || calibration.disclosureMethod;
        const cLabel = CORRECTION_LABELS[calibration.correctionMethod] || calibration.correctionMethod;
        const calibrationNote = `公开率口径：${dLabel}；纠错率口径：${cLabel}`;

        return [
            entity.name,
            entity.acceptedTotal?.toString() || '-',
            entity.disclosureRateStatus === 'MISSING' ? '—' : `${entity.disclosureRate?.toFixed(1)}%`,
            entity.correctionRateStatus === 'MISSING' ? '—' :
                entity.correctionDenominator !== undefined
                    ? `${entity.correctionRate?.toFixed(1)}% (${entity.correctionNumerator}/${entity.correctionDenominator})`
                    : `${entity.correctionRate?.toFixed(1)}%`,
            entity.riskLevel === 'red' ? '红牌' : '黄牌',
            entity.riskReason || '',
            calibrationNote
        ];
    });

    // 生成 CSV 内容
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // 下载 CSV
    downloadCSV(csvContent, `红黄牌清单_${new Date().toISOString().slice(0, 10)}.csv`);
}

/**
 * 导出任务清单 CSV
 */
export function exportTaskList(
    entities: EntityMetrics[],
    calibration: { disclosureMethod: DisclosureMethod; correctionMethod: CorrectionMethod },
    viewLevel: 'district' | 'department'
): void {
    const riskEntities = entities.filter(e => e.riskLevel === 'red' || e.riskLevel === 'yellow');

    if (riskEntities.length === 0) {
        alert('暂无需要整改的区县/部门');
        return;
    }

    const entityLabel = viewLevel === 'district' ? '区县' : '部门';

    // CSV 表头
    const headers = [
        entityLabel,
        '问题描述',
        '建议行动',
        '责任单位',
        '预计周期',
        'KPI目标'
    ];

    // CSV 数据行
    const rows = riskEntities.map(entity => {
        const issue = entity.riskReason || '待分析';
        const action = entity.riskLevel === 'red'
            ? '立即启动专项整改，建立工作专班'
            : '制定改进计划，定期跟踪进度';
        const owner = `${entity.name}政府`;
        const cycle = entity.riskLevel === 'red' ? '30天' : '60天';
        const kpi = entity.riskLevel === 'red'
            ? '公开率提升至70%以上，纠错率降至15%以下'
            : '公开率提升5个百分点，纠错率下降3个百分点';

        return [
            entity.name,
            issue,
            action,
            owner,
            cycle,
            kpi
        ];
    });

    // 生成 CSV 内容
    const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // 下载 CSV
    downloadCSV(csvContent, `整改任务清单_${new Date().toISOString().slice(0, 10)}.csv`);
}

/**
 * 下载 CSV 文件
 */
function downloadCSV(content: string, filename: string): void {
    // 添加 BOM 以支持中文
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + content], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
