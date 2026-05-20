import React, { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { resolveGovInsightLegacyHash } from '../app/govInsightRoutes';
import { Layout } from './components/Layout';
import { DashboardHome } from './views/DashboardHome';
import { OperationAnalysis } from './views/OperationAnalysis';
import { RiskAnalysis } from './views/RiskAnalysis';
import { PolicyRegulation } from './views/PolicyRegulation';
import { RegionalBenchmark } from './views/RegionalBenchmark';
import { EntityPortrait } from './views/EntityPortrait';
import { ReportGenerator } from './views/ReportGenerator';
import { LeaderCockpit } from './leader-cockpit/LeaderCockpit';

import './tailwind.css';

const GovInsightModule: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const legacyTarget = resolveGovInsightLegacyHash(location.pathname, location.hash);
    if (legacyTarget) {
      navigate(legacyTarget, { replace: true });
    }
  }, [location.hash, location.pathname, navigate]);

  return (
    <div className="gov-dashboard-root" style={{ width: '100%' }}>
      <Layout>
        <Routes>
          <Route index element={<DashboardHome />} />
          <Route path="portrait" element={<EntityPortrait />} />
          <Route path="operations" element={<OperationAnalysis />} />
          <Route path="risk" element={<RiskAnalysis />} />
          <Route path="policy" element={<PolicyRegulation />} />
          <Route path="benchmark" element={<RegionalBenchmark />} />
          <Route path="report" element={<ReportGenerator />} />
          <Route path="leader-cockpit" element={<LeaderCockpit />} />
          <Route path="*" element={<Navigate to="/govinsight" replace />} />
        </Routes>
      </Layout>
    </div>
  );
};

export default GovInsightModule;
