import React, { useEffect, useState } from 'react';
import { apiClient } from '../apiClient';
import { getRowColFromPath } from '../utils/tableRowColMapping';
import './VisionReviewPanel.css';

const TABLES = [
  { id: 'table_2', title: '表二', subtitle: '主动公开统计' },
  { id: 'table_3', title: '表三', subtitle: '申请处理统计' },
  { id: 'table_4', title: '表四', subtitle: '复议诉讼统计' },
];

const STATUS_LABELS = {
  queued: '等待复核',
  running: '复核中',
  completed: '已复核',
  source_unavailable: '无法截图',
  channel_unavailable: '识图通道不可用',
  failed: '复核失败',
};

const CONCLUSION_LABELS = {
  source_table_anomaly: '源表原始数据异常',
  parse_mapping_anomaly: '疑似解析/拆格/映射异常',
  source_table_matches_parse: 'OCR 与解析一致',
  inconclusive: '视觉复核不可判断',
};

const getErrorMessage = (err, fallback = '请求失败') =>
  err?.response?.data?.error || err?.message || fallback;

const normalizeReviews = (reviews = []) => {
  const latestByTable = new Map();
  reviews.forEach((review) => {
    if (!review?.tableId) return;
    const current = latestByTable.get(review.tableId);
    if (!current || new Date(review.updatedAt || 0) > new Date(current.updatedAt || 0)) {
      latestByTable.set(review.tableId, review);
    }
  });
  return latestByTable;
};

const formatDateTime = (value) => {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '暂无';
  return date.toLocaleString();
};

const formatValue = (value) => {
  if (value === null || value === undefined || value === '') return '空';
  return String(value);
};

const describePath = (path) => {
  const normalized = String(path || '')
    .replace(/^activeDisclosureData\./, 'activeDisclosureData.')
    .replace(/^tableData\./, 'tableData.')
    .replace(/^reviewLitigationData\./, 'reviewLitigationData.');
  const info = getRowColFromPath(normalized);
  if (!info) return normalized || '未知单元格';
  return [info.table, info.rowLabel || info.name, info.colLabel].filter(Boolean).join(' / ');
};

const getReviewTone = (review) => {
  const conclusion = review?.conclusion || review?.comparison?.conclusion;
  if (conclusion === 'source_table_anomaly') return 'source';
  if (conclusion === 'parse_mapping_anomaly') return 'parse';
  if (conclusion === 'source_table_matches_parse') return 'ok';
  if (review?.status === 'channel_unavailable' || review?.status === 'source_unavailable') return 'blocked';
  return 'unknown';
};

const VisionReviewPanel = ({ reportId, versionId, onCorrectionsChange }) => {
  const [reviews, setReviews] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [runningTableId, setRunningTableId] = useState('');
  const [resolving, setResolving] = useState('');
  const [error, setError] = useState('');

  const fetchReviews = async () => {
    if (!reportId || !versionId) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/reports/${reportId}/vision-review`, {
        params: { version_id: versionId },
      });
      const data = response.data?.data || {};
      setReviews(data.reviews || []);
      setCorrections(data.corrections || []);
      onCorrectionsChange?.(data.corrections || []);
    } catch (err) {
      setError(getErrorMessage(err, '视觉复核结果加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReviews();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportId, versionId]);

  const handleRun = async (tableId) => {
    if (!reportId || !versionId) return;
    setRunningTableId(tableId);
    setError('');
    try {
      await apiClient.post(`/reports/${reportId}/vision-review/run`, {
        version_id: versionId,
        table_ids: [tableId],
      });
      await fetchReviews();
    } catch (err) {
      setError(getErrorMessage(err, '视觉复核触发失败'));
    } finally {
      setRunningTableId('');
    }
  };

  const handleResolve = async (correctionIds, action) => {
    if (!reportId || !versionId || !correctionIds?.length) return;
    setResolving(`${action}:${correctionIds.join(',')}`);
    setError('');
    try {
      await apiClient.post(`/reports/${reportId}/vision-review/corrections/resolve`, {
        version_id: versionId,
        correction_ids: correctionIds,
        action,
      });
      await fetchReviews();
    } catch (err) {
      setError(getErrorMessage(err, 'OCR修正处理失败'));
    } finally {
      setResolving('');
    }
  };

  const latestByTable = normalizeReviews(reviews);
  const pendingCorrections = corrections.filter((item) => item.status === 'pending');
  const correctionsByTable = pendingCorrections.reduce((acc, item) => {
    const key = item.tableId || 'unknown';
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div className="vision-review-panel">
      <div className="vision-review-header">
        <div>
          <h3>视觉复核</h3>
          <p>只做诊断，不自动修改入库数据；用于区分源表数据异常和解析映射异常。</p>
        </div>
        <button className="vision-review-refresh" onClick={fetchReviews} disabled={loading}>
          {loading ? '刷新中' : '刷新'}
        </button>
      </div>

      {error && <div className="vision-review-error">{error}</div>}

      <div className="vision-review-grid">
        {TABLES.map((table) => {
          const review = latestByTable.get(table.id);
          const comparison = review?.comparison || {};
          const conclusion = review?.conclusion || comparison.conclusion;
          const differences = comparison.differences || [];
          const unreadableCells = comparison.unreadableCells || [];
          const tableCorrections = correctionsByTable[table.id] || [];
          const tone = getReviewTone(review);
          const isRunning = runningTableId === table.id || review?.status === 'running';

          return (
            <div key={table.id} className={`vision-review-card vision-review-card--${tone}`}>
              <div className="vision-review-card-head">
                <div>
                  <h4>{table.title}</h4>
                  <p>{table.subtitle}</p>
                </div>
                <span className="vision-review-status">
                  {STATUS_LABELS[review?.status] || '未复核'}
                </span>
              </div>

              <div className="vision-review-conclusion">
                {CONCLUSION_LABELS[conclusion] || '暂无结论'}
              </div>

              <div className="vision-review-meta">
                <span>模型：{review?.model || '未运行'}</span>
                <span>通道：{review?.apiMode || '-'}</span>
                <span>时间：{formatDateTime(review?.finishedAt || review?.updatedAt)}</span>
              </div>

              {review?.errorMessage && (
                <div className="vision-review-note">{review.errorMessage}</div>
              )}

              {differences.length > 0 && (
                <div className="vision-review-diffs">
                  <div className="vision-review-section-title">差异单元格</div>
                  {differences.slice(0, 8).map((diff, index) => (
                    <div key={`${diff.path}-${index}`} className="vision-review-diff-row">
                      <span>{describePath(diff.path)}</span>
                      <strong>{formatValue(diff.parsedValue)} / OCR {formatValue(diff.ocrValue)}</strong>
                    </div>
                  ))}
                  {differences.length > 8 && (
                    <div className="vision-review-more">还有 {differences.length - 8} 个差异</div>
                  )}
                </div>
              )}

              {unreadableCells.length > 0 && (
                <div className="vision-review-unreadable">
                  <div className="vision-review-section-title">不可读单元格</div>
                  {unreadableCells.slice(0, 6).join('、')}
                </div>
              )}

              {tableCorrections.length > 0 && (
                <div className="vision-review-corrections">
                  <div className="vision-review-section-title">OCR修正待核对</div>
                  {tableCorrections.slice(0, 8).map((correction) => (
                    <div key={correction.id} className="vision-review-correction-row">
                      <span>{describePath(correction.fieldPath)}</span>
                      <strong>{formatValue(correction.parsedValue)} → OCR {formatValue(correction.ocrValue)}</strong>
                    </div>
                  ))}
                  {tableCorrections.length > 8 && (
                    <div className="vision-review-more">还有 {tableCorrections.length - 8} 个待核对修正</div>
                  )}
                  <div className="vision-review-correction-actions">
                    <button
                      className="vision-review-confirm"
                      onClick={() => handleResolve(tableCorrections.map((item) => item.id), 'confirm')}
                      disabled={Boolean(resolving)}
                    >
                      确认OCR修正
                    </button>
                    <button
                      className="vision-review-reject"
                      onClick={() => handleResolve(tableCorrections.map((item) => item.id), 'reject')}
                      disabled={Boolean(resolving)}
                    >
                      驳回
                    </button>
                  </div>
                </div>
              )}

              <button
                className="vision-review-run"
                onClick={() => handleRun(table.id)}
                disabled={isRunning || loading}
              >
                {isRunning ? '复核中' : '重新复核'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VisionReviewPanel;
