export const FEATURE_LEADER_COCKPIT =
  (process.env.REACT_APP_FEATURE_LEADER_COCKPIT || '').toLowerCase() === 'true';

export const LEADER_COCKPIT_DEFAULT_CITY_NAME =
  (process.env.REACT_APP_LEADER_COCKPIT_DEFAULT_CITY_NAME || '').trim();
export const LEADER_COCKPIT_DEFAULT_YEAR = Number(process.env.REACT_APP_LEADER_COCKPIT_DEFAULT_YEAR || '');
export const LEADER_COCKPIT_SERIES_YEARS = 5;

export type LeaderCockpitTaskMode = 'demo' | 'api';

const taskModeRaw = (process.env.REACT_APP_LEADER_COCKPIT_TASK_MODE || 'api').toLowerCase();
export const LEADER_COCKPIT_TASK_MODE: LeaderCockpitTaskMode = taskModeRaw === 'demo' ? 'demo' : 'api';

export type DataConnectionState = 'auto' | 'connected' | 'not_connected';

export const LEADER_COCKPIT_CONNECTIONS: {
  litigation: DataConnectionState;
} = {
  litigation: 'auto',
};

// 最小样本量护栏：排名至少需要达到该样本量
export const MIN_N_FOR_RANKING = 30;

// 风险分级阈值配置
export const RISK_THRESHOLDS = {
  disclosureRate: {
    red: 60,
    yellow: 70,
  },
  correctionRate: {
    red: 20,
    yellow: 15,
  },
};
