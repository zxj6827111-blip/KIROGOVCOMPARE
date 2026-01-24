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


    Eye


} from 'lucide-react';






function IssueList({ regionId, regionName, onBack, onSelectReport }) {


    const [loading, setLoading] = useState(true);


    const [error, setError] = useState('');


    const [data, setData] = useState(null);


    const [expandedRegions, setExpandedRegions] = useState(new Set());


    const [filterMode, setFilterMode] = useState('issues'); // 'all' | 'issues'


    const [batchChecking, setBatchChecking] = useState(false);






    const fetchData = useCallback(async () => {
        setLoading(true);



        setError('');



        try {



            const id = regionId || 'all';



            const resp = await apiClient.get(`/regions/${id}/issues-summary`);



            setData(resp.data?.data || { total_issues: 0, regions: [] });







            // Auto-expand regions with issues



            const regionsWithIssues = (resp.data?.data?.regions || [])



                .filter(r => r.total_issues > 0)



                .map(r => r.region_id);



            setExpandedRegions(new Set(regionsWithIssues.slice(0, 5))); // Expand first 5



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






    const toggleRegion = (regionId) => {



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







    const filteredRegions = useMemo(() => {


        if (!data?.regions) return [];


        if (filterMode === 'issues') {


            return data.regions.filter(r => r.total_issues > 0);


        }


        return data.regions;


    }, [data, filterMode]);





    const issueReportIds = useMemo(() => {


        const ids = new Set();


        filteredRegions.forEach(region => {


            (region.reports || []).forEach(report => {


                if (report.issue_count > 0) {


                    ids.add(report.report_id);


                }


            });


        });


        return Array.from(ids);


    }, [filteredRegions]);





    const handleBatchCheck = async () => {


        if (batchChecking) return;


        if (issueReportIds.length === 0) {


            alert('当前没有需要校验的问题报告');


            return;


        }


        if (!window.confirm(`确认对当前筛选的 ${issueReportIds.length} 份问题报告进行一键校验？`)) return;





        setBatchChecking(true);


        try {


            const resp = await apiClient.post('/reports/batch-checks/run', { report_ids: issueReportIds });


            const data = resp.data || {};


            const processed = data.processed || 0;


            const skipped = data.skipped || 0;


            const failed = data.failed || 0;


            await fetchData();


            alert(`一键校验完成：成功 ${processed}，跳过 ${skipped}，失败 ${failed}`);


        } catch (err) {


            const message = err.response?.data?.error || err.message || '一键校验失败';


            alert(message);


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

















    return (



        <div className="issue-list-page">



            {/* Header */}



            <div className="issue-list-header">



                <div className="header-left">



                    <button className="back-btn" onClick={onBack}>



                        <ArrowLeft size={20} />



                        <span>返回</span>



                    </button>



                    <div className="header-title">



                        <h2>



                            <AlertCircle size={24} className="title-icon" />



                            问题清单



                        </h2>



                        {regionName && <p className="subtitle">{regionName} 及下级区域</p>}



                    </div>



                </div>



                <div className="header-right">



                    <button



                        className="refresh-btn"



                        onClick={fetchData}



                        disabled={loading}



                        title="刷新"



                    >



                        <RefreshCw size={18} className={loading ? 'spin' : ''} />



                    </button>



                </div>



            </div>







            {/* Summary Card */}



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



                        <span className="summary-value">{filteredRegions.length}</span>



                    </div>



                </div>



            )}







            {/* Filter Bar */}


            <div className="filter-bar">


                <div className="filter-tabs">


                    <button


                        className={`filter-tab ${filterMode === 'issues' ? 'active' : ''}`}


                        onClick={() => setFilterMode('issues')}


                    >


                        <AlertCircle size={16} />


                        只看有问题的 ({data?.regions?.filter(r => r.total_issues > 0).length || 0})


                    </button>


                    <button


                        className={`filter-tab ${filterMode === 'all' ? 'active' : ''}`}


                        onClick={() => setFilterMode('all')}


                    >


                        <FileText size={16} />


                        显示全部 ({data?.regions?.length || 0})


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






            {/* Error State */}



            {error && <div className="alert error">{error}</div>}







            {/* Loading State */}



            {loading && (



                <div className="loading-state">



                    <RefreshCw size={32} className="spin" />



                    <p>加载中...</p>



                </div>



            )}







            {/* Empty State */}



            {!loading && !error && filteredRegions.length === 0 && (



                <div className="empty-state">



                    <CheckCircle size={48} />



                    <h3>未发现问题</h3>



                    <p>所有年报均未发现需要关注的问题</p>



                </div>



            )}







            {/* Region List */}



            {!loading && !error && filteredRegions.length > 0 && (



                <div className="region-list">



                    {filteredRegions.map(region => (



                        <div key={region.region_id} className="region-item">



                            {/* Region Header */}



                            <div



                                className={`region-header ${region.total_issues > 0 ? 'has-issues' : ''}`}



                                onClick={() => toggleRegion(region.region_id)}



                            >



                                <div className="region-expand">



                                    {expandedRegions.has(region.region_id)



                                        ? <ChevronDown size={20} />



                                        : <ChevronRight size={20} />



                                    }



                                </div>



                                <div className="region-info">



                                    <span className="region-name">{region.region_name}</span>



                                    <span className="region-level">Level {region.region_level}</span>



                                </div>



                                <div className="region-stats">



                                    <span className={`issue-count ${region.total_issues > 0 ? 'has-issues' : 'no-issues'}`}>



                                        {region.total_issues > 0 ? (



                                            <>



                                                <AlertCircle size={16} />



                                                {region.total_issues} 个问题



                                            </>



                                        ) : (



                                            <>



                                                <CheckCircle size={16} />



                                                无问题



                                            </>



                                        )}



                                    </span>



                                    <span className="report-count">{region.reports.length} 份报告</span>



                                </div>



                            </div>







                            {/* Reports List (Expanded) */}



                            {expandedRegions.has(region.region_id) && (



                                <div className="reports-list">



                                    {region.reports.map(report => (



                                        <div



                                            key={report.report_id}



                                            className={`report-item ${report.issue_count > 0 ? 'has-issues' : ''}`}



                                        >



                                            <div className="report-info">



                                                <span className="report-year">{report.year}年</span>



                                                <span className="report-title">



                                                    {report.unit_name || region.region_name}政务公开年报



                                                </span>



                                            </div>







                                            <div className="report-issues">



                                                {report.issue_count > 0 ? (



                                                    <div className="issue-breakdown">



                                                        {report.issues_by_category.visual > 0 && (



                                                            <span className="issue-badge visual" title="表格审计">



                                                                表格 {report.issues_by_category.visual}



                                                            </span>



                                                        )}



                                                        {report.issues_by_category.structure > 0 && (



                                                            <span className="issue-badge structure" title="勾稽校验">



                                                                勾稽 {report.issues_by_category.structure}



                                                            </span>



                                                        )}



                                                        {report.issues_by_category.quality > 0 && (



                                                            <span className="issue-badge quality" title="语义审计">



                                                                语义 {report.issues_by_category.quality}



                                                            </span>



                                                        )}



                                                    </div>



                                                ) : (



                                                    <span className="no-issue-badge">



                                                        <CheckCircle size={14} /> 无问题



                                                    </span>



                                                )}



                                            </div>







                                            <button



                                                className="view-btn"



                                                onClick={(e) => handleViewReport(e, report.report_id)}



                                            >



                                                <Eye size={16} />



                                                查看



                                            </button>



                                        </div>



                                    ))}



                                </div>



                            )}



                        </div>



                    ))}



                </div>



            )}



        </div>



    );



}







export default IssueList;



