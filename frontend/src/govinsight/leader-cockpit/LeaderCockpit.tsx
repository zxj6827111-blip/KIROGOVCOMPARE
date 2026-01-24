import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { EntityContext } from '../components/Layout';
import { fetchOrgs } from '../api';
import { buildRegionTree } from '../data';
import { getCurrentUser } from '../../apiClient';
import { canAccessLeaderCockpit, isLeaderCockpitAdmin, isLeaderCockpitEnabled } from './access';
import {
  LEADER_COCKPIT_DEFAULT_CITY_NAME,
  LEADER_COCKPIT_DEFAULT_YEAR,
} from './config';
import { buildLeaderCockpitModel } from './selectors';
import type { ActionPackTemplateInstance, EvidenceItem, LeaderCockpitReport, MetricDefinition } from './types';
import { StepperHeader } from './components/StepperHeader';
import { MetricDefinitionPopover } from './components/MetricDefinitionPopover';
import { EvidenceDrawer } from './components/EvidenceDrawer';
import { Step1Overview } from './sections/Step1Overview';
import { Step2Reasons } from './sections/Step2Reasons';
import { Step3Funnel } from './sections/Step3Funnel';
import { Step4ActionPack } from './sections/Step4ActionPack';
import { Step5Report } from './sections/Step5Report';

const steps = ['总览', '原因结构', '风险漏斗', '行动包', 'AI报告'];

export const LeaderCockpit: React.FC = () => {
  const { entity, setEntity, openSelector } = useContext(EntityContext);
  const user = getCurrentUser();
  const canAccess = canAccessLeaderCockpit(user)
    && (isLeaderCockpitEnabled() || isLeaderCockpitAdmin(user));

  const [currentStep, setCurrentStep] = useState(0);
  const [year, setYear] = useState<number>(LEADER_COCKPIT_DEFAULT_YEAR);
  const [selectedDisclosureVariant, setSelectedDisclosureVariant] = useState('public_partial_over_closed');
  const [selectedCorrectionVariant, setSelectedCorrectionVariant] = useState('reconsideration_only');
  const [activeDefinition, setActiveDefinition] = useState<MetricDefinition | null>(null);
  const [activeEvidence, setActiveEvidence] = useState<EvidenceItem[] | null>(null);
  const [selectedActionPack, setSelectedActionPack] = useState<ActionPackTemplateInstance | null>(null);
  const [report, setReport] = useState<LeaderCockpitReport>({});

  const defaultCityApplied = useRef(false);
  const defaultYearApplied = useRef(false);

  useEffect(() => {
    document.body.classList.add('leader-cockpit-mode');
    return () => {
      document.body.classList.remove('leader-cockpit-mode');
    };
  }, []);

  const availableYears = useMemo(() => {
    const years = entity?.data ? entity.data.map((d) => d.year).sort((a, b) => b - a) : [];
    return years;
  }, [entity]);

  useEffect(() => {
    if (!entity || defaultCityApplied.current) return;
    if (entity.name === LEADER_COCKPIT_DEFAULT_CITY_NAME) {
      defaultCityApplied.current = true;
      return;
    }
    fetchOrgs()
      .then((orgs) => {
        const tree = buildRegionTree(orgs);
        const findByName = (nodes: any[]): any | null => {
          for (const node of nodes) {
            if (node.name === LEADER_COCKPIT_DEFAULT_CITY_NAME) return node;
            if (node.children && node.children.length) {
              const found = findByName(node.children);
              if (found) return found;
            }
          }
          return null;
        };
        const target = findByName(tree);
        if (target) {
          setEntity(target);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        defaultCityApplied.current = true;
      });
  }, [entity, setEntity]);

  useEffect(() => {
    if (!availableYears.length || defaultYearApplied.current) return;
    if (availableYears.includes(LEADER_COCKPIT_DEFAULT_YEAR)) {
      setYear(LEADER_COCKPIT_DEFAULT_YEAR);
    } else {
      setYear(availableYears[0]);
    }
    defaultYearApplied.current = true;
  }, [availableYears]);

  useEffect(() => {
    if (!availableYears.length) return;
    if (!availableYears.includes(year)) {
      setYear(availableYears[0]);
    }
  }, [availableYears, year]);

  const model = useMemo(() => {
    if (!entity) return null;
    return buildLeaderCockpitModel(entity, year);
  }, [entity, year]);

  if (!canAccess) {
    return (
      <div className="bg-white rounded-lg border border-dashed border-slate-200 p-10 text-center text-slate-500">
        领导驾驶舱功能未开启或无权限访问。
      </div>
    );
  }

  if (!model) {
    return (
      <div className="bg-white rounded-lg border border-dashed border-slate-200 p-10 text-center text-slate-500">
        正在加载驾驶舱数据...
      </div>
    );
  }

  const handleSelectActionPack = (pack: ActionPackTemplateInstance) => {
    setSelectedActionPack(pack);
    setCurrentStep(3);
  };

  return (
    <div className="space-y-6">
      <StepperHeader
        steps={steps}
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        onPrev={() => setCurrentStep((s) => Math.max(0, s - 1))}
        onNext={() => setCurrentStep((s) => Math.min(steps.length - 1, s + 1))}
        cityName={model.city.name}
        year={year}
        years={availableYears}
        onYearChange={setYear}
        onOpenCitySelector={openSelector}
      />
      {model.meta.notices.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-700 text-xs rounded-lg px-4 py-2">
          {model.meta.notices.join(' / ')}
        </div>
      )}

      {currentStep === 0 && (
        <Step1Overview
          model={model}
          selectedDisclosureVariant={selectedDisclosureVariant}
          selectedCorrectionVariant={selectedCorrectionVariant}
          onDisclosureVariantChange={setSelectedDisclosureVariant}
          onCorrectionVariantChange={setSelectedCorrectionVariant}
          onShowDefinition={(definition) => setActiveDefinition(definition || null)}
          onShowEvidence={(evidence) => setActiveEvidence(evidence || null)}
        />
      )}

      {currentStep === 1 && (
        <Step2Reasons
          model={model}
          onShowDefinition={(definition) => setActiveDefinition(definition || null)}
          onShowEvidence={(evidence) => setActiveEvidence(evidence || null)}
          onCreateActionPack={handleSelectActionPack}
        />
      )}

      {currentStep === 2 && (
        <Step3Funnel
          model={model}
          onShowDefinition={(definition) => setActiveDefinition(definition || null)}
          onShowEvidence={(evidence) => setActiveEvidence(evidence || null)}
          onCreateActionPack={handleSelectActionPack}
        />
      )}

      {currentStep === 3 && (
        <Step4ActionPack
          model={model}
          selectedActionPack={selectedActionPack}
          onActionPackChange={setSelectedActionPack}
        />
      )}

      {currentStep === 4 && (
        <Step5Report
          model={model}
          report={report}
          onReportChange={setReport}
          onShowEvidence={(evidence) => setActiveEvidence(evidence || null)}
        />
      )}

      <MetricDefinitionPopover
        open={!!activeDefinition}
        definition={activeDefinition}
        onClose={() => setActiveDefinition(null)}
      />

      <EvidenceDrawer
        open={!!activeEvidence}
        evidence={activeEvidence || []}
        onClose={() => setActiveEvidence(null)}
      />
    </div>
  );
};
