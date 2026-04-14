import React, { useEffect, useMemo, useState } from 'react';
import { fetchAIReport, fetchAnnualData, fetchAnnualReportSummary } from '../../govinsight/api';
import { transformYearData } from '../../govinsight/data';
import type { AnnualDataRecord, EntityProfile } from '../../govinsight/types';
import {
  buildRuleBasedEnhancedReport,
  formatChangePct,
  formatInteger,
  formatPercent,
  normalizeReportData,
  type AnnualReportSummary,
  type EnhancedAIReportResponse,
  type ScorecardItem,
} from '../../govinsight/utils/aiReport';

const renderParagraphs = (text: string, className = 'text-[14px] leading-[1.95] text-slate-700') =>
  text
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => (
      <p key={`${part}-${index}`} className={className}>
        {part}
      </p>
    ));

const scorecardValue = (item: ScorecardItem) =>
  item.unit === '%' ? formatPercent(item.current) : `${formatInteger(item.current)}${item.unit}`;

const previousScorecardValue = (item: ScorecardItem) =>
  item.unit === '%' ? formatPercent(item.previous) : `${formatInteger(item.previous)}${item.unit}`;

const ChapterPage = ({
  index,
  title,
  children,
}: {
  index: string;
  title: string;
  children: React.ReactNode;
}) => (
  <section className="report-page report-page-break border border-slate-300 bg-white px-9 py-9">
    <div className="border-b border-slate-300 pb-4">
      <h2 className="text-[26px] font-bold tracking-tight text-slate-900">
        {index}、{title}
      </h2>
    </div>
    <div className="mt-5 space-y-4">{children}</div>
  </section>
);

const DirectoryItem = ({ index, title }: { index: string; title: string }) => (
  <div className="flex items-end gap-3 border-b border-dotted border-slate-300 pb-2.5">
    <span className="text-[17px] font-bold text-slate-900">{index}</span>
    <span className="text-[17px] font-bold text-slate-900">{title}</span>
    <span className="mb-[7px] h-px flex-1 border-b border-dotted border-slate-200"></span>
  </div>
);

const SERIAL_MARKERS = ['一', '二', '三', '四', '五', '六', '七', '八'];

const formatSerialMarker = (index: number) => `（${SERIAL_MARKERS[index] || String(index + 1)}）`;

const splitRiskItems = (items: EnhancedAIReportResponse['riskItems']) => ({
  primary: items.filter((item) => item.priorityLevel === '首要关注事项'),
  secondary: items.filter((item) => item.priorityLevel === '重点关注事项'),
  tracking: items.filter((item) => item.priorityLevel === '持续跟踪事项'),
});

export const GovInsightReportPrintView: React.FC<{ orgId: string; year: number }> = ({ orgId, year }) => {
  const [entity, setEntity] = useState<EntityProfile | null>(null);
  const [reportData, setReportData] = useState<EnhancedAIReportResponse | null>(null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        setLoading(true);
        const [records, cloudReport, annualSummary] = await Promise.all([
          fetchAnnualData(undefined, orgId),
          fetchAIReport(orgId, year),
          fetchAnnualReportSummary(orgId, year),
        ]);

        const selfRecords = (records || []).filter((item) => item.org_id === orgId);
        if (!selfRecords.length) {
          throw new Error('未找到可导出的年度数据');
        }

        const sortedRecords = [...selfRecords].sort((a, b) => a.year - b.year);
        const targetRecord = sortedRecords.find((item) => item.year === year) || sortedRecords[sortedRecords.length - 1];
        const nextEntity: EntityProfile = {
          id: orgId,
          name: targetRecord.org_name,
          type: 'city',
          data: sortedRecords.map((item: AnnualDataRecord) => transformYearData(item)),
        };

        const normalized = cloudReport?.content
          ? normalizeReportData(cloudReport.content, nextEntity, year, annualSummary)
          : buildRuleBasedEnhancedReport(nextEntity, year, annualSummary);

        if (!normalized) {
          throw new Error('报告内容加载失败');
        }

        if (!isMounted) return;
        setEntity(nextEntity);
        setReportData(normalized);
        document.title = `${nextEntity.name}_${year}_智能辅策报告`;
      } catch (loadError: any) {
        if (isMounted) {
          setError(loadError?.message || '报告加载失败');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [orgId, year]);

  const chapters = useMemo(
    () => [
      { index: '一', title: '总体判断' },
      { index: '二', title: '需要重点关注的风险事项' },
      { index: '三', title: '基于年报可以确认的事实' },
      { index: '四', title: '基于数据作出的审慎分析' },
      { index: '五', title: '当前报告尚无法充分回答的问题' },
      { index: '六', title: '下一步工作建议与整改任务清单' },
      { index: '七', title: '结语' },
      { index: '附件一', title: '核心指标口径与勾稽说明' },
      { index: '附件二', title: '报告使用边界说明' },
      { index: '附件三', title: '后续补数清单' },
    ],
    []
  );

  const coverMetrics = useMemo(() => (reportData?.scorecards || []).slice(0, 4), [reportData]);
  const riskGroups = useMemo(() => splitRiskItems(reportData?.riskItems || []), [reportData]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white text-slate-500">
        正在准备导出报告…
      </div>
    );
  }

  if (error || !entity || !reportData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-8 text-center text-slate-600">
        {error || '报告加载失败'}
      </div>
    );
  }

  return (
    <>
      <style>
        {`
          @page {
            size: A4;
            margin: 10mm 8mm 12mm;
          }

          html, body {
            margin: 0;
            padding: 0;
            background: #ffffff;
          }

          .report-document-shell {
            font-family: "FangSong", "仿宋", "SimSun", serif;
          }

          .report-document-shell h1,
          .report-document-shell h2,
          .report-document-shell h3,
          .report-document-shell h4,
          .report-document-shell th {
            font-family: "SimHei", "Microsoft YaHei", "黑体", sans-serif;
          }

          .report-page,
          .report-cover-page,
          .report-directory-page {
            min-height: calc(297mm - 18mm);
            box-sizing: border-box;
          }

          .report-page-break {
            page-break-before: always;
            break-before: page;
          }

          .report-avoid-break {
            page-break-inside: avoid;
            break-inside: avoid;
          }

          .report-document-shell table {
            width: 100%;
            border-collapse: collapse;
          }

          .report-document-shell .report-page h3 {
            font-size: 18px;
            line-height: 1.55;
            letter-spacing: 0.01em;
          }

          .report-document-shell .report-page p,
          .report-document-shell .report-page li {
            line-height: 1.9;
          }

          .report-document-shell .report-page th {
            font-size: 12px;
            letter-spacing: 0.04em;
          }

          .report-document-shell .report-page td {
            font-size: 13.5px;
            line-height: 1.75;
          }

          .report-document-shell #govinsight-report-print > * + * {
            margin-top: 0;
          }
        `}
      </style>

      <div className="report-document-shell min-h-screen bg-white text-slate-900">
        <div id="govinsight-report-print" className="mx-auto w-full">
          <section className="report-cover-page border border-slate-300 bg-white px-11 py-11">
            <div className="flex h-full min-h-full flex-col justify-between">
              <div className="space-y-7">
                <div className="inline-flex border border-slate-300 bg-slate-50/30 px-4 py-1 text-[10px] font-semibold tracking-[0.18em] text-slate-700">
                  内部审阅材料
                </div>
                <div>
                  <h1 className="text-[50px] font-bold tracking-[0.06em] text-slate-900">{entity.name}</h1>
                  <h2 className="mt-5 max-w-4xl text-[31px] font-bold leading-[1.58] text-slate-900">
                    {reportData.metadata.reportTitle}
                  </h2>
                  <p className="mt-5 max-w-4xl border-l-4 border-slate-700 pl-5 text-[19px] font-semibold leading-[1.78] text-slate-900">
                    {reportData.metadata.summaryLine}
                  </p>
                  <div className="mt-7 h-[2px] w-32 bg-slate-900"></div>
                </div>
                <div className="max-w-4xl space-y-2.5 border-l-4 border-slate-700 pl-5">
                  {renderParagraphs(reportData.metadata.positioning)}
                  {renderParagraphs(reportData.metadata.evidenceBasis)}
                </div>
                <div className="border-l-4 border-slate-500 bg-slate-50/30 px-5 py-4 text-[14px] leading-[1.9] text-slate-700">
                  <p>{reportData.metadata.cautionNote}</p>
                  <p className="mt-2">{reportData.metadata.auxiliaryRiskLevelNote}</p>
                </div>
                <div className="grid gap-2.5 border-t border-slate-300 pt-4 md:grid-cols-2 xl:grid-cols-4">
                  {coverMetrics.map((item) => (
                    <div key={item.key} className="border border-slate-300 bg-white px-4 py-4">
                      <p className="text-[11px] font-semibold tracking-[0.12em] text-slate-500">{item.label}</p>
                      <p className="mt-2 text-[23px] font-bold leading-none text-slate-900">{scorecardValue(item)}</p>
                      <p className="mt-2 text-[12px] leading-6 text-slate-500">
                        上年 {previousScorecardValue(item)}，同比 {formatChangePct(item.changePct)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border-t border-slate-300 pt-4 text-[12px] leading-6 text-slate-600">
                <p>编制年度：{year} 年</p>
                <p>辅助说明：{reportData.metadata.auxiliaryRiskLevel}，仅作综合研判参考。</p>
              </div>
            </div>
          </section>

          <section className="report-directory-page report-page-break border border-slate-300 bg-white px-10 py-10">
            <div className="border-b border-slate-300 pb-4">
              <p className="text-center text-[32px] font-bold tracking-[0.28em] text-slate-900">目录</p>
            </div>
            <div className="mt-7 space-y-3.5">
              {chapters.map((item) => (
                <DirectoryItem key={item.index} index={item.index} title={item.title} />
              ))}
            </div>
          </section>

          <ChapterPage index="一" title="总体判断">
            {renderParagraphs(reportData.metadata.overallOverview)}
            {reportData.overallJudgments.map((item, index) => (
              <div key={`judgment-${index}`} className="report-avoid-break border border-slate-300 bg-white p-5">
                <h3 className="text-[18px] font-bold tracking-[0.01em] text-slate-900">
                  {formatSerialMarker(index)}
                  {item.heading}
                </h3>
                <div className="mt-3 space-y-2">
                  {renderParagraphs([item.factBasis, item.riskJudgment, item.managementImplication].join('\n'))}
                </div>
              </div>
            ))}
          </ChapterPage>

          <ChapterPage index="二" title="需要重点关注的风险事项">
            {riskGroups.primary.length ? (
              <div className="space-y-3">
                <div className="report-avoid-break border border-slate-300 border-l-[5px] border-l-rose-700 bg-white p-4">
                  <p className="text-[16px] font-bold text-rose-800">（一）首要关注事项</p>
                </div>
                {riskGroups.primary.map((item, index) => (
                  <div key={`priority-risk-${index}`} className="report-avoid-break border border-slate-300 bg-white p-5">
                    <h3 className="text-[18px] font-bold tracking-[0.01em] text-slate-900">{item.riskName}</h3>
                    <div className="mt-3 space-y-1.5 text-[14px] leading-[1.9] text-slate-700">
                      <p><span className="font-semibold text-slate-900">依据：</span>{item.basis}</p>
                      <p><span className="font-semibold text-slate-900">风险表现：</span>{item.manifestation}</p>
                      <p><span className="font-semibold text-slate-900">管理影响：</span>{item.impact}</p>
                      <p><span className="font-semibold text-slate-900">关注重点：</span>{item.focus}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {riskGroups.secondary.length ? (
              <div className="space-y-3">
                <div className="report-avoid-break border border-slate-300 border-l-[5px] border-l-amber-700 bg-white p-4">
                  <p className="text-[16px] font-bold text-amber-800">（二）重点关注事项</p>
                </div>
                {riskGroups.secondary.map((item, index) => (
                  <div key={`secondary-risk-${index}`} className="report-avoid-break border border-slate-300 bg-white p-5">
                    <h3 className="text-[18px] font-bold tracking-[0.01em] text-slate-900">{item.riskName}</h3>
                    <div className="mt-3 space-y-1.5 text-[14px] leading-[1.9] text-slate-700">
                      <p><span className="font-semibold text-slate-900">依据：</span>{item.basis}</p>
                      <p><span className="font-semibold text-slate-900">风险表现：</span>{item.manifestation}</p>
                      <p><span className="font-semibold text-slate-900">管理影响：</span>{item.impact}</p>
                      <p><span className="font-semibold text-slate-900">关注重点：</span>{item.focus}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {riskGroups.tracking.length ? (
              <div className="space-y-3">
                <div className="report-avoid-break border border-slate-300 border-l-[5px] border-l-slate-700 bg-white p-4">
                  <p className="text-[16px] font-bold text-slate-800">（三）持续跟踪事项</p>
                </div>
                {riskGroups.tracking.map((item, index) => (
                  <div key={`tracking-risk-${index}`} className="report-avoid-break border border-slate-300 bg-white p-5">
                    <h3 className="text-[18px] font-bold tracking-[0.01em] text-slate-900">{item.riskName}</h3>
                    <div className="mt-3 space-y-1.5 text-[14px] leading-[1.9] text-slate-700">
                      <p><span className="font-semibold text-slate-900">依据：</span>{item.basis}</p>
                      <p><span className="font-semibold text-slate-900">风险表现：</span>{item.manifestation}</p>
                      <p><span className="font-semibold text-slate-900">管理影响：</span>{item.impact}</p>
                      <p><span className="font-semibold text-slate-900">关注重点：</span>{item.focus}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </ChapterPage>

          <ChapterPage index="三" title="基于年报可以确认的事实">
            {reportData.confirmedFacts.map((group, index) => (
              <div key={`fact-${index}`} className="report-avoid-break border border-slate-300 bg-white p-5">
                <h3 className="text-[18px] font-bold tracking-[0.01em] text-slate-900">{group.category}</h3>
                <ul className="mt-4 space-y-2">
                  {group.points.map((point, pointIndex) => (
                    <li key={`fact-${index}-${pointIndex}`} className="flex items-start gap-3">
                      <span className="mt-[13px] h-px w-3 flex-shrink-0 bg-slate-900"></span>
                      <span className="text-[14px] leading-[1.9] text-slate-700">{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </ChapterPage>

          <ChapterPage index="四" title="基于数据作出的审慎分析">
            {reportData.prudentAnalyses.map((item, index) => (
              <div key={`analysis-${index}`} className="report-avoid-break border border-slate-300 bg-white p-5">
                <h3 className="text-[18px] font-bold tracking-[0.01em] text-slate-900">{item.topic}</h3>
                <p className="mt-3 text-[15px] leading-8 text-slate-700"><span className="font-semibold text-slate-900">分析：</span>{item.analysis}</p>
                <p className="mt-2 text-[15px] leading-8 text-slate-700"><span className="font-semibold text-slate-900">支撑：</span>{item.support}</p>
                <p className="mt-2 text-[15px] leading-8 text-slate-700"><span className="font-semibold text-slate-900">边界：</span>{item.caution}</p>
              </div>
            ))}
          </ChapterPage>

          <ChapterPage index="五" title="当前报告尚无法充分回答的问题">
            {reportData.unansweredQuestions.map((item, index) => (
              <div key={`unanswered-${index}`} className="report-avoid-break border border-slate-300 bg-white p-5">
                <h3 className="text-[18px] font-bold tracking-[0.01em] text-slate-900">{item.question}</h3>
                <p className="mt-3 text-[15px] leading-8 text-slate-700"><span className="font-semibold text-slate-900">当前边界：</span>{item.currentLimit}</p>
                <p className="mt-2 text-[15px] leading-8 text-slate-700"><span className="font-semibold text-slate-900">后续补数建议：</span>{item.nextDataNeeded}</p>
              </div>
            ))}
          </ChapterPage>

          <ChapterPage index="六" title="下一步工作建议与整改任务清单">
            <div className="space-y-3">
              {reportData.rectificationTasks.map((item, index) => (
                <div key={`task-${index}`} className="report-avoid-break border border-slate-300 bg-white p-5">
                  <div className="border-b border-slate-100 pb-4">
                    <p className="text-[12px] font-semibold tracking-[0.08em] text-slate-500">序号 {item.sequence}</p>
                    <div className="mt-2 flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <h3 className="text-[18px] font-bold tracking-[0.01em] text-slate-900">{item.taskName}</h3>
                        <div className="flex flex-wrap gap-2">
                          <span className="border border-slate-300 bg-slate-50/20 px-3 py-1 text-[12px] font-semibold text-slate-600">{item.taskType}</span>
                          <span className="border border-slate-300 bg-slate-50/20 px-3 py-1 text-[12px] font-semibold text-slate-700">{item.priority}</span>
                        </div>
                      </div>
                      <span className="border border-slate-300 bg-white px-3 py-1 text-[12px] font-semibold text-slate-600">
                        {item.responsibilityLevel}
                      </span>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="border border-slate-300 bg-white px-4 py-3">
                      <p className="text-[12px] font-semibold tracking-[0.08em] text-slate-500">问题指向</p>
                      <p className="mt-2 text-[15px] leading-8 text-slate-700">{item.problem}</p>
                    </div>
                    <div className="border border-slate-300 bg-white px-4 py-3">
                      <p className="text-[12px] font-semibold tracking-[0.08em] text-slate-500">工作措施</p>
                      <p className="mt-2 text-[15px] leading-8 text-slate-700">{item.measure}</p>
                    </div>
                    <div className="border border-slate-300 bg-white px-4 py-3">
                      <p className="text-[12px] font-semibold tracking-[0.08em] text-slate-500">牵头单位</p>
                      <p className="mt-2 text-[15px] leading-8 text-slate-700">{item.leadUnit}</p>
                    </div>
                    <div className="border border-slate-300 bg-white px-4 py-3">
                      <p className="text-[12px] font-semibold tracking-[0.08em] text-slate-500">配合单位</p>
                      <p className="mt-2 text-[15px] leading-8 text-slate-700">{item.supportUnits}</p>
                    </div>
                    <div className="border border-slate-300 bg-white px-4 py-3">
                      <p className="text-[12px] font-semibold tracking-[0.08em] text-slate-500">完成时限</p>
                      <p className="mt-2 text-[15px] leading-8 text-slate-700">{item.deadline}</p>
                    </div>
                    <div className="border border-slate-300 bg-white px-4 py-3">
                      <p className="text-[12px] font-semibold tracking-[0.08em] text-slate-500">阶段性节点</p>
                      <ul className="mt-2 space-y-1 text-[15px] leading-8 text-slate-700">
                        {item.milestones.map((milestone, milestoneIndex) => (
                          <li key={`milestone-${index}-${milestoneIndex}`}>{milestone}</li>
                        ))}
                      </ul>
                    </div>
                    <div className="border border-slate-300 bg-white px-4 py-3">
                      <p className="text-[12px] font-semibold tracking-[0.08em] text-slate-500">跟踪指标</p>
                      <p className="mt-2 text-[15px] leading-8 text-slate-700">{item.trackingIndicator}</p>
                    </div>
                    <div className="border border-slate-300 bg-white px-4 py-3 md:col-span-2">
                      <p className="text-[12px] font-semibold tracking-[0.08em] text-slate-500">督办方式</p>
                      <p className="mt-2 text-[15px] leading-8 text-slate-700">{item.supervisionMethod}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ChapterPage>

          <ChapterPage index="七" title="结语">
            {renderParagraphs(reportData.closing)}
            {reportData.notes.length ? (
              <div className="mt-6 border border-slate-300 bg-white px-5 py-4">
                <h3 className="text-[18px] font-bold text-slate-900">口径提示</h3>
                <ul className="mt-3 space-y-2">
                  {reportData.notes.map((item, index) => (
                    <li key={`note-${index}`} className="flex items-start gap-3">
                      <span className="mt-[13px] h-px w-3 flex-shrink-0 bg-slate-500"></span>
                      <span className="text-[15px] leading-8 text-slate-700">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </ChapterPage>

          <ChapterPage index="附件一" title="核心指标口径与勾稽说明">
            <div className="overflow-hidden border border-slate-300">
              <table>
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-3 py-3 text-left text-[13px]">指标</th>
                    <th className="px-3 py-3 text-left text-[13px]">来源字段</th>
                    <th className="px-3 py-3 text-left text-[13px]">计算公式</th>
                    <th className="px-3 py-3 text-left text-[13px]">本年值</th>
                    <th className="px-3 py-3 text-left text-[13px]">上年值</th>
                    <th className="px-3 py-3 text-left text-[13px]">校验说明</th>
                  </tr>
                </thead>
                <tbody>
                  {reportData.appendices.metricAuditRows.map((row, index) => (
                    <tr key={`appendix-metric-${index}`} className="border-t border-slate-200 align-top">
                      <td className="px-3 py-3 text-[14px] font-bold text-slate-900">{row.indicator}</td>
                      <td className="px-3 py-3 text-[14px] leading-7 text-slate-700">{row.sourceFields}</td>
                      <td className="px-3 py-3 text-[14px] leading-7 text-slate-700">{row.formula}</td>
                      <td className="px-3 py-3 text-[14px] leading-7 text-slate-700">{row.currentValue}</td>
                      <td className="px-3 py-3 text-[14px] leading-7 text-slate-700">{row.previousValue}</td>
                      <td className="px-3 py-3 text-[14px] leading-7 text-slate-700">{row.reconciliationNote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {reportData.appendices.reconciliationChecks.map((check) => (
                <div key={check.key} className={`report-avoid-break border px-4 py-4 ${check.passed ? 'border-slate-300 bg-white' : 'border-rose-300 bg-rose-50/30'}`}>
                  <p className="text-[14px] font-bold tracking-[0.01em] text-slate-900">{check.label}</p>
                  <p className="mt-2 text-[14px] leading-7 text-slate-700">应为：{formatInteger(check.expected)}，实际：{formatInteger(check.actual)}</p>
                  <p className="text-[14px] leading-7 text-slate-700">{check.note}</p>
                </div>
              ))}
            </div>
          </ChapterPage>

          <ChapterPage index="附件二" title="报告使用边界说明">
            {reportData.appendices.usageBoundaries.map((item, index) => (
              <div key={`boundary-${index}`} className="report-avoid-break border border-slate-300 bg-white p-5">
                <h3 className="text-[18px] font-bold tracking-[0.01em] text-slate-900">{item.title}</h3>
                <p className="mt-3 text-[15px] leading-8 text-slate-700">{item.description}</p>
              </div>
            ))}
          </ChapterPage>

          <ChapterPage index="附件三" title="后续补数清单">
            {reportData.appendices.supplementDataItems.map((item, index) => (
              <div key={`supplement-${index}`} className="report-avoid-break border border-slate-300 bg-white p-5">
                <h3 className="text-[18px] font-bold tracking-[0.01em] text-slate-900">{item.item}</h3>
                <p className="mt-3 text-[15px] leading-8 text-slate-700"><span className="font-semibold text-slate-900">用途：</span>{item.purpose}</p>
                <p className="mt-2 text-[15px] leading-8 text-slate-700"><span className="font-semibold text-slate-900">建议来源：</span>{item.suggestedSource}</p>
                <p className="mt-2 text-[15px] leading-8 text-slate-700"><span className="font-semibold text-slate-900">补数说明：</span>{item.note}</p>
              </div>
            ))}
          </ChapterPage>
        </div>
      </div>
    </>
  );
};

export default GovInsightReportPrintView;
