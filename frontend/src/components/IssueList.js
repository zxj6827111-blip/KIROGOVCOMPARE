import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import './IssueList.css';
import { apiClient } from '../apiClient';
import {
    AlertCircle,
    ChevronDown,
    ChevronRight,
    FileText,
    CheckCircle,
    ArrowLeft,
    RefreshCw,
    Eye
} from 'lucide-react';
import { useToast } from './common/ToastProvider';
import { useConfirmDialog } from './common/ConfirmDialogProvider';
import Button from './common/Button';
import PageHeader from './common/PageHeader';
import { appendReturnTo } from '../app/routeRegistry';

const EMPTY_ISSUES_DATA = { total_issues: 0, tree: [] };

function getDefaultExpandedRegions(nodes = []) {
    const ids = new Set();
    nodes.forEach(node => {
        if (node.subtree_issues > 0 || (node.reports && node.reports.length > 0)) {
            ids.add(node.region_id);
        }
    });
    return ids;
}

function collectReportsFromNodes(nodes = []) {
    const reports = [];
    const traverse = (items) => {
        if (!items) return;
        items.forEach(node => {
            if (node.reports) {
                reports.push(...node.reports);
            }
            if (node.children) {
                traverse(node.children);
            }
        });
    };
    traverse(nodes);
    return reports;
}

function countNodesWithIssues(nodes = []) {
    let count = 0;
    nodes.forEach(node => {
        if (node.own_issues > 0) count++;
        if (node.children) count += countNodesWithIssues(node.children);
    });
    return count;
}

function IssueListSkeleton() {
    return (
        <div className="region-tree issue-list-skeleton" aria-label="问题清单加载中">
            {[0, 1, 2, 3, 4].map(index => (
                <div key={index} className="issue-skeleton-row">
                    <span className="issue-skeleton-dot" />
                    <span className="issue-skeleton-line issue-skeleton-line--title" />
                    <span className="issue-skeleton-line issue-skeleton-line--meta" />
                </div>
            ))}
        </div>
    );
}

function IssueList({ regionId, regionName, onBack, onSelectReport }) {
    const toast = useToast();
    const confirmAction = useConfirmDialog();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [data, setData] = useState(EMPTY_ISSUES_DATA);
    const [expandedRegions, setExpandedRegions] = useState(new Set());
    const [filterMode, setFilterMode] = useState('issues'); // 'all' | 'issues'
    const [batchChecking, setBatchChecking] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const hasLoadedOnceRef = useRef(false);
    const activeRegionKeyRef = useRef(regionId || 'all');

    const fetchData = useCallback(async () => {
        const requestRegionKey = regionId || 'all';
        const shouldResetExpansion = activeRegionKeyRef.current !== requestRegionKey || !hasLoadedOnceRef.current;
        setLoading(true);
        setError('');
        try {
            const resp = await apiClient.get(`/regions/${requestRegionKey}/issues-summary`);
            const responseData = resp.data?.data || EMPTY_ISSUES_DATA;
            setData(responseData);
            setExpandedRegions(prev => (
                shouldResetExpansion ? getDefaultExpandedRegions(responseData.tree || []) : prev
            ));
            activeRegionKeyRef.current = requestRegionKey;
            hasLoadedOnceRef.current = true;
            setHasLoadedOnce(true);

        } catch (err) {
            const message = err.response?.data?.error || err.message || '请求失败';
            setError(`加载问题清单失败：${message}`);
        } finally {
            setLoading(false);
        }
    }, [regionId]);

    useEffect(() => {
        setData(EMPTY_ISSUES_DATA);
        setExpandedRegions(new Set());
        setHasLoadedOnce(false);
        hasLoadedOnceRef.current = false;
        activeRegionKeyRef.current = regionId || 'all';
        fetchData();
    }, [fetchData, regionId]);

    const toggleRegion = (e, regionId) => {
        e.stopPropagation();
        setExpandedRegions(prev => {
            const newSet = new Set(prev);
            if (newSet.has(regionId)) {
                newSet.delete(regionId);
            } else {
                newSet.add(regionId);
            }
            return newSet;
        });
    };

    // Recursive filtering
    const filterTree = useCallback((nodes) => {
        if (!nodes) return [];
        return nodes.map(node => {
            // Clone node to handle children filtering
            const newNode = { ...node };

            // Filter reports within the node based on filterMode
            if (newNode.reports && filterMode === 'issues') {
                newNode.reports = newNode.reports.filter(report => report.issue_count > 0);
            }

            if (newNode.children) {
                newNode.children = filterTree(newNode.children);
            }
            return newNode;
        }).filter(node => {
            if (filterMode === 'all') return true;
            // Keep if has reports with issues OR has children with issues
            const hasReportsWithIssues = node.reports && node.reports.length > 0;
            const hasChildrenWithIssues = node.children && node.children.length > 0;
            return hasReportsWithIssues || hasChildrenWithIssues;
        });
    }, [filterMode]);

    const filteredTree = useMemo(() => {
        return filterTree(data.tree || []);
    }, [data.tree, filterTree]);

    const issueReportIds = useMemo(() => {
        const allReports = collectReportsFromNodes(filteredTree);
        return allReports.map(r => r.report_id);
    }, [filteredTree]);

    const issueRegionCount = useMemo(() => countNodesWithIssues(data.tree || []), [data.tree]);
    const isInitialLoading = loading && !hasLoadedOnce;
    const isRefreshing = loading && hasLoadedOnce;

    const handleBatchCheck = async () => {
        if (batchChecking) return;
        if (issueReportIds.length === 0) {
            toast.info('当前没有需要校验的问题报告');
            return;
        }

        const confirmed = await confirmAction({
            title: '一键校验问题报告',
            message: `确认对当前筛选的 ${issueReportIds.length} 份问题报告进行一键校验？系统将以 50 份为一组分批处理，防止超时。`,
            confirmText: '开始校验',
            tone: 'default',
        });
        if (!confirmed) return;

        setBatchChecking(true);
        let totalProcessed = 0;
        let totalSkipped = 0;
        let totalFailed = 0;

        const CHUNK_SIZE = 50;
        const reportIds = [...issueReportIds];
        const chunks = [];
        for (let i = 0; i < reportIds.length; i += CHUNK_SIZE) {
            chunks.push(reportIds.slice(i, i + CHUNK_SIZE));
        }

        try {
            for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                console.log(`Processing batch ${i + 1}/${chunks.length}...`);
                const resp = await apiClient.post('/reports/batch-checks/run', { report_ids: chunk });
                const rData = resp.data || {};
                totalProcessed += (rData.processed || 0);
                totalSkipped += (rData.skipped || 0);
                totalFailed += (rData.failed || 0);
            }
            await fetchData();
            toast.success('一键校验完成', `成功 ${totalProcessed}，跳过 ${totalSkipped}，失败 ${totalFailed}`);
        } catch (err) {
            const message = err.response?.data?.error || err.message || '一键校验失败';
            console.error('Batch check error:', err);
            await fetchData();
            toast.error('校验过程中断', `已尝试处理 ${totalProcessed} 份。${message}`);
        } finally {
            setBatchChecking(false);
        }
    };

    const handleViewReport = (e, reportId) => {
        e.stopPropagation();
        if (onSelectReport) {
            onSelectReport(reportId);
        } else {
            window.location.href = appendReturnTo(`/catalog/reports/${reportId}`, window.location.pathname + window.location.search);
        }
    };

    const renderReportItem = (report) => (
        <div key={report.report_id} className={`report-item ${report.issue_count > 0 ? 'has-issues' : ''}`}>
            <div className="report-info">
                <span className="report-year">{report.year}年</span>
                <span className="report-title">{report.unit_name || '未命名单位'}</span>
            </div>
            <div className="report-issues">
                {report.issue_count > 0 ? (
                    <div className="issue-breakdown">
                        {report.issues_by_category?.visual > 0 && (
                            <span className="issue-badge visual">
                                <Eye size={12} /> 版式 {report.issues_by_category.visual}
                            </span>
                        )}
                        {report.issues_by_category?.structure > 0 && (
                            <span className="issue-badge structure">
                                <FileText size={12} /> 内容 {report.issues_by_category.structure}
                            </span>
                        )}
                        {report.issues_by_category?.quality > 0 && (
                            <span className="issue-badge quality">
                                <AlertCircle size={12} /> 质量 {report.issues_by_category.quality}
                            </span>
                        )}
                    </div>
                ) : (
                    <span className="no-issue-badge"><CheckCircle size={12} /> 正常</span>
                )}
            </div>
            <button className="view-btn" onClick={(e) => handleViewReport(e, report.report_id)}>
                查看
            </button>
        </div>
    );

    const renderRegionNode = (node, depth = 0) => {
        const isExpanded = expandedRegions.has(node.region_id);
        const hasChildren = node.children && node.children.length > 0;
        const hasReports = node.reports && node.reports.length > 0;
        const paddingLeft = 20 + depth * 24; // Dynamic indentation

        return (
            <div key={node.region_id} className="region-node">
                <div
                    className={`region-header ${node.subtree_issues > 0 ? 'has-issues' : ''}`}
                    onClick={(e) => toggleRegion(e, node.region_id)}
                    style={{ paddingLeft: `${paddingLeft}px` }}
                >
                    <div className="region-expand">
                        {(hasChildren || hasReports) ? (
                            isExpanded ? <ChevronDown size={20} /> : <ChevronRight size={20} />
                        ) : <span style={{ width: 20, display: 'inline-block' }}></span>}
                    </div>

                    <div className="region-info">
                        <span className="region-name">{node.region_name}</span>
                        {/* Optionally show level: <span className="region-level">L{node.region_level}</span> */}
                    </div>

                    <div className="region-stats">
                        {node.subtree_issues > 0 ? (
                            <span className="issue-count has-issues">
                                <AlertCircle size={16} /> {node.subtree_issues} 个问题
                            </span>
                        ) : (
                            <span className="issue-count no-issues">正常</span>
                        )}
                        {/* Show count of reports in this exact region */}
                        {node.reports && node.reports.length > 0 && (
                            <span className="report-count">{node.reports.length} 份报告</span>
                        )}
                    </div>
                </div>

                {isExpanded && (
                    <div className="region-content">
                        {/* Reports first (leaves of this node) */}
                        {hasReports && (
                            <div className="region-reports" style={{ paddingLeft: `${paddingLeft + 20}px` }}>
                                {node.reports.map(report => renderReportItem(report))}
                            </div>
                        )}

                        {/* Children next */}
                        {hasChildren && (
                            <div className="region-children">
                                {node.children.map(child => renderRegionNode(child, depth + 1))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="issue-list-page kc-page">
            <PageHeader
                title="问题清单"
                subtitle={regionName ? `${regionName} 及下级区域` : '按地区汇总年报校验和质量问题。'}
                badges={data && hasLoadedOnce ? (
                    <>
                        <span className="kc-status-badge kc-status-badge--danger">{data.total_issues} 个问题</span>
                        <span className="kc-status-badge kc-status-badge--info">{issueRegionCount} 个区域</span>
                        {isRefreshing && <span className="kc-status-badge">刷新中</span>}
                    </>
                ) : null}
                actions={(
                    <>
                        <Button variant="secondary" icon={<ArrowLeft size={16} />} onClick={onBack}>
                            返回
                        </Button>
                        <Button variant="secondary" icon={<RefreshCw size={16} className={loading ? 'spin' : ''} />} onClick={fetchData} disabled={loading}>
                            {loading ? '刷新中' : '刷新'}
                        </Button>
                    </>
                )}
            />

            {data && hasLoadedOnce && (
                <div className="summary-section kc-summary-grid issue-summary-grid">
                    <div className="kc-summary-card total">
                        <span className="kc-summary-card__label">发现问题总数</span>
                        <span className={`kc-summary-card__value ${data.total_issues > 0 ? 'kc-summary-card__value--danger' : ''}`}>
                            {data.total_issues}
                        </span>
                    </div>
                    <div className="kc-summary-card regions">
                        <span className="kc-summary-card__label">涉及区域</span>
                        <span className="kc-summary-card__value kc-summary-card__value--primary">{issueRegionCount}</span>
                    </div>
                    {isRefreshing && <span className="issue-refreshing-note"><RefreshCw size={14} className="spin" /> 正在刷新最新问题数据</span>}
                </div>
            )}

            <div className="filter-bar kc-toolbar">
                <div className="filter-tabs kc-segmented">
                    <button
                        className={`filter-tab ${filterMode === 'issues' ? 'active' : ''}`}
                        onClick={() => setFilterMode('issues')}
                    >
                        <AlertCircle size={16} /> 只看有问题的
                    </button>
                    <button
                        className={`filter-tab ${filterMode === 'all' ? 'active' : ''}`}
                        onClick={() => setFilterMode('all')}
                    >
                        <FileText size={16} /> 显示全部
                    </button>
                </div>
                <Button
                    variant="primary"
                    icon={<CheckCircle size={16} className={batchChecking ? 'spin' : ''} />}
                    onClick={handleBatchCheck}
                    disabled={loading || batchChecking || issueReportIds.length === 0}
                    title="对当前筛选的问题报告一键校验"
                >
                    {isInitialLoading ? '加载中' : batchChecking ? '一键校验中...' : `一键校验(${issueReportIds.length})`}
                </Button>
            </div>

            {error && <div className="alert error">{error}</div>}

            {isInitialLoading && <IssueListSkeleton />}

            {!loading && !error && hasLoadedOnce && filteredTree.length === 0 && (
                <div className="empty-state">
                    <CheckCircle size={48} />
                    <h3>未发现问题</h3>
                    <p>所有年报均未发现需要关注的问题</p>
                </div>
            )}

            {hasLoadedOnce && !error && filteredTree.length > 0 && (
                <div className={`region-tree ${isRefreshing ? 'region-tree--refreshing' : ''}`}>
                    {filteredTree.map(root => renderRegionNode(root, 0))}
                </div>
            )}
        </div>
    );
}

export default IssueList;
