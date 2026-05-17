import React, { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../apiClient';
import { getRowColFromPath } from '../utils/tableRowColMapping';
import './VisionReviewPanel.css';

const TABLES = [
  { id: 'table_2', title: '表二', subtitle: '主动公开统计' },
  { id: 'table_3', title: '表三', subtitle: '申请处理统计' },
  { id: 'table_4', title: '表四', subtitle: '复议诉讼统计' },
];

const STATUS_LABELS = {
  queued: '等待源表复核',
  running: 'OCR 复核中',
  completed: '已完成复核',
  source_unavailable: '源表不可用',
  channel_unavailable: '视觉通道不可用',
  failed: '复核失败',
};

const getErrorMessage = (err, fallback = '请求失败') =>
  err?.response?.data?.error || err?.message || fallback;

const getVisionReviewErrorMessage = (err, fallback) => {
  const code = err?.response?.data?.error;
  const retryAfter = Number(err?.response?.data?.retry_after);
  if (code === 'rate_limited') {
    return Number.isFinite(retryAfter) && retryAfter > 0
      ? `请求过于频繁，请 ${retryAfter} 秒后再试`
      : '请求过于频繁，请稍后再试';
  }
  return getErrorMessage(err, fallback);
};

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
  if (value === null || value === undefined || value === '') return '空值';
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

const getReviewTone = (review, pendingCorrectionsCount, confirmedCorrectionsCount) => {
  const conclusion = review?.conclusion || review?.comparison?.conclusion;
  if (pendingCorrectionsCount > 0) return 'review';
  if (confirmedCorrectionsCount > 0 && conclusion !== 'source_table_anomaly') return 'success';
  if (conclusion === 'source_table_matches_parse') return 'success';
  return 'review';
};

const getReviewStatusLabel = (review, pendingCorrectionsCount, confirmedCorrectionsCount) => {
  if (pendingCorrectionsCount > 0) return '待人工复核';
  if (confirmedCorrectionsCount > 0) return '已确认修正';
  if (!review) return '未触发复核';
  return STATUS_LABELS[review.status] || '未完成复核';
};

const getReviewConclusionLabel = (review, pendingCorrectionsCount) => {
  const conclusion = review?.conclusion || review?.comparison?.conclusion;
  if (!review) return '当前未触发源表 / OCR 复核';
  if (pendingCorrectionsCount > 0) return '已生成待确认修正';
  switch (conclusion) {
    case 'source_table_anomaly':
      return '源表异常';
    case 'parse_mapping_anomaly':
      return '疑似识别异常';
    case 'source_table_matches_parse':
      return '源表复核一致';
    case 'inconclusive':
      return '待人工复核';
    default:
      return '等待 OCR 结论';
  }
};

const getReviewHint = (review, pendingCorrectionsCount) => {
  const conclusion = review?.conclusion || review?.comparison?.conclusion;
  if (!review) {
    return '当前表格未进入 OCR / 视觉复核流程。该页仅展示源表、OCR 与解析复核信息，不计入勾稽问题，也不计入数据质量风险。';
  }
  if (review.status === 'queued') {
    return '勾稽校验已触发源表复核，当前正在等待 OCR 任务执行。';
  }
  if (review.status === 'running') {
    return '系统正在用 OCR 对照原始表格截图复核，不会改变勾稽页 problemCount。';
  }
  if (conclusion === 'source_table_anomaly') {
    return 'OCR 与当前解析一致，但相关勾稽仍失败，说明更像是源表原始填报或源表结构异常。';
  }
  if (conclusion === 'parse_mapping_anomaly') {
    return pendingCorrectionsCount > 0
      ? 'OCR 与当前解析存在差异，页面已生成待确认修正项，需人工确认是否采用修正值。'
      : 'OCR 与当前解析存在差异，正在等待待确认修正项写入。';
  }
  if (conclusion === 'source_table_matches_parse') {
    return 'OCR 与当前解析一致，本页仅保留复核结果说明，不影响勾稽与数据质量统计。';
  }
  if (conclusion === 'inconclusive') {
    return '截图不可用、OCR 不可读或缺少可比字段，仍需人工回看源表。';
  }
  if (review.status === 'source_unavailable') {
    return '当前无法从源文件定位到对应表格截图，需要人工检查原始文件或截图链路。';
  }
  if (review.status === 'channel_unavailable') {
    return '视觉复核通道当前不可用，本页仅保留状态说明。';
  }
  if (review.status === 'failed') {
    return '本次 OCR / 视觉复核执行失败，可在本页重新触发。';
  }
  return 'OCR / 视觉复核与勾稽异常、数据质量风险独立展示。';
};

const buildSummary = (cards, confirmedCorrectionsCount) => {
  const pendingReviewCount = cards.reduce((acc, card) => {
    const pendingCount =
      card.pendingCorrections.length +
      (card.reviewPending ? 1 : 0) +
      (card.reviewInconclusive ? 1 : 0) +
      (card.reviewParseMismatch && card.pendingCorrections.length === 0 ? 1 : 0);
    return acc + pendingCount;
  }, 0);

  return {
    pending: pendingReviewCount,
    confirmed: cards.filter((card) => card.reviewMatchesParse).length,
    corrected: confirmedCorrectionsCount,
    source: cards.filter((card) => card.reviewSourceAnomaly).length,
  };
};

const VisionReviewPanel = ({ reportId, versionId, onDataChange, onCorrectionsResolved }) => {
  const [reviews, setReviews] = useState([]);
  const [corrections, setCorrections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [runningTableId, setRunningTableId] = useState('');
  const [resolving, setResolving] = useState('');
  const [error, setError] = useState('');

  const applyReviewData = (data = {}) => {
    const nextReviews = data.reviews || [];
    const nextCorrections = data.corrections || [];
    setReviews(nextReviews);
    setCorrections(nextCorrections);
    onDataChange?.({ reviews: nextReviews, corrections: nextCorrections });
  };

  const fetchReviews = async () => {
    if (!reportId || !versionId) return;
    setLoading(true);
    setError('');
    try {
      const response = await apiClient.get(`/reports/${reportId}/vision-review`, {
        params: { version_id: versionId },
      });
      applyReviewData(response.data?.data || {});
    } catch (err) {
      setError(getVisionReviewErrorMessage(err, 'OCR / 视觉复核结果加载失败'));
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
      setError(getVisionReviewErrorMessage(err, 'OCR / 视觉复核触发失败'));
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
      await onCorrectionsResolved?.({ action, correctionIds });
    } catch (err) {
      setError(getVisionReviewErrorMessage(err, 'OCR 修正处理失败'));
    } finally {
      setResolving('');
    }
  };

  const latestByTable = useMemo(() => normalizeReviews(reviews), [reviews]);

  const {
    cards,
    summary,
  } = useMemo(() => {
    const pendingCorrections = corrections.filter((item) => item.status === 'pending');
    const confirmedCorrections = corrections.filter((item) => item.status === 'confirmed');
    const pendingByTable = pendingCorrections.reduce((acc, item) => {
      const key = item.tableId || 'unknown';
      acc[key] = acc[key] || [];
      acc[key].push(item);
      return acc;
    }, {});
    const confirmedByTable = confirmedCorrections.reduce((acc, item) => {
      const key = item.tableId || 'unknown';
      acc[key] = acc[key] || [];
      acc[key].push(item);
      return acc;
    }, {});

    const nextCards = TABLES.map((table) => {
      const review = latestByTable.get(table.id);
      const comparison = review?.comparison || {};
      const conclusion = review?.conclusion || comparison.conclusion;
      const differences = comparison.differences || [];
      const unreadableCells = comparison.unreadableCells || [];
      const tablePendingCorrections = pendingByTable[table.id] || [];
      const tableConfirmedCorrections = confirmedByTable[table.id] || [];
      const reviewPending = review?.status === 'queued' || review?.status === 'running';
      const reviewBlocked =
        review?.status === 'source_unavailable' ||
        review?.status === 'channel_unavailable' ||
        review?.status === 'failed';
      const reviewInconclusive = conclusion === 'inconclusive' || unreadableCells.length > 0;
      const reviewSourceAnomaly = conclusion === 'source_table_anomaly';
      const reviewParseMismatch = conclusion === 'parse_mapping_anomaly';
      const reviewMatchesParse = conclusion === 'source_table_matches_parse';
      return {
        table,
        review,
        comparison,
        conclusion,
        differences,
        unreadableCells,
        pendingCorrections: tablePendingCorrections,
        confirmedCorrections: tableConfirmedCorrections,
        reviewPending,
        reviewBlocked,
        reviewInconclusive,
        reviewSourceAnomaly,
        reviewParseMismatch,
        reviewMatchesParse,
      };
    });

    return {
      cards: nextCards,
      summary: buildSummary(nextCards, confirmedCorrections.length),
    };
  }, [corrections, latestByTable]);

  return (
    <div className="vision-review-panel">
      <div className="vision-review-header">
        <div className="vision-review-header-copy">
          <h3>OCR / 视觉复核</h3>
          <p>统一展示源表截图、OCR 识别、解析差异和人工修正状态，不与勾稽异常或数据质量风险混用。</p>
        </div>
        <button className="vision-review-refresh" onClick={fetchReviews} disabled={loading}>
          {loading ? '刷新中' : '刷新复核结果'}
        </button>
      </div>

      <div className="vision-review-scope-note">
        <span className="vision-review-scope-pill">不计入勾稽问题</span>
        <span className="vision-review-scope-pill">不计入数据质量风险</span>
        <span className="vision-review-scope-text">仅作为源表 / OCR / 解析复核说明，保持与 Phase 3A、Phase 2C 统计和定位链路隔离。</span>
      </div>

      <div className="vision-review-summary" aria-label="OCR / 视觉复核摘要">
        <div className="vision-review-summary-card">
          <span className="vision-review-summary-label">待复核</span>
          <strong>{summary.pending}</strong>
          <small>含待跑 OCR、不可判定和待确认修正</small>
        </div>
        <div className="vision-review-summary-card">
          <span className="vision-review-summary-label">已确认一致</span>
          <strong>{summary.confirmed}</strong>
          <small>OCR 与当前解析一致</small>
        </div>
        <div className="vision-review-summary-card vision-review-summary-card--success">
          <span className="vision-review-summary-label">已确认修正</span>
          <strong>{summary.corrected}</strong>
          <small>已采用修正值</small>
        </div>
        <div className="vision-review-summary-card">
          <span className="vision-review-summary-label">源表异常</span>
          <strong>{summary.source}</strong>
          <small>更像源表原始问题</small>
        </div>
      </div>

      {error && <div className="vision-review-error">{error}</div>}

      <div className="vision-review-grid">
        {cards.map((card) => {
          const {
            table,
            review,
            differences,
            unreadableCells,
            pendingCorrections,
            confirmedCorrections,
            reviewPending,
            reviewBlocked,
            reviewInconclusive,
            reviewSourceAnomaly,
            reviewParseMismatch,
            reviewMatchesParse,
          } = card;
          const tone = getReviewTone(review, pendingCorrections.length, confirmedCorrections.length);
          const isRunning = runningTableId === table.id || review?.status === 'running';
          const statusLabel = getReviewStatusLabel(review, pendingCorrections.length, confirmedCorrections.length);
          const conclusionLabel = getReviewConclusionLabel(review, pendingCorrections.length);
          const hint = getReviewHint(review, pendingCorrections.length);
          const showPendingSection =
            reviewPending ||
            reviewInconclusive ||
            (reviewParseMismatch && pendingCorrections.length === 0);
          const showRiskSection = reviewParseMismatch || differences.length > 0 || pendingCorrections.length > 0;
          const showSourceSection = reviewSourceAnomaly || reviewBlocked;
          const showConfirmedSection = reviewMatchesParse || confirmedCorrections.length > 0;
          const isEmptyCard =
            !showPendingSection &&
            !showRiskSection &&
            !showSourceSection &&
            !showConfirmedSection &&
            !review?.errorMessage;

          return (
            <div key={table.id} className={`vision-review-card vision-review-card--${tone}`}>
              <div className="vision-review-card-head">
                <div>
                  <h4>{table.title}</h4>
                  <p>{table.subtitle}</p>
                </div>
                <span className="vision-review-status">{statusLabel}</span>
              </div>

              <div className="vision-review-conclusion">{conclusionLabel}</div>

              <div className="vision-review-meta">
                <span>模型：{review?.model || '未运行'}</span>
                <span>通道：{review?.apiMode || '-'}</span>
                <span>时间：{formatDateTime(review?.finishedAt || review?.updatedAt)}</span>
              </div>

              {hint && <div className="vision-review-note">{hint}</div>}
              {review?.errorMessage && <div className="vision-review-note vision-review-note--error">{review.errorMessage}</div>}

              {showPendingSection && (
                <div className="vision-review-section">
                  <div className="vision-review-section-title">OCR 待复核</div>
                  <div className="vision-review-list">
                    {reviewPending && (
                      <div className="vision-review-list-item">
                        <span className="vision-review-list-tag">待人工复核</span>
                        <span>{review?.status === 'running' ? '正在执行 OCR 复核' : '已进入待执行队列'}</span>
                      </div>
                    )}
                    {reviewInconclusive && (
                      <div className="vision-review-list-item">
                        <span className="vision-review-list-tag">待人工复核</span>
                        <span>存在不可读单元格、截图受阻或缺少可比字段</span>
                      </div>
                    )}
                    {reviewParseMismatch && pendingCorrections.length === 0 && (
                      <div className="vision-review-list-item">
                        <span className="vision-review-list-tag">疑似识别异常</span>
                        <span>OCR 与当前解析存在差异，待生成修正项</span>
                      </div>
                    )}
                    {unreadableCells.slice(0, 4).map((path) => (
                      <div key={`${table.id}-unreadable-${path}`} className="vision-review-list-item">
                        <span className="vision-review-list-tag">不可读</span>
                        <span>{describePath(path)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {showRiskSection && (
                <div className="vision-review-section">
                  <div className="vision-review-section-title">表格解析风险</div>
                  <div className="vision-review-list">
                    {differences.slice(0, 8).map((diff, index) => (
                      <div key={`${diff.path}-${index}`} className="vision-review-list-item vision-review-list-item--two-column">
                        <span>{describePath(diff.path)}</span>
                        <strong>{formatValue(diff.parsedValue)} / OCR {formatValue(diff.ocrValue)}</strong>
                      </div>
                    ))}
                    {pendingCorrections.slice(0, 8).map((correction) => (
                      <div key={correction.id} className="vision-review-list-item vision-review-list-item--two-column">
                        <span>{describePath(correction.fieldPath)}</span>
                        <strong>{formatValue(correction.parsedValue)} {'->'} OCR {formatValue(correction.ocrValue)}</strong>
                      </div>
                    ))}
                  </div>
                  {pendingCorrections.length > 0 && (
                    <div className="vision-review-correction-actions">
                      <button
                        className="vision-review-confirm"
                        onClick={() => handleResolve(pendingCorrections.map((item) => item.id), 'confirm')}
                        disabled={Boolean(resolving)}
                      >
                        确认采用修正值
                      </button>
                      <button
                        className="vision-review-reject"
                        onClick={() => handleResolve(pendingCorrections.map((item) => item.id), 'reject')}
                        disabled={Boolean(resolving)}
                      >
                        驳回修正
                      </button>
                    </div>
                  )}
                </div>
              )}

              {showSourceSection && (
                <div className="vision-review-section">
                  <div className="vision-review-section-title">源表异常</div>
                  <div className="vision-review-list">
                    {reviewSourceAnomaly && (
                      <div className="vision-review-list-item">
                        <span className="vision-review-list-tag">source_anomaly</span>
                        <span>OCR 与解析一致，但勾稽仍失败，更像是源表原始结构或填报异常</span>
                      </div>
                    )}
                    {reviewBlocked && (
                      <div className="vision-review-list-item">
                        <span className="vision-review-list-tag">源表复核受阻</span>
                        <span>{STATUS_LABELS[review?.status] || '复核失败'}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {showConfirmedSection && (
                <div className="vision-review-section vision-review-section--success">
                  <div className="vision-review-section-title">已确认修正</div>
                  <div className="vision-review-list">
                    {reviewMatchesParse && (
                      <div className="vision-review-list-item vision-review-list-item--success">
                        <span className="vision-review-list-tag vision-review-list-tag--success">人工确认</span>
                        <span>源表 OCR 与当前解析一致，可视为已完成源表复核</span>
                      </div>
                    )}
                    {confirmedCorrections.slice(0, 8).map((correction) => (
                      <div key={correction.id} className="vision-review-list-item vision-review-list-item--two-column vision-review-list-item--success">
                        <span>{describePath(correction.fieldPath)}</span>
                        <strong>{formatValue(correction.ocrValue)}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isEmptyCard && (
                <div className="vision-review-empty">
                  当前表格未触发 OCR / 视觉复核，后续如出现源表异常、识别差异或人工修正项，会在本页独立展示。
                </div>
              )}

              <button
                className="vision-review-run"
                onClick={() => handleRun(table.id)}
                disabled={isRunning || loading}
              >
                {isRunning ? 'OCR 复核中' : '重新源表复核'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VisionReviewPanel;
