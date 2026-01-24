import { FEATURE_LEADER_COCKPIT } from './config';

export const isLeaderCockpitEnabled = (): boolean => FEATURE_LEADER_COCKPIT;

type UserLike = {
  id?: number;
  username?: string;
  role?: string;
  permissions?: Record<string, boolean>;
};

export const canAccessLeaderCockpit = (user: UserLike | null | undefined): boolean => {
  if (!user) return false;
  if (user.username === 'admin' || user.id === 1) return true;
  if (user.role === 'System Admin') return true;
  if (user.permissions?.system_admin) return true;
  if (user.permissions?.manage_users) return true;
  return false;
};

export const isLeaderCockpitAdmin = (user: UserLike | null | undefined): boolean => {
  if (!user) return false;
  if (user.username === 'admin' || user.id === 1) return true;
  if (user.role === 'System Admin') return true;
  if (user.permissions?.system_admin) return true;
  return false;
};
