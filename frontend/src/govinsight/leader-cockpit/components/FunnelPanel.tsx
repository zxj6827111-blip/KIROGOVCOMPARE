import React from 'react';
import type { MetricValue } from '../types';
import { formatNumber, getMetricDisplay } from '../utils';

interface FunnelPanelProps {
  newApplications: MetricValue;
  disputeCases: MetricValue;
  correctionCases: MetricValue;
  onShowDefinition: (definition: MetricValue['definition'] | undefined) => void;
  onShowEvidence: (evidence: MetricValue['evidence'] | undefined) => void;
}

const renderValue = (metric: MetricValue) => {
  return getMetricDisplay(metric, (value) => formatNumber(value));
};

export const FunnelPanel: React.FC<FunnelPanelProps> = ({
  newApplications,
  disputeCases,
  correctionCases,
  onShowDefinition,
  onShowEvidence,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: '依申请新收', metric: newApplications },
          { label: '复议/诉讼立案', metric: disputeCases },
          { label: '纠错数', metric: correctionCases },
        ].map((item) => (
          <div key={item.label} className="bg-slate-50 rounded-lg border border-slate-100 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">{item.label}</span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onShowDefinition(item.metric.definition)}
                  className="text-[10px] text-blue-600"
                >
                  i 口径
                </button>
                <button
                  type="button"
                  onClick={() => onShowEvidence(item.metric.evidence)}
                  className="text-[10px] text-slate-500"
                >
                  查看证据
                </button>
              </div>
            </div>
            <div className="mt-3 text-2xl font-bold text-slate-800">{renderValue(item.metric)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
