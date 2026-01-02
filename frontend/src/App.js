import React, { useEffect, useMemo, useState } from 'react';
import './App.css';
import Login from './components/Login';
import UploadReport from './components/UploadReport';
import BatchUpload from './components/BatchUpload';
import ReportDetail from './components/ReportDetail';
import CityIndex from './components/CityIndex';
import RegionsManager from './components/RegionsManager';
import ComparisonHistory from './components/ComparisonHistory';
import ComparisonDetailView from './components/ComparisonDetailView';
import JobCenter from './components/JobCenter';
import JobDetail from './components/JobDetail';
import NotificationCenter from './components/NotificationCenter';
import { apiClient, API_BASE_URL, isAuthenticated, getCurrentUser, logout } from './apiClient';
import { Map, UploadCloud, ListTodo, PieChart, GitCompare, User } from 'lucide-react';

function App() {
  const [currentPath, setCurrentPath] = useState(`${window.location.pathname}${window.location.search}`);
  const [user, setUser] = useState(() => getCurrentUser());
  const [authChecked, setAuthChecked] = useState(false);
  const [showBatchUpload, setShowBatchUpload] = useState(false);

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

  // Show login if not authenticated
  if (!user) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const renderContent = () => {
    if (pathname === '/regions') return <RegionsManager />;
    if (pathname === '/upload') return <UploadReport />;
    if (pathname === '/jobs' || pathname === '/jobs/') return <JobCenter />;
    if (pathname.startsWith('/jobs/')) {
      const versionId = pathname.split('/').pop();
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
          <h1>📊 政府信息公开年度报告差异比对系统</h1>
          <p>后台管理系统</p>
        </div>
        <div className="header-user">
          <NotificationCenter />
          <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <User size={18} />
            {user.displayName || user.username}
          </span>
          <button onClick={handleLogout} className="logout-btn">退出登录</button>
        </div>
      </header>

      <nav className="nav">
        <button
          type="button"
          className={`nav-btn ${isNavActive('/regions') ? 'active' : ''}`}
          onClick={() => navigate('/regions')}
        >
          <Map size={20} className="nav-icon" />
          <span>城市管理</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${isNavActive('/upload') ? 'active' : ''}`}
          onClick={() => navigate('/upload')}
        >
          <UploadCloud size={20} className="nav-icon" />
          <span>上传报告</span>
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
          className={`nav-btn ${isNavActive('/catalog') ? 'active' : ''}`}
          onClick={() => navigate('/catalog')}
        >
          <PieChart size={20} className="nav-icon" />
          <span>年报汇总</span>
        </button>
        <button
          type="button"
          className={`nav-btn ${isNavActive('/history') ? 'active' : ''}`}
          onClick={() => navigate('/history')}
        >
          <GitCompare size={20} className="nav-icon" />
          <span>比对结果汇总</span>
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
