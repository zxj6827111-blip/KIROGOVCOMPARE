/**
 * ComparisonPrintView.js
 * Print view for Puppeteer PDF export.
 * Requires auth; supports service_token in query string.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../ComparisonDetailView.css';

import './ComparisonPrintView.css';
import { Table2View, Table3View, Table4View, SimpleDiffTable } from '../TableViews';
import DiffText from '../DiffText';
import CrossYearCheckView from '../CrossYearCheckView';

import { normalizeTablePath } from '../../utils/tableRowColMapping';
import { translateFailureReason, getRawErrorDetail } from '../../utils/errorTranslator';

// ---- Tokenization & Similarity Algorithm (Same as ComparisonDetailView) ----
const tokenizeText = (text) => {
    if (!text) return [];
    const regex = /(\d+)|([a-zA-Z]+)|([\u4e00-\u9fff]+)|([\s\S])/g;
    const tokens = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
        tokens.push(match[0]);
    }
    return tokens;
};

const isPunctuation = (str) => {
    return /[-,.;:?!'"()[\]\s，。；：？！、“”‘’（）【】《》]/.test(str);
};

function calculateTextSimilarity(text1, text2) {
    if (!text1 && !text2) return 100;
    if (!text1 || !text2) return 0;

    const t1 = tokenizeText(text1).filter(t => !isPunctuation(t));
    const t2 = tokenizeText(text2).filter(t => !isPunctuation(t));

    if (t1.length === 0 && t2.length === 0) return 100;
    if (t1.length === 0 || t2.length === 0) return 0;

    const set2 = new Set(t2);
    let intersection = 0;
    t1.forEach(t => { if (set2.has(t)) intersection++; });
    const union = t1.length + t2.length;
    return Math.round((2 * intersection / union) * 100);
}

const readPath = (obj, path) => {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
};

const firstDefined = (...values) => values.find(value => value !== undefined && value !== null);

const isTableHighlightPath = (path) =>
    path &&
    (path.startsWith('tableData.') ||
        path.startsWith('activeDisclosureData.') ||
        path.startsWith('reviewLitigationData.'));

const buildIssueHighlightCells = (issues = []) => {
    const cells = [];
    const seen = new Set();

    const addPath = (rawPath, type) => {
        const path = normalizeTablePath(rawPath);
        if (!isTableHighlightPath(path)) return;
        const key = `${type}:${path}`;
        if (seen.has(key)) return;
        seen.add(key);
        cells.push({ path, type, scope: 'focus' });
    };

    issues
        .filter((item) =>
            ['FAIL', 'UNCERTAIN'].includes(item?.auto_status || item?.autoStatus) &&
            item?.human_status !== 'dismissed'
        )
        .forEach((item) => {
            const evidence = item.evidence || {};
            const leftPaths = evidence.leftPaths || [];
            const rightPaths = evidence.rightPaths || [];
            const fallbackPaths = evidence.paths || [];

            leftPaths.forEach((path) => addPath(path, 'left'));
            rightPaths.forEach((path) => addPath(path, 'right'));

            if (leftPaths.length === 0 && rightPaths.length === 0) {
                fallbackPaths.forEach((path) => addPath(path, 'diff'));
            }
        });

    return cells;
};

// Helper for Table 3 Rows
const getTable3Rows = (data) => {
    if (!data || !data.total || !data.total.results) return [];
    const t = data.total;
    const value = (...paths) => firstDefined(...paths.map(path => readPath(t, path)));

    return [
        { label: '本年新收政府信息公开申请数量', val: t.newReceived },
        { label: '上年结转政府信息公开申请数量', val: t.carriedOver },
        { label: '予以公开', val: value('results.granted') },
        { label: '部分公开', val: value('results.partialGrant') },
        { label: '不予公开-属于国家秘密', val: value('results.denied.stateSecret') },
        { label: '不予公开-其他法律行政法规禁止公开', val: value('results.denied.lawForbidden') },
        { label: '不予公开-危及"三安全一稳定"', val: value('results.denied.safetyStability') },
        { label: '不予公开-保护第三方合法权益', val: value('results.denied.thirdPartyRights') },
        { label: '不予公开-属于工作秘密', val: value('results.denied.workSecret') },
        { label: '不予公开-属于内部事务信息', val: value('results.denied.internalAffairs') },
        { label: '不予公开-属于内部管理信息', val: value('results.denied.internalManagement') },
        { label: '不予公开-属于过程性信息', val: value('results.denied.processInfo') },
        { label: '不予公开-属于行政执法案卷', val: value('results.denied.enforcementDossier', 'results.denied.enforcementCase') },
        { label: '不予公开-属于行政查询事项', val: value('results.denied.queryMatter', 'results.denied.adminQuery') },
        { label: '无法提供-本机关不掌握相关政府信息', val: value('results.unableToProvide.noInfo', 'results.unableToProvide.notGovInfo') },
        { label: '无法提供-没有现成信息需要另行制作', val: value('results.unableToProvide.needCreation', 'results.unableToProvide.notExist') },
        { label: '无法提供-补正后申请内容仍不明确', val: value('results.unableToProvide.unclear', 'results.unableToProvide.notResponsible') },
        { label: '不予处理-信访举报投诉类申请', val: value('results.notProcessed.complaint', 'results.notProcessed.petition') },
        { label: '不予处理-重复申请', val: value('results.notProcessed.repeat', 'results.notProcessed.duplicateRequest') },
        { label: '不予处理-要求提供公开出版物', val: value('results.notProcessed.publication', 'results.notProcessed.requirePublication') },
        { label: '不予处理-无正当理由大量反复申请', val: value('results.notProcessed.massiveRequests', 'results.notProcessed.unreasonableRequest') },
        { label: '不予处理-要求行政机关确认或重新出具', val: value('results.notProcessed.confirmInfo', 'results.notProcessed.requireConfirm') },
        { label: '不予处理-无法联系到申请人', val: value('results.notProcessed.noContact') },
        { label: '其他处理-申请人逾期不补正', val: value('results.other.overdueCorrection') },
        { label: '其他处理-申请人逾期未按收费通知缴费', val: value('results.other.overdueFee') },

        { label: '其他处理-其他', val: value('results.other.otherReasons', 'results.other') },

        { label: '总计', val: value('results.totalProcessed') },

        { label: '结转下年度继续办理', val: value('results.carriedForward') },
    ].filter(row => row.val !== undefined && row.val !== null);
};

// Helper for Table 4 Rows
const getTable4Rows = (data) => {
    if (!data) return [];

    const value = (...paths) => firstDefined(...paths.map(path => readPath(data, path)));

    return [
        { label: '行政复议-维持', val: value('review.maintain') },
        { label: '行政复议-撤销/变更/确认违法', val: value('review.correct', 'review.corrected') },
        { label: '行政复议-其他', val: value('review.other') },
        { label: '行政复议-尚未审结', val: value('review.unfinished') },
        { label: '行政复议-总计', val: value('review.total') },
        { label: '行政诉讼(未经复议)-维持', val: value('litigationDirect.maintain') },
        { label: '行政诉讼(未经复议)-撤销/变更/确认违法', val: value('litigationDirect.correct', 'litigationDirect.corrected') },
        { label: '行政诉讼(未经复议)-其他', val: value('litigationDirect.other') },
        { label: '行政诉讼(未经复议)-尚未审结', val: value('litigationDirect.unfinished') },

        { label: '行政诉讼(未经复议)-总计', val: value('litigationDirect.total') },

        { label: '行政诉讼(经复议)-维持', val: value('litigationPostReview.maintain', 'litigationAfterReview.maintain') },

        { label: '行政诉讼(经复议)-撤销/变更/确认违法', val: value('litigationPostReview.correct', 'litigationPostReview.corrected', 'litigationAfterReview.correct', 'litigationAfterReview.corrected') },

        { label: '行政诉讼(经复议)-其他', val: value('litigationPostReview.other', 'litigationAfterReview.other') },

        { label: '行政诉讼(经复议)-尚未审结', val: value('litigationPostReview.unfinished', 'litigationAfterReview.unfinished') },

        { label: '行政诉讼(经复议)-总计', val: value('litigationPostReview.total', 'litigationAfterReview.total') },
    ].filter(row => row.val !== undefined && row.val !== null);
};

// Helper for Table 2 Rows
const getTable2Rows = (data) => {
    if (!data) return [];
    return [
        { label: '规章-制发', val: firstDefined(readPath(data, 'regulations.made')) },
        { label: '规章-废止', val: firstDefined(readPath(data, 'regulations.repealed')) },
        { label: '规章-现行有效', val: firstDefined(readPath(data, 'regulations.valid')) },
        { label: '规范性文件-制发', val: firstDefined(readPath(data, 'normativeDocuments.made')) },
        { label: '规范性文件-废止', val: firstDefined(readPath(data, 'normativeDocuments.repealed')) },
        { label: '规范性文件-现行有效', val: firstDefined(readPath(data, 'normativeDocuments.valid')) },
        { label: '行政许可-处理', val: firstDefined(readPath(data, 'licensing.processed'), readPath(data, 'adminPermit.processed')) },
        { label: '行政处罚', val: firstDefined(readPath(data, 'punishment.processed'), readPath(data, 'adminPunishment')) },
        { label: '行政强制', val: firstDefined(readPath(data, 'coercion.processed'), readPath(data, 'adminForce')) },
        { label: '行政事业性收费(万元)', val: firstDefined(readPath(data, 'fees.amount'), readPath(data, 'adminFee')) },
    ].filter(row => row.val !== undefined && row.val !== null);
};

function ComparisonPrintView({ comparisonId }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [checksReady, setChecksReady] = useState(false);

    const [authToken, setAuthToken] = useState('');

    const [leftIssueHighlightCells, setLeftIssueHighlightCells] = useState([]);

    const hasTriggeredPrint = useRef(false);

    // Read highlight settings from URL search params
    // Default: show identical parts highlight (yellow), hide diff highlight (red)
    const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
    const highlightIdentical = searchParams.get('highlightIdentical') !== 'false'; // default true
    const highlightDiff = searchParams.get('highlightDiff') === 'true'; // default false

    const autoPrint = searchParams.get('autoPrint') === 'true';

    const handleLeftIssuesChange = useCallback((issues) => {
        setLeftIssueHighlightCells(buildIssueHighlightCells(issues));
    }, []);

    const buildSummaryItems = useCallback((sections) => {
        const items = [];

        sections.forEach((section) => {
            const title = section.title || '';
            if (title === '标题' || title.includes('年度报告')) return;

            if (section.type === 'text' && section.left && section.right) {
                const sim = calculateTextSimilarity(section.left.content || '', section.right.content || '');
                if (sim < 60) {
                    items.push(`${title.split('、')[1] || title}章节的文字变化较大，重复率约 ${Math.round(sim)}% （低于 60% 阈值）`);
                }
                return;
            }

            if (section.type === 'table_2') {
                const identical = JSON.stringify(section.left?.activeDisclosureData || null) === JSON.stringify(section.right?.activeDisclosureData || null);
                if (!identical) items.push(`${title.split('、')[1] || title}的表格重复率约 0%，存在明显数据差异`);
                return;
            }

            if (section.type === 'table_3') {
                const identical = JSON.stringify(section.left?.tableData || null) === JSON.stringify(section.right?.tableData || null);
                if (!identical) items.push(`${title.split('、')[1] || title}的表格重复率约 0%，存在明显数据差异`);
                return;
            }

            if (section.type === 'table_4') {
                const identical = JSON.stringify(section.left?.reviewLitigationData || null) === JSON.stringify(section.right?.reviewLitigationData || null);
                if (!identical) items.push(`${title.split('、')[1] || title}的表格重复率约 0%，存在明显数据差异`);
            }
        });

        return items;
    }, []);

    useEffect(() => {
        const url = new URL(window.location.href);
        if (url.searchParams.has('service_token')) {
            url.searchParams.delete('service_token');
            window.history.replaceState(null, '', url.toString());
        }
    }, []);

    // Fetch data directly from API (auth required)
    useEffect(() => {
        const fetchData = async () => {
            try {
                const serviceToken = searchParams.get('service_token');
                const token = serviceToken || localStorage.getItem('admin_token');
                setAuthToken(token || '');

                const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
                // Use configured API base or current origin to reach backend.
                const apiBase = process.env.REACT_APP_API_BASE_URL || '/api';
                const normalizedBase = apiBase.replace(/\/+$/, '');
                const baseWithoutApi = normalizedBase.replace(/\/api\/?$/, '');
                const fallbackBase = baseWithoutApi || window.location.origin;
                const backendUrls = [fallbackBase].filter(Boolean);

                let response = null;
                let lastError = null;

                for (const baseUrl of backendUrls) {
                    try {
                        console.log(`[PrintView] Trying backend at ${baseUrl}...`);
                        response = await fetch(`${baseUrl}/api/comparisons/${comparisonId}/result`, {
                            headers
                        });
                        if (response.ok) {
                            console.log(`[PrintView] Successfully connected to ${baseUrl}`);
                            break;
                        }
                    } catch (e) {
                        lastError = e;
                        console.log(`[PrintView] Failed to connect to ${baseUrl}:`, e.message);
                    }
                }

                if (!response || !response.ok) {
                    const errorPayload = response ? await response.json().catch(() => null) : null;
                    const error = lastError || new Error(errorPayload?.error || 'Failed to fetch comparison data from backend');
                    error.response = {
                        status: response?.status,
                        data: errorPayload,
                    };
                    throw error;
                }

                const comparisonData = await response.json();
                setData(comparisonData);

                // Set document title for PDF filename
                if (comparisonData) {
                    document.title = `比对报告_${comparisonData.region_name}_${comparisonData.year_a}vs${comparisonData.year_b}`;
                }
            } catch (err) {
                console.error('[PrintView] Error:', err);
                const friendlyMessage = translateFailureReason(err, '无法读取比对内容，请确认比对是否已生成完成。');
                const detail = getRawErrorDetail(err);
                setError(detail && detail !== friendlyMessage ? `${friendlyMessage}\n\n原始错误：${detail}` : friendlyMessage);
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [comparisonId, searchParams]);

    const markPrintReady = useCallback(() => {
        window.__COMPARISON_PRINT_READY__ = true;
        document.body.dataset.comparisonPrintReady = 'true';

        const content = document.getElementById('comparison-content');
        if (content) {
            content.setAttribute('data-print-ready', 'true');
        }
    }, []);

    useEffect(() => {
        window.__COMPARISON_PRINT_READY__ = false;
        document.body.dataset.comparisonPrintReady = 'false';

        return () => {
            delete window.__COMPARISON_PRINT_READY__;
            delete document.body.dataset.comparisonPrintReady;
        };
    }, [comparisonId]);

    useEffect(() => {
        if (!data || loading || error || !checksReady) return;

        const timer = window.setTimeout(() => {
            markPrintReady();

            if (autoPrint && !hasTriggeredPrint.current) {
                hasTriggeredPrint.current = true;
                window.print();
            }
        }, 300);

        return () => window.clearTimeout(timer);
    }, [autoPrint, checksReady, data, error, loading, markPrintReady]);


    // Aligned Sections and Summary calculation
    const { alignedSections, summary } = useMemo(() => {
        if (!data) return { alignedSections: [], summary: {} };

        const sections = [];
        const leftSections = data.left_content?.sections || [];
        const rightSections = data.right_content?.sections || [];

        let textSim = [], tableSim = [];

        const typeTitles = {
            text: '正文',
            table_2: '表二：主动公开',
            table_3: '表三：依申请公开',
            table_4: '表四：复议诉讼',
        };

        // Helper to get all sections of a specific type
        const getSectionsByType = (list, type) => list.filter(s => s.type === type);

        // Track used right sections to avoid duplicates/misses
        const usedRightIndices = new Set();

        // Process Left Sections
        leftSections.forEach((ls) => {
            // Find ALL right sections of this type
            const rightCandidates = getSectionsByType(rightSections, ls.type);

            // Find the corresponding right section by index within that type
            const leftTypeIndex = getSectionsByType(leftSections.slice(0, leftSections.indexOf(ls) + 1), ls.type).length - 1;
            const rs = rightCandidates[leftTypeIndex];

            // Title Logic: Prioritize specific section title, fallback to generic type title
            const title = ls.title || typeTitles[ls.type] || ls.type;

            if (rs) {
                usedRightIndices.add(rightSections.indexOf(rs));
            }

            if (ls.type === 'text' && rs) {
                const sim = calculateTextSimilarity(ls.content, rs.content);
                textSim.push(sim);
                sections.push({ type: ls.type, title, left: ls, right: rs, similarity: sim });
            } else if (ls.type.startsWith('table_')) {
                const sim = calculateTextSimilarity(JSON.stringify(ls), JSON.stringify(rs || {}));
                tableSim.push(sim);
                sections.push({ type: ls.type, title, left: ls, right: rs || null, similarity: sim });
            } else {
                sections.push({ type: ls.type, title, left: ls, right: rs || null });
            }
        });

        // Add remaining Right Sections
        rightSections.forEach((rs, index) => {
            if (!usedRightIndices.has(index)) {
                // If this type wasn't in left at all, or we have extra right sections
                const title = rs.title || typeTitles[rs.type] || rs.type;
                sections.push({ type: rs.type, title, left: null, right: rs });
            }
        });

        const avgText = textSim.length ? Math.round(textSim.reduce((a, b) => a + b, 0) / textSim.length) : null;
        const avgTable = tableSim.length ? Math.round(tableSim.reduce((a, b) => a + b, 0) / tableSim.length) : null;
        const overall = (avgText !== null && avgTable !== null) ? Math.round((avgText + avgTable) / 2) : avgText || avgTable;

        return {
            alignedSections: sections,
            summary: (data.diff_json?.summary && data.diff_json.summary.items && data.diff_json.summary.items.length > 0)
                ? data.diff_json.summary
                : { textRepetition: avgText, tableRepetition: avgTable, overallRepetition: overall, items: buildSummaryItems(sections) }
        };
    }, [buildSummaryItems, data]);

    // Render Table Diff
    const renderSectionDiff = (section) => {
        const { type, left, right } = section;

        if (type === 'table_2' && left && right) {
            const leftRows = getTable2Rows(left.activeDisclosureData);
            const rightRows = getTable2Rows(right.activeDisclosureData);
            const merged = leftRows.map(l => {
                const r = rightRows.find(rr => rr.label === l.label);
                return { label: l.label, valA: l.val, valB: r ? r.val : null };
            });
            rightRows.forEach(r => {
                if (!merged.find(m => m.label === r.label)) {
                    merged.push({ label: r.label, valA: null, valB: r.val });
                }
            });
            return (
                <SimpleDiffTable
                    title="主动公开数据差异"
                    headers={["指标", `${data.year_a}年`, `${data.year_b}年`]}
                    rows={merged}
                />
            );
        }

        if (type === 'table_3' && left && right) {
            const leftRows = getTable3Rows(left.tableData);
            const rightRows = getTable3Rows(right.tableData);
            const merged = leftRows.map(l => {
                const r = rightRows.find(rr => rr.label === l.label);
                return { label: l.label, valA: l.val, valB: r ? r.val : null };
            });
            rightRows.forEach(r => {
                if (!merged.find(m => m.label === r.label)) {
                    merged.push({ label: r.label, valA: null, valB: r.val });
                }
            });
            return (
                <SimpleDiffTable
                    title="依申请公开情况 - 详细指标差异分析"
                    headers={["指标", `${data.year_a}年`, `${data.year_b}年`]}
                    rows={merged}
                />
            );
        }

        if (type === 'table_4' && left && right) {
            const leftRows = getTable4Rows(left.reviewLitigationData);
            const rightRows = getTable4Rows(right.reviewLitigationData);
            const merged = leftRows.map(l => {
                const r = rightRows.find(rr => rr.label === l.label);
                return { label: l.label, valA: l.val, valB: r ? r.val : null };
            });
            rightRows.forEach(r => {
                if (!merged.find(m => m.label === r.label)) {
                    merged.push({ label: r.label, valA: null, valB: r.val });
                }
            });
            return (
                <SimpleDiffTable
                    title="复议诉讼数据差异"
                    headers={["指标", `${data.year_a}年`, `${data.year_b}年`]}
                    rows={merged}
                />
            );
        }

        return null;
    };

    if (loading) return (
        <div className="p-8 text-center text-gray-500">
            <div className="text-2xl mb-4">📄</div>
            <div>正在加载比对数据...</div>
        </div>
    );

    if (error) return (
        <div className="p-8 text-center text-red-500">
            <div className="text-2xl mb-4">❌</div>
            <div>{error}</div>
        </div>
    );

    if (!data) return (
        <div className="p-8 text-center">
            <div>无数据</div>
        </div>
    );

    return (
        <>
            {/* Inline print styles to force page breaks - Puppeteer respects @media print */}
            <style>
                {`
                    @media print {
                        .break-before-page {
                            page-break-before: always !important;
                            break-before: page !important;
                        }
                        .break-inside-avoid {
                            page-break-inside: avoid !important;
                            break-inside: avoid !important;
                        }
                        .break-after-avoid {
                            page-break-after: avoid !important;
                            break-after: avoid !important;
                        }
                    }
                `}
            </style>
            <div className="comparison-container comparison-print-page print-mode">
                <div id="comparison-content" className="comparison-print-content" data-print-ready="false">
                    {/* Summary Card */}
                    <div className="comparison-print-summary break-inside-avoid">
                        <h2 className="comparison-print-title font-serif-sc">
                            {data.region_name} 政务公开年报比对
                        </h2>
                        <div className="comparison-print-meta font-mono">
                            <div>
                                <span className="text-gray-500">年份:</span> <span className="font-bold">{data.year_a} vs {data.year_b}</span>
                            </div>
                            <div>
                                <span className="text-gray-500">文字重复率:</span>
                                <span className="font-bold ml-1">{summary.textRepetition ?? '-'}%</span>
                            </div>
                        </div>
                    </div>

                    <div className="comparison-print-findings break-inside-avoid">
                        <h3>发现问题</h3>
                        <ul>
                            {summary.items && summary.items.length > 0 ? (
                                summary.items.map((item, idx) => <li key={idx}>{item}</li>)
                            ) : (
                                <li>未检测到显著差异。</li>
                            )}
                        </ul>
                    </div>

                    {/* Header Row */}
                    <div className="comparison-grid comparison-print-year-row">
                        <h3>{data.year_a} 年报告</h3>
                        <h3>{data.year_b} 年报告</h3>
                    </div>

                    {/* Content Sections */}
                    {alignedSections.map((section, idx) => {
                        // Force page break for Sections 2, 4, 5, 6
                        const isNewPageSection = (section.title && ['二、', '四、', '五、', '六、'].some(prefix => section.title.startsWith(prefix))) || section.type === 'table_4';

                        // Let wide tables paginate naturally in the landscape print view.
                        const useBreakInsideAvoid = section.type.startsWith('table_') && !['table_2', 'table_3', 'table_4'].includes(section.type);

                        // DEBUG: Log section info for Puppeteer console capture
                        console.log(`[PDF Section ${idx}] type: ${section.type}, title: ${section.title}, isNewPageSection: ${isNewPageSection}`);

                        return (
                            <React.Fragment key={idx}>
                                {/* Explicit Page Break Helper - Robust version */}
                                {isNewPageSection && (
                                    <div className="w-full break-before-page" style={{
                                        pageBreakBefore: 'always',
                                        breakBefore: 'page',
                                        minHeight: '1px',
                                        display: 'block',
                                        clear: 'both',
                                        marginTop: '-1px'
                                    }}>
                                        &nbsp;
                                    </div>
                                )}
                                <div className={`comparison-print-section ${useBreakInsideAvoid ? 'break-inside-avoid' : ''}`}>
                                    <h3 className="comparison-print-section-title break-after-avoid" style={{ pageBreakAfter: 'avoid' }}>
                                        {section.title}
                                    </h3>

                                    {/* Text Section - no height limits for PDF */}
                                    {section.type === 'text' && (
                                        <div className="comparison-grid comparison-print-two-col">
                                            <div className="comparison-print-pane">
                                                <DiffText
                                                    oldText={section.right?.content || ''}
                                                    newText={section.left?.content || ''}
                                                    highlightIdentical={highlightIdentical}
                                                    highlightDiff={highlightDiff}
                                                />
                                            </div>
                                            <div className="comparison-print-pane">
                                                <DiffText
                                                    oldText={section.left?.content || ''}
                                                    newText={section.right?.content || ''}
                                                    highlightIdentical={highlightIdentical}
                                                    highlightDiff={highlightDiff}
                                                />
                                            </div>
                                        </div>
                                    )}

                                    {/* Table Sections - scaled to fit within container */}
                                    {/* Table Sections */}
                                    {section.type.startsWith('table_') && (
                                        <div className={`comparison-print-stack comparison-print-table-block comparison-print-table-block--${section.type}`}>
                                            {/* Table Rendering Logic - Different for Table 4 */}
                                            {section.type === 'table_4' ? (
                                                /* Table 4: Vertical Layout (Stacked) with zoom 0.65 */
                                                <div className="comparison-print-table-stack">
                                                    <div className="comparison-print-table-shell comparison-print-table-shell--scaled" style={{ overflow: 'visible', zoom: '0.65', width: '100%' }}>
                                                        <div className="comparison-print-table-label">{data.year_a} 年报告</div>
                                                        {section.left && <Table4View data={section.left.reviewLitigationData} highlightCells={leftIssueHighlightCells} />}
                                                        {!section.left && <div className="text-gray-400 text-center p-4">无数据</div>}
                                                    </div>
                                                    <div className="comparison-print-table-shell comparison-print-table-shell--scaled" style={{ overflow: 'visible', zoom: '0.65', width: '100%' }}>
                                                        <div className="comparison-print-table-label">{data.year_b} 年报告</div>
                                                        {section.right && <Table4View data={section.right.reviewLitigationData} />}
                                                        {!section.right && <div className="text-gray-400 text-center p-4">无数据</div>}
                                                    </div>
                                                </div>
                                            ) : (
                                                /* Table 2 & 3: Side-by-Side Layout with Scaling (Increased neg margin to remove whitespace) */
                                                <div className="comparison-grid comparison-print-two-col comparison-print-table-grid">
                                                    <div className="comparison-print-table-shell comparison-print-table-shell--scaled" style={{ zoom: '0.65', width: '100%' }}>
                                                        {section.type === 'table_2' && section.left && <Table2View data={section.left.activeDisclosureData} highlightCells={leftIssueHighlightCells} />}
                                                        {section.type === 'table_3' && section.left && <Table3View data={section.left.tableData} compact={true} highlightCells={leftIssueHighlightCells} />}
                                                        {!section.left && <div className="text-gray-400 text-center p-4">无数据</div>}
                                                    </div>
                                                    <div className="comparison-print-table-shell comparison-print-table-shell--scaled" style={{ zoom: '0.65', width: '100%' }}>
                                                        {section.type === 'table_2' && section.right && <Table2View data={section.right.activeDisclosureData} />}
                                                        {section.type === 'table_3' && section.right && <Table3View data={section.right.tableData} compact={true} />}
                                                        {!section.right && <div className="text-gray-400 text-center p-4">无数据</div>}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Diff Analysis Table - Start on a new page as requested */}
                                            <div className="comparison-print-diff-table break-before-page">
                                                {renderSectionDiff(section)}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </React.Fragment>
                        );
                    })}

                    {/* Cross Year Check View */}
                    <CrossYearCheckView
                        leftReportId={data.left_report_id}
                        rightReportId={data.right_report_id}
                        leftContent={data.left_content}
                        rightContent={data.right_content}
                        yearA={data.year_a}
                        yearB={data.year_b}
                        authToken={authToken}
                        onLeftIssuesChange={handleLeftIssuesChange}
                        onReadyChange={setChecksReady}
                    />

                    {/* Footer */}
                    <div className="mt-8 pt-4 border-t border-gray-200 text-center text-gray-500 text-sm">
                        <p>生成时间: {new Date().toLocaleString('zh-CN')}</p>
                        <p>政府信息公开年度报告差异比对系统</p>
                    </div>
                </div>
            </div >
        </>
    );
}

export default ComparisonPrintView;
