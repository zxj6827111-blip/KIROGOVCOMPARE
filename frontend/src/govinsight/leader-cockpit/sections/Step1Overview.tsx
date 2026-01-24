import React from 'react';
import type { LeaderCockpitModel, MetricValue } from '../types';
import { MetricCardRow } from '../components/MetricCardRow';
import { TrendSwitcher } from '../components/TrendSwitcher';

interface Step1OverviewProps {
  model: LeaderCockpitModel;
  selectedDisclosureVariant: string;
  selectedCorrectionVariant: string;
  onDisclosureVariantChange: (variantId: string) => void;
  onCorrectionVariantChange: (variantId: string) => void;
  onShowDefinition: (definition: MetricValue['definition'] | undefined) => void;
  onShowEvidence: (evidence: MetricValue['evidence'] | undefined) => void;
}

const applyVariant = (metric: MetricValue, variantId: string): MetricValue => {
  const variant = metric.variants?.find((v) => v.id === variantId) || metric.variants?.[0];
  if (!variant) return metric;
  return {
    ...metric,
    value: variant.value,
    status: variant.status,
  };
};

export const Step1Overview: React.FC<Step1OverviewProps> = ({
  model,
  selectedDisclosureVariant,
  selectedCorrectionVariant,
  onDisclosureVariantChange,
  onCorrectionVariantChange,
  onShowDefinition,
  onShowEvidence,
}) => {
  const disclosureMetric = applyVariant(model.metrics.substantiveDisclosureRate, selectedDisclosureVariant);
  const correctionMetric = applyVariant(model.metrics.reconsiderationCorrectionRate, selectedCorrectionVariant);

  return (
    <div className="space-y-6">
      <MetricCardRow
        metrics={[
          { key: 'newApplications', title: '依申请新收', metric: model.metrics.newApplications, format: 'number' },
          { key: 'acceptedTotal', title: '受理合计', metric: model.metrics.acceptedTotal, format: 'number' },
          { key: 'substantiveDisclosureRate', title: '实质公开率', metric: disclosureMetric, format: 'percent' },
          { key: 'reconsiderationCorrectionRate', title: '复议纠错率', metric: correctionMetric, format: 'percent' },
        ]}
        selectedVariant={{
          substantiveDisclosureRate: selectedDisclosureVariant,
          reconsiderationCorrectionRate: selectedCorrectionVariant,
        }}
        onVariantChange={(metricKey, variantId) => {
          if (metricKey === 'substantiveDisclosureRate') {
            onDisclosureVariantChange(variantId);
          }
          if (metricKey === 'reconsiderationCorrectionRate') {
            onCorrectionVariantChange(variantId);
          }
        }}
        onShowDefinition={onShowDefinition}
        onShowEvidence={onShowEvidence}
      />

      <TrendSwitcher
        pressure={model.trends.pressure}
        quality={model.trends.quality}
        risk={model.trends.risk}
      />
    </div>
  );
};
