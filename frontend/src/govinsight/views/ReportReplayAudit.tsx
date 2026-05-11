import React, { useCallback, useContext, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCopy,
  ClipboardList,
  Eye,
  EyeOff,
  FileJson,
  RefreshCw,
  Search,
  ShieldAlert,
  WandSparkles,
} from 'lucide-react';
import { EntityContext } from '../components/Layout';
import { fetchAIReportReplayContext, type GovInsightAIReportReplayContext } from '../api';

type CopyTarget = 'payload' | 'prompt' | null;
type WarningSource = '存量协议告警' | '数据质量提示';
type FilterState = {
  keyword: string;
  showPrompt: boolean;
  showPayload: boolean;
  warningsOnly: boolean;
};

const DEFAULT_FILTERS: FilterState = {
  keyword: '',
  showPrompt: true,
  showPayload: true,
  warningsOnly: false,
};

const includesKeyword = (value: string, keyword: string): boolean =>
  !keyword || value.toLowerCase().includes(keyword.toLowerCase());

const InfoCard = ({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) => (
  <div className="border border-slate-300 bg-white px-4 py-3">
    <p className="text-[11px] font-semibold tracking-[0.14em] text-slate-500">{label}</p>
    <div className="mt-2 text-sm leading-[1.8] text-slate-700">{value}</div>
  </div>
);

const StatusPill = ({
  tone,
  label,
}: {
  tone: 'emerald' | 'amber' | 'rose' | 'slate';
  label: string;
}) => {
  const className =
    tone === 'emerald'
      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
      : tone === 'amber'
        ? 'border-amber-300 bg-amber-50 text-amber-700'
        : tone === 'rose'
          ? 'border-rose-300 bg-rose-50 text-rose-700'
          : 'border-slate-300 bg-slate-50 text-slate-700';

  return (
    <span className={`inline-flex items-center border px-2.5 py-1 text-[11px] font-semibold tracking-[0.04em] ${className}`}>
      {label}
    </span>
  );
};

const ToggleButton = ({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`inline-flex items-center gap-2 border px-3 py-2 text-xs font-semibold transition ${
      active
        ? 'border-slate-700 bg-slate-700 text-white'
        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
    }`}
  >
    {icon}
    {label}
  </button>
);

const GuidanceCheck = ({
  passed,
  title,
  note,
}: {
  passed: boolean;
  title: string;
  note: string;
}) => (
  <div className={`border px-4 py-3 ${passed ? 'border-emerald-300 bg-emerald-50/40' : 'border-amber-300 bg-amber-50/50'}`}>
    <div className={`flex items-center gap-2 text-sm font-semibold ${passed ? 'text-emerald-700' : 'text-amber-700'}`}>
      {passed ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      {title}
    </div>
    <p className="mt-2 text-sm leading-[1.8] text-slate-700">{note}</p>
  </div>
);

const CodePanel = ({
  title,
  icon,
  content,
  onCopy,
  copied,
  summary,
}: {
  title: string;
  icon: React.ReactNode;
  content: string;
  onCopy: () => void;
  copied: boolean;
  summary?: string;
}) => (
  <section className="border border-slate-300 bg-white">
    <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-slate-900">
          {icon}
          <h3 className="text-sm font-bold tracking-[0.02em]">{title}</h3>
        </div>
        {summary ? <p className="text-xs leading-[1.7] text-slate-500">{summary}</p> : null}
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="inline-flex items-center gap-2 border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        <ClipboardCopy className="h-3.5 w-3.5" />
        {copied ? '已复制' : '复制'}
      </button>
    </div>
    <pre className="max-h-[520px] overflow-auto bg-slate-950 px-4 py-4 text-xs leading-6 text-slate-100">
      {content}
    </pre>
  </section>
);

function renderPayloadSummary(context: GovInsightAIReportReplayContext | null): React.ReactNode {
  const payload = context?.reportPayload as Record<string, unknown> | null;
  const metricsSnapshot = payload && typeof payload.metricsSnapshot === 'object' && payload.metricsSnapshot
    ? (payload.metricsSnapshot as Record<string, unknown>)
    : null;
  const dataQuality = payload && typeof payload.dataQuality === 'object' && payload.dataQuality
    ? (payload.dataQuality as Record<string, unknown>)
    : null;
  const hierarchyAnalysis = payload && typeof payload.hierarchyAnalysis === 'object' && payload.hierarchyAnalysis
    ? (payload.hierarchyAnalysis as Record<string, unknown>)
    : null;
  const districtFocusItems = Array.isArray(hierarchyAnalysis?.districtFocus) ? (hierarchyAnalysis?.districtFocus as unknown[]) : [];
  const departmentFocusItems = Array.isArray(hierarchyAnalysis?.departmentFocus) ? (hierarchyAnalysis?.departmentFocus as unknown[]) : [];
  const dataWarnings = Array.isArray(dataQuality?.warnings) ? (dataQuality?.warnings as unknown[]) : [];

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <InfoCard label="Payload 版本" value={String(payload?.version || 'N/A')} />
      <InfoCard label="指标版本" value={String(payload?.metricVersion || 'N/A')} />
      <InfoCard label="映射版本" value={String(payload?.mappingVersion || 'N/A')} />
      <InfoCard label="物化状态" value={String(payload?.materializeStatus || 'N/A')} />
      <InfoCard label="受理总量" value={String(metricsSnapshot?.acceptedTotal ?? 'N/A')} />
      <InfoCard label="新收申请" value={String(metricsSnapshot?.newReceived ?? 'N/A')} />
      <InfoCard label="质量异常" value={String(dataQuality?.hasAnomaly ?? 'N/A')} />
      <InfoCard label="数据告警数" value={String(dataWarnings.length)} />
      <InfoCard label="区县聚焦数" value={String(districtFocusItems.length)} />
      <InfoCard label="部门聚焦数" value={String(departmentFocusItems.length)} />
    </div>
  );
}

export const ReportReplayAudit: React.FC = () => {
  const { entity } = useContext(EntityContext);
  const [context, setContext] = useState<GovInsightAIReportReplayContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [copyTarget, setCopyTarget] = useState<CopyTarget>(null);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const canAccessReplay = Boolean(localStorage.getItem('admin_token'));

  const sortedYears = entity?.data ? entity.data.map((item) => item.year).sort((a, b) => b - a) : [];
  const year = sortedYears[0];

  const loadReplayContext = useCallback(async () => {
    if (!entity || !year || !canAccessReplay) {
      setContext(null);
      return;
    }

    setIsLoading(true);
    setErrorMessage('');
    try {
      const nextContext = await fetchAIReportReplayContext(entity.id, year);
      setContext(nextContext);
      if (!nextContext) {
        setErrorMessage('当前没有可用的 replay 上下文，或当前账号无权查看。');
      }
    } catch (error: any) {
      setContext(null);
      setErrorMessage(error?.message || '加载 replay 上下文失败。');
    } finally {
      setIsLoading(false);
    }
  }, [canAccessReplay, entity, year]);

  useEffect(() => {
    void loadReplayContext();
  }, [loadReplayContext]);

  const payload = context?.reportPayload as Record<string, unknown> | null;
  const payloadText = context?.reportPayload ? JSON.stringify(context.reportPayload, null, 2) : '{}';
  const promptText = context?.promptText || '';
  const dataQuality = payload && typeof payload.dataQuality === 'object' && payload.dataQuality
    ? (payload.dataQuality as Record<string, unknown>)
    : null;
  const storedPayloadErrorSource = Array.isArray(context?.storedPayloadErrors)
    ? (context?.storedPayloadErrors as unknown[])
    : [];
  const storedPayloadErrors = storedPayloadErrorSource.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );
  const dataQualityWarningSource = Array.isArray(dataQuality?.warnings)
    ? (dataQuality?.warnings as unknown[])
    : [];
  const dataQualityWarnings = dataQualityWarningSource.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0
  );
  const keyword = filters.keyword.trim();
  const filteredWarnings: Array<{ source: WarningSource; text: string }> = [
    ...storedPayloadErrors.map((text) => ({ source: '存量协议告警' as const, text })),
    ...dataQualityWarnings.map((text) => ({ source: '数据质量提示' as const, text })),
  ].filter((item) => includesKeyword(item.text, keyword));
  const promptMatches = includesKeyword(promptText, keyword);
  const payloadMatches = includesKeyword(payloadText, keyword);
  const showPromptPanel = filters.showPrompt && !filters.warningsOnly && promptMatches;
  const showPayloadPanel = filters.showPayload && !filters.warningsOnly && payloadMatches;
  const hasAnomaly = Boolean(dataQuality?.hasAnomaly);
  const protocolComplete = Boolean(
    context?.protocolVersion &&
      context?.payloadVersion &&
      context?.promptVersion &&
      context?.outputSchemaVersion
  );
  const payloadStored = context?.payloadSource === 'stored';
  const warningsResolved = storedPayloadErrors.length + dataQualityWarnings.length === 0;
  const dataQualityExplainable = !hasAnomaly || dataQualityWarnings.length > 0;
  const hasVisiblePanels = showPromptPanel || showPayloadPanel || filteredWarnings.length > 0 || !keyword;

  const handleCopy = async (target: CopyTarget, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyTarget(target);
      window.setTimeout(() => setCopyTarget((current) => (current === target ? null : current)), 1600);
    } catch {
      setCopyTarget(null);
    }
  };

  if (!entity || !year) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center border border-dashed border-slate-300 bg-white p-16 text-center">
        <h2 className="text-lg font-bold text-slate-900">无法加载回放审计页</h2>
        <p className="mt-2 text-sm text-slate-500">当前所选单位缺少可用的年度数据，暂时无法加载回放上下文。</p>
      </div>
    );
  }

  if (!canAccessReplay) {
    return (
      <section className="border border-amber-300 bg-white px-6 py-6">
        <div className="flex items-center gap-2 text-amber-700">
          <ShieldAlert className="h-5 w-5" />
          <h2 className="text-base font-bold">协议回放审计仅对管理端开放</h2>
        </div>
        <p className="mt-3 text-sm leading-[1.9] text-slate-700">
          当前页面依赖 `/api/gov-insight/ai-report/replay` 的管理端鉴权。请先使用管理端账号登录，再查看 payload、
          prompt 与协议回放信息。
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      <section className="border border-slate-300 bg-white px-6 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 border border-slate-300 bg-slate-50 px-3 py-1 text-[11px] font-semibold tracking-[0.16em] text-slate-700">
              <ClipboardList className="h-3.5 w-3.5" />
              管理端回放审计
            </div>
            <div>
              <h2 className="text-[28px] font-bold tracking-[0.02em] text-slate-900">
                {entity.name} {year} 年正式报告回放审计
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-[1.9] text-slate-700">
                该页面用于核对正式报告协议元信息、有效 payload、prompt 回放内容以及历史协议修复结果，便于后端化验收、
                协议治理和问题回放。
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadReplayContext()}
            disabled={isLoading}
            className="inline-flex items-center gap-2 border border-slate-300 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            {isLoading ? '刷新中' : '刷新回放上下文'}
          </button>
        </div>
      </section>

      <section className="border border-slate-300 bg-white px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-1 items-center gap-3 border border-slate-300 px-4 py-3">
            <Search className="h-4 w-4 flex-shrink-0 text-slate-400" />
            <input
              value={filters.keyword}
              onChange={(event) => setFilters((current) => ({ ...current, keyword: event.target.value }))}
              placeholder="按关键字筛选 payload、prompt、告警内容"
              className="w-full min-w-0 border-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <ToggleButton
              label={filters.showPrompt ? '隐藏 Prompt' : '显示 Prompt'}
              active={filters.showPrompt}
              onClick={() => setFilters((current) => ({ ...current, showPrompt: !current.showPrompt }))}
              icon={filters.showPrompt ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            />
            <ToggleButton
              label={filters.showPayload ? '隐藏 Payload' : '显示 Payload'}
              active={filters.showPayload}
              onClick={() => setFilters((current) => ({ ...current, showPayload: !current.showPayload }))}
              icon={filters.showPayload ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            />
            <ToggleButton
              label={filters.warningsOnly ? '退出只看告警' : '只看告警'}
              active={filters.warningsOnly}
              onClick={() => setFilters((current) => ({ ...current, warningsOnly: !current.warningsOnly }))}
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            />
            <ToggleButton
              label="重置筛选"
              active={false}
              onClick={() => setFilters(DEFAULT_FILTERS)}
              icon={<RefreshCw className="h-3.5 w-3.5" />}
            />
          </div>
        </div>
        <p className="mt-3 text-xs leading-[1.8] text-slate-500">
          “只看告警”会隐藏协议元信息、Payload 摘要和代码面板，仅保留需要处理的告警与验收结论，适合做修复复核。
        </p>
      </section>

      {errorMessage ? (
        <section className="border border-rose-300 bg-white px-5 py-4 text-sm leading-[1.9] text-rose-700">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            回放上下文异常
          </div>
          <p className="mt-2">{errorMessage}</p>
        </section>
      ) : null}

      {context ? (
        <>
          <section className="border border-slate-300 bg-white px-6 py-6">
            <div className="mb-4 flex flex-wrap items-center gap-2 text-slate-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <h3 className="text-sm font-bold tracking-[0.02em]">内部验收指引</h3>
              <StatusPill
                tone={payloadStored ? 'emerald' : 'amber'}
                label={payloadStored ? 'Payload 直接命中存储协议' : 'Payload 由回放链路重建'}
              />
              <StatusPill
                tone={hasAnomaly ? 'amber' : 'emerald'}
                label={hasAnomaly ? '存在质量异常' : '无质量异常'}
              />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <GuidanceCheck
                passed={protocolComplete}
                title="协议版本字段已完整写入"
                note="protocol_version、payload_version、prompt_version、output_schema_version 应同时存在，否则说明正式协议未完全收口。"
              />
              <GuidanceCheck
                passed={payloadStored}
                title="正式报告已优先命中存储 payload"
                note="stored 表示正式链路已将协议回写到 ai_decision_reports；rebuilt 表示当前页面只能根据后端规则重建，仍需继续修复历史或补全写回。"
              />
              <GuidanceCheck
                passed={warningsResolved}
                title="无存量协议告警"
                note="若 storedPayloadErrors 非空，应先修复存量协议或重新生成报告，再把该样本计入验收通过。"
              />
              <GuidanceCheck
                passed={dataQualityExplainable}
                title="质量异常具备解释依据"
                note="若 hasAnomaly=true，至少应能看到对应的数据质量提示或回放说明；否则说明异常来源无法审计，需要继续排查。"
              />
            </div>
            <div className="mt-4 border border-slate-200 bg-slate-50 px-4 py-4 text-sm leading-[1.9] text-slate-700">
              <p className="font-semibold text-slate-900">验收建议</p>
              <div className="mt-3 space-y-2">
                <p>1. 先核对协议版本、payload 来源、source job / report version，确认样本命中的是正式报告链路。</p>
                <p>2. 若页面显示 `rebuilt`，可用于排查，但不应直接视为协议治理完成态。</p>
                <p>3. 若存在存量协议告警，请优先修复历史存储，再复验 prompt 与 report_payload_v1 是否一致。</p>
                <p>4. 若筛选关键字后无结果，说明该问题不在当前 payload、prompt 或告警中，需要转查后端任务日志。</p>
              </div>
            </div>
          </section>

          {!filters.warningsOnly ? (
            <section className="border border-slate-300 bg-white px-6 py-6">
              <div className="mb-4 flex items-center gap-2 text-slate-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <h3 className="text-sm font-bold tracking-[0.02em]">协议元信息</h3>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <InfoCard label="协议版本" value={context.protocolVersion || 'N/A'} />
                <InfoCard label="报告格式" value={context.reportFormat || 'N/A'} />
                <InfoCard label="Payload / Prompt" value={`${context.payloadVersion || 'N/A'} / ${context.promptVersion || 'N/A'}`} />
                <InfoCard label="输出 Schema" value={context.outputSchemaVersion || 'N/A'} />
                <InfoCard
                  label="Payload 来源"
                  value={
                    <div className="space-y-2">
                      <StatusPill tone={payloadStored ? 'emerald' : 'amber'} label={context.payloadSource} />
                      <p className="text-xs leading-[1.7] text-slate-500">
                        {payloadStored ? '当前样本已命中正式存储协议。' : '当前样本依赖回放重建，仍建议继续补修存量协议。'}
                      </p>
                    </div>
                  }
                />
                <InfoCard label="物化状态" value={context.materializeStatus || 'N/A'} />
                <InfoCard label="来源任务 / 报告版本" value={`${context.sourceJobId ?? 'N/A'} / ${context.sourceReportVersionId ?? 'N/A'}`} />
                <InfoCard label="更新时间 / 模型" value={`${context.updatedAt ? new Date(context.updatedAt).toLocaleString() : 'N/A'} / ${context.modelUsed || 'N/A'}`} />
              </div>
            </section>
          ) : null}

          {filteredWarnings.length ? (
            <section className="border border-amber-300 bg-white px-5 py-4">
              <div className="flex flex-wrap items-center gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                <h3 className="text-sm font-bold tracking-[0.02em]">告警与异常</h3>
                <StatusPill tone="amber" label={`共 ${filteredWarnings.length} 条`} />
              </div>
              <ul className="mt-3 space-y-2 text-sm leading-[1.8] text-slate-700">
                {filteredWarnings.map((item, index) => (
                  <li key={`${item.source}-${item.text}-${index}`} className="flex items-start gap-3">
                    <StatusPill tone={item.source === '存量协议告警' ? 'amber' : 'slate'} label={item.source} />
                    <span className="pt-0.5">{item.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : filters.warningsOnly ? (
            <section className="border border-emerald-300 bg-white px-5 py-4 text-sm leading-[1.9] text-emerald-700">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                当前筛选条件下没有可见告警
              </div>
              <p className="mt-2 text-slate-700">
                {keyword ? '当前关键字未命中任何存量协议告警或数据质量提示。' : '当前样本没有存量协议告警，也没有数据质量提示。'}
              </p>
            </section>
          ) : null}

          {!filters.warningsOnly ? (
            <section className="border border-slate-300 bg-white px-6 py-6">
              <div className="mb-4 flex items-center gap-2 text-slate-900">
                <WandSparkles className="h-4 w-4 text-slate-700" />
                <h3 className="text-sm font-bold tracking-[0.02em]">Payload 摘要</h3>
              </div>
              {renderPayloadSummary(context)}
            </section>
          ) : null}

          {!hasVisiblePanels ? (
            <section className="border border-dashed border-slate-300 bg-white px-5 py-8 text-center">
              <p className="text-sm font-semibold text-slate-700">当前筛选条件下没有匹配的 Prompt 或 Payload 面板</p>
              <p className="mt-2 text-sm leading-[1.8] text-slate-500">
                可以尝试清空关键字，或关闭“只看告警”后重新查看完整回放内容。
              </p>
            </section>
          ) : null}

          {showPromptPanel ? (
            <CodePanel
              title="可回放 Prompt"
              icon={<ClipboardList className="h-4 w-4 text-slate-700" />}
              content={promptText}
              summary={keyword ? `当前关键字“${keyword}”已命中 Prompt 内容。` : '用于复核模型输入是否与正式 payload 协议一致。'}
              onCopy={() => void handleCopy('prompt', promptText)}
              copied={copyTarget === 'prompt'}
            />
          ) : null}

          {showPayloadPanel ? (
            <CodePanel
              title="有效 report_payload_v1"
              icon={<FileJson className="h-4 w-4 text-slate-700" />}
              content={payloadText}
              summary={keyword ? `当前关键字“${keyword}”已命中 Payload 内容。` : '用于复核后端指标、规则种子与正式协议字段是否已落库。'}
              onCopy={() => void handleCopy('payload', payloadText)}
              copied={copyTarget === 'payload'}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
};
