import React, { useMemo } from 'react';
import { Building2, Users } from 'lucide-react';
import PageHeader from './common/PageHeader';
import RegionsManager from './RegionsManager';
import UserManagement from './UserManagement';
import './SystemManagement.css';

function resolveTab(requestedTab, user) {
  const canManageRegions = Boolean(user?.permissions?.manage_regions);
  const canManageUsers = Boolean(user?.permissions?.manage_users);

  if (requestedTab === 'users' && canManageUsers) return 'users';
  if (requestedTab === 'regions' && canManageRegions) return 'regions';
  if (canManageRegions) return 'regions';
  if (canManageUsers) return 'users';
  return 'none';
}

function SystemManagement({ activeTab: requestedTab = 'regions', onNavigate, user }) {
  const canManageRegions = Boolean(user?.permissions?.manage_regions);
  const canManageUsers = Boolean(user?.permissions?.manage_users);
  const activeTab = useMemo(
    () => resolveTab(requestedTab, user),
    [requestedTab, user]
  );

  const switchTab = (tab) => {
    if (!onNavigate) return;
    onNavigate(tab === 'users' ? '/admin?tab=users' : '/admin?tab=regions');
  };

  return (
    <div className="system-management kc-page kc-page--wide">
      <PageHeader
        title="系统管理"
        subtitle="集中管理行政区划、部门目录、用户权限和数据范围。"
        actions={(
          <div className="kc-segmented system-management__tabs" role="tablist" aria-label="系统管理模块">
            {canManageRegions && (
              <button
                type="button"
                className={activeTab === 'regions' ? 'active' : ''}
                onClick={() => switchTab('regions')}
              >
                <Building2 size={16} />
                城市管理
              </button>
            )}
            {canManageUsers && (
              <button
                type="button"
                className={activeTab === 'users' ? 'active' : ''}
                onClick={() => switchTab('users')}
              >
                <Users size={16} />
                用户管理
              </button>
            )}
          </div>
        )}
      />

      {activeTab === 'regions' && <RegionsManager />}
      {activeTab === 'users' && <UserManagement />}
      {activeTab === 'none' && (
        <div className="kc-panel system-management__empty">
          当前账号没有系统管理权限。
        </div>
      )}
    </div>
  );
}

export default SystemManagement;
