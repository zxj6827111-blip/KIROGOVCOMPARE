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
import GovInsightReportPrintView from './components/print/GovInsightReportPrintView';
import UserManagement from './components/UserManagement';

import JobCenter from './components/JobCenter';
import JobDetail from './components/JobDetail';
import IssueList from './components/IssueList';
import ReportMaintenance from './components/ReportMaintenance';
import { ToastProvider } from './components/common/ToastProvider';
import { ConfirmDialogProvider } from './components/common/ConfirmDialogProvider';
import AppShell from './components/app/AppShell';

import DataCenterReportsList from './components/datacenter/DataCenterReportsList';
import DataCenterReportDetail from './components/datacenter/DataCenterReportDetail';
import { isAuthenticated, getCurrentUser, logout } from './apiClient';
import GovInsightModule from './govinsight/DashboardApp';
import { appendReturnTo, getRouteForPath } from './app/routeRegistry';
import { resolveRouteReturnTo } from './app/returnTo';

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
  const activeRoute = getRouteForPath(pathname);

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
  if (pathname.startsWith('/print/govinsight-report/')) {
    const parts = pathname.split('/');
    const orgId = decodeURIComponent(parts[parts.length - 2] || '');
    const year = Number(parts[parts.length - 1]);
    return <GovInsightReportPrintView orgId={orgId} year={year} />;
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
      const returnTo = resolveRouteReturnTo(location.search, pathname, '/jobs');
      return <JobDetail versionId={versionId} onBack={() => navigate(returnTo)} />;
    }
    if (pathname === '/catalog' || pathname === '/catalog/reports') {
      return <CityIndex
        onNavigate={navigate}
        onSelectReport={(reportId) => navigate(appendReturnTo(`/catalog/reports/${reportId}`, currentPath))}
        onViewComparison={(comparisonId) => navigate(appendReturnTo(`/comparison/${comparisonId}`, '/history'))}
      />;
    }
    if (pathname.startsWith('/catalog/reports/')) {
      const reportId = pathname.split('/').pop();
      const returnTo = resolveRouteReturnTo(location.search, pathname, '/catalog');
      return <ReportDetail reportId={reportId} onBack={() => navigate(returnTo)} />;
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
        onSelectReport={(reportId) => navigate(appendReturnTo(`/catalog/reports/${reportId}`, currentPath || '/catalog'))}
      />;
    }
    if (pathname === '/report-maintenance') {
      return <ReportMaintenance onBack={() => navigate('/catalog')} onNavigate={navigate} />;
    }
    if (pathname.startsWith('/comparison/')) {
      // Extract ID from /comparison/:id
      const parts = pathname.split('/');
      const id = parts[parts.length - 1]; // or parts[2]
      // Check for autoPrint query param
      const autoPrint = new URLSearchParams(window.location.search).get('autoPrint') === 'true';
      const returnTo = resolveRouteReturnTo(location.search, pathname, '/history');
      return <ComparisonDetailView comparisonId={id} onBack={() => navigate(returnTo)} autoPrint={autoPrint} />;
    }
    return <CityIndex onNavigate={navigate} onSelectReport={(reportId) => navigate(appendReturnTo(`/catalog/reports/${reportId}`, '/catalog'))} />;
  };

  return (
    <ToastProvider>
      <ConfirmDialogProvider>
        <AppShell
          currentPath={currentPath}
          navigate={navigate}
          onLogout={handleLogout}
          route={activeRoute}
          user={user}
        >
          {renderContent()}
        </AppShell>
      </ConfirmDialogProvider>
    </ToastProvider>
  );
}

export default App;
