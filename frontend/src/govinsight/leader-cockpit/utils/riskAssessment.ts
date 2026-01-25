import type { EntityMetrics } from '../types';
import { RISK_THRESHOLDS, MIN_N_FOR_RANKING } from '../config';

export type RiskLevel = 'red' | 'yellow' | 'green' | 'missing';

/**
 * 评估实体的风险等级
 * 红牌：公开率<60% 或 纠错率>20%（且样本量>=门槛）
 * 黄牌：公开率60%-70% 或 纠错率15%-20%（且样本量>=门槛）
 * 绿牌：正常
 * missing：数据缺失
 */
export function assessRiskLevel(entity: EntityMetrics): RiskLevel {
    const {
        disclosureRate,
        disclosureRateStatus,
        correctionRate,
        correctionRateStatus,
        acceptedTotal,
        isSampleSufficient
    } = entity;

    // 数据缺失
    if (disclosureRateStatus === 'MISSING' || correctionRateStatus === 'MISSING') {
        return 'missing';
    }

    // 样本量不足，不判定风险
    if (!isSampleSufficient || (acceptedTotal !== undefined && acceptedTotal < MIN_N_FOR_RANKING)) {
        return 'green';
    }

    // 红牌判定
    if (disclosureRate !== undefined && disclosureRate < RISK_THRESHOLDS.disclosureRate.red) {
        return 'red';
    }
    if (correctionRate !== undefined && correctionRate > RISK_THRESHOLDS.correctionRate.red) {
        return 'red';
    }

    // 黄牌判定（接近阈值）
    if (disclosureRate !== undefined &&
        disclosureRate >= RISK_THRESHOLDS.disclosureRate.red &&
        disclosureRate < RISK_THRESHOLDS.disclosureRate.yellow) {
        return 'yellow';
    }
    if (correctionRate !== undefined &&
        correctionRate <= RISK_THRESHOLDS.correctionRate.red &&
        correctionRate > RISK_THRESHOLDS.correctionRate.yellow) {
        return 'yellow';
    }

    return 'green';
}

/**
 * 获取风险原因说明
 */
export function getRiskReason(entity: EntityMetrics, riskLevel: RiskLevel): string {
    const { disclosureRate, correctionRate, acceptedTotal } = entity;

    if (riskLevel === 'missing') {
        return '数据待接入';
    }

    if (riskLevel === 'green') {
        if (acceptedTotal !== undefined && acceptedTotal < MIN_N_FOR_RANKING) {
            return `样本量不足（${acceptedTotal}件）`;
        }
        return '指标正常';
    }

    const reasons: string[] = [];

    if (disclosureRate !== undefined && disclosureRate < RISK_THRESHOLDS.disclosureRate.red) {
        reasons.push(`公开率过低（${disclosureRate.toFixed(1)}%）`);
    } else if (disclosureRate !== undefined && disclosureRate < RISK_THRESHOLDS.disclosureRate.yellow) {
        reasons.push(`公开率接近红线（${disclosureRate.toFixed(1)}%）`);
    }

    if (correctionRate !== undefined && correctionRate > RISK_THRESHOLDS.correctionRate.red) {
        reasons.push(`纠错率过高（${correctionRate.toFixed(1)}%）`);
    } else if (correctionRate !== undefined && correctionRate > RISK_THRESHOLDS.correctionRate.yellow) {
        reasons.push(`纠错率接近红线（${correctionRate.toFixed(1)}%）`);
    }

    return reasons.join('；') || '风险待评估';
}
