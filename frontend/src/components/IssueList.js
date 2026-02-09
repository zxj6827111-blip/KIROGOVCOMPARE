import React, { useCallback, useEffect, useState, useMemo } from 'react';
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
    Eye,
    Download
} from 'lucide-react';

function IssueList({ regionId, regionName, onBack, onSelectReport }) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [data, setData] = useState({ total_issues: 0, tree: [] });
    const [expandedRegions, setExpandedRegions] = useState(new Set());
    const [filterMode, setFilterMode] = useState('issues'); // 'all' | 'issues'
    const [batchChecking, setBatchChecking] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const id = regionId || 'all';
            const resp = await apiClient.get(`/regions/${id}/issues-summary`);
            const responseData = resp.data?.data || { total_issues: 0, tree: [] };
            setData(responseData);

            // Auto-expand regions with issues
            // We need to traverse the tree to find IDs of nodes with issues
            const idsToExpand = new Set();
            const traverseAndExpand = (nodes) => {
                if (!nodes) return;
                nodes.forEach(node => {
                    // Try to expand nodes that have issues
                    if (node.subtree_issues > 0) {
                        idsToExpand.add(node.region_id);
                    }
                    if (node.children) {
                        traverseAndExpand(node.children);
                    }
                });
            };

            traverseAndExpand(responseData.tree || []);
            setExpandedRegions(idsToExpand);

        } catch (err) {
            const message = err.response?.data?.error || err.message || '请求失败';
            setError(`加载问题清单失败：${message}`);
        } finally {
            setLoading(false);
        }
    }, [regionId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

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

    // Helper to extract reports from tree nodes for batch operations
    const getReportsFromNodes = (nodes) => {
        let reports = [];
        if (!nodes) return reports;
        nodes.forEach(node => {
            if (node.reports) {
                reports = [...reports, ...node.reports];
            }
            if (node.children) {
                reports = [...reports, ...getReportsFromNodes(node.children)];
            }
        });
        return reports;
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
        // Collect all report IDs from the FILTERED tree
        // This ensures batch check only runs on what is visible (conceptually)
        // or actually, logically we usually want to batch check "all with issues"?
        // Current requirement: "对当前筛选...一键校验". So yes, filtered tree.
        const allReports = getReportsFromNodes(filteredTree);
        return allReports.map(r => r.report_id);
    }, [filteredTree]);

    // Calculate display stats based on filtered tree?
    // Or just use the global stats?
    // "只看有问题 (X)" -> X should be count of regions or total issues?
    // Originally it was region count. Now maybe issue count is more relevant?
    // Let's stick to "Region Count" (nodes in tree that have issues).
    // But counting nodes in tree is recursive.
    const countNodesWithIssues = (nodes) => {
        let count = 0;
        nodes.forEach(node => {
            if (node.own_issues > 0) count++; // Count regions that HAVE issues themselves
            if (node.children) count += countNodesWithIssues(node.children);
        });
        return count;
    };

    const countTotalNodes = (nodes) => {
        let count = 0;
        nodes.forEach(node => {
            count++;
            if (node.children) count += countTotalNodes(node.children);
        });
        return count;
    };

    const handleBatchCheck = async () => {
        if (batchChecking) return;
        if (issueReportIds.length === 0) {
            alert('当前没有需要校验的问题报告');
            return;
        }

        if (!window.confirm(`确认对当前筛选的 ${issueReportIds.length} 份问题报告进行一键校验？\n(系统将以 50 份为一组分批处理，防止超时)`)) return;

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
            alert(`一键校验完成：\n成功：${totalProcessed}\n跳过：${totalSkipped}\n失败：${totalFailed}`);
        } catch (err) {
            const message = err.response?.data?.error || err.message || '一键校验失败';
            console.error('Batch check error:', err);
            await fetchData();
            alert(`校验过程中断：${message}\n\n已尝试处理：${totalProcessed} 份。`);
        } finally {
            setBatchChecking(false);
        }
    };

    const handleViewReport = (e, reportId) => {
        e.stopPropagation();
        if (onSelectReport) {
            onSelectReport(reportId);
        } else {
            window.location.href = `/catalog/reports/${reportId}`;
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
        <div className="issue-list-page">
            <div className="issue-list-header">
                <div className="header-left">
                    <button className="back-btn" onClick={onBack}>
                        <ArrowLeft size={20} /> <span>返回</span>
                    </button>
                    <div className="header-title">
                        <h2><AlertCircle size={24} className="title-icon" /> 问题清单</h2>
                        {regionName && <p className="subtitle">{regionName} 及下级区域</p>}
                    </div>
                </div>
                <div className="header-right">
                    <button className="refresh-btn" onClick={fetchData} disabled={loading} title="刷新">
                        <RefreshCw size={18} className={loading ? 'spin' : ''} />
                    </button>
                </div>
            </div>

            {data && !loading && (
                <div className="summary-section">
                    <div className="summary-card total">
                        <span className="summary-label">发现问题总数</span>
                        <span className={`summary-value ${data.total_issues > 0 ? 'has-issues' : ''}`}>
                            {data.total_issues}
                        </span>
                    </div>
                    <div className="summary-card regions">
                        <span className="summary-label">涉及区域</span>
                        <span className="summary-value">{countNodesWithIssues(data.tree || [])}</span>
                    </div>
                </div>
            )}

            <div className="filter-bar">
                <div className="filter-tabs">
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
                <button
                    className="batch-check-btn"
                    onClick={handleBatchCheck}
                    disabled={batchChecking || issueReportIds.length === 0}
                    title="对当前筛选的问题报告一键校验"
                >
                    <CheckCircle size={16} className={batchChecking ? 'spin' : ''} />
                    {batchChecking ? '一键校验中...' : `一键校验(${issueReportIds.length})`}
                </button>
            </div>

            {error && <div className="alert error">{error}</div>}

            {loading && (
                <div className="loading-state">
                    <RefreshCw size={32} className="spin" />
                    <p>加载中...</p>
                </div>
            )}

            {!loading && !error && filteredTree.length === 0 && (
                <div className="empty-state">
                    <CheckCircle size={48} />
                    <h3>未发现问题</h3>
                    <p>所有年报均未发现需要关注的问题</p>
                </div>
            )}

            {!loading && !error && filteredTree.length > 0 && (
                <div className="region-tree">
                    {filteredTree.map(root => renderRegionNode(root, 0))}
                </div>
            )}
        </div>
    );
}

export default IssueList;
