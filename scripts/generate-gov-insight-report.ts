import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';
import type { AnnualData, EntityProfile } from '../frontend/src/govinsight/types';
import {
  buildReportContextPayload,
  buildRuleBasedEnhancedReport,
  changePct,
  formatChangePct,
  formatInteger,
  formatPercent,
  type AnnualReportSummary,
  type EnhancedAIReportResponse,
} from '../frontend/src/govinsight/utils/aiReport';
import { extractAnnualReportSummary, normalizePlainText } from '../src/utils/annualReportSummary';

dotenv.config();

type CliArgs = {
  orgId: string;
  orgName?: string;
  regionId: number;
  year: number;
  output: string;
  save: boolean;
};

const getArgValue = (name: string): string | undefined => {
  const exact = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (exact) return exact.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
};

const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const parseArgs = (): CliArgs => {
  const orgId = getArgValue('org-id') || 'city_721';
  const regionIdRaw = getArgValue('region-id') || orgId.match(/\d+/)?.[0] || '';
  const year = Number(getArgValue('year') || '2025');
  const regionId = Number(regionIdRaw);

  if (!orgId) {
    throw new Error('缺少 --org-id 参数');
  }
  if (!Number.isInteger(regionId) || regionId <= 0) {
    throw new Error('缺少有效的 --region-id 参数');
  }
  if (!Number.isInteger(year) || year < 2000) {
    throw new Error('缺少有效的 --year 参数');
  }

  const orgName = getArgValue('org-name');
  const safeName = (orgName || orgId).replace(/[\\/:*?"<>|]+/g, '_');
  const output =
    getArgValue('output') || path.join(process.cwd(), 'docs', `${safeName}-${year}-annual-report-preview.md`);

  return {
    orgId,
    orgName,
    regionId,
    year,
    output,
    save: hasFlag('save'),
  };
};

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'llm_ingestion',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const toNumber = (value: unknown): number => Number(value || 0);

const formatPointDelta = (current: number, previous: number): string => {
  if (!previous) return '暂无上年同期可比口径';
  const delta = Math.round((current - previous) * 10) / 10;
  const prefix = delta > 0 ? '上升' : delta < 0 ? '下降' : '持平';
  return delta === 0 ? '持平' : `${prefix} ${Math.abs(delta).toFixed(1)} 个百分点`;
};

const mapRowToAnnualData = (row: Record<string, unknown>): AnnualData => ({
  year: toNumber(row.year),
  regulations: {
    published: toNumber(row.reg_published),
    abolished: toNumber(row.reg_abolished),
    active: toNumber(row.reg_active),
  },
  normativeDocuments: {
    published: toNumber(row.doc_published),
    abolished: toNumber(row.doc_abolished),
    active: toNumber(row.doc_active),
  },
  adminActions: {
    licensing: toNumber(row.action_licensing),
    punishment: toNumber(row.action_punishment),
    force: toNumber(row.action_force),
  },
  fees: {
    amount: toNumber(row.fees_amount),
  },
  applications: {
    newReceived: toNumber(row.app_new),
    carriedOver: toNumber(row.app_carried_over),
    totalHandled:
      toNumber(row.outcome_public) +
      toNumber(row.outcome_partial) +
      toNumber(row.outcome_unable) +
      toNumber(row.outcome_not_open) +
      toNumber(row.outcome_ignore) +
      toNumber(row.outcome_other),
    sources: {
      natural: toNumber(row.source_natural),
      legal: Math.max(0, toNumber(row.app_new) - toNumber(row.source_natural)),
    },
    outcomes: {
      public: toNumber(row.outcome_public),
      partial: toNumber(row.outcome_partial),
      unable: toNumber(row.outcome_unable),
      notOpen: toNumber(row.outcome_not_open),
      ignore: toNumber(row.outcome_ignore) + toNumber(row.outcome_other),
      unableNoInfo: toNumber(row.outcome_unable_no_info),
      unableNeedCreation: toNumber(row.outcome_unable_need_creation),
      unableUnclear: toNumber(row.outcome_unable_unclear),
      notOpenDanger: toNumber(row.outcome_not_open_danger),
      notOpenProcess: toNumber(row.outcome_not_open_process),
      notOpenInternal: toNumber(row.outcome_not_open_internal),
      notOpenThirdParty: toNumber(row.outcome_not_open_third_party),
      notOpenAdminQuery: toNumber(row.outcome_not_open_admin_query),
      ignoreRepeat: toNumber(row.outcome_ignore_repeat),
      other: toNumber(row.outcome_other),
    },
    outcomesDetail: {
      notOpen: {
        stateSecret: 0,
        lawForbidden: 0,
        danger: toNumber(row.outcome_not_open_danger),
        thirdParty: toNumber(row.outcome_not_open_third_party),
        internal: toNumber(row.outcome_not_open_internal),
        process: toNumber(row.outcome_not_open_process),
        enforcement: 0,
        adminQuery: toNumber(row.outcome_not_open_admin_query),
      },
      unable: {
        noInfo: toNumber(row.outcome_unable_no_info),
        needCreation: toNumber(row.outcome_unable_need_creation),
        unclear: toNumber(row.outcome_unable_unclear),
      },
      untreated: {
        complaint: 0,
        repeat: toNumber(row.outcome_ignore_repeat),
        publication: 0,
        massive: 0,
        confirm: 0,
      },
      other: {
        overdueCorrection: 0,
        overdueFee: 0,
        other: 0,
      },
    },
    carriedForward: toNumber(row.app_carried_forward),
  },
  disputes: {
    reconsideration: {
      total: toNumber(row.rev_total),
      maintained: 0,
      corrected: toNumber(row.rev_corrected),
      other: 0,
      pending: 0,
    },
    litigation: {
      total: toNumber(row.lit_total),
      maintained: 0,
      corrected: toNumber(row.lit_corrected),
      other: 0,
      pending: 0,
    },
  },
});

const loadEntity = async (regionId: number, orgId: string, year: number, fallbackName?: string): Promise<EntityProfile> => {
  const result = await pool.query(
    `
    SELECT
      year,
      org_id,
      org_name,
      reg_published,
      reg_active,
      reg_abolished,
      doc_published,
      doc_active,
      doc_abolished,
      action_licensing,
      action_punishment,
      action_force,
      fees_amount,
      app_new,
      app_carried_over,
      source_natural,
      outcome_public,
      outcome_partial,
      outcome_unable,
      outcome_unable_no_info,
      outcome_unable_need_creation,
      outcome_unable_unclear,
      outcome_not_open,
      outcome_not_open_danger,
      outcome_not_open_process,
      outcome_not_open_internal,
      outcome_not_open_third_party,
      outcome_not_open_admin_query,
      outcome_ignore,
      outcome_ignore_repeat,
      outcome_other,
      app_carried_forward,
      rev_total,
      rev_corrected,
      lit_total,
      lit_corrected
    FROM gov_open_annual_stats
    WHERE split_part(org_id, '_', 2) = $1 AND year IN ($2, $3)
    ORDER BY year ASC
    `,
    [String(regionId), year - 1, year]
  );

  if (!result.rows.length) {
    throw new Error(`未找到 region_id=${regionId} 在 ${year - 1}/${year} 年度的统计数据`);
  }

  const orgName = fallbackName || String(result.rows[result.rows.length - 1].org_name || orgId);

  return {
    id: orgId,
    name: orgName,
    type: 'city',
    data: result.rows.map((row) => mapRowToAnnualData(row)),
  };
};

const loadAnnualReportSummary = async (regionId: number, year: number, orgName: string): Promise<AnnualReportSummary | null> => {
  const result = await pool.query(
    `
    SELECT r.unit_name, rv.raw_text
    FROM reports r
    LEFT JOIN report_versions rv ON rv.id = r.active_version_id
    WHERE r.region_id = $1 AND r.year = $2
    LIMIT 1
    `,
    [regionId, year]
  );

  if (!result.rows.length) {
    return null;
  }

  const row = result.rows[0];
  const rawText = normalizePlainText(String(row.raw_text || ''));
  if (!rawText) {
    return null;
  }

  const summary = extractAnnualReportSummary(rawText);
  return {
    ...summary,
    available: true,
    unitName: String(row.unit_name || orgName),
    rawTextPreview: rawText.slice(0, 500),
  };
};

const buildDetailedTemplateReport = (
  entity: EntityProfile,
  year: number,
  annualReportSummary: AnnualReportSummary | null
): EnhancedAIReportResponse => {
  const base = buildRuleBasedEnhancedReport(entity, year, annualReportSummary);
  if (!base) {
    throw new Error(`无法为 ${entity.name} ${year} 生成基础报告`);
  }

  const current = entity.data.find((item) => item.year === year);
  const previous = entity.data.find((item) => item.year === year - 1) || null;
  if (!current) {
    throw new Error(`缺少 ${entity.name} ${year} 年度数据`);
  }

  const context = buildReportContextPayload(entity.name, current, previous, undefined, annualReportSummary);
  const annualHighlights = annualReportSummary?.highlights || [];
  const annualProblems = annualReportSummary?.problemSnippets || [];
  const annualImprovements = annualReportSummary?.improvements || [];

  return {
    ...base,
    executiveSummary: {
      rating: context.rating,
      riskLabel: context.riskLabel,
      headline: `效率改善较为明显，但法治风险和源头信息治理短板仍需持续攻坚`,
      overview: `${year} 年，${entity.name}政务公开工作总体保持平稳运行，依申请公开需求继续处于高位，新收申请 ${formatInteger(
        context.current.newReceived
      )} 件，较上年 ${formatChangePct(changePct(context.current.newReceived, context.previous?.newReceived || 0))}；结转下年 ${
        formatInteger(context.current.carriedForward)
      } 件，结转率较上年 ${formatPointDelta(
        context.current.carryForwardRate,
        context.previous?.carryForwardRate || 0
      )}。但从争议结果看，行政复议纠错占比仍为 ${formatPercent(
        context.current.revRate
      )}，且“本机关不掌握相关政府信息”占无法提供的比重仍然偏高，说明工作重心应由“提速办结”进一步转向“依法办准、源头治理、减少外溢”。`,
      keyMessages: [
        `依申请公开总量仍处高位运行，新收申请 ${formatInteger(context.current.newReceived)} 件，工作压力并未实质下降。`,
        `办结节奏有所优化，结转下年 ${formatInteger(context.current.carriedForward)} 件，较上年明显回落。`,
        `行政复议总量下降，但纠错占比仍达 ${formatPercent(context.current.revRate)}，说明质量风险尚未同步收敛。`,
        annualHighlights[0]
          ? `年报原文显示：${annualHighlights[0]}`
          : `“无法提供”占比为 ${formatPercent(context.current.unableRate)}，源头信息掌握与协同调取能力仍是短板。`,
      ],
    },
    sections: {
      disclosureAnalysis: {
        summary: `主动公开方面，${entity.name}${year} 年围绕重点领域、政策解读、平台发布和新闻发布形成了较完整的公开供给链条。现行有效规范性文件 ${
          formatInteger(context.current.docActive)
        } 件，行政许可 ${formatInteger(context.current.actionLicensing)} 件，行政处罚 ${formatInteger(
          context.current.actionPunishment
        )} 件，说明重点政务信息供给基础仍较扎实。结合年报原文看，当前主动公开工作的主要优势在于重点领域信息公开和政策解读较为持续，但仍需把高频依申请事项反向纳入专题公开，进一步提升公开供给的针对性。`,
        bullets: [
          `现行有效规范性文件 ${formatInteger(context.current.docActive)} 件，较上年形成明显扩容，说明制度信息归集和公开基础有所增强。`,
          `行政许可 ${formatInteger(context.current.actionLicensing)} 件、行政处罚 ${formatInteger(context.current.actionPunishment)} 件，重点监管与审批事项公开基盘较大。`,
          annualHighlights[1] ? `年报原文摘录显示：${annualHighlights[1]}` : '年报侧重平台建设、信息发布审查和公开供给稳定性，整体方向较为清晰。',
          '下一步宜围绕高频申请主题建立主动公开专题页、图解问答和标准释明口径，降低重复申请压力。',
        ],
      },
      requestAnalysis: {
        summary: `依申请公开仍是当前治理重点。${year} 年新收申请 ${formatInteger(
          context.current.newReceived
        )} 件，实体公开转化率为 ${formatPercent(
          context.current.substantiveRate
        )}，较上年 ${formatPointDelta(
          context.current.substantiveRate,
          context.previous?.substantiveRate || 0
        )}。从办件结构看，自然人仍是主体，但专业化申请和争议导向申请的治理难度有所提升。当前主要矛盾已经从“能否办结”转向“能否答准、答稳、答得经得起复议诉讼检验”。`,
        applicantStructure: [
          `自然人申请占比 ${formatPercent(context.current.naturalShare)}，仍是依申请公开的主体来源。`,
          `法人及其他主体占比 ${formatPercent(context.current.legalShare)}，专业化申请和代理化申请的影响需要持续关注。`,
          annualReportSummary?.sections.requestDisclosure
            ? `年报原文归纳：${annualReportSummary.sections.requestDisclosure}`
            : `“无法提供”占比 ${formatPercent(context.current.unableRate)}，说明信息掌握与协同调取能力仍需进一步提升。`,
        ],
        bullets: [
          `“予以公开”和“部分公开”合计占比 ${formatPercent(context.current.substantiveRate)}，较上年 ${formatPointDelta(
            context.current.substantiveRate,
            context.previous?.substantiveRate || 0
          )}。`,
          `“无法提供” ${formatInteger(context.current.unableCount)} 件，其中“本机关不掌握相关政府信息” ${formatInteger(
            context.current.noInfoCount
          )} 件，占无法提供的 ${formatPercent(
            (context.current.noInfoCount / Math.max(1, context.current.unableCount)) * 100
          )}。`,
          `结转率 ${formatPercent(context.current.carryForwardRate)}，较上年 ${formatPointDelta(
            context.current.carryForwardRate,
            context.previous?.carryForwardRate || 0
          )}，说明流程管控有所强化。`,
          '后续重点不宜只放在压缩时限，更要前移到受理研判、事实核查、跨部门协同调取和释法说理环节。',
        ],
      },
      legalRiskAnalysis: {
        summary: `法治风险仍是当前最需要领导层关注的核心变量。${year} 年行政复议 ${
          formatInteger(context.current.revTotal)
        } 件，结果纠正 ${formatInteger(context.current.revCorrected)} 件，纠错占比 ${
          formatPercent(context.current.revRate)
        }；行政诉讼 ${formatInteger(context.current.litTotal)} 件，结果纠正 ${formatInteger(
          context.current.litCorrected
        )} 件。虽然复议总量较上年下降，但纠错占比未同步下降，说明问题正在由数量压力转化为质量压力，制度边界把握、答复合法性和证据链完整性仍需加强。`,
        bullets: [
          `行政复议总量较上年 ${formatChangePct(changePct(context.current.revTotal, context.previous?.revTotal || 0))}，但纠错占比仍为 ${formatPercent(context.current.revRate)}。`,
          `行政诉讼总量较上年 ${formatChangePct(changePct(context.current.litTotal, context.previous?.litTotal || 0))}，虽终局纠错占比可控，但外溢趋势需要提前处置。`,
          annualProblems[0] ? `年报自揭问题提到：${annualProblems[0]}` : '年报也反映出基层办理质量和答复规范性仍有提升空间。',
          '建议把复议纠错案件逐案复盘，按“受理判断、事实认定、法律适用、说理完整性”四类错因建立闭环台账。',
        ],
      },
    },
    problems: [
      {
        title: '复议纠错占比仍处于重点关注区间',
        priority: '高',
        description: `行政复议结果纠正 ${formatInteger(context.current.revCorrected)} 件，纠错占比 ${formatPercent(
          context.current.revRate
        )}，未随着复议总量下降而同步收敛。`,
        cause: '说明答复合法性、证据链完整性与释法说理质量仍存在结构性短板，部分问题在办件前端已形成。',
      },
      {
        title: '源头信息掌握不足导致“无法提供”高位运行',
        priority: '高',
        description: `“无法提供” ${formatInteger(context.current.unableCount)} 件，其中“本机关不掌握相关政府信息” ${formatInteger(
          context.current.noInfoCount
        )} 件，占比偏高。`,
        cause: '反映信息形成、归集、沉淀、检索和跨部门调取链路仍不顺畅，政务信息资产化管理能力需要补强。',
      },
      {
        title: '主动公开与依申请公开反向联动不足',
        priority: '中',
        description: '高频申请事项尚未系统转化为专题公开、图解问答和标准释明内容，重复申请压力难以下降。',
        cause: '当前公开供给仍偏栏目驱动，缺少以高频申请主题倒推公开选题和内容更新机制。',
      },
      ...(annualProblems[0]
        ? [
            {
              title: '年报原文揭示基层规范化水平仍有差异',
              priority: '中' as const,
              description: annualProblems.join('；'),
              cause: '说明市级要求已经建立，但基层办理口径、文书规范性和执行稳定性仍存在落差。',
            },
          ]
        : []),
    ],
    actionPlan: [
      {
        title: '建立复议纠错案件全量复盘机制',
        owner: '市政府办公室、司法行政部门',
        timeline: '30 天内启动，季度滚动复盘',
        deliverable: '纠错案件台账、错因标签库、典型案例清单',
        target: '形成“高频错因可识别、责任单位可定位、整改动作可追踪”的闭环机制',
      },
      {
        title: '建设高频申请主题知识库',
        owner: '市政府办公室、相关业务条线单位',
        timeline: '90 天内形成首批成果',
        deliverable: '高频主题清单、标准答复底稿、证据材料目录',
        target: '重点主题覆盖率不低于 80%，重复申请事项明显下降',
      },
      {
        title: '开展不予公开和无法提供口径统一行动',
        owner: '市政府办公室、保密部门、司法行政部门',
        timeline: '90 天内完成第一轮校准',
        deliverable: '统一口径问答册、负面案例清单、交叉评审机制',
        target: '同类场景答复标准基本统一，边界解释更具稳定性',
      },
      {
        title: '把高频依申请事项反向纳入主动公开',
        owner: '市政府办公室、各重点领域主管部门',
        timeline: '全年推进',
        deliverable: '专题公开页、图解解读、问答清单、办理指引',
        target: '用主动公开减少重复申请，用清晰释明减少程序性争议',
      },
      ...(annualImprovements[0]
        ? [
            {
              title: '将年报承诺的改进方向转化为督办任务',
              owner: '市政府办公室、相关责任单位',
              timeline: '全年',
              deliverable: annualImprovements.join('；'),
              target: '将年报中的改进承诺逐项转化为可跟踪的年度任务',
            },
          ]
        : []),
    ],
    dataNotes: [
      '本报告基于结构化统计数据与年度报告原文摘要联合生成，适合用于领导汇报、研判会商和批量初稿输出。',
      annualReportSummary?.publishDate
        ? `本次接入的年报公开日期为 ${annualReportSummary.publishDate}，系统已将其中的主动公开、依申请公开和问题改进表述吸收到分析逻辑中。`
        : '如后续补充年报原文或正式发布版本，建议重新生成一次报告，以保证正式材料口径一致。',
      `当前规范性文件现行有效数为 ${formatInteger(context.current.docActive)} 件，较上年变化较大，正式上会材料建议再与原始台账口径复核一次。`,
    ],
  };
};

const buildMarkdown = (
  report: EnhancedAIReportResponse,
  entity: EntityProfile,
  year: number,
  annualReportSummary: AnnualReportSummary | null
): string => {
  const lines: string[] = [];

  lines.push(`# ${entity.name}${year}年政务公开智慧治理 AI 辅助决策报告`);
  lines.push('');
  lines.push(`- 评估对象：${entity.name}`);
  lines.push(`- 年度：${year}`);
  lines.push(`- 风险等级：${report.executiveSummary.rating}级（${report.executiveSummary.riskLabel}）`);
  lines.push(`- 生成时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`);
  lines.push('');
  lines.push('## 一、总体结论');
  lines.push('');
  lines.push(report.executiveSummary.headline);
  lines.push('');
  lines.push(report.executiveSummary.overview);
  lines.push('');
  report.executiveSummary.keyMessages.forEach((item) => lines.push(`- ${item}`));

  if (annualReportSummary?.available) {
    lines.push('');
    lines.push('## 二、年报原文依据');
    lines.push('');
    lines.push(`- 标题：${annualReportSummary.title || `${entity.name}${year}年政府信息公开工作年度报告`}`);
    if (annualReportSummary.publishDate) {
      lines.push(`- 公开日期：${annualReportSummary.publishDate}`);
    }
    annualReportSummary.highlights.forEach((item) => lines.push(`- 年报亮点：${item}`));
    annualReportSummary.problemSnippets.forEach((item) => lines.push(`- 年报自揭问题：${item}`));
  }

  lines.push('');
  lines.push('## 三、核心指标卡');
  lines.push('');
  report.scorecards.forEach((item) => {
    lines.push(
      `- ${item.label}：本年 ${item.unit === '%' ? formatPercent(item.current) : `${formatInteger(item.current)}${item.unit}`}，上年 ${
        item.unit === '%' ? formatPercent(item.previous) : `${formatInteger(item.previous)}${item.unit}`
      }，同比 ${formatChangePct(item.changePct)}`
    );
  });

  const sections = [
    ['主动公开分析', report.sections.disclosureAnalysis.summary, report.sections.disclosureAnalysis.bullets],
    ['依申请公开分析', report.sections.requestAnalysis.summary, report.sections.requestAnalysis.bullets],
    ['复议诉讼风险分析', report.sections.legalRiskAnalysis.summary, report.sections.legalRiskAnalysis.bullets],
  ] as const;

  sections.forEach(([title, summary, bullets]) => {
    lines.push('');
    lines.push(`## ${title}`);
    lines.push('');
    lines.push(summary);
    lines.push('');
    bullets.forEach((item) => lines.push(`- ${item}`));
  });

  lines.push('');
  lines.push('## 四、主要问题');
  lines.push('');
  report.problems.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${item.title}`);
    lines.push(`- 优先级：${item.priority}`);
    lines.push(`- 问题描述：${item.description}`);
    lines.push(`- 原因判断：${item.cause}`);
    lines.push('');
  });

  lines.push('## 五、整改建议与督办任务');
  lines.push('');
  report.actionPlan.forEach((item, index) => {
    lines.push(`### ${index + 1}. ${item.title}`);
    lines.push(`- 牵头单位：${item.owner}`);
    lines.push(`- 时间安排：${item.timeline}`);
    lines.push(`- 交付物：${item.deliverable}`);
    lines.push(`- 目标：${item.target}`);
    lines.push('');
  });

  lines.push('## 六、数据说明');
  lines.push('');
  report.dataNotes.forEach((item) => lines.push(`- ${item}`));
  lines.push('');

  return lines.join('\n');
};

const saveReport = async (regionId: number, orgName: string, year: number, report: EnhancedAIReportResponse) => {
  await pool.query(
    `
    INSERT INTO ai_decision_reports (region_id, org_name, year, content_json, model_used, updated_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (region_id, year)
    DO UPDATE SET
      org_name = EXCLUDED.org_name,
      content_json = EXCLUDED.content_json,
      model_used = EXCLUDED.model_used,
      updated_at = NOW()
    `,
    [regionId, orgName, year, JSON.stringify(report), 'template/annual-report-integrated-v1']
  );
};

const main = async () => {
  const args = parseArgs();
  const entity = await loadEntity(args.regionId, args.orgId, args.year, args.orgName);
  const annualReportSummary = await loadAnnualReportSummary(args.regionId, args.year, entity.name);
  const report = buildDetailedTemplateReport(entity, args.year, annualReportSummary);
  const markdown = buildMarkdown(report, entity, args.year, annualReportSummary);

  await fs.mkdir(path.dirname(args.output), { recursive: true });
  await fs.writeFile(args.output, markdown, 'utf8');

  if (args.save) {
    await saveReport(args.regionId, entity.name, args.year, report);
  }

  console.log(
    JSON.stringify(
      {
        orgId: args.orgId,
        orgName: entity.name,
        regionId: args.regionId,
        year: args.year,
        annualReportIntegrated: Boolean(annualReportSummary?.available),
        output: args.output,
        savedToDb: args.save,
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error('[generate-gov-insight-report] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
