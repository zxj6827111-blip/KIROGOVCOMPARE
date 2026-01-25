export const FEATURE_LEADER_COCKPIT =
  (process.env.REACT_APP_FEATURE_LEADER_COCKPIT || '').toLowerCase() === 'true';

export const LEADER_COCKPIT_DEFAULT_CITY_NAME = '淮安市';
export const LEADER_COCKPIT_DEFAULT_YEAR = 2024;
export const LEADER_COCKPIT_SERIES_YEARS = 5;

export type LeaderCockpitTaskMode = 'demo' | 'api';

export const LEADER_COCKPIT_TASK_MODE: LeaderCockpitTaskMode = 'demo';

export type DataConnectionState = 'auto' | 'connected' | 'not_connected';

export const LEADER_COCKPIT_CONNECTIONS: {
  litigation: DataConnectionState;
} = {
  litigation: 'auto',
};

// 样本量护栏：排名最小样本量门槛
export const MIN_N_FOR_RANKING = 30;

// 风险分级阈值配置
export const RISK_THRESHOLDS = {
  disclosureRate: {
    red: 60,    // 公开率 < 60% 为红牌
    yellow: 70, // 公开率 60%-70% 为黄牌
  },
  correctionRate: {
    red: 20,    // 纠错率 > 20% 为红牌
    yellow: 15, // 纠错率 15%-20% 为黄牌
  },
};
