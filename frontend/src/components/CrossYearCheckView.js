
import React, { useState, useEffect } from 'react';
import { apiClient } from '../apiClient';
import { highlightNumber } from './DiffUtils';
import { BarChart3, MapPin, Search, FileText, Table2, CheckCircle2, AlertCircle } from 'lucide-react';
import './CrossYearCheckView.css';

// 复制自 ConsistencyCheckView.js 的路径解析逻辑
const parseLocationFromPath = (path) => {
    if (!path) return null;

    const pathMappings = {
        // 表三相关路径
        'tableData.total.results.totalProcessed': '表三 → 办理结果总计 → 总数',
        'tableData.total.results.disclosure.activeDisclosure': '表三 → 办理结果总计 → 予以公开 → 主动公开',
        'tableData.total.results.disclosure.dependentApplication': '表三 → 办理结果总计 → 予以公开 → 依申请公开',
        'tableData.total.results.partialDisclosure.applyForInfo': '表三 → 办理结果总计 → 部分公开 → 申请信息',
        'tableData.total.results.notDisclosed': '表三 → 办理结果总计 → 不予公开',
        'tableData.total.results.notAccepted.notOwnInfo': '表三 → 办理结果总计 → 不予处理 → 非本机关信息',
        'tableData.total.results.notAccepted.notExist': '表三 → 办理结果总计 → 不予处理 → 信息不存在',
        'tableData.total.results.other': '表三 → 办理结果总计 → 其他处理',
        'tableData.total.results.transferred': '表三 → 办理结果总计 → 已移送',
        'tableData.total.channelStats': '表三 → 渠道统计',
        'tableData.currentYear': '表三 → 本年新收申请',
        'tableData.previousYear': '表三 → 上年结转申请',

        // 表四相关路径
        'reviewLitigationData.review.total': '表四 → 行政复议 → 总计',
        'reviewLitigationData.review.maintain': '表四 → 行政复议 → 维持',
        'reviewLitigationData.review.correct': '表四 → 行政复议 → 纠正',
        'reviewLitigationData.review.other': '表四 → 行政复议 → 其他',
        'reviewLitigationData.review.unfinished': '表四 → 行政复议 → 尚未审结',
        'reviewLitigationData.litigationDirect.total': '表四 → 未经复议直接起诉 → 总计',
        'reviewLitigationData.litigationDirect.maintain': '表四 → 未经复议直接起诉 → 维持',
        'reviewLitigationData.litigationDirect.correct': '表四 → 未经复议直接起诉 → 纠正',
        'reviewLitigationData.litigationPostReview.total': '表四 → 复议后起诉 → 总计',

        // 表二相关路径
        'activeDisclosureData.regulations': '表二 → 规章',
        'activeDisclosureData.normativeDocuments': '表二 → 规范性文件',
        'activeDisclosureData.licensing': '表二 → 行政许可',
        'activeDisclosureData.punishment': '表二 → 行政处罚',
        'activeDisclosureData.coercion': '表二 → 行政强制',

        // 正文相关
        'text.content': '正文内容',
    };

    if (pathMappings[path]) {
        return pathMappings[path];
    }

    for (const [key, value] of Object.entries(pathMappings)) {
        if (path.startsWith(key)) {
            const suffix = path.replace(key, '').replace(/^\./, '');
            return suffix ? `${value} → ${suffix}` : value;
        }
    }

    // Fallback
    return path;
};

// 提取详细位置信息
const getLocationInfo = (item) => {
    if (!item.evidence) return null;

    const result = {
        textSource: null,
        tableSource: null,
        context: null,
        leftValue: item.left_value,
        rightValue: item.right_value,
    };

    const values = item.evidence.values || {};
    const paths = item.evidence.paths || [];

    paths.forEach(path => {
        if (path.includes('tableData') || path.includes('reviewLitigationData')) {
            const desc = parseLocationFromPath(path);
            if (desc && !result.tableSource) {
                result.tableSource = desc;
            }
        }
    });

    if (values.sectionTitle) {
        const sectionNum = values.sectionIndex ? `第${values.sectionIndex}部分` : '';
        result.textSource = `${sectionNum}「${values.sectionTitle}」`;
    } else if (values.matchedText || paths.some(p => p.includes('content'))) {
        result.textSource = '正文相关内容';
    }

    if (values.context) {
        result.context = highlightNumber(values.context, values.textValue);
    } else if (values.matchedText) {
        result.context = highlightNumber(values.matchedText, values.textValue);
    }

    return result;
};

const CrossYearCheckView = ({ leftReportId, rightReportId, leftContent, rightContent, yearA, yearB }) => {
    const [leftIntraYearStatus, setLeftIntraYearStatus] = useState({ loading: true, issues: [], error: null });
    const [intraYearStatus, setIntraYearStatus] = useState({ loading: true, issues: [], error: null });
    const [crossYearStatus, setCrossYearStatus] = useState({ loading: true, diff: null, values: {} });
    const [table2Status, setTable2Status] = useState({ loading: true, checks: [] });

    // 1. 获取新报告的内部勾稽状态
    useEffect(() => {
        if (!rightReportId) return;

        const fetchChecks = async () => {
            try {
                const response = await apiClient.get(`/reports/${rightReportId}/checks`);
                const data = response.data?.data || response.data;

                let issues = [];
                if (data && data.groups) {
                    data.groups.forEach(group => {
                        if (group.items) {
                            const groupIssues = group.items.filter(item =>
                                (item.auto_status === 'FAIL' || item.auto_status === 'UNCERTAIN') &&
                                item.human_status !== 'dismissed'
                            );
                            issues = [...issues, ...groupIssues];
                        }
                    });
                }

                setIntraYearStatus({ loading: false, issues, error: null });
            } catch (err) {
                console.error('Failed to fetch checks', err);
                setIntraYearStatus({ loading: false, issues: [], error: '无法获取勾稽结果' });
            }
        };

        fetchChecks();
    }, [rightReportId]);

    // 1.5 获取旧报告的内部勾稽状态
    useEffect(() => {
        if (!leftReportId) return;

        const fetchLeftChecks = async () => {
            try {
                const response = await apiClient.get(`/reports/${leftReportId}/checks`);
                const data = response.data?.data || response.data;

                let issues = [];
                if (data && data.groups) {
                    data.groups.forEach(group => {
                        if (group.items) {
                            const groupIssues = group.items.filter(item =>
                                (item.auto_status === 'FAIL' || item.auto_status === 'UNCERTAIN') &&
                                item.human_status !== 'dismissed'
                            );
                            issues = [...issues, ...groupIssues];
                        }
                    });
                }

                setLeftIntraYearStatus({ loading: false, issues, error: null });
            } catch (err) {
                console.error('Failed to fetch left report checks', err);
                setLeftIntraYearStatus({ loading: false, issues: [], error: '无法获取勾稽结果' });
            }
        };

        fetchLeftChecks();
    }, [leftReportId]);

    // 2. 跨年数据计算
    useEffect(() => {
        const findTable3 = (content) => {
            if (!content || !content.sections) return null;
            const sec = content.sections.find(s => s.type === 'table_3');
            return sec ? sec.tableData : null;
        };
        const oldTable3 = findTable3(leftContent);
        const newTable3 = findTable3(rightContent);

        const oldVal = oldTable3?.total?.results?.carriedForward ?? null;
        const newVal = newTable3?.total?.carriedOver ?? null;

        let diff = false;
        if (typeof oldVal === 'number' && typeof newVal === 'number') {
            diff = oldVal !== newVal;
        } else if (oldVal === null && newVal === null) {
            diff = false;
        } else {
            diff = true;
        }
        setCrossYearStatus({ loading: false, diff, values: { oldVal, newVal } });
    }, [leftContent, rightContent]);

    // 3. 表二跨年数据计算（规章/行政规范性文件）
    useEffect(() => {
        const findTable2 = (content) => {
            if (!content || !content.sections) return null;
            const sec = content.sections.find(s => s.type === 'table_2');
            return sec ? sec.activeDisclosureData : null;
        };
        const oldT2 = findTable2(leftContent);
        const newT2 = findTable2(rightContent);

        const checks = [];

        // Check 规章
        if (oldT2?.regulations && newT2?.regulations) {
            const oldValid = oldT2.regulations.valid;
            const newMade = newT2.regulations.made;
            const newRepealed = newT2.regulations.repealed;
            const newValid = newT2.regulations.valid;

            if (typeof oldValid === 'number' && typeof newMade === 'number' &&
                typeof newRepealed === 'number' && typeof newValid === 'number') {
                const expected = oldValid + newMade - newRepealed;
                checks.push({
                    label: '规章',
                    formula: `${oldValid} + ${newMade} - ${newRepealed}`,
                    expected,
                    actual: newValid,
                    diff: expected !== newValid
                });
            }
        }

        // Check 行政规范性文件
        if (oldT2?.normativeDocuments && newT2?.normativeDocuments) {
            const oldValid = oldT2.normativeDocuments.valid;
            const newMade = newT2.normativeDocuments.made;
            const newRepealed = newT2.normativeDocuments.repealed;
            const newValid = newT2.normativeDocuments.valid;

            if (typeof oldValid === 'number' && typeof newMade === 'number' &&
                typeof newRepealed === 'number' && typeof newValid === 'number') {
                const expected = oldValid + newMade - newRepealed;
                checks.push({
                    label: '行政规范性文件',
                    formula: `${oldValid} + ${newMade} - ${newRepealed}`,
                    expected,
                    actual: newValid,
                    diff: expected !== newValid
                });
            }
        }

        setTable2Status({ loading: false, checks });
    }, [leftContent, rightContent]);

    const { loading: leftIntraLoading, issues: leftIntraIssues } = leftIntraYearStatus;
    const { loading: intraLoading, issues: intraIssues } = intraYearStatus;
    const { values: crossValues, diff: crossDiff } = crossYearStatus;
    const { checks: table2Checks } = table2Status;
    const table2HasIssues = table2Checks.some(c => c.diff);

    return (
        <div className="cross-check-card break-inside-avoid">
            <div className="cross-check-header">
                <h3><BarChart3 size={20} className="text-blue-400" /> 数据勾稽问题清单</h3>
            </div>

            {/* 1. 旧年度数据勾稽 */}
            <div className="check-section">
                <div className="section-title">
                    <span>1. {yearA} 年度内部勾稽关系检查</span>
                    {leftIntraLoading ? (
                        <span className="text-gray-400 text-sm">检查中...</span>
                    ) : leftIntraIssues.length === 0 ? (
                        <span className="status-valid"><CheckCircle2 size={15} /> 无问题</span>
                    ) : (
                        <span className="status-issue"><AlertCircle size={15} /> 发现 {leftIntraIssues.length} 个问题</span>
                    )}
                </div>

                {!leftIntraLoading && leftIntraIssues.length > 0 && (
                    <div className="issues-wrapper">
                        {leftIntraIssues.map(item => {
                            return (
                                <div key={item.id} className="issue-card">
                                    <div className="issue-header">
                                        <span className="issue-title">{item.description || item.rule_name}</span>
                                        <div className="issue-expr-row" style={{ display: 'none' }}>{item.expr}</div>
                                        <div className="issue-values">
                                            左值: {item.left_value} | 右值: {item.right_value} | 差值: <span className="font-bold">{item.delta}</span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 2. 新年度数据勾稽 */}
            <div className="check-section">
                <div className="section-title">
                    <span>2. {yearB} 年度内部勾稽关系检查</span>
                    {intraLoading ? (
                        <span className="text-gray-400 text-sm">检查中...</span>
                    ) : intraIssues.length === 0 ? (
                        <span className="status-valid"><CheckCircle2 size={15} /> 无问题</span>
                    ) : (
                        <span className="status-issue"><AlertCircle size={15} /> 发现 {intraIssues.length} 个问题</span>
                    )}
                </div>

                {!intraLoading && intraIssues.length > 0 && (
                    <div className="issues-wrapper">
                        {intraIssues.map(item => {
                            const details = getLocationInfo(item);
                            return (
                                <div key={item.id} className="issue-card">
                                    {/* 红色头部 */}
                                    <div className="issue-header">
                                        <span className="issue-title">{item.description || item.rule_name}</span>
                                        <div className="issue-expr-row" style={{ display: 'none' }}>{item.expr}</div>
                                        <div className="issue-values">
                                            左值: {item.left_value} | 右值: {item.right_value} | 差值: <span className="font-bold">{item.delta}</span>
                                        </div>
                                    </div>

                                    {/* 详细内容区 */}
                                    {details && (
                                        <div className="issue-detail">
                                            {/* 数据定位 */}
                                            <div className="detail-section">
                                                <div className="ds-header"><MapPin size={14} className="inline-block" /> 数据定位</div>
                                                <div className="ds-body location-grid">
                                                    <div className="loc-box text-side">
                                                        <div className="loc-title"><FileText size={14} className="inline-block" /> 正文来源</div>
                                                        <div className="loc-content">{details.textSource || '未定位'}</div>
                                                        <div className="loc-val">
                                                            <span className="val-tag">{item.left_value}</span>
                                                        </div>
                                                    </div>
                                                    <div className="arrow-divider">↔</div>
                                                    <div className="loc-box table-side">
                                                        <div className="loc-title"><Table2 size={14} className="inline-block" /> 表格来源</div>
                                                        <div className="loc-content">{details.tableSource || '未定位'}</div>
                                                        <div className="loc-val">
                                                            <span className="val-tag">{item.right_value}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 匹配文本 */}
                                            {(details.context) && (
                                                <div className="detail-section">
                                                    <div className="ds-header"><Search size={14} className="inline-block" /> 匹配文本</div>
                                                    <div className="ds-body">
                                                        <div className="context-content">
                                                            {/* SECURITY FIX: Render as plain text to prevent XSS */}
                                                            {details.context.replace(/<[^>]*>/g, '')}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 3. 跨年度结转政府信息公开申请数量 */}
            <div className="check-section">
                <div className="section-title">
                    <span>3. 跨年度结转政府信息公开申请数量</span>
                    {!crossDiff ? (
                        <span className="status-valid"><CheckCircle2 size={15} /> 数据一致</span>
                    ) : (
                        <span className="status-issue"><AlertCircle size={15} /> 数据不一致</span>
                    )}
                </div>

                <div className="cross-year-detail">
                    <div className="text-sm text-gray-600 text-center mb-2">
                        比较项目：[{yearA}年] 结转下年度继续办理 &nbsp; VS &nbsp; [{yearB}年] 上年结转政府信息公开申请数量
                    </div>
                    <div className="value-comparison">
                        <div className="val-box">
                            <span className="val-label">{yearA}年（旧）</span>
                            <div className="val-num">{crossValues.oldVal ?? '-'}</div>
                        </div>

                        <div className={`comparison-icon ${crossDiff ? 'error' : 'success'}`}>
                            {crossDiff ? '≠' : '='}
                        </div>

                        <div className="val-box">
                            <span className="val-label">{yearB}年（新）</span>
                            <div className="val-num">{crossValues.newVal ?? '-'}</div>
                        </div>
                    </div>
                    {crossDiff && (
                        <div className="diff-msg error">
                            差异值: {(crossValues.newVal || 0) - (crossValues.oldVal || 0)}
                        </div>
                    )}
                </div>
            </div>

            {/* 4. 跨年度规章和行政规范性文件数量 */}
            {table2Checks.length > 0 && (
                <div className="check-section">
                    <div className="section-title">
                        <span>4. 跨年度规章和行政规范性文件数量</span>
                        {!table2HasIssues ? (
                            <span className="status-valid"><CheckCircle2 size={15} /> 数据一致</span>
                        ) : (
                            <span className="status-issue"><AlertCircle size={15} /> 数据不一致</span>
                        )}
                    </div>
                    <div className="text-sm text-gray-600 text-center mb-2">
                        公式：[{yearB}年] 现行有效件数 = [{yearA}年] 现行有效件数 + [{yearB}年] 本年制发件数 - [{yearB}年] 本年废止件数
                    </div>
                    {table2Checks.map((check, idx) => (
                        <div key={idx} className="cross-year-detail mb-4">
                            <div className="text-sm font-bold text-center mb-2">{check.label}</div>
                            <div className="value-comparison">
                                <div className="val-box">
                                    <span className="val-label">计算值</span>
                                    <div className="val-num">{check.expected}</div>
                                    <div className="text-xs text-gray-500">{check.formula}</div>
                                </div>

                                <div className={`comparison-icon ${check.diff ? 'error' : 'success'}`}>
                                    {check.diff ? '≠' : '='}
                                </div>

                                <div className="val-box">
                                    <span className="val-label">实际值</span>
                                    <div className="val-num">{check.actual}</div>
                                    <div className="text-xs text-gray-500">{yearB}年 现行有效件数</div>
                                </div>
                            </div>
                            {check.diff && (
                                <div className="diff-msg error">
                                    差异值: {check.actual - check.expected}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

        </div>
    );
};

export default CrossYearCheckView;
