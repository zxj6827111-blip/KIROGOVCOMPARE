import type { EntityMetrics } from './types';

// =========================================================================================
// 1. 核心常量配置
// =========================================================================================

// 样本量门槛：只有 N >= 30 才视为稳定样本
// 用于：红黄牌判定、排行榜准入、P90-P10计算（建议）
export const MIN_N_FOR_RANKING = 30;

// 差距计算最小样本量
export const GAP_MIN_SAMPLES = 5;

// 默认配置开关
export const DEFAULT_STABLE_SAMPLE = true;     // 默认开启稳定样本口径
export const DEFAULT_GAP_MODE = "P90_P10";     // 默认使用稳健差距
export const DEFAULT_OVERLAY_COMPARE = false;  // 默认关闭趋势图叠加

// =========================================================================================
// 2. 风险阈值定义
// =========================================================================================

export const RISK_THRESHOLDS = {
    // 实质公开率阈值 (数值越低风险越高)
    disclosureRate: {
        red: 40.0,      // < 40%
        yellow: 45.0,   // < 45%
    },
    // 复议纠错率阈值 (数值越高风险越高)
    correctionRate: {
        red: 15.0,      // > 15%
        yellow: 10.0,   // > 10%
    },
};

// =========================================================================================
// 3. 风险判定逻辑
// =========================================================================================

/**
 * 判定单一实体的风险等级
 * 
 * 规则：
 * 1. 若数据缺失 -> missing
 * 2. 若样本不足 (N < MIN_N_FOR_RANKING) -> green (观察/小样本，不标红黄)
 * 3. 纠错率 > 15% -> red
 * 4. 纠错率 > 10% -> yellow
 * 5. 公开率 < 40% -> red
 * 6. 公开率 < 45% -> yellow
 * 7. 否则 -> green
 */
export const assessRiskLevel = (entity: EntityMetrics): 'red' | 'yellow' | 'green' | 'missing' => {
    if (entity.status === 'missing') return 'missing';

    // 小样本保护：样本不足不评定红黄牌，避免统计误伤
    // 仅 acceptedTotal 存在且 >= 30 才进行评定
    if (!entity.isSampleSufficient) {
        return 'green';
    }

    // 1. 纠错率判定 (高风险优先)
    if (entity.correctionRateStatus === 'VALUE' && entity.correctionRate !== undefined) {
        if (entity.correctionRate > RISK_THRESHOLDS.correctionRate.red) return 'red';
        if (entity.correctionRate > RISK_THRESHOLDS.correctionRate.yellow) return 'yellow';
    }

    // 2. 公开率判定
    if (entity.disclosureRateStatus === 'VALUE' && entity.disclosureRate !== undefined) {
        if (entity.disclosureRate < RISK_THRESHOLDS.disclosureRate.red) return 'red';
        if (entity.disclosureRate < RISK_THRESHOLDS.disclosureRate.yellow) return 'yellow';
    }

    return 'green';
};

/**
 * 获取风险判定原因说明 (用于 Tooltip)
 */
export const getRiskReason = (entity: EntityMetrics, level: 'red' | 'yellow' | 'green' | 'missing'): string => {
    if (level === 'missing') return '缺失：数据待接入或未填报';

    if (!entity.isSampleSufficient) {
        return `观察：样本不足 (N=${entity.acceptedTotal || 0} < ${MIN_N_FOR_RANKING})，不参与风险评级`;
    }

    if (level === 'red') {
        if (entity.correctionRate !== undefined && entity.correctionRate > RISK_THRESHOLDS.correctionRate.red) {
            return `红牌：纠错率 ${entity.correctionRate.toFixed(1)}% > ${RISK_THRESHOLDS.correctionRate.red}% (且 N=${entity.acceptedTotal} >= ${MIN_N_FOR_RANKING})`;
        }
        if (entity.disclosureRate !== undefined && entity.disclosureRate < RISK_THRESHOLDS.disclosureRate.red) {
            return `红牌：公开率 ${entity.disclosureRate.toFixed(1)}% < ${RISK_THRESHOLDS.disclosureRate.red}% (且 N=${entity.acceptedTotal} >= ${MIN_N_FOR_RANKING})`;
        }
    }

    if (level === 'yellow') {
        if (entity.correctionRate !== undefined && entity.correctionRate > RISK_THRESHOLDS.correctionRate.yellow) {
            return `黄牌：纠错率 ${entity.correctionRate.toFixed(1)}% > ${RISK_THRESHOLDS.correctionRate.yellow}%`;
        }
        if (entity.disclosureRate !== undefined && entity.disclosureRate < RISK_THRESHOLDS.disclosureRate.yellow) {
            return `黄牌：公开率 ${entity.disclosureRate.toFixed(1)}% < ${RISK_THRESHOLDS.disclosureRate.yellow}%`;
        }
    }

    return '正常：指标在安全范围内';
};
