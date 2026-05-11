/**
 * ComparisonPrintView.js
 * Print view for Puppeteer PDF export.
 * Requires auth; supports service_token in query string.
 */
import React, { useEffect, useState, useMemo } from 'react';
import '../ComparisonDetailView.css';
import { Table2View, Table3View, Table4View, SimpleDiffTable } from '../TableViews';
import DiffText from '../DiffText';
import CrossYearCheckView from '../CrossYearCheckView';

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

// Helper for Table 3 Rows
const getTable3Rows = (data) => {
    if (!data || !data.total || !data.total.results) return [];
    const t = data.total;
    const r = t.results;
    return [
        { label: '本年新收政府信息公开申请数量', val: t.newReceived },
        { label: '上年结转政府信息公开申请数量', val: t.carriedOver },
        { label: '予以公开', val: r.granted },
        { label: '部分公开', val: r.partialGrant },
        { label: '不予公开-属于国家秘密', val: r.denied?.stateSecret },
        { label: '不予公开-其他法律行政法规禁止公开', val: r.denied?.lawForbidden },
        { label: '不予公开-危及"三安全一稳定"', val: r.denied?.safetyStability },
        { label: '不予公开-保护第三方合法权益', val: r.denied?.thirdPartyRights },
        { label: '不予公开-属于工作秘密', val: r.denied?.workSecret },
        { label: '不予公开-属于内部事务信息', val: r.denied?.internalAffairs },
        { label: '不予公开-属于内部管理信息', val: r.denied?.internalManagement },
        { label: '不予公开-属于过程性信息', val: r.denied?.processInfo },
        { label: '不予公开-属于行政执法案卷', val: r.denied?.enforcementDossier },
        { label: '不予公开-属于行政查询事项', val: r.denied?.queryMatter },
        { label: '无法提供-非政府公开信息', val: r.unableToProvide?.notGovInfo },
        { label: '无法提供-信息不存在', val: r.unableToProvide?.notExist },
        { label: '无法提供-非本机关负责公开', val: r.unableToProvide?.notResponsible },
        { label: '不予处理-信访举报投诉类', val: r.notProcessed?.petition },
        { label: '不予处理-重复申请', val: r.notProcessed?.duplicateRequest },
        { label: '不予处理-要求提供公开出版物', val: r.notProcessed?.requirePublication },
        { label: '不予处理-无正当理由大量反复申请', val: r.notProcessed?.unreasonableRequest },
        { label: '不予处理-要求行政机关确认或重新出具', val: r.notProcessed?.requireConfirm },
        { label: '不予处理-无法联系到申请人', val: r.notProcessed?.noContact },
        { label: '其他处理', val: r.other },
        { label: '结转下年度继续办理', val: r.carriedForward },
    ].filter(row => row.val !== undefined && row.val !== null);
};

// Helper for Table 4 Rows
const getTable4Rows = (data) => {
    if (!data) return [];
    return [
        { label: '行政复议-维持', val: data.review?.maintain },
        { label: '行政复议-撤销/变更/确认违法', val: data.review?.corrected },
        { label: '行政复议-其他', val: data.review?.other },
        { label: '行政诉讼(未经复议)-维持', val: data.litigationDirect?.maintain },
        { label: '行政诉讼(未经复议)-撤销/变更/确认违法', val: data.litigationDirect?.corrected },
        { label: '行政诉讼(未经复议)-其他', val: data.litigationDirect?.other },
        { label: '行政诉讼(经复议)-维持', val: data.litigationAfterReview?.maintain },
        { label: '行政诉讼(经复议)-撤销/变更/确认违法', val: data.litigationAfterReview?.corrected },
        { label: '行政诉讼(经复议)-其他', val: data.litigationAfterReview?.other },
    ].filter(row => row.val !== undefined && row.val !== null);
};

// Helper for Table 2 Rows
const getTable2Rows = (data) => {
    if (!data) return [];
    return [
        { label: '规章-制发', val: data.regulations?.made },
        { label: '规章-废止', val: data.regulations?.repealed },
        { label: '规章-现行有效', val: data.regulations?.valid },
        { label: '规范性文件-制发', val: data.normativeDocuments?.made },
        { label: '规范性文件-废止', val: data.normativeDocuments?.repealed },
        { label: '规范性文件-现行有效', val: data.normativeDocuments?.valid },
        { label: '行政许可-处理', val: data.adminPermit?.processed },
        { label: '行政处罚', val: data.adminPunishment },
        { label: '行政强制', val: data.adminForce },
        { label: '行政事业性收费(万元)', val: data.adminFee },
    ].filter(row => row.val !== undefined && row.val !== null);
};

function ComparisonPrintView({ comparisonId }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Read highlight settings from URL search params
    // Default: show identical parts highlight (yellow), hide diff highlight (red)
    const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
    const highlightIdentical = searchParams.get('highlightIdentical') !== 'false'; // default true
    const highlightDiff = searchParams.get('highlightDiff') === 'true'; // default false

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
                    throw lastError || new Error('Failed to fetch comparison data from backend');
                }

                const comparisonData = await response.json();
                setData(comparisonData);

                // Set document title for PDF filename
                if (comparisonData) {
                    document.title = `比对报告_${comparisonData.region_name}_${comparisonData.year_a}vs${comparisonData.year_b}`;
                }
            } catch (err) {
                console.error('[PrintView] Error:', err);
                setError(err.message || '加载失败');
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [comparisonId, searchParams]);

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
            summary: { textRepetition: avgText, tableRepetition: avgTable, overallRepetition: overall, items: [] }
        };
    }, [data]);

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
            <div className="comparison-container bg-white min-h-screen p-6 print-mode">
                <div id="comparison-content" className="max-w-[1400px] mx-auto">
                    {/* Summary Card */}
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-8 shadow-sm">
                        <h2 className="text-2xl font-bold text-gray-900 mb-4 font-serif-sc">
                            {data.region_name} 政务公开年报比对
                        </h2>
                        <div className="flex space-x-8 text-sm text-gray-700 mb-4 font-mono">
                            <div>
                                <span className="text-gray-500">年份:</span> <span className="font-bold">{data.year_a} vs {data.year_b}</span>
                            </div>
                            <div>
                                <span className="text-gray-500">文字重复率:</span>
                                <span className="font-bold ml-1">{summary.textRepetition ?? '-'}%</span>
                            </div>
                        </div>
                    </div>

                    {/* Header Row */}
                    <div className="comparison-grid grid grid-cols-2 gap-4 bg-gray-100 pt-4 pb-2 px-4 border-b border-gray-300 mb-0 rounded-t-lg">
                        <h3 className="text-lg font-bold text-gray-800">{data.year_a} 年报告</h3>
                        <h3 className="text-lg font-bold text-gray-800">{data.year_b} 年报告</h3>
                    </div>

                    {/* Content Sections */}
                    {alignedSections.map((section, idx) => {
                        // Force page break for Sections 2, 4, 5, 6
                        const isNewPageSection = (section.title && ['二、', '四、', '五、', '六、'].some(prefix => section.title.startsWith(prefix))) || section.type === 'table_4';

                        // Don't use break-inside-avoid for Table 4 div, to allow clean page break before it
                        const useBreakInsideAvoid = section.type.startsWith('table_') && section.type !== 'table_4';

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
                                <div className={`mb-6 ${useBreakInsideAvoid ? 'break-inside-avoid' : ''}`}>
                                    <h3 className="text-lg font-bold text-gray-900 mb-1 border-l-4 border-blue-500 pl-3 py-1 bg-blue-50 rounded-r break-after-avoid" style={{ pageBreakAfter: 'avoid' }}>
                                        {section.title}
                                    </h3>

                                    {/* Text Section - no height limits for PDF */}
                                    {section.type === 'text' && (
                                        <div className="comparison-grid grid grid-cols-2 gap-4">
                                            <div className="bg-white p-4 rounded border border-gray-200 shadow-sm text-sm leading-relaxed">
                                                <DiffText
                                                    oldText={section.right?.content || ''}
                                                    newText={section.left?.content || ''}
                                                    highlightIdentical={highlightIdentical}
                                                    highlightDiff={highlightDiff}
                                                />
                                            </div>
                                            <div className="bg-white p-4 rounded border border-gray-200 shadow-sm text-sm leading-relaxed">
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
                                        <div className="space-y-4">
                                            {/* Table Rendering Logic - Different for Table 4 */}
                                            {section.type === 'table_4' ? (
                                                /* Table 4: Vertical Layout (Stacked) with zoom 0.65 */
                                                <div className="flex flex-col space-y-6">
                                                    <div className="bg-white p-2 rounded border border-gray-200 shadow-sm origin-top-left" style={{ overflow: 'visible', zoom: '0.65', width: '100%' }}>
                                                        <div className="mb-2 font-bold text-gray-700 text-center">{data.year_a} 年报告</div>
                                                        {section.left && <Table4View data={section.left.reviewLitigationData} />}
                                                        {!section.left && <div className="text-gray-400 text-center p-4">无数据</div>}
                                                    </div>
                                                    <div className="bg-white p-2 rounded border border-gray-200 shadow-sm origin-top-left" style={{ overflow: 'visible', zoom: '0.65', width: '100%' }}>
                                                        <div className="mb-2 font-bold text-gray-700 text-center">{data.year_b} 年报告</div>
                                                        {section.right && <Table4View data={section.right.reviewLitigationData} />}
                                                        {!section.right && <div className="text-gray-400 text-center p-4">无数据</div>}
                                                    </div>
                                                </div>
                                            ) : (
                                                /* Table 2 & 3: Side-by-Side Layout with Scaling (Increased neg margin to remove whitespace) */
                                                <div className="comparison-grid grid grid-cols-2 gap-4 relative z-0">
                                                    <div className="bg-white p-2 rounded border border-gray-200 shadow-sm origin-top-left" style={{ zoom: '0.65', width: '100%' }}>
                                                        {section.type === 'table_2' && section.left && <Table2View data={section.left.activeDisclosureData} />}
                                                        {section.type === 'table_3' && section.left && <Table3View data={section.left.tableData} compact={true} />}
                                                        {!section.left && <div className="text-gray-400 text-center p-4">无数据</div>}
                                                    </div>
                                                    <div className="bg-white p-2 rounded border border-gray-200 shadow-sm origin-top-left" style={{ zoom: '0.65', width: '100%' }}>
                                                        {section.type === 'table_2' && section.right && <Table2View data={section.right.activeDisclosureData} />}
                                                        {section.type === 'table_3' && section.right && <Table3View data={section.right.tableData} compact={true} />}
                                                        {!section.right && <div className="text-gray-400 text-center p-4">无数据</div>}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Diff Analysis Table - Start on a new page as requested */}
                                            <div className="relative z-10 pt-4 break-before-page" style={{ pageBreakBefore: 'always' }}>
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
