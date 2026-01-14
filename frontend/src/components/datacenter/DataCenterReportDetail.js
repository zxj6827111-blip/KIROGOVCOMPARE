import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../apiClient';
import './DataCenterReportDetail.css';

const FACT_LABELS = {
  active_disclosure: '主动公开',
  application: '依申请公开',
  legal_proceeding: '行政复议/诉讼',
};

const parseCellRef = (cellRef = '') => {
  const [tableId, rowKey, colKey] = String(cellRef).split(':');
  return {
    tableId: tableId || '',
    rowKey: rowKey || '',
    colKey: colKey || '',
  };
};

function DataCenterReportDetail({ reportId, onBack }) {
  const [report, setReport] = useState(null);
  const [facts, setFacts] = useState({});
  const [qualityIssues, setQualityIssues] = useState([]);
  const [qualityFlags, setQualityFlags] = useState([]);
  const [cells, setCells] = useState([]);
  const [cellFilters, setCellFilters] = useState({ tableId: '', rowKey: '', colKey: '' });
  const [loadingCells, setLoadingCells] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchAll = async () => {
      if (!reportId) return;
      setLoading(true);
      setError('');
      try {
        const reportResp = await apiClient.get(`/reports/${reportId}`);
        const reportData = reportResp.data?.data ?? reportResp.data ?? null;
        setReport(reportData);

        const [activeDisclosure, application, legalProceeding, issuesResp, flagsResp] = await Promise.all([
          apiClient.get(`/v2/reports/${reportId}/facts/active_disclosure`),
          apiClient.get(`/v2/reports/${reportId}/facts/application`),
          apiClient.get(`/v2/reports/${reportId}/facts/legal_proceeding`),
          apiClient.get(`/v2/reports/${reportId}/quality-issues`),
          apiClient.get(`/v2/reports/${reportId}/quality-flags`),
        ]);

        setFacts({
          active_disclosure: activeDisclosure.data?.data ?? [],
          application: application.data?.data ?? [],
          legal_proceeding: legalProceeding.data?.data ?? [],
        });
        setQualityIssues(issuesResp.data?.data ?? []);
        setQualityFlags(flagsResp.data?.data ?? []);
      } catch (err) {
        console.error('Failed to load data center report detail', err);
        setError('加载报告详情失败');
      } finally {
        setLoading(false);
      }
    };

    fetchAll();
  }, [reportId]);

  const loadCells = useCallback(async () => {
    if (!reportId) return;
    setLoadingCells(true);
    try {
      const params = {};
      if (cellFilters.tableId) params.table_id = cellFilters.tableId;
      if (cellFilters.rowKey) params.row_key = cellFilters.rowKey;
      if (cellFilters.colKey) params.col_key = cellFilters.colKey;
      params.limit = 200;
      const response = await apiClient.get(`/v2/reports/${reportId}/cells`, { params });
      setCells(response.data?.data ?? []);
    } catch (err) {
      console.error('Failed to load cells', err);
    } finally {
      setLoadingCells(false);
    }
  }, [cellFilters, reportId]);

  useEffect(() => {
    loadCells();
  }, [loadCells]);

  const factSummaries = useMemo(() => {
    return Object.entries(FACT_LABELS).map(([key, label]) => {
      const rows = Array.isArray(facts[key]) ? facts[key] : [];
      return { key, label, count: rows.length, rows };
    });
  }, [facts]);

  const handleCellFilterChange = (key, value) => {
    setCellFilters((prev) => ({ ...prev, [key]: value }));
  };

  const handleApplyCellFilter = () => {
    loadCells();
  };

  const handleUseCellRef = (cellRef) => {
    const parsed = parseCellRef(cellRef);
    setCellFilters(parsed);
    setTimeout(() => loadCells(), 0);
  };

  if (loading) {
    return (
      <div className="datacenter-detail">
        <p>加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="datacenter-detail">
        <p className="error">{error}</p>
        <button type="button" className="ghost" onClick={onBack}>返回</button>
      </div>
    );
  }

  return (
    <div className="datacenter-detail">
      <div className="detail-header">
        <div>
          <button type="button" className="ghost" onClick={onBack}>返回列表</button>
          <h2>
            {report?.year || ''}年{report?.unit_name || report?.region_name || ''} 年报
          </h2>
          <p>报告 #{report?.report_id} / 激活版本 #{report?.active_version?.version_id || '—'}</p>
        </div>
        <div className="detail-meta">
          <div>
            <span className="label">Region</span>
            <strong>{report?.region_name || report?.region_id}</strong>
          </div>
          <div>
            <span className="label">版本时间</span>
            <strong>{report?.active_version?.created_at || '—'}</strong>
          </div>
          <div>
            <span className="label">最新任务</span>
            <strong>{report?.latest_job?.status || '—'}</strong>
          </div>
        </div>
      </div>

      <section className="detail-section">
        <div className="section-header">
          <h3>Facts 概览</h3>
          <p>fact_active_disclosure / fact_application / fact_legal_proceeding</p>
        </div>
        <div className="fact-grid">
          {factSummaries.map((summary) => (
            <div key={summary.key} className="fact-card">
              <h4>{summary.label}</h4>
              <p className="fact-count">{summary.count} 条</p>
              <div className="fact-table">
                {summary.rows.length === 0 && <p className="empty">暂无数据</p>}
                {summary.rows.slice(0, 5).map((row) => (
                  <div key={row.id} className="fact-row">
                    <span>{row.category || row.applicant_type || row.case_type}</span>
                    <span>{row.count ?? row.made_count ?? row.processed_count ?? row.valid_count ?? 0}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="detail-section">
        <div className="section-header">
          <h3>质量问题</h3>
          <p>quality_issues / quality_flags</p>
        </div>
        <div className="quality-grid">
          <div className="quality-panel">
            <h4>问题清单</h4>
            {qualityIssues.length === 0 && <p className="empty">暂无质量问题</p>}
            {qualityIssues.slice(0, 10).map((issue) => (
              <div key={issue.id} className="quality-issue">
                <div>
                  <strong>{issue.rule_code}</strong>
                  <span className={`severity ${issue.severity}`}>{issue.severity}</span>
                </div>
                <p>{issue.description}</p>
                {issue.cell_ref && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => handleUseCellRef(issue.cell_ref)}
                  >
                    证据 {issue.cell_ref}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="quality-panel">
            <h4>标记汇总</h4>
            {qualityFlags.length === 0 && <p className="empty">暂无标记</p>}
            {qualityFlags.map((flag, idx) => (
              <div key={`${flag.rule_code}-${idx}`} className="flag-row">
                <span>{flag.rule_code}</span>
                <span>{flag.severity}</span>
                <strong>{flag.count}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="detail-section">
        <div className="section-header">
          <h3>证据下钻</h3>
          <p>cells（支持按表/行/列过滤）</p>
        </div>
        <div className="cell-filters">
          <div className="filter-group">
            <label>表 ID</label>
            <input
              type="text"
              value={cellFilters.tableId}
              onChange={(e) => handleCellFilterChange('tableId', e.target.value)}
              placeholder="table_2"
            />
          </div>
          <div className="filter-group">
            <label>行 Key</label>
            <input
              type="text"
              value={cellFilters.rowKey}
              onChange={(e) => handleCellFilterChange('rowKey', e.target.value)}
              placeholder="row_key"
            />
          </div>
          <div className="filter-group">
            <label>列 Key</label>
            <input
              type="text"
              value={cellFilters.colKey}
              onChange={(e) => handleCellFilterChange('colKey', e.target.value)}
              placeholder="col_key"
            />
          </div>
          <button type="button" className="primary" onClick={handleApplyCellFilter}>
            筛选
          </button>
        </div>
        <div className="cells-table">
          {loadingCells && <p>加载 cells...</p>}
          {!loadingCells && cells.length === 0 && <p className="empty">暂无匹配 cells</p>}
          {!loadingCells && cells.length > 0 && (
            <div className="cells-grid">
              <div className="cells-header">
                <span>cell_ref</span>
                <span>table</span>
                <span>row</span>
                <span>col</span>
                <span>value</span>
              </div>
              {cells.map((cell) => (
                <div key={cell.id} className="cells-row">
                  <span>{cell.cell_ref}</span>
                  <span>{cell.table_id}</span>
                  <span>{cell.row_key}</span>
                  <span>{cell.col_key}</span>
                  <span>{cell.value_raw ?? cell.value_num ?? cell.normalized_value ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default DataCenterReportDetail;
