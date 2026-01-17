
import { EntityProfile, AnnualData } from '../types';

const calcTrend = (current: number, prev: number) => {
  if (prev === 0) return 0;
  return (current - prev) / prev;
};

const fmtPct = (val: number) => (val * 100).toFixed(1) + '%';
const fmtInt = (val: number) => val.toLocaleString();

/**
 * 辅助：生成增长/下降的描述词
 */
const getTrendDesc = (rate: number) => {
  if (rate > 0.3) return "大幅激增";
  if (rate > 0.1) return "显著增长";
  if (rate > 0) return "稳步上升";
  if (rate === 0) return "持平";
  if (rate > -0.1) return "小幅回落";
  return "明显收缩";
};

/**
 * 1. 总体概述 (Executive Summary) - 深度研判版
 */
export const generateExecutiveSummary = (entity: EntityProfile, year: number): string => {
  const current = entity.data.find(d => d.year === year);
  const prev = entity.data.find(d => d.year === year - 1);
  if (!current || !prev) return "数据不足。";

  // 计算核心同比
  const appGrowth = calcTrend(current.applications.newReceived, prev.applications.newReceived);
  const disputeGrowth = calcTrend(
    current.disputes.reconsideration.total + current.disputes.litigation.total,
    prev.disputes.reconsideration.total + prev.disputes.litigation.total
  );
  
  // 纠错率
  const correctionRate = (current.disputes.reconsideration.corrected + current.disputes.litigation.corrected) / 
                         (current.disputes.reconsideration.total + current.disputes.litigation.total || 1);
  const prevCorrectionRate = (prev.disputes.reconsideration.corrected + prev.disputes.litigation.corrected) / 
                             (prev.disputes.reconsideration.total + prev.disputes.litigation.total || 1);
  const riskDelta = correctionRate - prevCorrectionRate;

  // 段落1：基本面与工作量
  let p1 = `**【总体态势】** ${year}年度，${entity.name}深入贯彻法治政府建设要求，统筹推进政务公开与服务优化。全年依申请公开工作呈现“**${getTrendDesc(appGrowth)}**”态势，共受理新申请 ${fmtInt(current.applications.newReceived)} 件，同比${appGrowth >= 0 ? '增长' : '下降'} ${fmtPct(Math.abs(appGrowth))}。`;
  
  if (appGrowth > 0.2) {
    p1 += ` 面对申请量激增的严峻挑战，我单位通过优化内部协办流程，确保了受理渠道的畅通有序，未发生因系统拥堵导致的登记遗漏。`;
  } else {
    p1 += ` 申请总量保持在合理区间，工作重心逐步由“被动应答”向“主动治理”转移。`;
  }

  // 段落2：质量与风险（对比去年）
  let p2 = `\n\n**【履职质效】** 在案件办理质量方面，全年实质性公开率（予以/部分公开）为 ${fmtPct((current.applications.outcomes.public + current.applications.outcomes.partial)/current.applications.totalHandled)}。`;
  p2 += ` 值得关注的是，行政争议风险防控取得${riskDelta < 0 ? '积极成效' : '一定波动'}。全年复议诉讼纠错率为 ${fmtPct(correctionRate)}，`;
  
  if (riskDelta < -0.05) {
    p2 += `较上年度下降 ${(Math.abs(riskDelta)*100).toFixed(1)} 个百分点，实现了“案增诉减”的良性循环。`;
  } else if (riskDelta > 0.05) {
    p2 += `较上年度上升 ${(riskDelta*100).toFixed(1)} 个百分点，反映出在疑难复杂案件（如涉拆迁、涉第三方权益）的法律适用上仍存在薄弱环节。`;
  } else {
    p2 += `与上年度基本持平，法治化水平保持稳定。`;
  }

  return p1 + p2;
};

/**
 * 2. 现状深度点评 (Status Critique) - 专家诊断版
 */
export const generateStatusCritique = (entity: EntityProfile, year: number) => {
  const current = entity.data.find(d => d.year === year);
  const prev = entity.data.find(d => d.year === year - 1);
  if (!current || !prev) return { strengths: [], weaknesses: [] };

  const strengths = [];
  const weaknesses = [];

  // --- 亮点分析 ---

  // 1. 结构优化
  const naturalRate = current.applications.sources.natural / current.applications.newReceived;
  if (naturalRate > 0.5) {
    strengths.push(`<strong>便民服务触达率高：</strong> 自然人申请占比达 ${fmtPct(naturalRate)}，表明政务公开渠道已深度渗透至基层群众，有效保障了公民知情权。`);
  }

  // 2. 效率提升 (结转率对比)
  const prevCarriedRate = prev.applications.carriedForward / prev.applications.totalHandled;
  const currCarriedRate = current.applications.carriedForward / current.applications.totalHandled;
  if (currCarriedRate < prevCarriedRate && currCarriedRate < 0.05) {
    strengths.push(`<strong>办理时效显著增强：</strong> 在受理量变化的情况下，结转下年案件占比由 ${fmtPct(prevCarriedRate)} 压降至 ${fmtPct(currCarriedRate)}，积压件清理成效明显。`);
  }

  // 3. 监管平衡 (行政行为)
  const ratio = current.adminActions.licensing / (current.adminActions.punishment || 1);
  if (ratio > 5) {
    strengths.push(`<strong>营商环境持续优化：</strong> 行政许可与处罚比维持在 ${ratio.toFixed(1)}:1 的高位，体现了“包容审慎”的监管导向，市场准入便利度较高。`);
  }

  // --- 痛点/短板分析 ---

  // 1. 滥用风险
  const unableRate = current.applications.outcomes.unable / current.applications.totalHandled;
  const prevUnableRate = prev.applications.outcomes.unable / prev.applications.totalHandled;
  if (unableRate > 0.35) {
    weaknesses.push(`<strong>“无法提供”占比较高且呈上升趋势：</strong> 本年度该类答复占比达 ${fmtPct(unableRate)}（同比上升 ${(unableRate - prevUnableRate > 0 ? '+' : '')}${fmtPct(unableRate - prevUnableRate)}）。需警惕是否因档案管理缺失导致“应公开而无法公开”。`);
  }

  // 2. 败诉风险
  const totalDisputes = current.disputes.reconsideration.total + current.disputes.litigation.total;
  const correctionRate = (current.disputes.reconsideration.corrected + current.disputes.litigation.corrected) / (totalDisputes || 1);
  if (correctionRate > 0.15) {
    weaknesses.push(`<strong>行政争议败诉率触及红线：</strong> 纠错率达 ${fmtPct(correctionRate)}，超出全省平均水平。主要集中在“事实不清”和“程序违法”两大类，反映出经办人员法治素养亟待提升。`);
  }

  // 3. 制度老化
  const activeDocs = current.normativeDocuments.active;
  const abolishedDocs = current.normativeDocuments.abolished;
  if (activeDocs > 100 && abolishedDocs < 2) {
    weaknesses.push(`<strong>存量文件清理滞后：</strong> 现行有效规范性文件基数大（${activeDocs}件），但本年度仅废止 ${abolishedDocs} 件，存在“僵尸文件”滞留风险。`);
  }

  if (strengths.length === 0) strengths.push("各项指标运行平稳，基础工作扎实，未见显著波动。");
  if (weaknesses.length === 0) weaknesses.push("核心指标处于健康区间，建议继续保持高标准规范化管理。");

  return { strengths, weaknesses };
};

/**
 * 3. 下一步工作建议 (Future Work Plan) - 针对性策略
 */
export const generateFutureWorkPlan = (entity: EntityProfile, year: number) => {
  const current = entity.data.find(d => d.year === year);
  if (!current) return [];

  const plans = [];

  // 1. 针对“无法提供”高发
  const unableRate = current.applications.outcomes.unable / current.applications.totalHandled;
  if (unableRate > 0.3) {
    plans.push({
      title: "实施“档案数字化”专项攻坚",
      content: `针对本年度高达 ${fmtPct(unableRate)} 的“无法提供”答复，建议启动历史档案溯源工程。重点对 2015 年之前的纸质案卷进行数字化扫描和元数据挂接，建立“一键检索”知识库，降低因档案缺失引发的履职风险。`
    });
  }

  // 2. 针对“行政争议”
  const correctionRate = (current.disputes.reconsideration.corrected + current.disputes.litigation.corrected) / 
                         (current.disputes.reconsideration.total + current.disputes.litigation.total || 1);
  if (correctionRate > 0.1) {
    plans.push({
      title: "建立败诉案件“全链条”复盘机制",
      content: "建议由法规处牵头，每季度召开一次行政争议复盘会。对本年度所有被纠错/败诉案件进行“逐案解剖”，区分是“依申请答复不规范”还是“原行政行为违法”，并将其纳入年度绩效考核负面清单。"
    });
  }

  // 3. 针对“主动公开”
  plans.push({
    title: "深化重点领域主动公开",
    content: "变“被动公开”为“主动服务”。梳理本年度依申请公开中高频出现的“学区划分”、“征地补偿”、“行政处罚标准”等事项，编制 2025 年度主动公开目录，在门户网站设立专题专栏进行集中发布。"
  });

  // 4. 能力建设
  plans.push({
    title: "提升政务公开队伍专业化水平",
    content: "组织开展全系统法治培训，重点学习新修订的《行政复议法》及最高法关于政府信息公开的最新司法解释。引入公职律师参与疑难复杂依申请公开案件的会商研判。"
  });

  return plans;
};
