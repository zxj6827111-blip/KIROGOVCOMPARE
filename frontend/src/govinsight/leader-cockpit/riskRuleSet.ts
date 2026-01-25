export const RISK_RULE_SET = {
    version: 'RiskRuleSet v1.2',
    name: '法治政府建设考核风险评估模型',
    thresholds: {
        red: {
            correction: '> 15.0%',
            disclosure: '< 40.0%',
        },
        yellow: {
            correction: '> 10.0%',
            disclosure: '< 45.0%',
        }
    },
    guardrails: [
        '样本量 < 30 (Observation): 不参与红黄牌评定，仅标记',
        '数据缺失 (Missing): 不参与评定，需接入年报',
        '稳定性保护 (Stability): 小样本或缺失数据标记为低稳定性'
    ],
    descriptions: [
        '红牌 (High Risk): 实质公开率显著低 / 纠错率显著高，建议重点约谈',
        '黄牌 (Medium Risk): 指标偏离正常区间，建议督促改进',
        '绿牌 (Low Risk): 指标在安全范围内'
    ]
};

export const STABILITY_RULES = {
    high: { description: '样本充足(N>=100)且数据完整', label: '样本充足' },
    medium: { description: '样本一般(30<=N<100)或轻微缺失', label: '样本一般' },
    low: { description: '样本偏少(N<30)或关键数据缺失', label: '样本偏少' }
};
