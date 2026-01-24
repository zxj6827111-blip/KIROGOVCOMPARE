import React from 'react';
import type { ActionPackTemplateInstance, LeaderCockpitModel, MetricValue } from '../types';
import { FunnelPanel } from '../components/FunnelPanel';
import { AttributionTopList } from '../components/AttributionTopList';
import { formatPercent, getMetricDisplay } from '../utils';

interface Step3FunnelProps {
  model: LeaderCockpitModel;
  onShowDefinition: (definition: MetricValue['definition'] | undefined) => void;
  onShowEvidence: (evidence: MetricValue['evidence'] | undefined) => void;
  onCreateActionPack: (pack: ActionPackTemplateInstance) => void;
}

const renderRate = (metric: MetricValue) => {
  return getMetricDisplay(metric, (value) => formatPercent(value, 1));
};

export const Step3Funnel: React.FC<Step3FunnelProps> = ({
  model,
  onShowDefinition,
  onShowEvidence,
  onCreateActionPack,
}) => {
  return (
    <div className="space-y-6">
      <FunnelPanel
        newApplications={model.funnel.newApplications}
        disputeCases={model.funnel.disputeCases}
        correctionCases={model.funnel.correctionCases}
        onShowDefinition={onShowDefinition}
        onShowEvidence={onShowEvidence}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {[
          { label: '争议转化率', metric: model.funnel.rates.disputeConversion },
          { label: '纠错转化率', metric: model.funnel.rates.correctionConversion },
          { label: '纠错率', metric: model.funnel.rates.correctionRate },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-slate-200 rounded-lg p-4">
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
            <div className="mt-3 text-2xl font-bold text-slate-800">
              {renderRate(item.metric)}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AttributionTopList
          title="Top 归因（原因项）"
          items={model.funnel.topAttributions.byReason}
          missingText="待接入原因结构"
        />
        <AttributionTopList
          title="Top 归因（答复结构）"
          items={model.funnel.topAttributions.byResponseType}
          missingText="待接入答复结构"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-500">
        口径提示：诉讼数据如未接入，将以复议数据口径展示并标记提示。
        <button
          type="button"
          onClick={() => {
            const pack = model.actionPacks.templates[model.actionPacks.templates.length - 1];
            if (pack) onCreateActionPack(pack);
          }}
          className="ml-3 text-blue-600"
        >
          基于风险生成行动包
        </button>
      </div>
    </div>
  );
};
