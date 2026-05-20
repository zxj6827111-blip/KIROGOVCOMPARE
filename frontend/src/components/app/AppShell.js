import React from 'react';
import Logo from '../Logo';
import { User } from 'lucide-react';
import {
  getNavGroupForPath,
  getPrimaryNavTarget,
  getVisiblePrimaryNavItems,
  NAV_GROUP_LABELS,
  NAV_GROUPS,
} from '../../app/routeRegistry';
import './AppShell.css';

function AppShell({
  children,
  currentPath,
  navigate,
  onLogout,
  user,
}) {
  const pathname = new URL(currentPath, window.location.origin).pathname;
  const activeNavGroup = getNavGroupForPath(pathname);
  const navItems = getVisiblePrimaryNavItems(user);

  return (
    <div className="app app-shell">
      <header className="app-shell__header">
        <Logo />
        <div className="app-shell__user">
          {user?.permissions?.manage_users && (
            <button
              type="button"
              onClick={() => navigate('/admin/users')}
              className={`app-shell__user-nav ${activeNavGroup === NAV_GROUPS.ADMIN ? 'active' : ''}`}
              title="用户管理"
            >
              <User size={18} />
              <span>用户管理</span>
            </button>
          )}

          <span className="app-shell__identity">
            <span className="app-shell__avatar">
              {user?.displayName?.[0] || user?.username?.[0] || 'A'}
            </span>
            <span className="app-shell__name">{user?.displayName || user?.username}</span>
          </span>
          <button type="button" onClick={onLogout} className="logout-btn">退出登录</button>
        </div>
      </header>

      <nav className="app-shell__nav" aria-label="主导航">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = activeNavGroup === item.navGroup;
          return (
            <button
              key={item.key}
              type="button"
              className={`app-shell__nav-btn ${active ? 'active' : ''}`}
              onClick={() => navigate(getPrimaryNavTarget(item, user))}
              title={NAV_GROUP_LABELS[item.navGroup]}
            >
              {Icon && <Icon size={20} className="nav-icon" />}
              <span>{item.navLabel || item.title}</span>
            </button>
          );
        })}
      </nav>

      <main className="app-shell__main">{children}</main>

      <footer className="app-shell__footer">
        <p>© 2025 政府信息公开年度报告差异比对系统</p>
      </footer>
    </div>
  );
}

export default AppShell;
