import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Plus, Trash2 } from 'lucide-react';
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

export default function FilingList({ onOpen, onCreate }) {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(String(new Date().getFullYear() - 1));
  const [status, setStatus] = useState('');
  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState('');
  const [creating, setCreating] = useState(false);

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

      <div className="filing-table-wrap">
        {loading ? (
          <div className="filing-empty">加载中…</div>
        ) : items.length === 0 ? (
          <div className="filing-empty">
            暂无填报记录。请在上方逐级选择单位与年份后点击「新建/打开填报」。
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
