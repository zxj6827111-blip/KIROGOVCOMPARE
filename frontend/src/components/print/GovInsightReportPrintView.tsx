import React, { useEffect, useMemo, useState } from 'react';
import { fetchAIReport, fetchAIReportPayload, fetchAnnualData, fetchAnnualReportSummary } from '../../govinsight/api';
import { transformYearData } from '../../govinsight/data';
import type { AnnualDataRecord, EntityProfile } from '../../govinsight/types';
import {
  buildAuxiliaryRiskLevelExplanation,
  buildReportContextPayload,
  buildRuleBasedEnhancedReport,
  formatChangePct,
  formatInteger,
  formatPercent,
  normalizeReportData,
  type EnhancedAIReportResponse,
  type GovInsightBackendReportPayload,
  type ReconciliationCheck,
  type ReportRating,
  type ScorecardItem,
} from '../../govinsight/utils/aiReport';
import { MIN_N_FOR_RANKING, RISK_THRESHOLDS } from '../../govinsight/leader-cockpit/riskPolicy';
import './GovInsightReportPrintView.css';

type Chapter = {
  id: string;
  index: string;
  title: string;
  appendix?: boolean;
};

type PageMarker = Chapter & {
  page: number;
};

type RiskTone = 'primary' | 'secondary' | 'tracking';
type HierarchyAnalysis = NonNullable<GovInsightBackendReportPayload['hierarchyAnalysis']>;
type HierarchyFocusItem = NonNullable<HierarchyAnalysis['districtFocus']>[number];
type HierarchyCoverage = NonNullable<HierarchyAnalysis['districtCoverage']>;

const SERIAL_MARKERS = ['一', '二', '三', '四', '五', '六', '七', '八'];
const PRIMARY_PRIORITY_LEVELS = ['首要关注事项'];
const SECONDARY_PRIORITY_LEVELS = ['重点关注事项'];
const TRACKING_PRIORITY_LEVELS = ['持续跟踪事项'];
const REQUIRED_SCORECARD_KEYS = ['substantiveRate', 'unableRate', 'noInfoShareInUnable', 'overallCorrectionRate'];

const formatSerialMarker = (index: number) => `（${SERIAL_MARKERS[index] || String(index + 1)}）`;

const hasPriorityLevel = (value: unknown, accepted: string[]) => accepted.includes(String(value ?? ''));

const splitRiskItems = (items: EnhancedAIReportResponse['riskItems']) => ({
  primary: items.filter((item) => hasPriorityLevel(item.priorityLevel, PRIMARY_PRIORITY_LEVELS)),
  secondary: items.filter((item) => hasPriorityLevel(item.priorityLevel, SECONDARY_PRIORITY_LEVELS)),
  tracking: items.filter((item) => hasPriorityLevel(item.priorityLevel, TRACKING_PRIORITY_LEVELS)),
});

const scorecardValue = (item: ScorecardItem) =>
  item.unit === '%' ? formatPercent(item.current) : `${formatInteger(item.current)}${item.unit}`;

const previousScorecardValue = (item: ScorecardItem) =>
  item.unit === '%' ? formatPercent(item.previous) : `${formatInteger(item.previous)}${item.unit}`;

const changeText = (item: ScorecardItem) => formatChangePct(item.changePct);

const normalizeParagraphs = (text: string): string[] =>
  String(text || '')
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

const renderParagraphs = (text: string, options?: { noIndent?: boolean }) =>
  normalizeParagraphs(text).map((part, index) => (
    <p key={`${part}-${index}`} className={options?.noIndent ? 'pdf-paragraph pdf-paragraph--plain' : 'pdf-paragraph'}>
      {part}
    </p>
  ));

const getRiskRatingClass = (rating?: ReportRating | null) => {
  if (rating === 'A') return 'pdf-risk-rating--a';
  if (rating === 'C') return 'pdf-risk-rating--c';
  return 'pdf-risk-rating--b';
};

const getScorecardToneClass = (status: ScorecardItem['status']) => {
  if (status === 'good') return 'pdf-metric-card--good';
  if (status === 'risk') return 'pdf-metric-card--risk';
  return 'pdf-metric-card--watch';
};

const getHierarchyRiskClass = (riskLevel?: string | null) => {
  if (riskLevel === 'red') return 'pdf-tag--red';
  if (riskLevel === 'yellow') return 'pdf-tag--amber';
  if (riskLevel === 'green') return 'pdf-tag--green';
  return 'pdf-tag--muted';
};

const hierarchyRiskLabel = (riskLevel?: string | null): string => {
  if (riskLevel === 'red') return '红牌关注';
  if (riskLevel === 'yellow') return '黄牌关注';
  if (riskLevel === 'green') return '绿色观察';
  return '待补充';
};

const formatNullableCount = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return Number(value).toLocaleString('zh-CN');
};

const formatNullablePercent = (value?: number | null): string => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'N/A';
  return `${Number(value).toFixed(1)}%`;
};

const formatCoverage = (value?: string | null): string => {
  const normalized = String(value || '').trim();
  return normalized || '0/0';
};

const buildCoverageSummary = (coverage?: HierarchyCoverage): string => {
  if (!coverage) {
    return '覆盖单位 0 个，纳入底座 0/0，可直接分析 0/0，正式口径 0/0。';
  }

  return `覆盖单位 ${formatNullableCount(coverage.total)} 个，纳入底座 ${formatCoverage(
    coverage.statsCoverage || coverage.reportCoverage
  )}，可直接分析 ${formatCoverage(
    coverage.analyzableCoverage || coverage.parseSuccessRate
  )}，正式口径 ${formatCoverage(coverage.officialCoverage)}。`;
};

const buildMethodNotes = (): string[] => [
  '区县层和部门层覆盖情况，分别反映当前纳入监测范围的区县、部门单位总量及其可用情况。',
  '“纳入底座”指已纳入当期监测底账；“可直接分析”指已有可比数据、可以开展当期研判；“正式口径”指达到当前年度正式使用条件的单位。',
  `红牌样本主要指受理总量达到${MIN_N_FOR_RANKING}件，且实质公开率低于${RISK_THRESHOLDS.disclosureRate.red}%或纠正占比高于${RISK_THRESHOLDS.correctionRate.red}%的单位；黄牌样本主要指受理总量达到${MIN_N_FOR_RANKING}件，且实质公开率低于${RISK_THRESHOLDS.disclosureRate.yellow}%或纠正占比高于${RISK_THRESHOLDS.correctionRate.yellow}%的单位；绿色观察为未触发前述阈值的样本；受理总量低于${MIN_N_FOR_RANKING}件的，标注为“样本偏小”，仅作观察提示。`,
  '以上内容属于基于当前底座和样本门槛形成的内部重点样本提示，不形成全量正式排名，不作为正式考核结论。',
];

const reportRootStyle = {
  '--pdf-total-pages': 'counter(pages)',
} as React.CSSProperties;

const buildCoverReportTitle = (reportTitle: string, entityName: string): string => {
  const normalizedTitle = String(reportTitle || '').trim();
  const normalizedEntityName = String(entityName || '').trim();
  if (!normalizedEntityName) return normalizedTitle;

  return normalizedTitle.replace(normalizedEntityName, '').replace(/\s{2,}/g, ' ').trim();
};

const ChapterPage = ({
  id,
  index,
  title,
  reportTitle,
  children,
}: {
  id: string;
  index: string;
  title: string;
  reportTitle: string;
  children: React.ReactNode;
}) => (
  <section className="pdf-page pdf-page--chapter pdf-page-break" data-chapter-id={id}>
    <PageChrome reportTitle={reportTitle} />
    <div className="pdf-page-content">
      <div className="pdf-chapter-heading">
        <p className="pdf-chapter-kicker">章节 {index}</p>
        <h2>
          {index}、{title}
        </h2>
      </div>
      <div className="pdf-section-stack">{children}</div>
    </div>
  </section>
);

const PageChrome = (_props: { reportTitle: string }) => null;

const DirectoryItem = ({ chapter }: { chapter: PageMarker }) => (
  <div className={`pdf-toc-row${chapter.appendix ? ' pdf-toc-row--appendix' : ''}`}>
    <span className="pdf-toc-index">{chapter.index}</span>
    <span className="pdf-toc-title">{chapter.title}</span>
    <span className="pdf-toc-leader" aria-hidden="true"></span>
    <span className="pdf-toc-page" data-toc-page-for={chapter.id}>{chapter.page || '-'}</span>
  </div>
);

const CoverPage = ({
  entity,
  year,
  reportData,
  reportContext,
  resolvedPayload,
}: {
  entity: EntityProfile;
  year: number;
  reportData: EnhancedAIReportResponse;
  reportContext: ReturnType<typeof buildReportContextPayload>;
  resolvedPayload: GovInsightBackendReportPayload | null;
}) => {
  const guide = buildAuxiliaryRiskLevelExplanation(reportContext.current, reportContext.previous, reportData.dataQuality || reportContext.dataQuality, {
    rating: resolvedPayload?.riskAssessment?.rating || reportContext.rating,
    riskLabel: resolvedPayload?.riskAssessment?.riskLabel || reportContext.riskLabel,
    reason: resolvedPayload?.riskAssessment?.reason,
  });

  return (
    <section className="pdf-page pdf-page--cover">
      <div className="pdf-cover-mark">内部审阅材料</div>
      <div className="pdf-cover-main">
        <h1>{entity.name}</h1>
        <h2>{buildCoverReportTitle(reportData.metadata.reportTitle, entity.name)}</h2>
        <p className="pdf-cover-summary">{reportData.metadata.summaryLine}</p>
      </div>

      <div className="pdf-cover-notes">
        <div>
          <span>适用范围</span>
          <p>{reportData.metadata.positioning}</p>
        </div>
        <div>
          <span>数据来源</span>
          <p>{reportData.metadata.evidenceBasis}</p>
        </div>
        <div>
          <span>审阅提示</span>
          <p>{reportData.metadata.cautionNote}</p>
        </div>
      </div>

      <section className="pdf-cover-risk">
        <div className="pdf-cover-risk-head">
          <span className={`pdf-risk-rating ${getRiskRatingClass(guide.rating)}`}>{guide.currentLevelText}</span>
          <div>
            <h3>辅助风险等级说明</h3>
            <p>{guide.reason}</p>
          </div>
        </div>
        <div className="pdf-cover-risk-grid">
          {guide.levels.map((level) => (
            <div key={level.rating} className={`pdf-risk-level-card${level.rating === guide.rating ? ' is-active' : ''}`}>
              <div className="pdf-risk-level-title">
                <strong>{level.rating}级</strong>
                {level.rating === guide.rating ? <span>当前</span> : null}
              </div>
              <p className="pdf-risk-level-name">{level.title}</p>
              <p>{level.summary}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="pdf-cover-footer">
        <span>编制年度：{year} 年</span>
        <span>{reportData.metadata.auxiliaryRiskLevelNote || reportContext.auxiliaryRiskLevelNote}</span>
      </div>
    </section>
  );
};

const OverviewPage = ({
  reportData,
  reportContext,
  scorecards,
  riskGroups,
  year,
}: {
  reportData: EnhancedAIReportResponse;
  reportContext: ReturnType<typeof buildReportContextPayload>;
  scorecards: ScorecardItem[];
  riskGroups: ReturnType<typeof splitRiskItems>;
  year: number;
}) => {
  const focusSummaries = [
    ...riskGroups.primary,
    ...riskGroups.secondary,
    ...riskGroups.tracking,
  ].slice(0, 3);

  return (
    <section className="pdf-page pdf-page-break pdf-page--overview">
      <div className="pdf-page-content pdf-page-content--plain">
        <div className="pdf-overview-head">
          <p>核心指标总览</p>
          <h2>{year} 年度政务公开运行摘要</h2>
        </div>

        <div className="pdf-metric-grid pdf-metric-grid--overview">
          {scorecards.map((item) => (
            <article key={item.key} className={`pdf-metric-card ${getScorecardToneClass(item.status)}`}>
              <span className="pdf-metric-label">{item.label}</span>
              <p className="pdf-metric-value">{scorecardValue(item)}</p>
              <div className="pdf-metric-meta">
                <span>上期值 {previousScorecardValue(item)}</span>
                <span>变化情况 {changeText(item)}</span>
              </div>
              <p className="pdf-metric-tip">{item.interpretation}</p>
            </article>
          ))}
        </div>

        <div className="pdf-overview-lower">
          <section className="pdf-overview-risk-card">
            <p className="pdf-overview-label">当前风险等级摘要</p>
            <div className="pdf-overview-risk-line">
              <span className={`pdf-risk-rating ${getRiskRatingClass(reportContext.rating)}`}>{reportContext.rating}级</span>
              <strong>{reportContext.riskLabel}</strong>
            </div>
            <ul className="pdf-compact-list">
              {reportContext.topSignals.slice(0, 4).map((item, index) => (
                <li key={`signal-${index}`}>{item}</li>
              ))}
            </ul>
          </section>

          <section className="pdf-overview-focus-card">
            <p className="pdf-overview-label">重点关注事项摘要</p>
            {focusSummaries.length ? (
              <ol className="pdf-focus-summary-list">
                {focusSummaries.map((item, index) => (
                  <li key={`focus-summary-${index}`}>
                    <strong>{item.riskName}</strong>
                    <span>{item.focus}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="pdf-muted-text">当前未生成重点关注事项。</p>
            )}
          </section>
        </div>

        <section className="pdf-overview-notes">
          <p>
            <strong>编制年度：</strong>
            {year} 年
          </p>
          <p>
            <strong>口径说明：</strong>
            {reportData.metadata.auxiliaryRiskLevelNote || reportContext.auxiliaryRiskLevelNote}
          </p>
        </section>
      </div>
    </section>
  );
};

const DirectoryPage = ({ chapters, reportTitle }: { chapters: PageMarker[]; reportTitle: string }) => (
  <section className="pdf-page pdf-page-break pdf-page--toc">
    <PageChrome reportTitle={reportTitle} />
    <div className="pdf-page-content">
      <div className="pdf-toc-heading">
        <h2>目录</h2>
      </div>
      <div className="pdf-toc-list">
        {chapters.map((chapter) => (
          <DirectoryItem key={chapter.id} chapter={chapter} />
        ))}
      </div>
    </div>
  </section>
);

const RiskGroup = ({
  title,
  tone,
  children,
}: {
  title: string;
  tone: RiskTone;
  children: React.ReactNode;
}) => (
  <section className={`pdf-risk-group pdf-risk-group--${tone}`}>
    <h3>{title}</h3>
    <div className="pdf-risk-group-body">{children}</div>
  </section>
);

const RiskItemBlock = ({ item }: { item: EnhancedAIReportResponse['riskItems'][number] }) => (
  <article className="pdf-risk-item">
    <h4>{item.riskName}</h4>
    <dl>
      <div>
        <dt>依据</dt>
        <dd>{item.basis}</dd>
      </div>
      <div>
        <dt>表现</dt>
        <dd>{item.manifestation}</dd>
      </div>
      <div>
        <dt>影响</dt>
        <dd>{item.impact}</dd>
      </div>
      <div>
        <dt>关注点</dt>
        <dd>{item.focus}</dd>
      </div>
    </dl>
  </article>
);

const FactListBlock = ({
  title,
  items,
}: {
  title: string;
  items: string[];
}) => (
  <article className="pdf-content-block">
    <h3>{title}</h3>
    <ul className="pdf-dash-list">
      {items.map((item, index) => (
        <li key={`${title}-${index}`}>{item}</li>
      ))}
    </ul>
  </article>
);

const AnalysisBlock = ({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: string }>;
}) => (
  <article className="pdf-content-block">
    <h3>{title}</h3>
    <dl className="pdf-field-list">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  </article>
);

const HierarchyFocusTable = ({
  title,
  items,
  emptyText,
  limit,
}: {
  title: string;
  items: HierarchyFocusItem[];
  emptyText: string;
  limit: number;
}) => {
  const visibleItems = items.slice(0, limit);

  return (
    <section className="pdf-hierarchy-table-section">
      <h3>{title}</h3>
      {visibleItems.length ? (
        <table className="pdf-table pdf-table--hierarchy">
          <thead>
            <tr>
              <th>单位名称</th>
              <th>风险等级</th>
              <th>触发原因</th>
              <th>新收申请</th>
              <th>受理总量</th>
              <th>公开率</th>
              <th>纠正占比</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item, index) => (
              <tr key={`${item.orgId || item.regionId || index}`}>
                <td>{item.orgName || '未命名单位'}</td>
                <td>
                  <span className={`pdf-tag ${getHierarchyRiskClass(item.riskLevel)}`}>{hierarchyRiskLabel(item.riskLevel)}</span>
                  {item.isSampleSufficient === false ? <span className="pdf-tag pdf-tag--muted">样本偏小</span> : null}
                </td>
                <td>{item.riskReason || '未返回触发原因'}</td>
                <td>{formatNullableCount(item.newApplications)}</td>
                <td>{formatNullableCount(item.acceptedTotal)}</td>
                <td>{formatNullablePercent(item.disclosureRate)}</td>
                <td>{formatNullablePercent(item.correctionRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="pdf-empty-text">{emptyText}</p>
      )}
    </section>
  );
};

const HierarchyPrintSummary = ({
  payload,
}: {
  payload?: GovInsightBackendReportPayload | null;
}) => {
  const hierarchyAnalysis = payload?.hierarchyAnalysis;
  if (!hierarchyAnalysis) return null;

  const districtCoverage = hierarchyAnalysis.districtCoverage;
  const departmentCoverage = hierarchyAnalysis.departmentCoverage;
  const districtFocus = Array.isArray(hierarchyAnalysis.districtFocus) ? hierarchyAnalysis.districtFocus : [];
  const departmentFocus = Array.isArray(hierarchyAnalysis.departmentFocus) ? hierarchyAnalysis.departmentFocus : [];

  if (
    !districtCoverage?.available &&
    !departmentCoverage?.available &&
    districtFocus.length === 0 &&
    departmentFocus.length === 0
  ) {
    return null;
  }

  return (
    <section className="pdf-hierarchy-summary">
      <div className="pdf-note-box">
        <p className="pdf-note-title">方法说明</p>
        {buildMethodNotes().map((note, index) => (
          <p key={`method-note-${index}`}>{note}</p>
        ))}
      </div>

      <div className="pdf-two-col">
        <article className="pdf-summary-card">
          <p className="pdf-summary-card-label">区县层覆盖情况</p>
          <p>{buildCoverageSummary(districtCoverage)}</p>
        </article>
        <article className="pdf-summary-card">
          <p className="pdf-summary-card-label">部门层覆盖情况</p>
          <p>{buildCoverageSummary(departmentCoverage)}</p>
        </article>
      </div>

      <HierarchyFocusTable
        title="区县层重点提示样本"
        items={districtFocus}
        emptyText="当前未返回可展示的区县层重点样本。"
        limit={8}
      />
      <HierarchyFocusTable
        title="部门层重点提示样本"
        items={departmentFocus}
        emptyText="当前未返回可展示的部门层重点样本。"
        limit={8}
      />
    </section>
  );
};

const RectificationTaskCard = ({
  item,
  className = '',
}: {
  item: EnhancedAIReportResponse['rectificationTasks'][number];
  className?: string;
}) => (
  <article className={`pdf-task-card${className ? ` ${className}` : ''}`}>
    <div className="pdf-task-head">
      <div>
        <p>任务 {item.sequence}</p>
        <h3>{item.taskName}</h3>
      </div>
      <div className="pdf-task-tags">
        <span>{item.taskType}</span>
        <span>{item.priority}</span>
        <span>{item.responsibilityLevel}</span>
      </div>
    </div>
    <dl className="pdf-task-grid">
      <div className="pdf-task-field pdf-task-field--wide">
        <dt>问题指向</dt>
        <dd>{item.problem}</dd>
      </div>
      <div className="pdf-task-field pdf-task-field--wide">
        <dt>工作措施</dt>
        <dd>{item.measure}</dd>
      </div>
      <div className="pdf-task-field">
        <dt>牵头单位</dt>
        <dd>{item.leadUnit}</dd>
      </div>
      <div className="pdf-task-field">
        <dt>配合单位</dt>
        <dd>{item.supportUnits}</dd>
      </div>
      <div className="pdf-task-field">
        <dt>完成时限</dt>
        <dd>{item.deadline}</dd>
      </div>
      <div className="pdf-task-field pdf-task-field--wide">
        <dt>阶段里程碑</dt>
        <dd>{item.milestones.join('；')}</dd>
      </div>
      <div className="pdf-task-field">
        <dt>跟踪指标</dt>
        <dd>{item.trackingIndicator}</dd>
      </div>
      <div className="pdf-task-field pdf-task-field--wide">
        <dt>督办方式</dt>
        <dd>{item.supervisionMethod}</dd>
      </div>
    </dl>
  </article>
);

const ReconciliationTable = ({ checks }: { checks: ReconciliationCheck[] }) => {
  if (!checks.length) return null;

  return (
    <section className="pdf-audit-section">
      <h3>勾稽校验</h3>
      <div className="pdf-check-grid">
        {checks.map((check) => (
          <article key={check.key} className="pdf-check-card">
            <div className="pdf-check-card-head">
              <h4>{check.label}</h4>
              <span className={`pdf-tag ${check.passed ? 'pdf-tag--green' : 'pdf-tag--amber'}`}>
                {check.passed ? '校验通过' : '建议复核'}
              </span>
            </div>
            <dl>
              <div>
                <dt>期望值</dt>
                <dd>{formatInteger(check.expected)}</dd>
              </div>
              <div>
                <dt>实际值</dt>
                <dd>{formatInteger(check.actual)}</dd>
              </div>
              <div className="pdf-check-card-note">
                <dt>校验说明</dt>
                <dd>{check.note}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
};

const getCoreScorecards = (scorecards: ScorecardItem[]): ScorecardItem[] => {
  const byKey = new Map(scorecards.map((item) => [item.key, item]));
  const selected = REQUIRED_SCORECARD_KEYS.map((key) => byKey.get(key)).filter(Boolean) as ScorecardItem[];
  return selected.length === REQUIRED_SCORECARD_KEYS.length ? selected : scorecards.slice(0, 4);
};

const normalizeIdToken = (value: unknown): string => String(value ?? '').trim().toLowerCase();

const extractNumericId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const token = String(value ?? '').trim();
  const match = token.match(/\d+/);
  return match ? Number(match[0]) : null;
};

const resolveGovInsightPrintOrgId = (
  requestedOrgId: string,
  records: AnnualDataRecord[]
): string | null => {
  const normalizedRequested = normalizeIdToken(requestedOrgId);
  const requestedRegionId = extractNumericId(requestedOrgId);
  const candidates = new Map<string, AnnualDataRecord>();

  const addCandidate = (record: AnnualDataRecord | undefined) => {
    if (record?.org_id && !candidates.has(record.org_id)) {
      candidates.set(record.org_id, record);
    }
  };

  addCandidate(records.find((record) => normalizeIdToken(record.org_id) === normalizedRequested));

  if (requestedRegionId !== null) {
    addCandidate(records.find((record) => normalizeIdToken(record.org_id) === `city_${requestedRegionId}`));

    records.forEach((record) => {
      const recordRegionIds = [
        record.region_id,
        extractNumericId(record.org_id),
        extractNumericId(record.city_region_id),
      ].filter((value): value is number => value !== null && Number.isFinite(value));

      if (recordRegionIds.some((value) => value === requestedRegionId)) {
        addCandidate(record);
      }
    });
  }

  if (candidates.size === 0) return null;

  const ordered = Array.from(candidates.keys());
  return (
    ordered.find((candidate) => normalizeIdToken(candidate) === normalizedRequested) ||
    ordered.find((candidate) => normalizeIdToken(candidate) === `city_${requestedRegionId}`) ||
    ordered[0]
  );
};

export const GovInsightReportPrintView: React.FC<{ orgId: string; year: number }> = ({ orgId, year }) => {
  const [entity, setEntity] = useState<EntityProfile | null>(null);
  const [reportData, setReportData] = useState<EnhancedAIReportResponse | null>(null);
  const [resolvedPayload, setResolvedPayload] = useState<GovInsightBackendReportPayload | null>(null);
  const [tocPages, setTocPages] = useState<Record<string, number>>({});
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        setLoading(true);
        const records = await fetchAnnualData(undefined, orgId);
        const resolvedOrgId = resolveGovInsightPrintOrgId(orgId, records || []);

        if (!resolvedOrgId) {
          throw new Error('未找到可导出的年度数据。');
        }

        const [cloudReport, backendReportPayload, annualSummary] = await Promise.all([
          fetchAIReport(resolvedOrgId, year),
          fetchAIReportPayload(resolvedOrgId, year),
          fetchAnnualReportSummary(resolvedOrgId, year),
        ]);

        const selfRecords = (records || []).filter((item) => item.org_id === resolvedOrgId);
        if (!selfRecords.length) {
          throw new Error('未找到可导出的年度数据。');
        }

        const sortedRecords = [...selfRecords].sort((a, b) => a.year - b.year);
        const targetRecord = sortedRecords.find((item) => item.year === year) || sortedRecords[sortedRecords.length - 1];
        const nextEntity: EntityProfile = {
          id: resolvedOrgId,
          name: targetRecord.org_name,
          type: 'city',
          regionId: extractNumericId(targetRecord.region_id) ?? extractNumericId(targetRecord.org_id) ?? undefined,
          data: sortedRecords.map((item: AnnualDataRecord) => transformYearData(item)),
        };

        const normalized = cloudReport?.content
          ? normalizeReportData(
              cloudReport.content,
              nextEntity,
              year,
              annualSummary,
              cloudReport.reportPayload || backendReportPayload
            )
          : buildRuleBasedEnhancedReport(nextEntity, year, annualSummary, backendReportPayload);

        if (!normalized) {
          throw new Error('报告内容加载失败。');
        }

        if (!isMounted) return;
        setEntity(nextEntity);
        setReportData(normalized);
        setResolvedPayload((cloudReport?.reportPayload || backendReportPayload || null) as GovInsightBackendReportPayload | null);
        document.title = `${nextEntity.name}_${year}_政务公开智能辅策报告`;
      } catch (loadError: any) {
        if (isMounted) {
          setError(loadError?.message || '报告加载失败。');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void load();
    return () => {
      isMounted = false;
    };
  }, [orgId, year]);

  const hasHierarchySummary = Boolean(resolvedPayload?.hierarchyAnalysis);

  const chapters = useMemo<Chapter[]>(() => {
    const baseChapters = [
      { id: 'overall', index: '一', title: '总体判断' },
      { id: 'risks', index: '二', title: '重点风险事项' },
      { id: 'facts', index: '三', title: '确认事实' },
      { id: 'analysis', index: '四', title: '审慎分析' },
      ...(hasHierarchySummary ? [{ id: 'hierarchy', index: '五', title: '三级监测重点摘要' }] : []),
      { id: 'questions', index: hasHierarchySummary ? '六' : '五', title: '待补充问题' },
      { id: 'tasks', index: hasHierarchySummary ? '七' : '六', title: '整改任务清单' },
      { id: 'closing', index: hasHierarchySummary ? '八' : '七', title: '结语' },
    ];

    const appendixChapters = [
      { id: 'appendix-audit', index: '附件一', title: '指标审计与勾稽校验', appendix: true },
      { id: 'appendix-boundary', index: '附件二', title: '使用边界与口径说明', appendix: true },
      { id: 'appendix-supplement', index: '附件三', title: '建议补充数据', appendix: true },
    ];

    return [...baseChapters, ...appendixChapters];
  }, [hasHierarchySummary]);

  const reportContext = useMemo(() => {
    if (!entity) return null;
    const current = entity.data.find((item) => item.year === year);
    if (!current) return null;
    const previous = entity.data.find((item) => item.year === year - 1) || null;
    return buildReportContextPayload(entity.name, current, previous);
  }, [entity, year]);

  const riskGroups = useMemo(() => splitRiskItems(reportData?.riskItems || []), [reportData]);
  const coreScorecards = useMemo(() => getCoreScorecards(reportData?.scorecards || []), [reportData]);

  const chaptersWithPages = useMemo<PageMarker[]>(
    () =>
      chapters.map((chapter) => ({
        ...chapter,
        page: tocPages[chapter.id] || 0,
      })),
    [chapters, tocPages]
  );

  useEffect(() => {
    if (loading || error || !reportData) return;

    const computeToc = () => {
      const pages = Array.from(document.querySelectorAll<HTMLElement>('.pdf-page'));
      const nextPages: Record<string, number> = {};
      const pxPerMm = 96 / 25.4;
      const pageHeightPx = 260 * pxPerMm;
      let currentPage = 1;

      pages.forEach((pageElement) => {
        const chapterId = pageElement.dataset.chapterId;
        if (chapterId) {
          nextPages[chapterId] = currentPage;
        }
        currentPage += Math.max(1, Math.ceil(pageElement.offsetHeight / pageHeightPx));
      });

      setTocPages(nextPages);
      Object.entries(nextPages).forEach(([chapterId, page]) => {
        const pageNode = document.querySelector<HTMLElement>(`[data-toc-page-for="${chapterId}"]`);
        if (pageNode) pageNode.textContent = String(page);
      });
      document.documentElement.setAttribute('data-govinsight-pdf-ready', 'true');
    };

    (window as any).__govinsightComputePdfToc = computeToc;

    const raf = window.requestAnimationFrame(() => {
      computeToc();
      window.setTimeout(computeToc, 250);
    });

    return () => {
      window.cancelAnimationFrame(raf);
      delete (window as any).__govinsightComputePdfToc;
    };
  }, [loading, error, reportData, chapters]);

  if (loading) {
    return (
      <div className="pdf-loading">
        正在准备导出报告...
      </div>
    );
  }

  if (error || !entity || !reportData || !reportContext) {
    return (
      <div className="pdf-loading pdf-loading--error">
        {error || '报告加载失败。'}
      </div>
    );
  }

  const reportTitle = `${entity.name} ${year} 年度政务公开智能辅策报告`;

  return (
    <div className="pdf-document-shell" style={reportRootStyle}>
      <div id="govinsight-report-print" className="pdf-document">
        <CoverPage
          entity={entity}
          year={year}
          reportData={reportData}
          reportContext={reportContext}
          resolvedPayload={resolvedPayload}
        />

        <OverviewPage
          reportData={reportData}
          reportContext={reportContext}
          scorecards={coreScorecards}
          riskGroups={riskGroups}
          year={year}
        />

        <DirectoryPage chapters={chaptersWithPages} reportTitle={reportTitle} />

        <ChapterPage id="overall" index="一" title="总体判断" reportTitle={reportTitle}>
          {renderParagraphs(reportData.metadata.overallOverview)}
          {reportData.overallJudgments.map((item, index) => (
            <article key={`judgment-${index}`} className="pdf-content-block">
              <h3>
                {formatSerialMarker(index)}
                {item.heading}
              </h3>
              {renderParagraphs([item.factBasis, item.riskJudgment, item.managementImplication].join('\n'))}
            </article>
          ))}
        </ChapterPage>

        <ChapterPage id="risks" index="二" title="重点风险事项" reportTitle={reportTitle}>
          {riskGroups.primary.length ? (
            <RiskGroup title="（一）首要关注事项" tone="primary">
              {riskGroups.primary.map((item, index) => (
                <RiskItemBlock key={`priority-risk-${index}`} item={item} />
              ))}
            </RiskGroup>
          ) : null}

          {riskGroups.secondary.length ? (
            <RiskGroup title="（二）重点关注事项" tone="secondary">
              {riskGroups.secondary.map((item, index) => (
                <RiskItemBlock key={`secondary-risk-${index}`} item={item} />
              ))}
            </RiskGroup>
          ) : null}

          {riskGroups.tracking.length ? (
            <RiskGroup title="（三）持续跟踪事项" tone="tracking">
              {riskGroups.tracking.map((item, index) => (
                <RiskItemBlock key={`tracking-risk-${index}`} item={item} />
              ))}
            </RiskGroup>
          ) : null}
        </ChapterPage>

        <ChapterPage id="facts" index="三" title="确认事实" reportTitle={reportTitle}>
          {reportData.confirmedFacts.map((group, index) => (
            <FactListBlock key={`fact-${index}`} title={group.category} items={group.points} />
          ))}
        </ChapterPage>

        <ChapterPage id="analysis" index="四" title="审慎分析" reportTitle={reportTitle}>
          {reportData.prudentAnalyses.map((item, index) => (
            <AnalysisBlock
              key={`analysis-${index}`}
              title={item.topic}
              rows={[
                { label: '分析', value: item.analysis },
                { label: '支撑', value: item.support },
                { label: '提示', value: item.caution },
              ]}
            />
          ))}
        </ChapterPage>

        {hasHierarchySummary ? (
          <ChapterPage id="hierarchy" index="五" title="三级监测重点摘要" reportTitle={reportTitle}>
            <HierarchyPrintSummary payload={resolvedPayload} />
          </ChapterPage>
        ) : null}

        <ChapterPage id="questions" index={hasHierarchySummary ? '六' : '五'} title="待补充问题" reportTitle={reportTitle}>
          {reportData.unansweredQuestions.map((item, index) => (
            <AnalysisBlock
              key={`unanswered-${index}`}
              title={item.question}
              rows={[
                { label: '当前限制', value: item.currentLimit },
                { label: '下一步所需数据', value: item.nextDataNeeded },
              ]}
            />
          ))}
        </ChapterPage>

        <ChapterPage id="tasks" index={hasHierarchySummary ? '七' : '六'} title="整改任务清单" reportTitle={reportTitle}>
          <div className="pdf-task-stack">
            {reportData.rectificationTasks.map((item, index) => (
              <RectificationTaskCard
                key={`task-${item.sequence}-${item.taskName}`}
                item={item}
                className={
                  reportData.rectificationTasks.length % 2 === 1 && index === reportData.rectificationTasks.length - 1
                    ? 'pdf-task-card--solo-tail'
                    : ''
                }
              />
            ))}
          </div>
        </ChapterPage>

        <ChapterPage id="closing" index={hasHierarchySummary ? '八' : '七'} title="结语" reportTitle={reportTitle}>
          {renderParagraphs(reportData.closing)}
          {reportData.notes.length ? (
            <article className="pdf-content-block">
              <h3>口径提示</h3>
              <ul className="pdf-dash-list">
                {reportData.notes.map((item, index) => (
                  <li key={`note-${index}`}>{item}</li>
                ))}
              </ul>
            </article>
          ) : null}
        </ChapterPage>

        <ChapterPage id="appendix-audit" index="附件一" title="指标审计与勾稽校验" reportTitle={reportTitle}>
          <section className="pdf-audit-section">
            <h3>指标审计</h3>
            <table className="pdf-table pdf-table--audit">
              <thead>
                <tr>
                  <th>指标</th>
                  <th>计算公式</th>
                  <th>本期值</th>
                  <th>上期值</th>
                  <th>校验说明</th>
                </tr>
              </thead>
              <tbody>
                {reportData.appendices.metricAuditRows.map((row, index) => (
                  <tr key={`appendix-metric-${index}`}>
                    <td>{row.indicator}</td>
                    <td>{row.formula}</td>
                    <td>{row.currentValue}</td>
                    <td>{row.previousValue}</td>
                    <td>{row.reconciliationNote}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <ReconciliationTable checks={reportData.appendices.reconciliationChecks} />
        </ChapterPage>

        <ChapterPage id="appendix-boundary" index="附件二" title="使用边界与口径说明" reportTitle={reportTitle}>
          {reportData.appendices.usageBoundaries.map((item, index) => (
            <article key={`boundary-${index}`} className="pdf-content-block">
              <h3>{item.title}</h3>
              {renderParagraphs(item.description)}
            </article>
          ))}
        </ChapterPage>

        <ChapterPage id="appendix-supplement" index="附件三" title="建议补充数据" reportTitle={reportTitle}>
          {reportData.appendices.supplementDataItems.map((item, index) => (
            <AnalysisBlock
              key={`supplement-${index}`}
              title={item.item}
              rows={[
                { label: '用途', value: item.purpose },
                { label: '建议来源', value: item.suggestedSource },
                { label: '备注', value: item.note },
              ]}
            />
          ))}
        </ChapterPage>
      </div>
    </div>
  );
};

export default GovInsightReportPrintView;
