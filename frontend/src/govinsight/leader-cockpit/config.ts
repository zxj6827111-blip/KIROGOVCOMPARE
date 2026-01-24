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
