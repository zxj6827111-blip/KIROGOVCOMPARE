/**
 * 统计学工具函数
 * 用于计算分位数、稳健差距等
 */

/**
 * 计算数组的分位数 (Linear interpolation)
 * @param values 数值数组
 * @param p 分位数 (0 ~ 1)，例如 0.9 表示 P90
 */
export const percentile = (values: number[], p: number): number | null => {
    if (values.length === 0) return null;
    if (p < 0) p = 0;
    if (p > 1) p = 1;

    const sorted = [...values].sort((a, b) => a - b);
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos);
    const rest = pos - base;

    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
};

/**
 * 计算 P90 - P10 差距 (稳健差距)
 * @param values 数值数组
 * @param minSamples 最小样本量要求，默认 5
 */
export const robustGapP90P10 = (values: number[], minSamples: number = 5): number | null => {
    // 过滤掉 NaN, Infinity, null, undefined
    const validValues = values.filter(v => typeof v === 'number' && isFinite(v));

    if (validValues.length < minSamples) {
        return null;
    }

    const p90 = percentile(validValues, 0.9);
    const p10 = percentile(validValues, 0.1);

    if (p90 === null || p10 === null) return null;

    return p90 - p10;
};

/**
 * 计算 Max - Min 差距
 * @param values 数值数组
 */
export const maxMinGap = (values: number[]): number | null => {
    const validValues = values.filter(v => typeof v === 'number' && isFinite(v));
    if (validValues.length === 0) return null;

    const max = Math.max(...validValues);
    const min = Math.min(...validValues);
    return max - min;
};

/**
 * 格式化缺失原因
 */
export const formatMissingReason = (reason: string | undefined): string => {
    if (!reason) return '数据待接入'; // Default fallback

    // Map internal codes to display text if needed, or just return as is
    const map: Record<string, string> = {
        'NOT_CONNECTED': '待接入区县年报',
        'NOT_REPORTED': '未填报',
        'NOT_APPLICABLE': '不适用',
        'small_sample': '样本不足',
    };

    return map[reason] || reason;
};

/**
 * 格式化带有分母的比率
 * 示例: 15.0% (3/20)
 */
export const formatRateWithFrac = (rate: number | undefined, num: number | undefined, den: number | undefined): string => {
    if (rate === undefined || num === undefined || den === undefined) return '—';
    return `${rate.toFixed(1)}% (${num}/${den})`;
};
