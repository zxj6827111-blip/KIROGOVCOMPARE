import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import './styles/tokens.css';
import './styles/base.css';
import './styles/print.css';
import './App.css';
import Login from './components/Login';
import UploadReport from './components/UploadReport';

import ReportDetail from './components/ReportDetail';
import CityIndex from './components/CityIndex';
import SystemManagement from './components/SystemManagement';
import ComparisonHistory from './components/ComparisonHistory';
import ComparisonDetailView from './components/ComparisonDetailView';
import ComparisonPrintView from './components/print/ComparisonPrintView';
import GovInsightReportPrintView from './components/print/GovInsightReportPrintView';

import JobCenter from './components/JobCenter';
import JobDetail from './components/JobDetail';
import IssueList from './components/IssueList';
import ReportMaintenance from './components/ReportMaintenance';
import { ToastProvider } from './components/common/ToastProvider';
import { ConfirmDialogProvider } from './components/common/ConfirmDialogProvider';
import { TaskDrawerProvider } from './components/tasks/TaskDrawerProvider';
import ErrorBoundary from './components/common/ErrorBoundary';
import AppShell from './components/app/AppShell';
import NotFound from './components/NotFound';

import DataCenterReportsList from './components/datacenter/DataCenterReportsList';
import DataCenterReportDetail from './components/datacenter/DataCenterReportDetail';
import { isAuthenticated, getCurrentUser, logout } from './apiClient';
import GovInsightModule from './govinsight/DashboardApp';
import { appendReturnTo, getRouteForPath } from './app/routeRegistry';
import { resolveRouteReturnTo } from './app/returnTo';

function ComparisonPrintRoute() {
  const { comparisonId } = useParams();
  return <ComparisonPrintView comparisonId={comparisonId} />;
}

function GovInsightPrintRoute() {
  const { orgId = '', year = '' } = useParams();
  return <GovInsightReportPrintView orgId={decodeURIComponent(orgId)} year={Number(year)} />;
}

function DataCenterRoute({ navigate }) {
  return (
    <DataCenterReportsList
      onSelectReport={(reportId) => navigate(`/datacenter/reports/${reportId}`, { state: { returnTo: '/datacenter' } })}
    />
  );
}

function DataCenterReportRoute({ navigate }) {
  const { reportId } = useParams();
  const location = useLocation();
  const returnTo = resolveRouteReturnTo(location.search, location.pathname, '/datacenter', location.state);
  return <DataCenterReportDetail reportId={reportId} onBack={() => navigate(returnTo)} />;
}

function JobDetailRoute({ navigate }) {
  const { versionId } = useParams();
  const location = useLocation();

  if (!versionId || versionId === 'undefined' || Number.isNaN(Number(versionId))) {
    return <Navigate to="/jobs" replace />;
  }

  const returnTo = resolveRouteReturnTo(location.search, location.pathname, '/jobs', location.state);
  return <JobDetail versionId={versionId} onBack={() => navigate(returnTo)} />;
}

function CatalogRoute({ currentPath, navigate }) {
  return (
    <CityIndex
      onNavigate={navigate}
      onSelectReport={(reportId, returnPath = currentPath) => navigate(appendReturnTo(`/catalog/reports/${reportId}`, returnPath))}
      onViewComparison={(comparisonId) => navigate(appendReturnTo(`/comparison/${comparisonId}`, '/history'))}
    />
  );
}

function ReportDetailRoute({ navigate }) {
  const { reportId } = useParams();
  const location = useLocation();
  const returnTo = resolveRouteReturnTo(location.search, location.pathname, '/catalog', location.state);
  return <ReportDetail reportId={reportId} onBack={() => navigate(returnTo)} />;
}

function IssueListRoute({ currentPath, navigate }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const regionId = params.get('region');
  const regionName = params.get('name');

  return (
    <IssueList
      regionId={regionId}
      regionName={regionName}
      onBack={() => navigate(resolveRouteReturnTo(location.search, location.pathname, '/catalog', location.state))}
      onSelectReport={(reportId) => navigate(appendReturnTo(`/catalog/reports/${reportId}`, currentPath || '/catalog'))}
    />
  );
}

function ReportMaintenanceRoute({ navigate }) {
  const location = useLocation();
  const returnTo = resolveRouteReturnTo(location.search, location.pathname, '/catalog', location.state);
  return <ReportMaintenance onBack={() => navigate(returnTo)} onNavigate={navigate} />;
}

function ComparisonDetailRoute({ navigate }) {
  const { comparisonId } = useParams();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const autoPrint = searchParams.get('autoPrint') === 'true';
  const returnTo = resolveRouteReturnTo(location.search, location.pathname, '/history', location.state);

  return (
    <ComparisonDetailView
      comparisonId={comparisonId}
      onBack={() => navigate(returnTo)}
      autoPrint={autoPrint}
    />
  );
}

function AuthenticatedApp({ onLogout, user }) {
  const location = useLocation();
  const routerNavigate = useNavigate();
  const currentPath = `${location.pathname}${location.search}`;
  const activeRoute = getRouteForPath(location.pathname);
  const isLeaderCockpitRoute = location.pathname === '/govinsight/leader-cockpit';
  const navigate = useCallback(
    (path, options) => {
      if (!path) return;
      routerNavigate(path, options);
    },
    [routerNavigate]
  );

  return (
    <ToastProvider>
      <ConfirmDialogProvider>
        <TaskDrawerProvider navigate={navigate} disabled={isLeaderCockpitRoute}>
          <AppShell
            currentPath={currentPath}
            navigate={navigate}
            onLogout={onLogout}
            route={activeRoute}
            user={user}
          >
            <Routes>
              <Route path="/" element={<Navigate to="/catalog" replace />} />
              <Route path="/catalog" element={<CatalogRoute currentPath={currentPath} navigate={navigate} />} />
              <Route path="/catalog/reports" element={<CatalogRoute currentPath={currentPath} navigate={navigate} />} />
              <Route path="/catalog/reports/:reportId" element={<ReportDetailRoute navigate={navigate} />} />
              <Route path="/upload" element={<UploadReport />} />
              <Route path="/jobs" element={<JobCenter />} />
              <Route path="/jobs/:versionId" element={<JobDetailRoute navigate={navigate} />} />
              <Route path="/history" element={<ComparisonHistory />} />
              <Route path="/comparison/:comparisonId" element={<ComparisonDetailRoute navigate={navigate} />} />
              <Route path="/issues/*" element={<IssueListRoute currentPath={currentPath} navigate={navigate} />} />
              <Route path="/report-maintenance" element={<ReportMaintenanceRoute navigate={navigate} />} />
              <Route path="/admin" element={<SystemManagement activeTab={new URLSearchParams(location.search).get('tab') || 'regions'} onNavigate={navigate} user={user} />} />
              <Route path="/regions" element={<SystemManagement activeTab="regions" onNavigate={navigate} user={user} />} />
              <Route path="/admin/users" element={<SystemManagement activeTab="users" onNavigate={navigate} user={user} />} />
              <Route path="/datacenter" element={<DataCenterRoute navigate={navigate} />} />
              <Route path="/datacenter/reports/:reportId" element={<DataCenterReportRoute navigate={navigate} />} />
              <Route path="/govinsight/*" element={<GovInsightModule />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AppShell>
        </TaskDrawerProvider>
      </ConfirmDialogProvider>
    </ToastProvider>
  );
}

function App() {
  const navigate = useNavigate();
  const [user, setUser] = useState(() => getCurrentUser());
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (isAuthenticated()) {
      setUser(getCurrentUser());
    }
    setAuthChecked(true);
  }, []);

  const handleLoginSuccess = (userData) => {
    setUser(userData);
    navigate('/catalog');
  };

  const handleLogout = () => {
    logout();
    setUser(null);
  };

  if (!authChecked) {
    return (
      <div className="app app-loading">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/print/comparison/:comparisonId" element={<ComparisonPrintRoute />} />
        <Route path="/print/govinsight-report/:orgId/:year" element={<GovInsightPrintRoute />} />
        <Route
          path="/*"
          element={
            user ? (
              <AuthenticatedApp onLogout={handleLogout} user={user} />
            ) : (
              <Login onLoginSuccess={handleLoginSuccess} />
            )
          }
        />
      </Routes>
    </ErrorBoundary>
  );
}

export default App;
