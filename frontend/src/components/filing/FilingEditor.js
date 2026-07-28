import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Save, Send, Wand2, RotateCcw, Trash2, Link2 } from 'lucide-react';
import { apiClient } from '../../apiClient';
import { useToast } from '../common/ToastProvider';
import PageHeader from '../common/PageHeader';
import Button from '../common/Button';
import { formatAllTextSections, formatAnnualReportText } from '../../utils/textFormat';
import { FilingTable2, FilingTable3, FilingTable4 } from './FilingTables';
import './Filing.css';

const STATUS_LABELS = {
  draft: '草稿',
  submitted: '校验中',
  checks_failed: '勾稽未通过',
  effective: '已生效',
};

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function summarizeImportStats(stats) {
  if (!stats) return '';
  return `正文一 ${stats.text1Chars || 0} 字 · 表二 ${stats.table2Filled || 0} 项 · 表三 ${stats.table3Filled || 0} 项 · 表四 ${stats.table4Filled || 0} 项`;
}

export default function FilingEditor({ filingId, onBack }) {
  const toast = useToast();
  const [filing, setFiling] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [gate, setGate] = useState(null);

  // submitted is transient; after recovery it becomes checks_failed. Treat as non-editable mid-flight.
  const editable = filing && (filing.status === 'draft' || filing.status === 'checks_failed');
  const canDelete =
    filing &&
    (filing.status === 'draft' || filing.status === 'checks_failed' || filing.status === 'submitted');
  const canReopen =
    filing &&
    (filing.status === 'effective' ||
      filing.status === 'checks_failed' ||
      filing.status === 'submitted');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get(`/filings/${filingId}`);
      const f = res.data?.filing;
      setFiling(f);
      setForm(deepClone(f?.form_json));
      setGate(f?.last_check_summary_json || null);
    } catch (err) {
      toast.error('加载填报失败', err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  }, [filingId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const updateSection = (idx, patch) => {
    setForm((prev) => {
      const next = deepClone(prev);
      next.sections[idx] = { ...next.sections[idx], ...patch };
      return next;
    });
  };

  const handleFormatAll = () => {
    setForm((prev) => formatAllTextSections(prev));
    toast.success('已完成全文一键排版');
  };

  const handleImportFromUrl = async () => {
    if (!editable) return;
    const url = String(importUrl || '').trim();
    if (!url) {
      toast.warning('请输入年报页面网址');
      return;
    }
    if (!window.confirm('将从该网址规则抽取六章内容并覆盖当前草稿中的对应字段，是否继续？\n（不会自动提交生效，请核对后自行保存/提交）')) {
      return;
    }
    setImporting(true);
    try {
      const res = await apiClient.post(`/filings/${filingId}/import-from-url`, {
        url,
        apply: true,
      });
      const nextForm = res.data?.form_json || res.data?.filing?.form_json;
      if (res.data?.filing) setFiling(res.data.filing);
      if (nextForm) setForm(deepClone(nextForm));
      const statsText = summarizeImportStats(res.data?.stats);
      const warnCount = res.data?.stats?.warnings?.length || 0;
      if (warnCount > 0) {
        toast.warning('已导入（部分章节可能不全）', statsText || '请核对表格与正文');
      } else {
        toast.success('已从网址导入并写入草稿', statsText);
      }
    } catch (err) {
      toast.error('网址导入失败', err.response?.data?.error || err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleFormatSection = (idx) => {
    setForm((prev) => {
      const next = deepClone(prev);
      if (next.sections[idx]?.type === 'text') {
        next.sections[idx].content = formatAnnualReportText(next.sections[idx].content || '');
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!editable) return;
    setSaving(true);
    try {
      const res = await apiClient.put(`/filings/${filingId}`, { form_json: form });
      setFiling(res.data.filing);
      setForm(deepClone(res.data.filing.form_json));
      toast.success('草稿已保存');
    } catch (err) {
      toast.error('保存失败', err.response?.data?.error || err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!editable) return;
    const replaceHint =
      filing?.active_version_id && filing.status !== 'effective'
        ? '提交并勾稽通过后将替换当前已生效的年报版本。是否继续？'
        : '提交后将运行勾稽校验，仅表内勾稽全部通过才会正式生效。是否继续？';
    if (!window.confirm(replaceHint)) return;

    setSubmitting(true);
    try {
      const res = await apiClient.post(`/filings/${filingId}/submit`, { form_json: form });
      setFiling(res.data.filing);
      setForm(deepClone(res.data.filing.form_json));
      setGate(res.data.gate || res.data.filing?.last_check_summary_json);
      if (res.data.gate?.passed) {
        toast.success('勾稽通过，年报已生效', `报告 ID: ${res.data.reportId}`);
      } else {
        toast.warning(
          '勾稽未通过，尚未生效',
          `失败 ${res.data.gate?.failCount || 0} 项，请修正后重新提交`
        );
      }
    } catch (err) {
      const data = err.response?.data;
      if (err.response?.status === 422 && data?.gate) {
        setFiling(data.filing);
        setForm(deepClone(data.filing?.form_json || form));
        setGate(data.gate);
        toast.warning('勾稽未通过，尚未生效', `失败 ${data.gate.failCount || 0} 项`);
      } else {
        toast.error('提交失败', data?.error || err.message);
        // Reload so recovered checks_failed status is visible (avoid stuck UI).
        try {
          const refreshed = await apiClient.get(`/filings/${filingId}`);
          if (refreshed.data?.filing) {
            setFiling(refreshed.data.filing);
            setForm(deepClone(refreshed.data.filing.form_json));
            setGate(refreshed.data.filing.last_check_summary_json || null);
          }
        } catch {
          /* ignore */
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async () => {
    if (!window.confirm('撤回为草稿后可继续修改，需重新提交并通过勾稽才会再次生效。是否继续？')) {
      return;
    }
    try {
      const res = await apiClient.post(`/filings/${filingId}/reopen`);
      setFiling(res.data.filing);
      toast.success('已撤回为草稿');
    } catch (err) {
      toast.error('撤回失败', err.response?.data?.error || err.message);
    }
  };

  const handleDelete = async () => {
    if (!filing) return;
    if (!canDelete) {
      toast.warning('无法删除', '已生效填报不可删除，请先撤回为草稿');
      return;
    }
    const name = filing.region_name || '当前单位';
    if (!window.confirm(`确定删除「${name} · ${filing.year}」的填报草稿吗？此操作不可恢复。`)) {
      return;
    }
    try {
      await apiClient.delete(`/filings/${filingId}`);
      toast.success('已删除填报草稿');
      onBack?.();
    } catch (err) {
      toast.error('删除失败', err.response?.data?.error || err.message);
    }
  };

  const fails = useMemo(() => gate?.fails || gate?.last_check_summary_json?.fails || [], [gate]);

  if (loading || !form) {
    return (
      <div className="filing-page kc-page">
        <div className="filing-empty">加载中…</div>
      </div>
    );
  }

  return (
    <div className="filing-page filing-editor kc-page">
      <PageHeader
        eyebrow="年报填报"
        title={`${filing?.region_name || '单位'} · ${filing?.year} 年政府信息公开工作年度报告`}
        subtitle={
          <>
            状态：
            <span className={`kc-status-badge filing-badge filing-badge--${filing?.status}`}>
              {STATUS_LABELS[filing?.status] || filing?.status}
            </span>
            {filing?.report_id ? ` · 报告 #${filing.report_id}` : ''}
            {filing?.effective_version_id ? ` · 生效版本 #${filing.effective_version_id}` : ''}
          </>
        }
        actions={
          <>
            <Button variant="ghost" icon={<ArrowLeft size={16} />} onClick={onBack}>
              返回列表
            </Button>
            {editable && (
              <>
                <Button
                  variant="secondary"
                  icon={<Wand2 size={16} />}
                  onClick={handleFormatAll}
                  disabled={saving || submitting}
                >
                  一键排版
                </Button>
                <Button
                  variant="secondary"
                  icon={<Save size={16} />}
                  onClick={handleSave}
                  disabled={saving || submitting}
                >
                  {saving ? '保存中…' : '保存草稿'}
                </Button>
                <Button
                  variant="primary"
                  icon={<Send size={16} />}
                  onClick={handleSubmit}
                  disabled={saving || submitting}
                >
                  {submitting ? '提交校验中…' : '提交生效'}
                </Button>
              </>
            )}
            {canReopen && (
              <Button variant="secondary" icon={<RotateCcw size={16} />} onClick={handleReopen}>
                撤回为草稿
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" icon={<Trash2 size={16} />} onClick={handleDelete}>
                删除草稿
              </Button>
            )}
          </>
        }
      />

      {editable && (
        <div className="filing-import-bar">
          <div className="filing-import-bar__label">
            <Link2 size={16} />
            <span>从已发布年报网页导入</span>
          </div>
          <input
            className="filing-import-input"
            type="url"
            placeholder="粘贴政府信息公开工作年度报告 HTML 链接…"
            value={importUrl}
            disabled={importing || saving || submitting}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleImportFromUrl();
              }
            }}
          />
          <Button
            variant="secondary"
            icon={<Link2 size={16} />}
            onClick={handleImportFromUrl}
            disabled={importing || saving || submitting || !importUrl.trim()}
          >
            {importing ? '抽取中…' : '导入填入'}
          </Button>
          <div className="filing-import-hint">
            纯规则解析，不调用 AI。支持静态 HTML 年报页，以及部分 SPA（如奉贤
            xxgk…/art/info/…）自动拉详情。导入后请核对再提交。
          </div>
        </div>
      )}

      {fails.length > 0 && (
        <div className="filing-gate-panel filing-gate-panel--fail">
          <h3>勾稽未通过（{fails.length}）— 尚未生效</h3>
          <ul>
            {fails.map((f, i) => (
              <li key={`${f.checkKey}-${i}`}>
                <strong>{f.title}</strong>
                {f.expr ? <span className="filing-gate-expr"> · {f.expr}</span> : null}
                {f.leftValue != null || f.rightValue != null ? (
                  <span>
                    {' '}
                    （{f.leftValue ?? '—'} vs {f.rightValue ?? '—'}）
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {filing?.status === 'effective' && (
        <div className="filing-gate-panel filing-gate-panel--ok">
          勾稽已通过，本填报已作为正式年报版本生效。
          {filing.report_id ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                window.location.href = `/catalog/reports/${filing.report_id}`;
              }}
            >
              查看报告详情
            </Button>
          ) : null}
        </div>
      )}

      <div className="filing-document">
        {(form.sections || []).map((section, idx) => {
          if (section.type === 'text') {
            return (
              <section key={idx} className="filing-section">
                <div className="filing-section-head">
                  <h2>{section.title}</h2>
                  {editable && (
                    <Button variant="ghost" size="sm" onClick={() => handleFormatSection(idx)}>
                      一键排版
                    </Button>
                  )}
                </div>
                <textarea
                  className="filing-textarea"
                  rows={10}
                  value={section.content || ''}
                  disabled={!editable}
                  onChange={(e) => updateSection(idx, { content: e.target.value })}
                  placeholder="请在此填写本章正文…"
                />
              </section>
            );
          }

          if (section.type === 'table_2') {
            return (
              <section key={idx} className="filing-section">
                <div className="filing-section-head">
                  <h2>{section.title}</h2>
                </div>
                <FilingTable2
                  data={section.activeDisclosureData || {}}
                  disabled={!editable}
                  onChange={(activeDisclosureData) => updateSection(idx, { activeDisclosureData })}
                />
              </section>
            );
          }

          if (section.type === 'table_3') {
            return (
              <section key={idx} className="filing-section">
                <div className="filing-section-head">
                  <h2>{section.title}</h2>
                </div>
                <FilingTable3
                  data={section.tableData || {}}
                  disabled={!editable}
                  onChange={(tableData) => updateSection(idx, { tableData })}
                />
              </section>
            );
          }

          if (section.type === 'table_4') {
            return (
              <section key={idx} className="filing-section">
                <div className="filing-section-head">
                  <h2>{section.title}</h2>
                </div>
                <FilingTable4
                  data={section.reviewLitigationData || {}}
                  disabled={!editable}
                  onChange={(reviewLitigationData) => updateSection(idx, { reviewLitigationData })}
                />
              </section>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
