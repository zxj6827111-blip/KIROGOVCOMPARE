import React from 'react';
// 使用 HashRouter 以确保与主应用的 URL (pushState) 互不干扰
// 在组件内部，它会有自己的 #/portrait, #/risk 等路由
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { DashboardHome } from './views/DashboardHome';
import { OperationAnalysis } from './views/OperationAnalysis';
import { RiskAnalysis } from './views/RiskAnalysis';
import { PolicyRegulation } from './views/PolicyRegulation';
import { RegionalBenchmark } from './views/RegionalBenchmark';
import { EntityPortrait } from './views/EntityPortrait';
import { ReportGenerator } from './views/ReportGenerator';

import './tailwind.css';

// 这个组件就是您将在 Legacy App 中导入的组件
// 例如: import GovInsightModule from './gov-insight/App';
const GovInsightModule: React.FC = () => {
  return (
    <div className="gov-dashboard-root" style={{ width: '100%' }}>
      {/* HashRouter 创建一个独立的路由上下文 */}
      <HashRouter>
        <Layout>
          <Routes>
            <Route path="/" element={<DashboardHome />} />
            <Route path="/portrait" element={<EntityPortrait />} />
            <Route path="/operations" element={<OperationAnalysis />} />
            <Route path="/risk" element={<RiskAnalysis />} />
            <Route path="/policy" element={<PolicyRegulation />} />
            <Route path="/benchmark" element={<RegionalBenchmark />} />
            <Route path="/report" element={<ReportGenerator />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </HashRouter>
    </div>
  );
};

export default GovInsightModule;