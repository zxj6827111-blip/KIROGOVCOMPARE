import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Plus, Trash2, Link2, CheckSquare, Square } from 'lucide-react';
import { apiClient } from '../../apiClient';
import { useToast } from '../common/ToastProvider';
import PageHeader from '../common/PageHeader';
import Button from '../common/Button';
import RegionCascader from '../RegionCascader';
import './Filing.css';

const STATUS_LABELS = {
  draft: '草稿',
  submitted: '校验中',
  checks_failed: '勾稽未通过',
  effective: '已生效',
};

const BATCH_STATUS_LABELS = {
  ready: '可导入',
  needs_region: '待选单位',
  failed: '失败',
  applied: '已写入',
  skipped: '已跳过',
};

function summarizeStats(stats) {
  if (!stats) return '';
  const parts = [];
  if (stats.table2Filled) parts.push(`表二 ${stats.table2Filled}`);
  if (stats.table3Filled) parts.push(`表三 ${stats.table3Filled}`);
  if (stats.table4Filled) parts.push(`表四 ${stats.table4Filled}`);
  if (stats.text1Chars) parts.push(`正文 ${stats.text1Chars}字`);
  return parts.join(' · ');
}

export default function FilingList({ onOpen, onCreate }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [status, setStatus] = useState('');
  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState('');
  const [creating, setCreating] = useState(false);

  const [batchUrls, setBatchUrls] = useState('');
  const [batchYear, setBatchYear] = useState(String(new Date().getFullYear() - 1));
  const [batchRows, setBatchRows] = useState([]);
  const [batchSummary, setBatchSummary] = useState(null);
  const [batchPreviewing, setBatchPreviewing] = useState(false);
  const [batchApplying, setBatchApplying] = useState(false);

  const loadRegions = useCallback(async () => {
    try {
      const res = await apiClient.get('/regions');
      const list = res.data?.data || res.data?.regions || res.data?.items || res.data || [];
      setRegions(Array.isArray(list) ? list : []);
    } catch (err) {
      console.warn('load regions failed', err);
      toast.error('加载地区失败', '请确认已登录且城市管理中有地区数据');
    }
  }, [toast]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (year) params.year = Number(year);
      if (status) params.status = status;
      if (regionId) params.regionId = Number(regionId);
      const res = await apiClient.get('/filings', { params });
      setItems(res.data?.items || []);
    } catch (err) {
      toast.error('加载填报列表失败', err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [year, status, regionId, toast]);

  useEffect(() => {
    loadRegions();
  }, [loadRegions]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedRegionName = (() => {
    if (!regionId) return '';
    const hit = regions.find((r) => String(r.id) === String(regionId));
    return hit?.name || '';
  })();

  const selectedBatchCount = useMemo(
    () => batchRows.filter((r) => r.selected && (r.status === 'ready' || r.status === 'needs_region') && r.regionId && r.year).length,
    [batchRows]
  );

  const handleCreate = async () => {
    if (!regionId || !year) {
      toast.warning('请选择单位与年份', '请通过省 / 市 / 区县 / 部门逐级选择');
      return;
    }
    setCreating(true);
    try {
      const res = await apiClient.post('/filings', {
        regionId: Number(regionId),
        year: Number(year),
      });
      const filing = res.data?.filing;
      toast.success(res.data?.created ? '已创建填报草稿' : '已打开已有填报');
      if (filing?.id) {
        onCreate?.(filing);
        onOpen?.(filing.id);
      }
      await load();
    } catch (err) {
      toast.error('创建失败', err.response?.data?.error || err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (item) => {
    if (!item?.id) return;
    if (item.status === 'effective') {
      toast.warning('无法删除', '已生效填报不可删除，请先撤回为草稿');
      return;
    }
    const name = item.region_name || item.unit_name || item.region_id;
    if (!window.confirm(`确定删除「${name} · ${item.year}」的填报草稿吗？此操作不可恢复。`)) {
      return;
    }
    try {
      await apiClient.delete(`/filings/${item.id}`);
      toast.success('已删除填报草稿');
      await load();
    } catch (err) {
      toast.error('删除失败', err.response?.data?.error || err.message);
    }
  };

  const handleBatchPreview = async () => {
    if (!String(batchUrls || '').trim()) {
      toast.warning('请粘贴年报链接', '一行一条 HTML 年报正文 URL（不要列表页/纯 PDF）');
      return;
    }
    setBatchPreviewing(true);
    try {
      const res = await apiClient.post('/filings/batch-import-from-url/preview', {
        urls: batchUrls,
        defaultYear: batchYear ? Number(batchYear) : undefined,
      });
      const rows = (res.data?.items || []).map((row) => ({
        ...row,
        selected: row.selected !== false && (row.status === 'ready' || row.status === 'needs_region'),
        regionId: row.regionId != null ? String(row.regionId) : '',
        year: row.year != null ? String(row.year) : batchYear,
      }));
      setBatchRows(rows);
      setBatchSummary(res.data?.summary || null);
      const s = res.data?.summary;
      if (s) {
        toast.success(
          '预检完成（未写入）',
          `共 ${s.total} 条：可导入 ${s.ready}，待选单位 ${s.needs_region}，失败 ${s.failed}`
        );
      } else {
        toast.success('预检完成（未写入）');
      }
    } catch (err) {
      toast.error('批量预检失败', err.response?.data?.error || err.message);
    } finally {
      setBatchPreviewing(false);
    }
  };

  const patchBatchRow = (id, patch) => {
    setBatchRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const toggleSelectAllReady = () => {
    const selectable = batchRows.filter(
      (r) => r.status === 'ready' || (r.status === 'needs_region' && r.regionId)
    );
    const allOn = selectable.length > 0 && selectable.every((r) => r.selected);
    setBatchRows((prev) =>
      prev.map((r) => {
        if (r.status === 'failed') return r;
        if (r.status === 'needs_region' && !r.regionId) return { ...r, selected: false };
        if (r.status === 'ready' || r.status === 'needs_region') {
          return { ...r, selected: !allOn };
        }
        return r;
      })
    );
  };

  const handleBatchApply = async () => {
    const toApply = batchRows.filter(
      (r) => r.selected && r.regionId && r.year && (r.status === 'ready' || r.status === 'needs_region')
    );
    if (!toApply.length) {
      toast.warning('没有可确认的条目', '请勾选已匹配单位的行（失败行不可导入）');
      return;
    }
    if (
      !window.confirm(
        `将把 ${toApply.length} 条规则抽表结果写入填报草稿（不自动提交生效、不走 AI）。是否继续？`
      )
    ) {
      return;
    }
    setBatchApplying(true);
    try {
      const res = await apiClient.post('/filings/batch-import-from-url/apply', {
        items: toApply.map((r) => ({
          url: r.url,
          regionId: Number(r.regionId),
          year: Number(r.year),
          unitName: r.unitName || undefined,
          form_json: r.form_json,
        })),
      });
      const resultItems = res.data?.items || [];
      setBatchRows((prev) =>
        prev.map((row) => {
          const hit = resultItems.find((x) => x.url === row.url);
          if (!hit) return row;
          return {
            ...row,
            status: hit.status,
            message: hit.message,
            filingId: hit.filingId,
            selected: hit.status === 'applied' ? false : row.selected,
            form_json: hit.status === 'applied' ? undefined : row.form_json,
          };
        })
      );
      const s = res.data?.summary;
      toast.success(
        '批量写入完成',
        s ? `成功 ${s.applied}，失败 ${s.failed}，跳过 ${s.skipped}` : ''
      );
      await load();
    } catch (err) {
      toast.error('批量写入失败', err.response?.data?.error || err.message);
    } finally {
      setBatchApplying(false);
    }
  };

  return (
    <div className="filing-page kc-page">
      <PageHeader
        eyebrow="年报工作台"
        title="年报填报"
        subtitle="按国办公开办函〔2021〕30号格式在线填报；勾稽通过后正式生效。单位数据与城市管理同源。"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<RefreshCw size={16} className={loading ? 'spin' : ''} />}
              onClick={load}
              disabled={loading}
            >
              刷新
            </Button>
            <Button
              variant="primary"
              icon={<Plus size={16} />}
              onClick={handleCreate}
              disabled={creating}
            >
              {creating ? '创建中…' : '新建/打开填报'}
            </Button>
          </>
        }
      />

      <div className="filing-toolbar kc-toolbar">
        <label className="filing-field">
          <span>年份</span>
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            min={2000}
            max={2100}
          />
        </label>
        <label className="filing-field">
          <span>状态</span>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">全部</option>
            <option value="draft">草稿</option>
            <option value="checks_failed">勾稽未通过</option>
            <option value="effective">已生效</option>
            <option value="submitted">校验中</option>
          </select>
        </label>
        <div className="filing-field filing-field--region">
          <span>填报单位（与城市管理同源：省 → 市 → 区/县 → 部门）</span>
          <RegionCascader
            regions={regions}
            value={regionId}
            onChange={(id) => setRegionId(id ? String(id) : '')}
            emptyLabelMode="strict"
          />
          {selectedRegionName ? (
            <div className="filing-selected-hint">
              当前选择：{selectedRegionName}
              <span className="filing-selected-hint--muted">（列表含本级及全部下级单位）</span>
            </div>
          ) : (
            <div className="filing-selected-hint filing-selected-hint--muted">
              数据来自「系统管理 → 城市管理」地区树；选到部门后点击「新建/打开填报」
            </div>
          )}
        </div>
      </div>

      <div className="filing-batch-panel">
        <div className="filing-batch-panel__head">
          <div className="filing-batch-panel__title">
            <Link2 size={16} />
            <span>批量网址导入（规则抽表 → 填报草稿，不经 AI）</span>
          </div>
          <div className="filing-batch-panel__actions">
            <label className="filing-field filing-field--inline">
              <span>默认年份</span>
              <input
                type="number"
                value={batchYear}
                onChange={(e) => setBatchYear(e.target.value)}
                min={2000}
                max={2100}
              />
            </label>
            <Button
              variant="secondary"
              onClick={handleBatchPreview}
              disabled={batchPreviewing || batchApplying}
            >
              {batchPreviewing ? '预检中…' : '1. 预检（不写入）'}
            </Button>
            <Button
              variant="primary"
              onClick={handleBatchApply}
              disabled={batchApplying || batchPreviewing || selectedBatchCount === 0}
            >
              {batchApplying ? '写入中…' : `2. 确认导入草稿 (${selectedBatchCount})`}
            </Button>
          </div>
        </div>
        <textarea
          className="filing-batch-textarea"
          rows={4}
          value={batchUrls}
          onChange={(e) => setBatchUrls(e.target.value)}
          placeholder={'一行一条年报正文 HTML 链接，例如：\nhttps://www.xuhui.gov.cn/xxgk/portal/article/detail?id=...\nhttps://xxgk.fengxian.gov.cn/art/info/...'}
          disabled={batchPreviewing || batchApplying}
        />
        <div className="filing-import-hint">
          仅支持含六章表格的 HTML 正文页（含奉贤 SPA）。列表页 / 纯 PDF 会标失败。预检自动匹配城市管理中的单位；匹配不上可手工选区后勾选确认。写入草稿后请打开核对，再单独提交生效。
          {batchSummary
            ? ` 最近预检：共 ${batchSummary.total} · 可导入 ${batchSummary.ready} · 待选 ${batchSummary.needs_region} · 失败 ${batchSummary.failed}`
            : ''}
        </div>

        {batchRows.length > 0 && (
          <div className="filing-batch-table-wrap">
            <div className="filing-batch-table-toolbar">
              <Button variant="ghost" size="sm" onClick={toggleSelectAllReady} icon={<CheckSquare size={14} />}>
                全选/取消可导入
              </Button>
            </div>
            <table className="filing-table kc-data-table filing-batch-table">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>选</th>
                  <th>链接 / 标题</th>
                  <th style={{ width: 88 }}>年份</th>
                  <th style={{ minWidth: 200 }}>匹配单位</th>
                  <th style={{ width: 100 }}>状态</th>
                  <th>说明</th>
                  <th style={{ width: 72 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {batchRows.map((row) => {
                  const canSelect =
                    (row.status === 'ready' || row.status === 'needs_region') && Boolean(row.regionId) && Boolean(row.year);
                  const canPickRegion = row.status === 'ready' || row.status === 'needs_region';
                  return (
                    <tr key={row.id} className={row.status === 'failed' ? 'filing-batch-row--fail' : undefined}>
                      <td>
                        <button
                          type="button"
                          className="filing-batch-check"
                          disabled={!canSelect || batchApplying}
                          onClick={() => patchBatchRow(row.id, { selected: !row.selected })}
                          title={canSelect ? '勾选后确认导入' : '需先选择单位或该行不可导入'}
                        >
                          {row.selected && canSelect ? <CheckSquare size={16} /> : <Square size={16} />}
                        </button>
                      </td>
                      <td>
                        <div className="filing-batch-url" title={row.url}>
                          {row.title || row.url}
                        </div>
                        <div className="filing-batch-url-sub">{row.finalUrl || row.url}</div>
                        {row.stats ? (
                          <div className="filing-batch-url-sub">{summarizeStats(row.stats)}</div>
                        ) : null}
                      </td>
                      <td>
                        <input
                          type="number"
                          className="filing-batch-year"
                          value={row.year || ''}
                          min={2000}
                          max={2100}
                          disabled={!canPickRegion || batchApplying}
                          onChange={(e) => patchBatchRow(row.id, { year: e.target.value })}
                        />
                      </td>
                      <td>
                        {canPickRegion ? (
                          <RegionCascader
                            regions={regions}
                            value={row.regionId || ''}
                            onChange={(id) =>
                              patchBatchRow(row.id, {
                                regionId: id ? String(id) : '',
                                regionName: id
                                  ? regions.find((r) => String(r.id) === String(id))?.name || row.regionName
                                  : null,
                                selected: Boolean(id),
                                status: id ? 'ready' : 'needs_region',
                              })
                            }
                            emptyLabelMode="strict"
                          />
                        ) : (
                          row.regionName || row.unitName || '—'
                        )}
                      </td>
                      <td>
                        <span className={`filing-badge filing-batch-badge filing-batch-badge--${row.status}`}>
                          {BATCH_STATUS_LABELS[row.status] || row.status}
                        </span>
                      </td>
                      <td className="filing-batch-msg">{row.message || row.code || '—'}</td>
                      <td>
                        {row.filingId ? (
                          <Button variant="ghost" size="sm" onClick={() => onOpen?.(row.filingId)}>
                            打开
                          </Button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="filing-table-wrap">
        {loading ? (
          <div className="filing-empty">加载中…</div>
        ) : items.length === 0 ? (
          <div className="filing-empty">
            暂无填报记录。请在上方逐级选择单位与年份后点击「新建/打开填报」，或使用批量网址导入。
          </div>
        ) : (
          <table className="filing-table kc-data-table">
            <thead>
              <tr>
                <th>单位</th>
                <th>年份</th>
                <th>状态</th>
                <th>勾稽</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const summary = item.last_check_summary_json || {};
                const failCount = summary.failCount ?? summary.fails?.length;
                return (
                  <tr key={item.id}>
                    <td>{item.region_name || item.unit_name || item.region_id}</td>
                    <td>{item.year}</td>
                    <td>
                      <span className={`kc-status-badge filing-badge filing-badge--${item.status}`}>
                        {STATUS_LABELS[item.status] || item.status}
                      </span>
                    </td>
                    <td>
                      {item.status === 'checks_failed'
                        ? `未通过 ${failCount != null ? `(${failCount})` : ''}`
                        : item.status === 'effective'
                          ? '已通过'
                          : '—'}
                    </td>
                    <td>{item.updated_at ? new Date(item.updated_at).toLocaleString() : '—'}</td>
                    <td>
                      <div className="filing-row-actions">
                        <Button variant="ghost" size="sm" onClick={() => onOpen?.(item.id)}>
                          打开
                        </Button>
                        {item.status !== 'effective' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Trash2 size={14} />}
                            onClick={() => handleDelete(item)}
                            title="删除草稿"
                          >
                            删除
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
