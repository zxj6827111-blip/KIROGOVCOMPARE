import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Plus, RefreshCw, Save, Trash2, Zap } from 'lucide-react';
import { apiClient } from '../apiClient';
import { useToast } from './common/ToastProvider';
import { useConfirmDialog } from './common/ConfirmDialogProvider';
import './AiModelSettings.css';

const EMPTY_FORM = {
  id: null,
  name: '',
  modelName: '',
  baseUrl: '',
  apiKey: '',
  isEnabled: true,
  showInUpload: true,
  sortOrder: 0,
};

function AiModelSettings() {
  const toast = useToast();
  const confirm = useConfirmDialog();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [bindings, setBindings] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [bindingDraft, setBindingDraft] = useState({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiClient.get('/ai/models');
      const nextProfiles = Array.isArray(resp.data?.profiles) ? resp.data.profiles : [];
      const nextBindings = Array.isArray(resp.data?.bindings) ? resp.data.bindings : [];
      setProfiles(nextProfiles);
      setBindings(nextBindings);
      const draft = {};
      nextBindings.forEach((item) => {
        draft[item.purpose] = item.profileId == null ? 'env' : String(item.profileId);
      });
      setBindingDraft(draft);
    } catch (error) {
      console.error(error);
      toast?.error?.('加载失败', '无法加载 AI 模型配置');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const editingLabel = useMemo(
    () => (form.id ? `编辑模型 #${form.id}` : '新增模型'),
    [form.id]
  );

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setTestResult(null);
  };

  const startEdit = (profile) => {
    setTestResult(null);
    setForm({
      id: profile.id,
      name: profile.name || '',
      modelName: profile.modelName || '',
      baseUrl: profile.baseUrl || '',
      apiKey: '',
      isEnabled: profile.isEnabled !== false,
      showInUpload: profile.showInUpload !== false,
      sortOrder: Number(profile.sortOrder || 0),
    });
  };


  const testConnection = async () => {
    if (!form.modelName.trim() || !form.baseUrl.trim()) {
      toast?.error?.('信息不完整', '测试前请填写模型名和 Base URL');
      return;
    }
    if (!form.id && !form.apiKey.trim()) {
      toast?.error?.('信息不完整', '新增模型测试时必须填写 API Key');
      return;
    }

    setTesting(true);
    setTestResult(null);
    try {
      const payload = {
        modelName: form.modelName.trim(),
        baseUrl: form.baseUrl.trim(),
        provider: 'openai',
      };
      if (form.id) payload.profileId = form.id;
      if (form.apiKey.trim()) payload.apiKey = form.apiKey.trim();
      if (form.name.trim()) payload.name = form.name.trim();

      const resp = await apiClient.post('/ai/models/test', payload, { timeout: 120000 });
      const data = resp.data || {};
      setTestResult(data);
      if (data.ok) {
        toast?.success?.(
          '连通性测试通过',
          `${data.model || form.modelName} · ${data.latencyMs || 0}ms`
        );
      } else {
        toast?.error?.('连通性测试失败', data.message || '请检查 URL / 模型名 / API Key');
      }
    } catch (error) {
      console.error(error);
      const data = error?.response?.data || {};
      const result = {
        ok: false,
        message: data.message || error?.message || '连通性测试失败',
        latencyMs: data.latencyMs,
        preview: data.preview || '',
        model: data.model || form.modelName,
        baseUrl: data.baseUrl || form.baseUrl,
        provider: data.provider || 'openai',
      };
      setTestResult(result);
      toast?.error?.('连通性测试失败', result.message);
    } finally {
      setTesting(false);
    }
  };

  const saveProfile = async () => {
    if (!form.name.trim() || !form.modelName.trim() || !form.baseUrl.trim()) {
      toast?.error?.('信息不完整', '请填写显示名称、模型名和 Base URL');
      return;
    }
    if (!form.id && !form.apiKey.trim()) {
      toast?.error?.('信息不完整', '新增模型时必须填写 API Key');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        modelName: form.modelName.trim(),
        baseUrl: form.baseUrl.trim(),
        isEnabled: form.isEnabled !== false,
        showInUpload: form.showInUpload !== false,
        sortOrder: Number(form.sortOrder) || 0,
      };
      if (form.apiKey.trim()) {
        payload.apiKey = form.apiKey.trim();
      }

      if (form.id) {
        await apiClient.put(`/ai/models/${form.id}`, payload);
        toast?.success?.('已更新', '模型配置已保存');
      } else {
        await apiClient.post('/ai/models', payload);
        toast?.success?.('已创建', '模型配置已添加');
      }
      resetForm();
      await loadData();
    } catch (error) {
      console.error(error);
      toast?.error?.('保存失败', error?.response?.data?.message || '请检查输入后重试');
    } finally {
      setSaving(false);
    }
  };

  const removeProfile = async (profile) => {
    const ok = await confirm({
      title: '删除模型配置',
      message: `确认删除「${profile.name}」吗？已绑定的用途将回退到环境变量。`,
      confirmText: '删除',
      cancelText: '取消',
    });
    if (!ok) return;

    try {
      await apiClient.delete(`/ai/models/${profile.id}`);
      toast?.success?.('已删除', '模型配置已移除');
      if (form.id === profile.id) resetForm();
      await loadData();
    } catch (error) {
      console.error(error);
      toast?.error?.('删除失败', error?.response?.data?.message || '请稍后重试');
    }
  };

  const saveBinding = async (purpose) => {
    const raw = bindingDraft[purpose];
    const profileId = raw === 'env' || raw == null || raw === '' ? null : Number(raw);
    try {
      await apiClient.put(`/ai/bindings/${purpose}`, { profileId });
      toast?.success?.('已绑定', '用途默认模型已更新');
      await loadData();
    } catch (error) {
      console.error(error);
      toast?.error?.('绑定失败', error?.response?.data?.message || '请稍后重试');
    }
  };

  if (loading) {
    return <div className="kc-panel ai-model-settings">正在加载 AI 模型配置…</div>;
  }

  return (
    <div className="ai-model-settings">
      <div className="kc-panel ai-model-settings__intro">
        <div className="ai-model-settings__intro-title">
          <Bot size={18} />
          <div>
            <strong>AI 模型目录</strong>
            <p>
              管理员可维护 Base URL、模型名、API Key，并为「年报解析 / 智能辅策报告 / 视觉复核」指定默认模型。
              未绑定时自动回退到服务器 `.env` 配置；修改后热更新生效，无需重启。
            </p>
          </div>
        </div>
        <button type="button" className="kc-btn kc-btn--ghost" onClick={loadData}>
          <RefreshCw size={16} />
          刷新
        </button>
      </div>

      <div className="ai-model-settings__grid">
        <section className="kc-panel">
          <div className="ai-model-settings__section-head">
            <h3>模型列表</h3>
            <button type="button" className="kc-btn kc-btn--secondary" onClick={resetForm}>
              <Plus size={16} />
              新建
            </button>
          </div>

          {profiles.length === 0 ? (
            <div className="ai-model-settings__empty">暂无模型，请先在右侧新增一条配置。</div>
          ) : (
            <div className="ai-model-settings__table-wrap">
              <table className="ai-model-settings__table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>模型</th>
                    <th>Base URL</th>
                    <th>API Key</th>
                    <th>状态</th>
                    <th>上传页</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id}>
                      <td>{profile.name}</td>
                      <td>
                        <code>{profile.modelName}</code>
                      </td>
                      <td className="ai-model-settings__url" title={profile.baseUrl}>
                        {profile.baseUrl}
                      </td>
                      <td>
                        <code>{profile.apiKeyMasked || '未设置'}</code>
                      </td>
                      <td>
                        <span className={profile.isEnabled ? 'tag-green' : 'tag-rose'}>
                          {profile.isEnabled ? '启用' : '停用'}
                        </span>
                      </td>
                      <td>
                        <span className={profile.showInUpload !== false ? 'tag-cyan' : 'tag-rose'}>
                          {profile.showInUpload !== false ? '显示' : '隐藏'}
                        </span>
                      </td>
                      <td className="ai-model-settings__actions">
                        <button type="button" className="kc-btn kc-btn--ghost" onClick={() => startEdit(profile)}>
                          编辑
                        </button>
                        <button
                          type="button"
                          className="kc-btn kc-btn--ghost ai-model-settings__danger"
                          onClick={() => removeProfile(profile)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="kc-panel">
          <div className="ai-model-settings__section-head">
            <h3>{editingLabel}</h3>
          </div>

          <div className="ai-model-settings__form">
            <label>
              显示名称
              <input
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="例如：GPT-5.5 中继"
              />
            </label>
            <label>
              模型名
              <input
                value={form.modelName}
                onChange={(e) => setForm((prev) => ({ ...prev, modelName: e.target.value }))}
                placeholder="例如：gpt-5.5"
              />
            </label>
            <label>
              Base URL
              <input
                value={form.baseUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                placeholder="例如：https://api.example.com"
              />
            </label>
            <label>
              API Key{form.id ? '（留空表示不修改）' : ''}
              <input
                type="password"
                value={form.apiKey}
                onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                placeholder={form.id ? '********' : 'sk-...'}
                autoComplete="new-password"
              />
            </label>
                        <label className="ai-model-settings__checkbox">
              <input
                type="checkbox"
                checked={form.isEnabled}
                onChange={(e) => setForm((prev) => ({ ...prev, isEnabled: e.target.checked }))}
              />
              启用该模型
            </label>
            <label className="ai-model-settings__checkbox">
              <input
                type="checkbox"
                checked={form.showInUpload !== false}
                onChange={(e) => setForm((prev) => ({ ...prev, showInUpload: e.target.checked }))}
              />
              在年报上传页下拉中显示
            </label>
            <div className="ai-model-settings__form-actions">
              <button type="button" className="kc-btn kc-btn--primary" disabled={saving || testing} onClick={saveProfile}>
                <Save size={16} />
                {saving ? '保存中…' : '保存模型'}
              </button>
              <button
                type="button"
                className="kc-btn kc-btn--secondary"
                disabled={saving || testing}
                onClick={testConnection}
                title="使用当前表单中的 Base URL / 模型名 / API Key 发起一次真实调用"
              >
                <Zap size={16} />
                {testing ? '测试中…' : '测试连通'}
              </button>
              {form.id && (
                <button type="button" className="kc-btn kc-btn--ghost" disabled={testing} onClick={resetForm}>
                  取消编辑
                </button>
              )}
            </div>
            {testResult && (
              <div
                className={`ai-model-settings__test-result ${
                  testResult.ok ? 'ai-model-settings__test-result--ok' : 'ai-model-settings__test-result--fail'
                }`}
              >
                <div className="ai-model-settings__test-result-title">
                  {testResult.ok ? '连通性测试通过' : '连通性测试失败'}
                  {typeof testResult.latencyMs === 'number' ? ` · ${testResult.latencyMs}ms` : ''}
                </div>
                <div className="ai-model-settings__test-result-msg">{testResult.message || ''}</div>
                {testResult.preview ? (
                  <pre className="ai-model-settings__test-result-preview">{testResult.preview}</pre>
                ) : null}
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="kc-panel">
        <div className="ai-model-settings__section-head">
          <h3>用途默认绑定</h3>
        </div>
        <div className="ai-model-settings__bindings">
          {bindings.map((item) => (
            <div key={item.purpose} className="ai-model-settings__binding-card">
              <div>
                <strong>{item.label}</strong>
                <p>
                  当前生效：
                  <code>{item.resolved?.modelValue || '-'}</code>
                  <span className="ai-model-settings__source">
                    （来源：{item.resolved?.source === 'database' ? '数据库' : '环境变量'}）
                  </span>
                </p>
              </div>
              <div className="ai-model-settings__binding-controls">
                <select
                  value={bindingDraft[item.purpose] ?? 'env'}
                  onChange={(e) =>
                    setBindingDraft((prev) => ({
                      ...prev,
                      [item.purpose]: e.target.value,
                    }))
                  }
                >
                  <option value="env">使用环境变量 (.env)</option>
                  {profiles
                    .filter((profile) => profile.isEnabled)
                    .map((profile) => (
                      <option key={profile.id} value={String(profile.id)}>
                        {profile.name} ({profile.modelName})
                      </option>
                    ))}
                </select>
                <button type="button" className="kc-btn kc-btn--secondary" onClick={() => saveBinding(item.purpose)}>
                  保存绑定
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default AiModelSettings;
