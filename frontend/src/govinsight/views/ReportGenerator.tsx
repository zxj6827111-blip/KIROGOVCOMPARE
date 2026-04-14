import React, { useContext, useEffect, useRef, useState } from 'react';
import { EntityContext } from '../components/Layout';
import { saveAIReport, fetchAIReport, fetchAnnualReportSummary } from '../api';
import { apiClient } from '../../apiClient';
import {
  AlertTriangle,
  Bot,
  ClipboardList,
  FileDown,
  Printer,
  Scale,
  SearchSlash,
  Shield,
  Sparkles,
} from 'lucide-react';
import {
  buildAiNarrativePrompt,
  buildReportContextPayload,
  buildRuleBasedEnhancedReport,
  formatChangePct,
  formatInteger,
  formatPercent,
  normalizeReportData,
  type AnnualReportSummary,
  type EnhancedAIReportResponse,
  type ScorecardItem,
} from '../utils/aiReport';

type EngineMode = 'ai' | 'rule';
type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';
type GovInsightReportJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

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

const DEFAULT_MODEL_CONFIG = {
  model: '',
} as const;

const ACTIVE_JOB_STATUSES = new Set<GovInsightReportJobStatus>(['queued', 'running']);
const AI_REPORT_SYSTEM_INSTRUCTION = '你只返回合法 JSON，不要输出 Markdown，不要补充任何解释。';

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
  <section className="border border-slate-300 bg-white p-6">
    <div className="mb-5 border-b border-slate-200 pb-3">
      <h3 className="text-[17px] font-bold tracking-[0.02em] text-slate-900">
        {index}、{title}
      </h3>
    </div>
    <div className="space-y-3">{children}</div>
  </section>
);

const MetricCard = ({ item }: { item: ScorecardItem }) => (
  <div className="border border-slate-300 bg-white px-4 py-4">
    <p className="text-[11px] font-semibold tracking-[0.16em] text-slate-500">{item.label}</p>
    <p className="mt-3 text-[25px] font-bold leading-none text-slate-900">{scorecardValue(item)}</p>
    <p className="mt-3 border-t border-slate-200 pt-2 text-[12px] leading-6 text-slate-500">
      上年 {previousScorecardValue(item)}，同比 {formatChangePct(item.changePct)}
    </p>
  </div>
);

const SERIAL_MARKERS = ['一', '二', '三', '四', '五', '六', '七', '八'];

const formatSerialMarker = (index: number) => `（${SERIAL_MARKERS[index] || String(index + 1)}）`;

const splitRiskItems = (items: EnhancedAIReportResponse['riskItems']) => ({
  primary: items.filter((item) => item.priorityLevel === '首要关注事项'),
  secondary: items.filter((item) => item.priorityLevel === '重点关注事项'),
  tracking: items.filter((item) => item.priorityLevel === '持续跟踪事项'),
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
      ? 'border-l-[5px] border-rose-700 bg-white text-rose-900'
      : tone === 'amber'
        ? 'border-l-[5px] border-amber-700 bg-white text-amber-900'
        : 'border-l-[5px] border-slate-700 bg-white text-slate-900';

  return (
    <div className={`border border-slate-300 px-4 py-2.5 ${styles}`}>
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
  const { entity } = useContext(EntityContext);
  const [isGenerating, setIsGenerating] = useState(false);
  const [reportData, setReportData] = useState<EnhancedAIReportResponse | null>(null);
  const [annualReportSummary, setAnnualReportSummary] = useState<AnnualReportSummary | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [engine, setEngine] = useState<EngineMode>('ai');
  const [loadedModel, setLoadedModel] = useState<string>('');
  const [loadedUpdatedAt, setLoadedUpdatedAt] = useState<string>('');
  const [activeJob, setActiveJob] = useState<GovInsightReportJob | null>(null);
  const [jobMessage, setJobMessage] = useState<string>('');
  const timerRef = useRef<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const sortedYears = entity?.data ? entity.data.map((d) => d.year).sort((a, b) => b - a) : [];
  const year = sortedYears[0];
  const current = entity?.data ? entity.data.find((d) => d.year === year) || null : null;
  const previous = entity?.data ? entity.data.find((d) => d.year === year - 1) || null : null;

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
    async function loadAnnualSummary() {
      if (!entity || !year) return;
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
      if (!entity || !year) return;
      const cacheKey = `report_cache_${entity.id}_${year}`;
      const cached = sessionStorage.getItem(cacheKey);

      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          const normalized = normalizeReportData(parsed, entity, year, annualReportSummary);
          if (isMounted && normalized) {
            setReportData(normalized);
            setSaveStatus('saved');
          }
        } catch (error) {
          console.warn('[ReportGenerator] Failed to parse cache:', error);
        }
      }

      try {
        const cloudReport = await fetchAIReport(entity.id, year);
        if (!cloudReport?.content || !isMounted) return;
        const normalized = normalizeReportData(cloudReport.content, entity, year, annualReportSummary);
        if (!normalized) return;
        setReportData(normalized);
        sessionStorage.setItem(cacheKey, JSON.stringify(normalized));
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
  }, [entity, year, annualReportSummary]);

  useEffect(() => {
    let isMounted = true;
    async function loadLatestJob() {
      if (!entity || !year) return;
      if (!localStorage.getItem('admin_token')) return;

      try {
        const response = await apiClient.get('/gov-insight/ai-report/jobs/latest', {
          params: { org_id: entity.id, year },
        });

        const latestJob = mapGovInsightJob(response.data?.data);
        if (!isMounted || !latestJob) return;

        setActiveJob(latestJob);
        setLoadedModel(latestJob.model || '');

        if (ACTIVE_JOB_STATUSES.has(latestJob.status)) {
          setIsGenerating(true);
          setSaveStatus('saving');
          setJobMessage(`后台任务执行中：${latestJob.stepName}`);
          return;
        }

        setIsGenerating(false);
        if (latestJob.status === 'failed') {
          setSaveStatus('error');
          setJobMessage(latestJob.errorMessage || '后台任务执行失败');
        } else if (latestJob.status === 'cancelled') {
          setSaveStatus('error');
          setJobMessage('后台任务已取消');
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
        setJobMessage(`后台任务执行中：${nextJob.stepName}`);

        if (ACTIVE_JOB_STATUSES.has(nextJob.status)) {
          setIsGenerating(true);
          setSaveStatus('saving');
          return;
        }

        setIsGenerating(false);

        if (nextJob.status === 'succeeded') {
          const cloudReport = await fetchAIReport(entity.id, year);
          if (cancelled || !cloudReport?.content) return;

          const normalized = normalizeReportData(cloudReport.content, entity, year, annualReportSummary);
          if (!normalized) {
            setSaveStatus('error');
            setJobMessage('任务已完成，但报告内容无法正常加载');
            return;
          }

          const cacheKey = `report_cache_${entity.id}_${year}`;
          setReportData(normalized);
          sessionStorage.setItem(cacheKey, JSON.stringify(normalized));
          setEngine('ai');
          setLoadedModel(cloudReport.model || nextJob.model || '');
          setLoadedUpdatedAt(cloudReport.updatedAt || nextJob.finishedAt || '');
          setSaveStatus('saved');
          setJobMessage('后台任务已完成，报告已自动保存');
          return;
        }

        if (nextJob.status === 'failed') {
          setSaveStatus('error');
          setJobMessage(nextJob.errorMessage || '后台任务执行失败');
          return;
        }

        if (nextJob.status === 'cancelled') {
          setSaveStatus('error');
          setJobMessage('后台任务已取消');
        }
      } catch (error: any) {
        if (cancelled) return;
        setIsGenerating(false);
        setSaveStatus('error');
        setJobMessage(error?.message || '后台任务状态查询失败');
      }
    };

    pollJob();
    const intervalId = window.setInterval(pollJob, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeJobId, activeJobStatus, annualReportSummary, entity, year]);

  if (!entity || !current || !year) {
    return (
      <div className="flex min-h-[520px] flex-col items-center justify-center border border-dashed border-slate-300 bg-white p-20 text-center">
        <h3 className="text-lg font-bold text-slate-800">无法生成报告</h3>
        <p className="mt-2 text-sm text-slate-500">选定单位尚未关联年度统计数据，请先完成数据解析。</p>
      </div>
    );
  }

  const reportContext = buildReportContextPayload(entity.name, current, previous, undefined, annualReportSummary);
  const activeModelLabel = loadedModel || '按服务端环境配置';
  const primaryRiskItems = reportData ? splitRiskItems(reportData.riskItems).primary : [];
  const secondaryRiskItems = reportData ? splitRiskItems(reportData.riskItems).secondary : [];
  const trackingRiskItems = reportData ? splitRiskItems(reportData.riskItems).tracking : [];

  const generateWithRuleEngine = () => {
    const fallback = buildRuleBasedEnhancedReport(entity, year, annualReportSummary);
    if (!fallback) return;
    setIsGenerating(true);
    setTimeout(() => {
      setReportData(fallback);
      setEngine('rule');
      setLoadedModel('template/gov-insight-formal-v4');
      setLoadedUpdatedAt(new Date().toISOString());
      setSaveStatus('idle');
      setIsGenerating(false);
      setJobMessage('已生成规则兜底正式稿');
    }, 300);
  };

  const generateWithAi = async () => {
    const token = localStorage.getItem('admin_token');
    if (!token) {
      alert('未登录或登录已过期，请重新登录。');
      return;
    }

    setEngine('ai');
    setIsGenerating(true);
    setSaveStatus('saving');
    setLoadedUpdatedAt('');
    setJobMessage('正在创建后台生成任务...');

    try {
      const prompt = buildAiNarrativePrompt(reportContext);
      const payload: Record<string, unknown> = {
        org_id: entity.id,
        org_name: entity.name,
        year,
        prompt,
        systemInstruction: AI_REPORT_SYSTEM_INSTRUCTION,
      };
      const response = await apiClient.post('/gov-insight/ai-report/jobs', payload);

      const nextJob = mapGovInsightJob(response.data?.data?.job);
      if (!nextJob) {
        throw new Error('后台任务创建成功，但未返回任务信息。');
      }

      setActiveJob(nextJob);
      setLoadedModel(nextJob.model || '');
      setJobMessage(
        response.data?.data?.reused
          ? `已接续正在执行的后台任务：${nextJob.stepName}`
          : `后台任务已创建：${nextJob.stepName}`
      );
    } catch (error: any) {
      setIsGenerating(false);
      setSaveStatus('error');
      setJobMessage(error?.message || '后台任务创建失败，请稍后重试。');
      alert(`创建后台任务失败：${error?.message || '未知错误'}`);
    }
  };

  const handleGenerate = () => {
    if (localStorage.getItem('admin_token')) {
      void generateWithAi();
      return;
    }
    generateWithRuleEngine();
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
      alert(`PDF 导出失败：${error?.message || '未知错误'}`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="border border-slate-300 bg-white px-8 py-8">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-4xl space-y-3.5">
            <div className="inline-flex items-center gap-2 border border-slate-300 bg-slate-50/30 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-slate-700">
              <Shield className="h-3.5 w-3.5" />
              内部审阅材料
            </div>
            <h2 className="text-[30px] font-bold leading-tight tracking-[0.02em] text-slate-900">
              {reportData ? reportData.metadata.reportTitle : `${year}年度${entity.name}智能辅策报告`}
            </h2>
            <p className="text-[11px] font-semibold tracking-[0.18em] text-slate-500">综合判断</p>
            <p className="max-w-3xl border-l-4 border-slate-700 pl-4 text-[18px] font-semibold leading-[1.85] text-slate-900">
              {reportData?.metadata.summaryLine || '综合判断：总体可控，部分风险需持续关注。'}
            </p>
            <div className="space-y-1.5 border-l-4 border-slate-700 bg-slate-50/20 px-4 py-3">
              <p className="text-xs font-semibold tracking-wide text-slate-500">编制说明</p>
              {renderParagraphs(
                reportData?.metadata.positioning || '面向政务公开分管领导，服务研判、部署、督办。',
                'text-sm leading-[1.9] text-slate-700'
              )}
              {renderParagraphs(
                reportData?.metadata.evidenceBasis || '依据结构化统计数据和年度报告摘要形成。',
                'text-sm leading-[1.9] text-slate-700'
              )}
            </div>
            <div className="border-l-4 border-slate-500 bg-slate-50/30 px-4 py-3 text-sm leading-[1.9] text-slate-700">
              <p className="text-xs font-semibold tracking-wide text-slate-500">口径说明</p>
              <p className="mt-2">{reportData?.metadata.cautionNote || '对证据不足的内容已按审慎口径处理。'}</p>
              <p className="mt-2">{reportData?.metadata.auxiliaryRiskLevelNote || reportContext.auxiliaryRiskLevelNote}</p>
              {reportData?.dataQuality.warnings?.length ? (
                <ul className="mt-2 space-y-1">
                  {reportData.dataQuality.warnings.map((warning, index) => (
                    <li key={`warning-${index}`}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 xl:w-[360px]">
            <div className="border border-slate-300 bg-white px-4 py-4">
              <p className="text-xs font-semibold tracking-wide text-slate-500">证据基础</p>
              <p className="mt-2 text-sm leading-[1.9] text-slate-700">
                {reportData?.metadata.evidenceBasis || '依据结构化统计数据和年度报告摘要形成。'}
              </p>
              <p className="mt-3 border-t border-slate-200 pt-2 text-xs leading-6 text-slate-500">
                辅助说明：
                {reportData?.metadata.auxiliaryRiskLevel || `${reportContext.rating}级（${reportContext.riskLabel}）`}
                ，仅作综合研判参考。
              </p>
            </div>
            {loadedUpdatedAt ? (
              <div className="border border-slate-300 bg-slate-50/20 px-4 py-3 text-xs leading-6 text-slate-500">
                <p>形成时间：{new Date(loadedUpdatedAt).toLocaleString()}</p>
                <p>形成方式：{engine === 'ai' ? 'AI 后台生成' : '规则兜底生成'}</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-7 border-t border-slate-300 pt-4">
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
            {(reportData?.scorecards || []).slice(0, 4).map((item) => (
              <MetricCard key={item.key} item={item} />
            ))}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 bg-slate-900 px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? <Sparkles className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? '后台生成中' : '生成正式报告'}
          </button>
          <button
            type="button"
            onClick={generateWithRuleEngine}
            disabled={isGenerating}
            className="inline-flex items-center gap-2 border border-slate-300 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Bot className="h-4 w-4" />
            生成规则稿
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={!reportData}
            className="inline-flex items-center gap-2 border border-slate-300 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Printer className="h-4 w-4" />
            打印版
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

        <div
          className={`mt-5 border px-4 py-3 text-sm leading-[1.8] ${
            saveStatus === 'error'
              ? 'border-rose-300 bg-white text-rose-700'
              : isGenerating
                ? 'border-slate-300 bg-slate-50/30 text-slate-700'
                : 'border-slate-300 bg-slate-50/20 text-slate-600'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{jobMessage || '报告将按正式辅策报告口径生成并保存。'}</span>
            {isGenerating ? <span>{Math.round(activeJob?.progress || 0)}%</span> : null}
          </div>
          {isGenerating ? <p className="mt-2 text-xs">已运行约 {Math.floor(elapsedTime)} 秒，刷新页面后仍可恢复任务状态。</p> : null}
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

          <SectionShell index="二" title="需要重点关注的风险事项">
            {primaryRiskItems.length ? (
              <div className="space-y-3">
                <RiskGroupBanner title="（一）首要关注事项" tone="rose" />
                {primaryRiskItems.map((item, index) => (
                  <div key={`priority-risk-${index}`} className="border border-slate-300 bg-white p-5">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Scale className="h-4 w-4 text-rose-600" />
                      <h4 className="text-[15px] font-bold tracking-[0.01em]">{item.riskName}</h4>
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm leading-[1.9] text-slate-700">
                      <p><span className="font-semibold text-slate-900">依据：</span>{item.basis}</p>
                      <p><span className="font-semibold text-slate-900">风险表现：</span>{item.manifestation}</p>
                      <p><span className="font-semibold text-slate-900">管理影响：</span>{item.impact}</p>
                      <p><span className="font-semibold text-slate-900">关注重点：</span>{item.focus}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {secondaryRiskItems.length ? (
              <div className="space-y-3">
                <RiskGroupBanner title="（二）重点关注事项" tone="amber" />
                {secondaryRiskItems.map((item, index) => (
                  <div key={`secondary-risk-${index}`} className="border border-slate-300 bg-white p-5">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Scale className="h-4 w-4 text-amber-600" />
                      <h4 className="text-[15px] font-bold tracking-[0.01em]">{item.riskName}</h4>
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm leading-[1.9] text-slate-700">
                      <p><span className="font-semibold text-slate-900">依据：</span>{item.basis}</p>
                      <p><span className="font-semibold text-slate-900">风险表现：</span>{item.manifestation}</p>
                      <p><span className="font-semibold text-slate-900">管理影响：</span>{item.impact}</p>
                      <p><span className="font-semibold text-slate-900">关注重点：</span>{item.focus}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {trackingRiskItems.length ? (
              <div className="space-y-3">
                <RiskGroupBanner title="（三）持续跟踪事项" tone="slate" />
                {trackingRiskItems.map((item, index) => (
                  <div key={`tracking-risk-${index}`} className="border border-slate-300 bg-white p-5">
                    <div className="flex items-center gap-2 text-slate-900">
                      <Scale className="h-4 w-4 text-slate-500" />
                      <h4 className="text-[15px] font-bold tracking-[0.01em]">{item.riskName}</h4>
                    </div>
                    <div className="mt-3 space-y-1.5 text-sm leading-[1.9] text-slate-700">
                      <p><span className="font-semibold text-slate-900">依据：</span>{item.basis}</p>
                      <p><span className="font-semibold text-slate-900">风险表现：</span>{item.manifestation}</p>
                      <p><span className="font-semibold text-slate-900">管理影响：</span>{item.impact}</p>
                      <p><span className="font-semibold text-slate-900">关注重点：</span>{item.focus}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </SectionShell>

          <SectionShell index="三" title="基于年报可以确认的事实">
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

          <SectionShell index="四" title="基于数据作出的审慎分析">
            {reportData.prudentAnalyses.map((item, index) => (
              <div key={`analysis-${index}`} className="border border-slate-300 bg-white p-5">
                <h4 className="text-[15px] font-bold tracking-[0.01em] text-slate-900">{item.topic}</h4>
                <p className="mt-3 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">分析：</span>{item.analysis}</p>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">支撑：</span>{item.support}</p>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">边界：</span>{item.caution}</p>
              </div>
            ))}
          </SectionShell>

          <SectionShell index="五" title="当前报告尚无法充分回答的问题">
            {reportData.unansweredQuestions.map((item, index) => (
              <div key={`unanswered-${index}`} className="border border-slate-300 bg-white p-5">
                <div className="flex items-center gap-2 text-slate-900">
                  <SearchSlash className="h-4 w-4 text-amber-600" />
                  <h4 className="text-[15px] font-bold tracking-[0.01em]">{item.question}</h4>
                </div>
                <p className="mt-3 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">当前边界：</span>{item.currentLimit}</p>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">后续补数建议：</span>{item.nextDataNeeded}</p>
              </div>
            ))}
          </SectionShell>

          <SectionShell index="六" title="下一步工作建议与整改任务清单">
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
                  <TaskField label="阶段性节点" value={<ul className="space-y-1">{item.milestones.map((milestone, milestoneIndex) => <li key={`milestone-${index}-${milestoneIndex}`}>{milestone}</li>)}</ul>} />
                  <TaskField label="跟踪指标" value={item.trackingIndicator} />
                  <TaskField label="督办方式" value={item.supervisionMethod} />
                </div>
              </div>
            ))}
          </SectionShell>

          <SectionShell index="七" title="结语">
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

          <SectionShell index="附件一" title="核心指标口径与勾稽说明">
            <div className="overflow-x-auto border border-slate-300">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-700">
                  <tr>
                    <th className="px-4 py-3 text-left">指标</th>
                    <th className="px-4 py-3 text-left">来源字段</th>
                    <th className="px-4 py-3 text-left">计算公式</th>
                    <th className="px-4 py-3 text-left">本年值</th>
                    <th className="px-4 py-3 text-left">上年值</th>
                    <th className="px-4 py-3 text-left">校验说明</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.appendices.metricAuditRows.map((row, index) => (
                    <tr key={`metric-row-${index}`} className="border-t border-slate-200 align-top">
                      <td className="px-4 py-3 font-semibold text-slate-900">{row.indicator}</td>
                      <td className="px-4 py-3 text-slate-700">{row.sourceFields}</td>
                      <td className="px-4 py-3 text-slate-700">{row.formula}</td>
                      <td className="px-4 py-3 text-slate-700">{row.currentValue}</td>
                      <td className="px-4 py-3 text-slate-700">{row.previousValue}</td>
                      <td className="px-4 py-3 text-slate-700">{row.reconciliationNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {reportData.appendices.reconciliationChecks.map((check) => (
                <div key={check.key} className={`border px-4 py-3 ${check.passed ? 'border-slate-300 bg-white' : 'border-rose-300 bg-rose-50/30'}`}>
                  <p className="text-sm font-semibold text-slate-900">{check.label}</p>
                  <p className="mt-2 text-sm leading-[1.9] text-slate-700">应为：{formatInteger(check.expected)}，实际：{formatInteger(check.actual)}</p>
                  <p className="text-sm leading-[1.9] text-slate-700">{check.note}</p>
                </div>
              ))}
            </div>
          </SectionShell>

          <SectionShell index="附件二" title="报告使用边界说明">
            {reportData.appendices.usageBoundaries.map((item, index) => (
              <div key={`boundary-${index}`} className="border border-slate-300 bg-white p-5">
                <h4 className="text-[15px] font-bold tracking-[0.01em] text-slate-900">{item.title}</h4>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700">{item.description}</p>
              </div>
            ))}
          </SectionShell>

          <SectionShell index="附件三" title="后续补数清单">
            {reportData.appendices.supplementDataItems.map((item, index) => (
              <div key={`supplement-${index}`} className="border border-slate-300 bg-white p-5">
                <h4 className="text-[15px] font-bold tracking-[0.01em] text-slate-900">{item.item}</h4>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">用途：</span>{item.purpose}</p>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">建议来源：</span>{item.suggestedSource}</p>
                <p className="mt-2 text-sm leading-[1.9] text-slate-700"><span className="font-semibold text-slate-900">补数说明：</span>{item.note}</p>
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
            报告将按“总体判断、风险事项、事实层、审慎分析、数据边界、整改任务清单、结语”的固定结构生成，不再沿用摘要型写法。
          </p>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating}
            className="mt-8 inline-flex items-center gap-2 bg-slate-900 px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isGenerating ? <Sparkles className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? '正在生成' : '开始生成'}
          </button>
        </div>
      )}
    </div>
  );
};
