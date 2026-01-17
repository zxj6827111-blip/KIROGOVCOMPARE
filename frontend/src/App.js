import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import Login from './components/Login';
import UploadReport from './components/UploadReport';

import ReportDetail from './components/ReportDetail';
import CityIndex from './components/CityIndex';
import RegionsManager from './components/RegionsManager';
import ComparisonHistory from './components/ComparisonHistory';
import ComparisonDetailView from './components/ComparisonDetailView';
import ComparisonPrintView from './components/print/ComparisonPrintView';
import UserManagement from './components/UserManagement';

import JobCenter from './components/JobCenter';
import JobDetail from './components/JobDetail';
import IssueList from './components/IssueList';

import DataCenterReportsList from './components/datacenter/DataCenterReportsList';
import DataCenterReportDetail from './components/datacenter/DataCenterReportDetail';
import { API_BASE_URL, isAuthenticated, getCurrentUser, logout } from './apiClient';
import { Map, UploadCloud, ListTodo, PieChart, GitCompare, User, Activity } from 'lucide-react';
import GovInsightModule from './govinsight/DashboardApp';

function App() {
  const [currentPath, setCurrentPath] = useState(`${window.location.pathname}${window.location.search}`);
  const [user, setUser] = useState(() => getCurrentUser());
  const [authChecked, setAuthChecked] = useState(false);


  // Check auth on mount
  useEffect(() => {
    if (isAuthenticated()) {
      setUser(getCurrentUser());
    }
    setAuthChecked(true);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(`${window.location.pathname}${window.location.search}`);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path) => {
    if (path === currentPath) return;
    window.history.pushState({}, '', path);
    setCurrentPath(path);
  };

  const location = useMemo(() => new URL(currentPath, window.location.origin), [currentPath]);
  const pathname = location.pathname;

  useEffect(() => {
    if (pathname === '/') {
      navigate('/catalog');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    navigate('/catalog');
  };

  const handleLogout = () => {
    logout();
    setUser(null);
  };

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <div className="app app-loading">
        <p>加载中...</p>
      </div>
    );
  }

  // Special route for print pages (no auth required for Puppeteer PDF export)
  if (pathname.startsWith('/print/comparison/')) {
    const comparisonId = pathname.split('/').pop();
    return <ComparisonPrintView comparisonId={comparisonId} />;
  }

  // Show login if not authenticated
  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const renderContent = () => {
    if (pathname === '/govinsight' || pathname.startsWith('/govinsight')) {
      return <GovInsightModule />;
    }
    if (pathname === '/regions') return <RegionsManager />;
    if (pathname === '/upload') return <UploadReport />;
    if (pathname === '/jobs' || pathname === '/jobs/') return <JobCenter />;
    if (pathname === '/admin/users') return <UserManagement />;
    if (pathname === '/datacenter') {
      return <DataCenterReportsList onSelectReport={(reportId) => navigate(`/datacenter/reports/${reportId}`)} />;
    }
    if (pathname.startsWith('/datacenter/reports/')) {
      const reportId = pathname.split('/').pop();
      return <DataCenterReportDetail reportId={reportId} onBack={() => navigate('/datacenter')} />;
    }
    if (pathname.startsWith('/jobs/')) {
      const versionId = pathname.split('/').pop();
      // Validate versionId
      if (!versionId || versionId === 'undefined' || isNaN(Number(versionId))) {
        // Invalid versionId, redirect to jobs list
        navigate('/jobs');
        return null;
      }
      return <JobDetail versionId={versionId} onBack={() => navigate('/jobs')} />;
    }
    if (pathname === '/catalog' || pathname === '/catalog/reports') {
      return <CityIndex
        onSelectReport={(reportId) => navigate(`/catalog/reports/${reportId}`)}
        onViewComparison={(comparisonId) => navigate(`/comparison/${comparisonId}`)}
      />;
    }
    if (pathname.startsWith('/catalog/reports/')) {
      const reportId = pathname.split('/').pop();
      return <ReportDetail reportId={reportId} onBack={() => window.history.back()} />;
    }
    if (pathname === '/history') return <ComparisonHistory />;
    if (pathname === '/issues' || pathname.startsWith('/issues')) {
      // Extract region ID from query params if present
      const params = new URLSearchParams(window.location.search);
      const regionId = params.get('region');
      const regionName = params.get('name');
      return <IssueList
        regionId={regionId}
        regionName={regionName}
        onBack={() => navigate('/catalog')}
        onSelectReport={(reportId) => navigate(`/catalog/reports/${reportId}`)}
      />;
    }
    if (pathname.startsWith('/comparison/')) {
      // Extract ID from /comparison/:id
      const parts = pathname.split('/');
      const id = parts[parts.length - 1]; // or parts[2]
      // Check for autoPrint query param
      const autoPrint = new URLSearchParams(window.location.search).get('autoPrint') === 'true';
      return <ComparisonDetailView comparisonId={id} onBack={() => navigate('/history')} autoPrint={autoPrint} />;
    }
    return <CityIndex onSelectReport={(reportId) => navigate(`/catalog/reports/${reportId}`)} />;
  };

  const isNavActive = (path) => pathname.startsWith(path);

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <h1>政府信息公开年度报告差异比对系统</h1>
          <p>后台管理系统</p>
        </div>
        <div className="header-user">
          {/* User Management moved to header, replacing NotificationCenter as requested */}
          {(user.permissions?.manage_users || user.username === 'admin' || user.id === 1) && (
            <button
              onClick={() => navigate('/admin/users')}
              className={`header-nav-btn ${isNavActive('/admin/users') ? 'active' : ''}`}
              title="用户管理"
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                color: isNavActive('/admin/users') ? '#2563eb' : '#64748b',
                fontWeight: 500,
                fontSize: '14px',
                marginRight: '12px'
              }}
            >
              <User size={18} />
              <span>用户管理</span>
            </button>
          )}

          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', background: '#eff6ff',
              color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 'bold', fontSize: '14px'
            }}>
              {user.displayName?.[0] || user.username?.[0] || 'A'}
            </div>
            <span style={{ fontWeight: 500 }}>{user.displayName || user.username}</span>
          </span>
          <button onClick={handleLogout} className="logout-btn">退出登录</button>
        </div>
      </header>

      <nav className="nav">
        {(user.permissions?.manage_cities || user.username === 'admin' || user.id === 1) && (
          <button
            type="button"
            className={`nav-btn ${isNavActive('/regions') ? 'active' : ''}`}
            onClick={() => navigate('/regions')}
          >
            <Map size={20} className="nav-icon" />
            <span>城市管理</span>
          </button>
        )}
        {(user.permissions?.upload_reports || user.username === 'admin' || user.id === 1) && (
          <button
            type="button"
            className={`nav-btn ${isNavActive('/upload') ? 'active' : ''}`}
            onClick={() => navigate('/upload')}
          >
            <UploadCloud size={20} className="nav-icon" />
            <span>上传报告</span>
          </button>
        )}
        <button
          type="button"
          className={`nav-btn ${isNavActive('/catalog') ? 'active' : ''}`}
          onClick={() => navigate('/catalog')}
        >
          <PieChart size={20} className="nav-icon" />
          <span>年报汇总</span>
        </button>
        {/* <button
          type="button"
          className={`nav-btn ${isNavActive('/datacenter') ? 'active' : ''}`}
          onClick={() => navigate('/datacenter')}
        >
          <Database size={20} className="nav-icon" />
          <span>Data Center</span>
        </button> */}
        <button
          type="button"
          className={`nav-btn ${isNavActive('/history') ? 'active' : ''}`}
          onClick={() => navigate('/history')}
        >
          <GitCompare size={20} className="nav-icon" />
          <span>比对结果汇总</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${isNavActive('/jobs') ? 'active' : ''}`}
          onClick={() => navigate('/jobs')}
        >
          <ListTodo size={20} className="nav-icon" />
          <span>任务中心</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${isNavActive('/govinsight') ? 'active' : ''}`}
          onClick={() => navigate('/govinsight')}
        >
          <Activity size={20} className="nav-icon" />
          <span>智慧治理</span>
        </button>
      </nav>

      <main className="main">{renderContent()}</main>

      <footer className="footer">
        <p>© 2025 政府信息公开年度报告差异比对系统 | 后端 API: {API_BASE_URL || '同域 /dev proxy'}</p>
      </footer>
    </div>
  );
}

export default App;
