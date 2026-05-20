import React, { useContext, useEffect, useRef, useState } from 'react';
import { EntityContext } from '../components/Layout';
import { saveAIReport, fetchAIReport, fetchAIReportPayload, fetchAnnualReportSummary } from '../api';
import { apiClient } from '../../apiClient';
import {
  AlertTriangle,
  ClipboardList,
  FileDown,
  Printer,
  Scale,
  SearchSlash,
  Shield,
  Sparkles,
} from 'lucide-react';
import {
  buildReportContextPayload,
  filterClientFacingWarnings,
  formatChangePct,
  formatInteger,
  formatPercent,
  normalizeReportData,
  type AnnualReportSummary,
  type EnhancedAIReportResponse,
  type GovInsightBackendReportPayload,
  type ScorecardItem,
} from '../utils/aiReport';
import { buildGovInsightSourceStatus, type GovInsightReportSourceMeta } from '../utils/sourceStatus';
import { AuxiliaryRiskGuide } from '../components/AuxiliaryRiskGuide';
import { AuxiliaryRiskThresholdPanel } from '../components/AuxiliaryRiskThresholdPanel';
import { HierarchySupportSummary } from '../components/HierarchySupportSummary';
import { ReconciliationCheckCards } from '../components/ReconciliationCheckCards';
import { useToast } from '../../components/common/ToastProvider';
import { useTaskDrawer } from '../../components/tasks/TaskDrawerProvider';
import { getAxiosFriendlyError } from '../../utils/errorTranslator';

type EngineMode = 'ai' | 'rule';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type GovInsightReportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
type ToastApi = {
  success: (title: string, message?: string, options?: { actionLabel?: string; onAction?: () => void; duration?: number }) => void;
  error: (title: string, message?: string, options?: { detail?: string }) => void;
};

type TaskDrawerApi = {
  trackGovInsightJob: (job: Record<string, unknown>) => void;
  openDrawer: () => void;
};

interface GovInsightReportJob {
  id: number;
  regionId: number;
  orgId: string;
  orgName: string;
  year: number;
  status: GovInsightReportJobStatus;
  progress: number;
  stepCode: string;
  stepName: string;
  model: string;
  errorCode: string;
  errorMessage: string;
  retryCount: number;
  maxRetries: number;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
}

const ACTIVE_JOB_STATUSES = new Set<GovInsightReportJobStatus>(['queued', 'running']);
const AI_REPORT_SYSTEM_INSTRUCTION = '请只返回符合 JSON Schema 的正式报告 JSON，不要输出 Markdown，也不要额外解释。';
const buildReportYearStorageKey = (entityId: string) => `govinsight:selected-report-year:${entityId}`;

const renderParagraphs = (text: string, className = 'text-sm leading-[1.9] text-slate-700') =>
  text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => (
      <p key={`${part}-${index}`} className={className}>
        {part}
      </p>
    ));

const mapGovInsightJob = (raw: any): GovInsightReportJob | null => {
  if (!raw || typeof raw !== 'object') return null;

  return {
    id: Number(raw.id),
    regionId: Number(raw.regionId || 0),
    orgId: String(raw.orgId || ''),
    orgName: String(raw.orgName || ''),
    year: Number(raw.year || 0),
    status: String(raw.status || 'queued') as GovInsightReportJobStatus,
    progress: Number(raw.progress || 0),
    stepCode: String(raw.stepCode || 'QUEUED'),
    stepName: String(raw.stepName || '等待处理'),
    model: String(raw.model || ''),
    errorCode: String(raw.errorCode || ''),
    errorMessage: String(raw.errorMessage || ''),
    retryCount: Number(raw.retryCount || 0),
    maxRetries: Number(raw.maxRetries || 0),
    createdAt: String(raw.createdAt || ''),
    startedAt: String(raw.startedAt || ''),
    finishedAt: String(raw.finishedAt || ''),
  };
};

const isGovInsightJobInFinalSync = (job: GovInsightReportJob): boolean =>
  job.stepCode === 'DONE' || job.progress >= 100 || /已生成|已完成|已保存/.test(job.stepName);

const formatGovInsightActiveJobMessage = (job: GovInsightReportJob): string =>
  isGovInsightJobInFinalSync(job) ? '后台已完成生成，正在同步报告内容...' : `后台任务执行中：${job.stepName}`;

const formatStatusDateTime = (value?: string | null): string => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
};

const inferEngineModeFromModel = (model: string): EngineMode =>
  model.startsWith('template/') || model.includes('payload-backed') ? 'rule' : 'ai';

const scorecardValue = (item: ScorecardItem) =>
  item.unit === '%' ? formatPercent(item.current) : `${formatInteger(item.current)}${item.unit}`;

const previousScorecardValue = (item: ScorecardItem) =>
  item.unit === '%' ? formatPercent(item.previous) : `${formatInteger(item.previous)}${item.unit}`;

const SectionShell = ({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) => (
  <section className="border border-slate-300 bg-gradient-to-b from-white to-slate-50/60 p-6 shadow-sm">
    <div className="mb-5 flex items-center gap-3 border-b border-slate-200 pb-3">
      <span className="h-[3px] w-8 bg-slate-700"></span>
      <h3 className="text-[17px] font-bold tracking-[0.02em] text-slate-900">
        {index}、{title}
      </h3>
    </div>
    <div className="space-y-3">{children}</div>
  </section>
);

const METRIC_CARD_TONES = [
  {
    container: 'border-sky-200 bg-gradient-to-br from-sky-50 via-white to-white',
    accent: 'bg-sky-500',
    label: 'text-sky-700',
    divider: 'border-sky-100',
    subtext: 'text-sky-700/80',
  },
  {
    container: 'border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-white',
    accent: 'bg-emerald-500',
    label: 'text-emerald-700',
    divider: 'border-emerald-100',
    subtext: 'text-emerald-700/80',
  },
  {
    container: 'border-amber-200 bg-gradient-to-br from-amber-50 via-white to-white',
    accent: 'bg-amber-500',
    label: 'text-amber-700',
    divider: 'border-amber-100',
    subtext: 'text-amber-700/80',
  },
  {
    container: 'border-rose-200 bg-gradient-to-br from-rose-50 via-white to-white',
    accent: 'bg-rose-500',
    label: 'text-rose-700',
    divider: 'border-rose-100',
    subtext: 'text-rose-700/80',
  },
] as const;

const SCORECARD_FORMULAS: Record<string, string> = {
  substantiveRate: '(予以公开+部分公开)÷受理总量×100%',
  unableRate: '无法提供÷受理总量×100%',
  noInfoShareInUnable: '不掌握信息÷无法提供×100%',
  overallCorrectionRate: '(复议纠正+诉讼纠正)÷(复议总数+诉讼总数)×100%',
  carryForwardRate: '结转下年÷受理总量×100%',
};

const MetricCard = ({ item, toneIndex }: { item: ScorecardItem; toneIndex: number }) => {
  const tone = METRIC_CARD_TONES[toneIndex % METRIC_CARD_TONES.length];
  const formula = SCORECARD_FORMULAS[item.key] || '按程序口径自动计算';

  return (
    <div className={`relative overflow-hidden border px-4 py-4 shadow-sm ${tone.container}`}>
      <div className={`absolute inset-x-0 top-0 h-1 ${tone.accent}`}></div>
      <div className="flex items-start justify-between gap-4">
        <p className={`text-[11px] font-semibold tracking-[0.16em] ${tone.label}`}>{item.label}</p>
        <div className={`max-w-[180px] border bg-white/80 px-2 py-1 text-right text-[10px] leading-4 text-slate-500 ${tone.divider}`}>
          {formula}
        </div>
      </div>
      <p className="mt-3 text-[25px] font-bold leading-none text-slate-900">{scorecardValue(item)}</p>
      <p className={`mt-3 border-t pt-2 text-[12px] leading-6 ${tone.divider} ${tone.subtext}`}>
        较上年 {previousScorecardValue(item)}，变化 {formatChangePct(item.changePct)}
      </p>
    </div>
  );
};

const SERIAL_MARKERS = ['一', '二', '三', '四', '五', '六', '七', '八'];

const formatSerialMarker = (index: number) => `（${SERIAL_MARKERS[index] || String(index + 1)}）`;

const PRIMARY_PRIORITY_LEVELS = ['首要关注事项'];
const SECONDARY_PRIORITY_LEVELS = ['重点关注事项'];
const TRACKING_PRIORITY_LEVELS = ['持续跟踪事项'];

const hasPriorityLevel = (value: unknown, accepted: string[]) => accepted.includes(String(value ?? ''));

const splitRiskItems = (items: EnhancedAIReportResponse['riskItems']) => ({
  primary: items.filter((item) => hasPriorityLevel(item.priorityLevel, PRIMARY_PRIORITY_LEVELS)),
  secondary: items.filter((item) => hasPriorityLevel(item.priorityLevel, SECONDARY_PRIORITY_LEVELS)),
  tracking: items.filter((item) => hasPriorityLevel(item.priorityLevel, TRACKING_PRIORITY_LEVELS)),
});

const RiskGroupBanner = ({
  title,
  tone,
}: {
  title: string;
  tone: 'rose' | 'amber' | 'slate';
}) => {
  const styles =
    tone === 'rose'
      ? 'border-l-[5px] border-rose-600 border-rose-200 bg-gradient-to-r from-rose-50 to-white text-rose-900 shadow-sm'
      : tone === 'amber'
        ? 'border-l-[5px] border-amber-600 border-amber-200 bg-gradient-to-r from-amber-50 to-white text-amber-900 shadow-sm'
        : 'border-l-[5px] border-slate-600 border-slate-200 bg-gradient-to-r from-slate-100 to-white text-slate-900 shadow-sm';

  return (
    <div className={`border px-4 py-2.5 ${styles}`}>
      <p className="text-[13px] font-bold tracking-[0.03em]">{title}</p>
    </div>
  );
};

const TaskField = ({ label, value, className = '' }: { label: string; value: React.ReactNode; className?: string }) => (
  <div className={`border border-slate-200 bg-white px-4 py-3 ${className}`}>
    <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500">{label}</p>
    <div className="mt-2 text-sm leading-[1.9] text-slate-700">{value}</div>
  </div>
);

export const ReportGenerator: React.FC = () => {
  const toast = useToast() as ToastApi;
  const taskDrawer = useTaskDrawer() as TaskDrawerApi;
  const { entity } = useContext(EntityContext);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [reportData, setReportData] = useState<EnhancedAIReportResponse | null>(null);
  const [annualReportSummary, setAnnualReportSummary] = useState<AnnualReportSummary | null>(null);
  const [backendPayload, setBackendPayload] = useState<GovInsightBackendReportPayload | null>(null);
  const [resolvedPayload, setResolvedPayload] = useState<GovInsightBackendReportPayload | null>(null);
  const [sourceMeta, setSourceMeta] = useState<GovInsightReportSourceMeta | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [engine, setEngine] = useState<EngineMode>('ai');
  const [loadedModel, setLoadedModel] = useState<string>('');
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string>('');
  const [activeJob, setActiveJob] = useState<GovInsightReportJob | null>(null);
  const [jobMessage, setJobMessage] = useState<string>('');
  const timerRef = useRef<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const availableYears = entity?.data
    ? Array.from(new Set(entity.data.map((d) => d.year).filter((candidate) => Number.isFinite(candidate)))).sort(
        (a, b) => b - a
      )
    : [];
  const availableYearsKey = availableYears.join(',');
  const reportYearStorageKey = entity ? buildReportYearStorageKey(entity.id) : null;
  const year = selectedYear ?? availableYears[0];
  const current = entity?.data ? entity.data.find((d) => d.year === year) || null : null;
  const previous = entity?.data ? entity.data.find((d) => d.year === year - 1) || null : null;

  useEffect(() => {
    if (availableYears.length === 0) {
      setSelectedYear(null);
      return;
    }

    const savedYear = reportYearStorageKey ? Number(localStorage.getItem(reportYearStorageKey)) : NaN;
    const preferredYear =
      Number.isFinite(savedYear) && availableYears.includes(savedYear)
        ? savedYear
        : availableYears[0];
    const nextYear =
      selectedYear && availableYears.includes(selectedYear)
        ? selectedYear
        : preferredYear;

    if (nextYear !== selectedYear) {
      setSelectedYear(nextYear);
    }
    // availableYearsKey fully captures the year options and keeps the effect stable for year switching.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableYearsKey, reportYearStorageKey, selectedYear]);

  useEffect(() => {
    if (!reportYearStorageKey || !year) return;
    localStorage.setItem(reportYearStorageKey, String(year));
  }, [reportYearStorageKey, year]);

  useEffect(() => {
    if (!year) return;
    document.title = `${year}年度智能辅策报告`;
  }, [year]);

  useEffect(() => {
    if (isGenerating) {
      const anchor = activeJob?.startedAt || activeJob?.createdAt;
      const initialSeconds =
        anchor && !Number.isNaN(new Date(anchor).getTime())
          ? Math.max(0, (Date.now() - new Date(anchor).getTime()) / 1000)
          : 0;

      setElapsedTime(initialSeconds);
      timerRef.current = window.setInterval(() => {
        setElapsedTime((prevTime) => prevTime + 1);
      }, 1000);
    } else {
      setElapsedTime(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeJob?.createdAt, activeJob?.startedAt, isGenerating]);

  useEffect(() => {
    let isMounted = true;
    async function loadBackendPayload() {
      if (!entity || !year) {
        if (isMounted) setBackendPayload(null);
        return;
      }

      setBackendPayload(null);
      try {
        const payload = await fetchAIReportPayload(entity.id, year);
        if (isMounted) {
          setBackendPayload(payload);
          setResolvedPayload((currentPayload) => currentPayload || payload);
        }
      } catch (error) {
        console.warn('[ReportGenerator] Failed to load backend payload:', error);
        if (isMounted) setBackendPayload(null);
      }
    }

    loadBackendPayload();
    return () => {
      isMounted = false;
    };
  }, [entity, year]);

  useEffect(() => {
    let isMounted = true;
    async function loadAnnualSummary() {
      if (!entity || !year) {
        if (isMounted) setAnnualReportSummary(null);
        return;
      }

      setAnnualReportSummary(null);
      try {
        const summary = await fetchAnnualReportSummary(entity.id, year);
        if (isMounted) setAnnualReportSummary(summary);
      } catch (error) {
        console.warn('[ReportGenerator] Failed to load annual report summary:', error);
        if (isMounted) setAnnualReportSummary(null);
      }
    }

    loadAnnualSummary();
    return () => {
      isMounted = false;
    };
  }, [entity, year]);

  useEffect(() => {
    let isMounted = true;
    async function loadReport() {
      if (!entity || !year) {
        if (isMounted) {
          setReportData(null);
          setResolvedPayload(null);
          setSourceMeta(null);
          setLoadedModel('');
          setLoadedUpdatedAt('');
          setSaveStatus('idle');
        }
        return;
      }

      setReportData(null);
      setResolvedPayload(null);
      setSourceMeta(null);
      setLoadedModel('');
      setLoadedUpdatedAt('');
      setSaveStatus('idle');
      const cacheKey = `report_cache_${entity.id}_${year}`;
      const cached = sessionStorage.getItem(cacheKey);

      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const normalized = normalizeReportData(parsed, entity, year, annualReportSummary, backendPayload);
          if (isMounted && normalized) {
            setReportData(normalized);
            if (backendPayload) {
              setResolvedPayload((currentPayload) => currentPayload || backendPayload);
            }
            setSaveStatus('saved');
          }
        } catch (error) {
          console.warn('[ReportGenerator] Failed to parse cache:', error);
        }
      }

      try {
        const cloudReport = await fetchAIReport(entity.id, year);
        if (!cloudReport?.content || !isMounted) return;
        const normalized = normalizeReportData(
          cloudReport.content,
          entity,
          year,
          annualReportSummary,
          cloudReport.reportPayload || backendPayload
        );
        if (!normalized) return;
        setReportData(normalized);
        setResolvedPayload((cloudReport.reportPayload || backendPayload || null) as GovInsightBackendReportPayload | null);
        setSourceMeta({
          payloadSource: cloudReport.payloadSource,
          materializeStatus: cloudReport.materializeStatus,
          sourceJobId: cloudReport.sourceJobId,
          sourceReportVersionId: cloudReport.sourceReportVersionId,
          storedPayloadErrors: cloudReport.storedPayloadErrors,
        });
        sessionStorage.setItem(cacheKey, JSON.stringify(normalized));
        setEngine(inferEngineModeFromModel(cloudReport.model || ''));
        setLoadedModel(cloudReport.model || '');
        setLoadedUpdatedAt(cloudReport.updatedAt || '');
        setSaveStatus('saved');
      } catch (error) {
        console.warn('[ReportGenerator] Cloud load failed:', error);
      }
    }

    loadReport();
    return () => {
      isMounted = false;
    };
  }, [entity, year, annualReportSummary, backendPayload]);

  useEffect(() => {
    let isMounted = true;
    async function loadLatestJob() {
      setActiveJob(null);
      setIsGenerating(false);
      setJobMessage('');

      if (!entity || !year) return;

      try {
        const response = await apiClient.get('/gov-insight/ai-report/jobs/latest', {
          params: { org_id: entity.id, year },
        });

        const latestJob = mapGovInsightJob(response.data?.data);
        if (!isMounted) return;
        if (!latestJob) {
          setActiveJob(null);
          return;
        }

        setActiveJob(latestJob);
        setLoadedModel(latestJob.model || '');

        if (ACTIVE_JOB_STATUSES.has(latestJob.status)) {
          setIsGenerating(true);
          setSaveStatus('saving');
          setJobMessage(formatGovInsightActiveJobMessage(latestJob));
          return;
        }

        setIsGenerating(false);
        if (latestJob.status === 'failed') {
          setSaveStatus('error');
          setJobMessage(latestJob.errorMessage || '后台任务执行失败');
        } else if (latestJob.status === 'cancelled') {
          setSaveStatus('error');
          setJobMessage('后台任务已取消。');
        } else {
          setJobMessage('');
        }
      } catch (error) {
        console.warn('[ReportGenerator] Failed to load latest job:', error);
      }
    }

    loadLatestJob();
    return () => {
      isMounted = false;
    };
  }, [entity, year]);

  const activeJobId = activeJob?.id;
  const activeJobStatus = activeJob?.status;

  useEffect(() => {
    if (!entity || !year || !activeJobId || !activeJobStatus || !ACTIVE_JOB_STATUSES.has(activeJobStatus)) {
      return undefined;
    }

    let cancelled = false;
    const pollJob = async () => {
      try {
        const response = await apiClient.get(`/gov-insight/ai-report/jobs/${activeJobId}`);
        if (cancelled) return;

        const nextJob = mapGovInsightJob(response.data?.data);
        if (!nextJob) return;

        setActiveJob(nextJob);
        setLoadedModel(nextJob.model || '');

        if (ACTIVE_JOB_STATUSES.has(nextJob.status)) {
          setIsGenerating(true);
          setSaveStatus('saving');
          setJobMessage(formatGovInsightActiveJobMessage(nextJob));
          return;
        }

        setIsGenerating(false);

        if (nextJob.status === 'succeeded') {
          const cloudReport = await fetchAIReport(entity.id, year);
          if (cancelled || !cloudReport?.content) return;

          const normalized = normalizeReportData(
            cloudReport.content,
            entity,
            year,
            annualReportSummary,
            cloudReport.reportPayload || backendPayload
          );
          if (!normalized) {
            setSaveStatus('error');
            setJobMessage('未能从后台结果还原正式报告。');
            return;
          }

          const cacheKey = `report_cache_${entity.id}_${year}`;
          setReportData(normalized);
          setResolvedPayload((cloudReport.reportPayload || backendPayload || null) as GovInsightBackendReportPayload | null);
          setSourceMeta({
            payloadSource: cloudReport.payloadSource,
            materializeStatus: cloudReport.materializeStatus,
            sourceJobId: cloudReport.sourceJobId,
            sourceReportVersionId: cloudReport.sourceReportVersionId,
            storedPayloadErrors: cloudReport.storedPayloadErrors,
          });
          sessionStorage.setItem(cacheKey, JSON.stringify(normalized));
          setEngine(inferEngineModeFromModel(cloudReport.model || nextJob.model || ''));
          setLoadedModel(cloudReport.model || nextJob.model || '');
          setLoadedUpdatedAt(cloudReport.updatedAt || nextJob.finishedAt || '');
          setSaveStatus('saved');
          setJobMessage('后台正式报告已生成。');
          return;
        }

        if (nextJob.status === 'failed') {
          setSaveStatus('error');
          setJobMessage(nextJob.errorMessage || '后台任务执行失败');
          return;
        }

        if (nextJob.status === 'cancelled') {
          setSaveStatus('error');
          setJobMessage('后台任务已取消。');
        }
      } catch (error: any) {
        if (cancelled) return;
        setIsGenerating(false);
        setSaveStatus('error');
        setJobMessage(error?.message || '加载后台正式报告失败。');
      }
    };

    pollJob();
    const intervalId = window.setInterval(pollJob, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeJobId, activeJobStatus, annualReportSummary, backendPayload, entity, year]);

  if (!entity || !current || !year) {
    return (
        <div className="flex min-h-[520px] flex-col items-center justify-center border border-dashed border-slate-300 bg-white p-20 text-center">
          <h3 className="text-lg font-bold text-slate-800">无法生成报告</h3>
          <p className="mt-2 text-sm text-slate-500">当前选中单位缺少可用于生成正式报告的年度数据。</p>
        </div>
      );
  }

  const reportContext = buildReportContextPayload(entity.name, current, previous, undefined, annualReportSummary);
  const activeModelLabel = loadedModel || '按服务端环境配置';
  const effectivePayload = resolvedPayload || backendPayload;
  const hasHierarchySummary = Boolean(effectivePayload?.hierarchyAnalysis);
  const riskAssessment = effectivePayload?.riskAssessment;
  const clientFacingWarnings = filterClientFacingWarnings(reportData?.dataQuality.warnings);
  const sourceStatus = buildGovInsightSourceStatus(effectivePayload as (GovInsightBackendReportPayload & Record<string, unknown>) | null, sourceMeta);
  const primaryRiskItems = reportData ? splitRiskItems(reportData.riskItems).primary : [];
  const secondaryRiskItems = reportData ? splitRiskItems(reportData.riskItems).secondary : [];
  const trackingRiskItems = reportData ? splitRiskItems(reportData.riskItems).tracking : [];
  const resolvedEngineMode = loadedModel ? inferEngineModeFromModel(loadedModel) : engine;
  const generationStatusTitle = saveStatus === 'error' ? '生成失败' : isGenerating ? '报告生成中' : reportData ? '报告已生成' : '待生成';
  const generationSourceLabel = resolvedEngineMode === 'ai' ? 'AI 大模型生成' : '结构化数据生成';
  const generationKindLabel = resolvedEngineMode === 'ai' ? 'AI 正式稿' : '数据生成版';
  const generationTimeLabel = formatStatusDateTime(loadedUpdatedAt || activeJob?.finishedAt || '');
  const generationStatusDescription =
    saveStatus === 'error'
      ? jobMessage || '后台任务执行失败，请重试。'
      : isGenerating
        ? jobMessage || '后台任务正在生成正式稿，请稍候。'
        : reportData
          ? resolvedEngineMode === 'ai'
            ? '当前展示的是 AI 大模型生成的正式稿。'
            : '当前展示的是依据已校验结构化数据生成的报告版本。'
          : jobMessage || '点击“生成正式稿”后开始生成。';

  const generateWithAi = async () => {
    setEngine('ai');
    setIsGenerating(true);
    setSaveStatus('saving');
    setLoadedUpdatedAt('');
    setJobMessage('正在创建后台生成任务...');

    try {
      const payload: Record<string, unknown> = {
        org_id: entity.id,
        org_name: entity.name,
        year,
        use_backend_payload: true,
        systemInstruction: AI_REPORT_SYSTEM_INSTRUCTION,
      };
      const response = await apiClient.post('/gov-insight/ai-report/jobs', payload);

      const nextJob = mapGovInsightJob(response.data?.data?.job);
      if (!nextJob) {
        throw new Error('后台任务创建失败，未返回有效任务信息。');
      }

      setActiveJob(nextJob);
      setLoadedModel(nextJob.model || '');
      taskDrawer.trackGovInsightJob({
        ...nextJob,
        title: `${nextJob.orgName || entity.name} ${nextJob.year || year} AI 报告`,
      });
      taskDrawer.openDrawer();
      setJobMessage(
        response.data?.data?.reused
          ? `复用已有后台任务：${nextJob.stepName}`
          : `后台任务已创建：${nextJob.stepName}`
      );
      toast.success('AI 报告任务已创建', '生成进度会在右侧任务抽屉持续更新。', {
        actionLabel: '打开任务抽屉',
        onAction: () => taskDrawer.openDrawer(),
        duration: 8000,
      });
    } catch (error: any) {
      setIsGenerating(false);
      setSaveStatus('error');
      const friendly = getAxiosFriendlyError(error, '任务创建失败，请稍后重试。');
      setJobMessage(friendly.message);
      toast.error('任务创建失败', friendly.message, { detail: friendly.detail });
    }
  };

  const handleGenerate = () => {
    void generateWithAi();
  };

  const handlePrint = async () => {
    if (!reportData) return;
    try {
      setSaveStatus('saving');
      await saveAIReport(String(entity.id), entity.name, year, reportData, activeModelLabel);
      setSaveStatus('saved');
    } catch (error) {
      console.warn('[ReportGenerator] Save before print failed:', error);
      setSaveStatus('error');
    }

    const printUrl = `${window.location.origin}/print/govinsight-report/${encodeURIComponent(String(entity.id))}/${year}`;
    const printWindow = window.open(printUrl, '_blank', 'noopener,noreferrer');
    if (!printWindow) window.location.assign(printUrl);
  };

  const handleExportPdf = async () => {
    if (!reportData) return;

    try {
      setIsExportingPdf(true);
      setSaveStatus('saving');
      await saveAIReport(String(entity.id), entity.name, year, reportData, activeModelLabel);
      setSaveStatus('saved');

      const response = await apiClient.get('/gov-insight/report-pdf', {
        params: { org_id: entity.id, year },
        responseType: 'blob',
      });

      const disposition = String(response.headers['content-disposition'] || '');
      const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
      const asciiMatch = disposition.match(/filename="([^"]+)"/i);
      const fileName = utf8Match
        ? decodeURIComponent(utf8Match[1])
        : asciiMatch?.[1] || `${entity.name}_${year}_智能辅策报告.pdf`;

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      const friendly = getAxiosFriendlyError(error, 'PDF 导出失败，请稍后重试。');
      toast.error('PDF 导出失败', friendly.message, { detail: friendly.detail });
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="border border-slate-300 bg-gradient-to-b from-white to-slate-50/50 px-8 py-8 shadow-sm">
        <div className="space-y-5">
          <div className="inline-flex items-center gap-2 border border-slate-300 bg-slate-50/30 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-slate-700">
            <Shield className="h-3.5 w-3.5" />
            内部审阅材料
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-3 border border-slate-300 bg-white px-4 py-2">
              <span className="text-[11px] font-semibold tracking-[0.12em] text-slate-500">报告年度</span>
              <select
                value={year}
                onChange={(event) => setSelectedYear(Number(event.target.value))}
                className="border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm font-semibold text-slate-700 outline-none transition focus:border-slate-500"
              >
                {availableYears.map((availableYear) => (
                  <option key={availableYear} value={availableYear}>
                    {availableYear} 年度
                  </option>
                ))}
              </select>
            </div>
            <p className="text-xs leading-6 text-slate-500">
              当前主体已入库的历史年份都可以在这里切换查看，并按所选年份生成正式稿。
            </p>
          </div>

          <div className="max-w-5xl space-y-3.5 border border-slate-200 bg-gradient-to-r from-white via-white to-sky-50/40 px-6 py-5 shadow-sm">
            <h2 className="text-[30px] font-bold leading-tight tracking-[0.02em] text-slate-900">
              {reportData ? reportData.metadata.reportTitle : `${year}年度${entity.name}智能辅策报告`}
            </h2>
            <p className="inline-flex w-fit items-center border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-sky-700">
              综合判断
            </p>
            <p className="max-w-4xl border-l-4 border-sky-500 pl-4 text-[18px] font-semibold leading-[1.85] text-slate-900">
              {reportData?.metadata.summaryLine || '待生成正式稿后展示综合判断。'}
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="border border-sky-200 bg-gradient-to-br from-sky-50/90 via-white to-white px-5 py-4 shadow-sm">
              <p className="inline-flex items-center border border-sky-200 bg-white px-3 py-1 text-xs font-semibold tracking-wide text-sky-700">
                编制说明
              </p>
              <div className="mt-3 space-y-2">
                {renderParagraphs(
                  reportData?.metadata.positioning || '本报告用于支撑领导决策、监管研判和风险提示，当前展示为待生成占位内容。',
                  'text-sm leading-[1.9] text-slate-700'
                )}
                {renderParagraphs(
                  reportData?.metadata.evidenceBasis || '本报告依据年度公开数据、结构化指标和规则校验结果生成。',
                  'text-sm leading-[1.9] text-slate-700'
                )}
              </div>
            </div>

            <div className="border border-amber-200 bg-gradient-to-br from-amber-50/90 via-white to-white px-5 py-4 shadow-sm">
              <p className="inline-flex items-center border border-amber-200 bg-white px-3 py-1 text-xs font-semibold tracking-wide text-amber-700">
                口径说明
              </p>
              <div className="mt-3 space-y-2 text-sm leading-[1.9] text-slate-700">
                <p>{reportData?.metadata.cautionNote || '当前页面仅展示正式报告结果，具体口径以后端正式数据为准。'}</p>
                {clientFacingWarnings.length ? (
                  <ul className="space-y-1 border-t border-amber-100 bg-white/75 pt-3 text-sm text-slate-700">
                    {clientFacingWarnings.map((warning, index) => (
                      <li key={`warning-${index}`}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>

            <div className="border border-slate-200 bg-gradient-to-br from-slate-50 via-white to-white px-5 py-4 shadow-sm">
              <p className="inline-flex items-center border border-slate-200 bg-white px-3 py-1 text-xs font-semibold tracking-wide text-slate-700">
                来源状态
              </p>
              <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-700">
                <div className="grid grid-cols-2 gap-2">
                  <TaskField label="PAYLOAD" value={sourceStatus.sourceLabel} className="bg-slate-50/60" />
                  <TaskField label="MATERIALIZE" value={sourceStatus.materializeLabel} className="bg-slate-50/60" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <TaskField label="SOURCE JOB" value={sourceStatus.sourceJobLabel} className="bg-slate-50/60" />
                  <TaskField label="REPORT VERSION" value={sourceStatus.sourceVersionLabel} className="bg-slate-50/60" />
                </div>
                <p className={sourceStatus.hasAnomaly ? 'text-amber-700' : 'text-slate-600'}>
                  {sourceStatus.dataQualitySummary}
                </p>
                {sourceStatus.warnings.length ? (
                  <ul className="space-y-1 border-t border-slate-100 pt-2 text-xs text-slate-600">
                    {sourceStatus.warnings.slice(0, 3).map((warning, index) => (
                      <li key={`source-warning-${index}`}>{warning}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <AuxiliaryRiskGuide
              current={reportContext.current}
              previous={reportContext.previous}
              dataQuality={reportData?.dataQuality || reportContext.dataQuality}
              rating={riskAssessment?.rating || reportContext.rating}
              riskLabel={riskAssessment?.riskLabel || reportContext.riskLabel}
              reason={riskAssessment?.reason}
              note={reportData?.metadata.auxiliaryRiskLevelNote || reportContext.auxiliaryRiskLevelNote}
            />

            <AuxiliaryRiskThresholdPanel
              current={reportContext.current}
              previous={reportContext.previous}
              generatedAt={loadedUpdatedAt ? new Date(loadedUpdatedAt).toLocaleString() : null}
              engineLabel={reportData ? generationKindLabel : null}
            />
          </div>
        </div>

        <div className="mt-7 border-t border-slate-300 pt-4">
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            {(reportData?.scorecards || []).slice(0, 4).map((item, index) => (
              <MetricCard key={item.key} item={item} toneIndex={index} />
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className={`inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold transition ${
              isGenerating
                ? 'cursor-not-allowed border border-slate-300 bg-slate-200 text-slate-500'
                : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            {isGenerating ? <Sparkles className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? '正在生成' : '生成正式稿'}
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!reportData}
            className="inline-flex items-center gap-2 border border-slate-300 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Printer className="h-4 w-4" />
            打印预览
          </button>
          <button
            type="button"
            onClick={handleExportPdf}
            disabled={!reportData || isExportingPdf}
            className="inline-flex items-center gap-2 border border-slate-300 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <FileDown className="h-4 w-4" />
            {isExportingPdf ? '导出中' : '导出 PDF'}
          </button>
        </div>

        <div className="mt-5 border border-slate-300 bg-white px-4 py-4 text-sm text-slate-700 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500">当前状态</p>
              <p className={`mt-1 text-[15px] font-bold ${saveStatus === 'error' ? 'text-rose-700' : 'text-slate-900'}`}>
                {generationStatusTitle}
              </p>
            </div>
            <div className="inline-flex items-center border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
              {isGenerating ? `进度 ${Math.round(activeJob?.progress || 0)}%` : generationKindLabel}
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <TaskField label="生成方式" value={generationSourceLabel} className="bg-slate-50/60" />
            <TaskField label="生成时间" value={generationTimeLabel} className="bg-slate-50/60" />
          </div>
          <p className="mt-3 text-sm leading-[1.8]">{generationStatusDescription}</p>
          {isGenerating ? <p className="mt-2 text-xs text-slate-500">已运行 {Math.floor(elapsedTime)} 秒。</p> : null}
        </div>
      </section>

      {reportData ? (
        <div className="space-y-6">
          <SectionShell index="一" title="总体判断">
            {renderParagraphs(reportData.metadata.overallOverview, 'text-sm leading-[1.95] text-slate-700')}
            {reportData.overallJudgments.map((item, index) => (
              <div key={`judgment-${index}`} className="border border-slate-300 bg-white p-5">
                <h4 className="text-[15px] font-bold tracking-[0.01em] text-slate-900">
                  {formatSerialMarker(index)}
                  {item.heading}
                </h4>
                <div className="mt-3 space-y-2">
                  {renderParagraphs(
                    [item.factBasis, item.riskJudgment, item.managementImplication].join('\n'),
                    'text-sm leading-[1.95] text-slate-700'
                  )}
                </div>
              </div>
            ))}
          </SectionShell>

          <SectionShell index="二" title="重点风险事项">
            {primaryRiskItems.length ? (
              <div className="space-y-3">
                <RiskGroupBanner title="首要关注事项" tone="rose" />
                {primaryRiskItems.map((item, index) => (
                  <div key={`priority-risk-${index}`} className="border border-slate-300 bg-white p-5">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Scale className="h-4 w-4 text-rose-600" />
                      <h4 className="text-[15px] font-bold tracking-[0.01em]">{item.riskName}</h4>
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm leading-[1.9] text-slate-700">
                      <p><span className="font-semibold text-slate-900">依据：</span>{item.basis}</p>
                      <p><span className="font-semibold text-slate-900">表现：</span>{item.manifestation}</p>
                      <p><span className="font-semibold text-slate-900">影响：</span>{item.impact}</p>
                      <p><span className="font-semibold text-slate-900">关注点：</span>{item.focus}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {secondaryRiskItems.length ? (
              <div className="space-y-3">
                <RiskGroupBanner title="重点关注事项" tone="amber" />
                {secondaryRiskItems.map((item, index) => (
                  <div key={`secondary-risk-${index}`} className="border border-slate-300 bg-white p-5">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Scale className="h-4 w-4 text-amber-600" />
                      <h4 className="text-[15px] font-bold tracking-[0.01em]">{item.riskName}</h4>
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm leading-[1.9] text-slate-700">
                      <p><span className="font-semibold text-slate-900">依据：</span>{item.basis}</p>
                      <p><span className="font-semibold text-slate-900">表现：</span>{item.manifestation}</p>
                      <p><span className="font-semibold text-slate-900">影响：</span>{item.impact}</p>
                      <p><span className="font-semibold text-slate-900">关注点：</span>{item.focus}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {trackingRiskItems.length ? (
              <div className="space-y-3">
                <RiskGroupBanner title="持续跟踪事项" tone="slate" />
                {trackingRiskItems.map((item, index) => (
                  <div key={`tracking-risk-${index}`} className="border border-slate-300 bg-white p-5">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Scale className="h-4 w-4 text-slate-500" />
                      <h4 className="text-[15px] font-bold tracking-[0.01em]">{item.riskName}</h4>
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm leading-[1.9] text-slate-700">
                      <p><span className="font-semibold text-slate-900">依据：</span>{item.basis}</p>
                      <p><span className="font-semibold text-slate-900">表现：</span>{item.manifestation}</p>
                      <p><span className="font-semibold text-slate-900">影响：</span>{item.impact}</p>
                      <p><span className="font-semibold text-slate-900">关注点：</span>{item.focus}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </SectionShell>

          <SectionShell index="三" title="确认事实">
            {reportData.confirmedFacts.map((group, index) => (
              <div key={`fact-${index}`} className="border border-slate-300 bg-white p-5">
                <h4 className="text-[15px] font-bold tracking-[0.01em] text-slate-900">{group.category}</h4>
                <ul className="mt-3 space-y-2">
                  {group.points.map((point, pointIndex) => (
                    <li key={`fact-${index}-${pointIndex}`} className="flex items-start gap-3">
                      <span className="mt-[9px] h-px w-3 flex-shrink-0 bg-slate-400"></span>
                      <span className="text-sm leading-[1.9] text-slate-700">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </SectionShell>

          <SectionShell index="四" title="审慎分析">
            {reportData.prudentAnalyses.map((item, index) => (
              <div key={`analysis-${index}`} className="border border-slate-300 bg-white p-5">
                <h4 className="text-[15px] font-bold tracking-[0.01em] text-slate-900">{item.topic}</h4>
                <p className="mt-3 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">分析：</span>{item.analysis}</p>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">支撑：</span>{item.support}</p>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">提示：</span>{item.caution}</p>
              </div>
            ))}
          </SectionShell>

          {hasHierarchySummary ? (
            <SectionShell index="五" title="三级监测重点摘要">
              <HierarchySupportSummary
                payload={effectivePayload}
                title="三级监测重点摘要"
                subtitle="本节依据既有三级监测结果，对已纳入监测范围且具备分析条件的区县、部门样本作内部提示，不形成全量正式排名，不作为正式考核结论。"
                limit={8}
                showHeader={false}
              />
            </SectionShell>
          ) : null}

          <SectionShell index={hasHierarchySummary ? '六' : '五'} title="待补充问题">
            {reportData.unansweredQuestions.map((item, index) => (
              <div key={`unanswered-${index}`} className="border border-slate-300 bg-white p-5">
                <div className="flex items-center gap-2 text-slate-900">
                  <SearchSlash className="h-4 w-4 text-amber-600" />
                  <h4 className="text-[15px] font-bold tracking-[0.01em]">{item.question}</h4>
                </div>
                <p className="mt-3 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">当前限制：</span>{item.currentLimit}</p>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">下一步所需数据：</span>{item.nextDataNeeded}</p>
              </div>
            ))}
          </SectionShell>

          <SectionShell index={hasHierarchySummary ? '七' : '六'} title="整改任务清单">
            {reportData.rectificationTasks.map((item, index) => (
              <div key={`task-${index}`} className="border border-slate-300 bg-white p-5">
                <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 md:flex-row md:items-start md:justify-between">
                  <div className="space-y-2">
                    <p className="text-xs font-semibold tracking-wide text-slate-500">序号 {item.sequence}</p>
                    <h4 className="text-[15px] font-bold tracking-[0.01em] text-slate-900">{item.taskName}</h4>
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex border border-slate-300 bg-slate-50/20 px-3 py-1 text-xs font-semibold text-slate-600">{item.taskType}</span>
                      <span className="inline-flex border border-slate-300 bg-slate-50/20 px-3 py-1 text-xs font-semibold text-slate-700">{item.priority}</span>
                      <span className="inline-flex border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-600">{item.responsibilityLevel}</span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <TaskField label="问题指向" value={item.problem} />
                  <TaskField label="工作措施" value={item.measure} />
                  <TaskField label="牵头单位" value={item.leadUnit} />
                  <TaskField label="配合单位" value={item.supportUnits} />
                  <TaskField label="完成时限" value={item.deadline} />
                  <TaskField label="阶段里程碑" value={<ul className="space-y-1">{item.milestones.map((milestone, milestoneIndex) => <li key={`milestone-${index}-${milestoneIndex}`}>{milestone}</li>)}</ul>} />
                  <TaskField label="跟踪指标" value={item.trackingIndicator} />
                  <TaskField label="督办方式" value={item.supervisionMethod} />
                </div>
              </div>
            ))}
          </SectionShell>

          <SectionShell index={hasHierarchySummary ? '八' : '七'} title="结语">
            {renderParagraphs(reportData.closing)}
          </SectionShell>

          {reportData.notes.length ? (
            <section className="border border-slate-300 bg-white p-6">
              <div className="mb-4 flex items-center gap-2 text-slate-900">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <h3 className="text-[15px] font-bold tracking-[0.01em]">口径提示</h3>
              </div>
              <ul className="space-y-2">
                {reportData.notes.map((item, index) => (
                  <li key={`note-${index}`} className="flex items-start gap-3">
                    <span className="mt-[9px] h-px w-3 flex-shrink-0 bg-slate-500"></span>
                    <span className="text-sm leading-[1.9] text-slate-700">{item}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <SectionShell index="附件一" title="指标审计与勾稽校验">
            <div className="overflow-x-auto border border-slate-300">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left">指标</th>
                    <th className="px-4 py-3 text-left">计算公式</th>
                    <th className="px-4 py-3 text-left">本期值</th>
                    <th className="px-4 py-3 text-left">上期值</th>
                    <th className="px-4 py-3 text-left">校验说明</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.appendices.metricAuditRows.map((row, index) => (
                    <tr key={`metric-row-${index}`} className="border-t border-slate-200 align-top">
                      <td className="px-4 py-3 font-semibold text-slate-900">{row.indicator}</td>
                      <td className="px-4 py-3 text-slate-700">{row.formula}</td>
                      <td className="px-4 py-3 text-slate-700">{row.currentValue}</td>
                      <td className="px-4 py-3 text-slate-700">{row.previousValue}</td>
                      <td className="px-4 py-3 text-slate-700">{row.reconciliationNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ReconciliationCheckCards checks={reportData.appendices.reconciliationChecks} />
          </SectionShell>

          <SectionShell index="附件二" title="使用边界与口径说明">
            {reportData.appendices.usageBoundaries.map((item, index) => (
              <div key={`boundary-${index}`} className="border border-slate-300 bg-white p-5">
                <h4 className="text-[15px] font-bold tracking-[0.01em] text-slate-900">{item.title}</h4>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700">{item.description}</p>
              </div>
            ))}
          </SectionShell>

          <SectionShell index="附件三" title="建议补充数据">
            {reportData.appendices.supplementDataItems.map((item, index) => (
              <div key={`supplement-${index}`} className="border border-slate-300 bg-white p-5">
                <h4 className="text-[15px] font-bold tracking-[0.01em] text-slate-900">{item.item}</h4>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">用途：</span>{item.purpose}</p>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">建议来源：</span>{item.suggestedSource}</p>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">备注：</span>{item.note}</p>
              </div>
            ))}
          </SectionShell>
        </div>
      ) : (
        <div className="flex min-h-[420px] flex-col items-center justify-center border border-dashed border-slate-300 bg-white px-8 py-20 text-center">
          <div className="mb-4 border border-slate-300 bg-slate-50/30 p-5">
            <ClipboardList className="h-10 w-10 text-slate-700" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900">准备生成正式辅策报告</h3>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-500">
            系统将调用 AI 大模型生成正式报告，生成完成后可直接查看、打印或导出。
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="mt-8 inline-flex items-center gap-2 bg-slate-900 px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? <Sparkles className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? '生成中' : '开始生成'}
          </button>
        </div>
      )}
    </div>
  );
};
