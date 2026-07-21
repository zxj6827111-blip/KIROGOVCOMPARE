import pool from '../config/database-llm';
import { createLlmProvider } from './LlmProviderFactory';
import {
  buildPrefixedModelValue,
  normalizeLlmProviderName,
  parsePrefixedModelValue,
  resolveFirstNonEmpty,
  RuntimeModelOption,
} from '../utils/aiEnv';

export type AiModelPurpose = 'upload_parse' | 'gov_insight_report' | 'vision_review';

export const AI_MODEL_PURPOSES: AiModelPurpose[] = [
  'upload_parse',
  'gov_insight_report',
  'vision_review',
];

export const AI_MODEL_PURPOSE_LABELS: Record<AiModelPurpose, string> = {
  upload_parse: '年报上传解析',
  gov_insight_report: '政务公开智能辅策报告',
  vision_review: '表格 OCR 视觉复核',
};

export interface AiModelProfileRecord {
  id: number;
  name: string;
  model_name: string;
  base_url: string;
  api_key: string;
  provider: string;
  is_enabled: boolean;
  show_in_upload: boolean;
  sort_order: number;
  created_by: number | null;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface AiModelProfilePublic {
  id: number;
  name: string;
  modelName: string;
  baseUrl: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  provider: string;
  isEnabled: boolean;
  showInUpload: boolean;
  sortOrder: number;
  modelValue: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedRuntimeAiModel {
  source: 'database' | 'env';
  profileId: number | null;
  profileName: string | null;
  purpose: AiModelPurpose | 'default';
  provider: string;
  model: string;
  modelValue: string;
  baseUrl: string;
  apiKey: string;
}

export interface CreateAiModelProfileInput {
  name: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  provider?: string;
  isEnabled?: boolean;
  showInUpload?: boolean;
  sortOrder?: number;
  actorUserId?: number | null;
}

export interface UpdateAiModelProfileInput {
  name?: string;
  modelName?: string;
  baseUrl?: string;
  apiKey?: string;
  provider?: string;
  isEnabled?: boolean;
  showInUpload?: boolean;
  sortOrder?: number;
  actorUserId?: number | null;
}

const CACHE_TTL_MS = Number(process.env.AI_MODEL_CONFIG_CACHE_TTL_MS || 5000);

type CacheEntry = {
  expiresAt: number;
  profiles: AiModelProfileRecord[];
  bindings: Map<AiModelPurpose, number | null>;
};

let cache: CacheEntry | null = null;

function isPurpose(value: string): value is AiModelPurpose {
  return (AI_MODEL_PURPOSES as string[]).includes(value);
}

export function maskApiKey(apiKey: string | null | undefined): string {
  const key = String(apiKey || '').trim();
  if (!key) return '';
  if (key.length <= 8) return `${key.slice(0, 2)}****`;
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

function normalizeBaseUrl(raw: string): string {
  return String(raw || '').trim().replace(/\/+$/, '');
}

function assertHttpUrl(raw: string, field = 'baseUrl'): string {
  const value = normalizeBaseUrl(raw);
  if (!value) {
    throw Object.assign(new Error(`${field} 不能为空`), { code: 'invalid_base_url' });
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw Object.assign(new Error(`${field} 不是合法 URL`), { code: 'invalid_base_url' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error(`${field} 仅支持 http/https`), { code: 'invalid_base_url' });
  }
  return value.replace(/\/+$/, '');
}

function toPublic(row: AiModelProfileRecord): AiModelProfilePublic {
  const provider = normalizeLlmProviderName(row.provider, 'openai') || 'openai';
  const modelName = String(row.model_name || '').trim();
  return {
    id: Number(row.id),
    name: row.name,
    modelName,
    baseUrl: row.base_url,
    apiKeyMasked: maskApiKey(row.api_key),
    hasApiKey: Boolean(String(row.api_key || '').trim()),
    provider,
    isEnabled: row.is_enabled === true,
    showInUpload: row.show_in_upload !== false,
    sortOrder: Number(row.sort_order || 0),
    modelValue: buildPrefixedModelValue(provider, modelName),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function invalidateCache(): void {
  cache = null;
}

async function loadCache(force = false): Promise<CacheEntry> {
  if (!force && cache && cache.expiresAt > Date.now()) {
    return cache;
  }

  const [profilesResult, bindingsResult] = await Promise.all([
    pool.query(
      `SELECT id, name, model_name, base_url, api_key, provider, is_enabled, show_in_upload, sort_order,
              created_by, updated_by, created_at, updated_at
       FROM ai_model_profiles
       ORDER BY sort_order ASC, id ASC`
    ),
    pool.query(`SELECT purpose, profile_id FROM ai_model_purpose_bindings`),
  ]);

  const bindings = new Map<AiModelPurpose, number | null>();
  for (const purpose of AI_MODEL_PURPOSES) {
    bindings.set(purpose, null);
  }
  for (const row of bindingsResult.rows) {
    const purpose = String(row.purpose || '');
    if (isPurpose(purpose)) {
      bindings.set(purpose, row.profile_id == null ? null : Number(row.profile_id));
    }
  }

  cache = {
    expiresAt: Date.now() + Math.max(1000, CACHE_TTL_MS),
    profiles: profilesResult.rows as AiModelProfileRecord[],
    bindings,
  };
  return cache;
}

function envFallback(purpose: AiModelPurpose): ResolvedRuntimeAiModel {
  if (purpose === 'upload_parse') {
    const provider = normalizeLlmProviderName(
      resolveFirstNonEmpty(process.env.LLM_PARSE_PROVIDER, process.env.LLM_PROVIDER, 'openai'),
      'openai'
    );
    const model = resolveFirstNonEmpty(
      process.env.LLM_PARSE_MODEL,
      process.env.OPENAI_MODEL,
      process.env.LLM_MODEL,
      'gpt-5.5'
    );
    return {
      source: 'env',
      profileId: null,
      profileName: null,
      purpose,
      provider,
      model,
      modelValue: buildPrefixedModelValue(provider, model),
      baseUrl: normalizeBaseUrl(resolveFirstNonEmpty(process.env.OPENAI_BASE_URL)),
      apiKey: resolveFirstNonEmpty(process.env.OPENAI_API_KEY),
    };
  }

  if (purpose === 'gov_insight_report') {
    const provider = normalizeLlmProviderName(
      resolveFirstNonEmpty(
        process.env.GOV_INSIGHT_REPORT_PROVIDER,
        process.env.LLM_REPORT_PROVIDER,
        process.env.LLM_PROVIDER,
        'openai'
      ),
      'openai'
    );
    const model = resolveFirstNonEmpty(
      process.env.GOV_INSIGHT_REPORT_MODEL,
      process.env.LLM_REPORT_MODEL,
      process.env.OPENAI_MODEL,
      process.env.LLM_MODEL,
      'gpt-5.5'
    );
    return {
      source: 'env',
      profileId: null,
      profileName: null,
      purpose,
      provider,
      model,
      modelValue: buildPrefixedModelValue(provider, model),
      baseUrl: normalizeBaseUrl(resolveFirstNonEmpty(process.env.OPENAI_BASE_URL)),
      apiKey: resolveFirstNonEmpty(process.env.OPENAI_API_KEY),
    };
  }

  const provider = normalizeLlmProviderName(
    resolveFirstNonEmpty(process.env.VISION_REVIEW_PROVIDER, process.env.LLM_PROVIDER, 'openai'),
    'openai'
  );
  const model = resolveFirstNonEmpty(
    process.env.VISION_REVIEW_MODEL,
    process.env.OPENAI_MODEL,
    process.env.LLM_MODEL,
    'gpt-5.5'
  );
  return {
    source: 'env',
    profileId: null,
    profileName: null,
    purpose,
    provider,
    model,
    modelValue: buildPrefixedModelValue(provider, model),
    baseUrl: normalizeBaseUrl(
      resolveFirstNonEmpty(process.env.VISION_REVIEW_BASE_URL, process.env.OPENAI_BASE_URL)
    ),
    apiKey: resolveFirstNonEmpty(process.env.VISION_REVIEW_API_KEY, process.env.OPENAI_API_KEY),
  };
}

function resolveFromProfiles(
  purpose: AiModelPurpose,
  profiles: AiModelProfileRecord[],
  bindings: Map<AiModelPurpose, number | null>
): ResolvedRuntimeAiModel {
  const profileId = bindings.get(purpose) ?? null;
  if (profileId != null) {
    const bound = profiles.find((item) => Number(item.id) === profileId && item.is_enabled === true);
    if (bound && String(bound.api_key || '').trim() && String(bound.base_url || '').trim()) {
      const provider = normalizeLlmProviderName(bound.provider, 'openai') || 'openai';
      const model = String(bound.model_name || '').trim();
      return {
        source: 'database',
        profileId: Number(bound.id),
        profileName: bound.name,
        purpose,
        provider,
        model,
        modelValue: buildPrefixedModelValue(provider, model),
        baseUrl: normalizeBaseUrl(bound.base_url),
        apiKey: String(bound.api_key || '').trim(),
      };
    }
  }

  return envFallback(purpose);
}

export class AiModelConfigService {
  invalidateCache(): void {
    invalidateCache();
  }

  async listProfiles(): Promise<AiModelProfilePublic[]> {
    const data = await loadCache();
    return data.profiles.map(toPublic);
  }

  async getProfileById(id: number): Promise<AiModelProfileRecord | null> {
    const data = await loadCache();
    return data.profiles.find((item) => Number(item.id) === id) || null;
  }

  async createProfile(input: CreateAiModelProfileInput): Promise<AiModelProfilePublic> {
    const name = String(input.name || '').trim();
    const modelName = String(input.modelName || '').trim();
    const baseUrl = assertHttpUrl(input.baseUrl);
    const apiKey = String(input.apiKey || '').trim();
    const provider = normalizeLlmProviderName(input.provider, 'openai') || 'openai';
    const isEnabled = input.isEnabled !== false;
    const showInUpload = input.showInUpload !== false;
    const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0;

    if (!name) throw Object.assign(new Error('name 不能为空'), { code: 'invalid_name' });
    if (!modelName) throw Object.assign(new Error('modelName 不能为空'), { code: 'invalid_model' });
    if (!apiKey) throw Object.assign(new Error('apiKey 不能为空'), { code: 'invalid_api_key' });

    const result = await pool.query(
      `INSERT INTO ai_model_profiles
         (name, model_name, base_url, api_key, provider, is_enabled, show_in_upload, sort_order, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
       RETURNING id, name, model_name, base_url, api_key, provider, is_enabled, show_in_upload, sort_order,
                 created_by, updated_by, created_at, updated_at`,
      [name, modelName, baseUrl, apiKey, provider, isEnabled, showInUpload, sortOrder, input.actorUserId ?? null]
    );

    invalidateCache();
    return toPublic(result.rows[0] as AiModelProfileRecord);
  }

  async updateProfile(id: number, input: UpdateAiModelProfileInput): Promise<AiModelProfilePublic> {
    const existing = await this.getProfileById(id);
    if (!existing) {
      throw Object.assign(new Error('模型配置不存在'), { code: 'not_found' });
    }

    const name = input.name !== undefined ? String(input.name || '').trim() : existing.name;
    const modelName =
      input.modelName !== undefined ? String(input.modelName || '').trim() : existing.model_name;
    const baseUrl =
      input.baseUrl !== undefined ? assertHttpUrl(input.baseUrl) : normalizeBaseUrl(existing.base_url);
    const apiKeyRaw =
      input.apiKey !== undefined ? String(input.apiKey || '').trim() : String(existing.api_key || '');
    const provider =
      input.provider !== undefined
        ? normalizeLlmProviderName(input.provider, 'openai') || 'openai'
        : normalizeLlmProviderName(existing.provider, 'openai') || 'openai';
    const isEnabled = input.isEnabled !== undefined ? input.isEnabled === true : existing.is_enabled === true;
    const showInUpload =
      input.showInUpload !== undefined ? input.showInUpload === true : existing.show_in_upload !== false;
    const sortOrder =
      input.sortOrder !== undefined && Number.isFinite(Number(input.sortOrder))
        ? Number(input.sortOrder)
        : Number(existing.sort_order || 0);

    if (!name) throw Object.assign(new Error('name 不能为空'), { code: 'invalid_name' });
    if (!modelName) throw Object.assign(new Error('modelName 不能为空'), { code: 'invalid_model' });
    if (!apiKeyRaw) throw Object.assign(new Error('apiKey 不能为空'), { code: 'invalid_api_key' });

    const result = await pool.query(
      `UPDATE ai_model_profiles
       SET name = $1,
           model_name = $2,
           base_url = $3,
           api_key = $4,
           provider = $5,
           is_enabled = $6,
           show_in_upload = $7,
           sort_order = $8,
           updated_by = $9,
           updated_at = NOW()
       WHERE id = $10
       RETURNING id, name, model_name, base_url, api_key, provider, is_enabled, show_in_upload, sort_order,
                 created_by, updated_by, created_at, updated_at`,
      [name, modelName, baseUrl, apiKeyRaw, provider, isEnabled, showInUpload, sortOrder, input.actorUserId ?? null, id]
    );

    invalidateCache();
    return toPublic(result.rows[0] as AiModelProfileRecord);
  }

  async deleteProfile(id: number): Promise<void> {
    const result = await pool.query(`DELETE FROM ai_model_profiles WHERE id = $1`, [id]);
    if ((result.rowCount || 0) === 0) {
      throw Object.assign(new Error('模型配置不存在'), { code: 'not_found' });
    }
    invalidateCache();
  }

  async listPurposeBindings(): Promise<
    Array<{
      purpose: AiModelPurpose;
      label: string;
      profileId: number | null;
      profile: AiModelProfilePublic | null;
      resolved: ResolvedRuntimeAiModel;
    }>
  > {
    const data = await loadCache();
    return AI_MODEL_PURPOSES.map((purpose) => {
      const profileId = data.bindings.get(purpose) ?? null;
      const profileRow =
        profileId == null ? null : data.profiles.find((item) => Number(item.id) === profileId) || null;
      return {
        purpose,
        label: AI_MODEL_PURPOSE_LABELS[purpose],
        profileId,
        profile: profileRow ? toPublic(profileRow) : null,
        resolved: resolveFromProfiles(purpose, data.profiles, data.bindings),
      };
    });
  }

  async setPurposeBinding(
    purpose: AiModelPurpose,
    profileId: number | null,
    actorUserId?: number | null
  ): Promise<void> {
    if (!isPurpose(purpose)) {
      throw Object.assign(new Error('用途无效'), { code: 'invalid_purpose' });
    }

    if (profileId != null) {
      const profile = await this.getProfileById(profileId);
      if (!profile) {
        throw Object.assign(new Error('模型配置不存在'), { code: 'not_found' });
      }
      if (!profile.is_enabled) {
        throw Object.assign(new Error('不能绑定已停用的模型'), { code: 'profile_disabled' });
      }
    }

    await pool.query(
      `INSERT INTO ai_model_purpose_bindings (purpose, profile_id, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (purpose) DO UPDATE
       SET profile_id = EXCLUDED.profile_id,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()`,
      [purpose, profileId, actorUserId ?? null]
    );
    invalidateCache();
  }

  async resolveRuntime(purpose: AiModelPurpose): Promise<ResolvedRuntimeAiModel> {
    try {
      const data = await loadCache();
      return resolveFromProfiles(purpose, data.profiles, data.bindings);
    } catch (error) {
      console.warn('[AiModelConfig] resolveRuntime failed, fallback to env:', error);
      return envFallback(purpose);
    }
  }

  async resolveUploadParseOptions(): Promise<{ defaultModel: string; options: RuntimeModelOption[] }> {
    try {
      const data = await loadCache();
      const enabled = data.profiles.filter((item) => item.is_enabled === true);
      // Only models marked show_in_upload appear on the upload page dropdown.
      const listed = enabled.filter((item) => item.show_in_upload !== false);
      if (listed.length > 0) {
        const options = listed.map((item) => {
          const publicItem = toPublic(item);
          return {
            value: publicItem.modelValue,
            label: publicItem.name || publicItem.modelName,
          };
        });
        const boundId = data.bindings.get('upload_parse');
        const bound =
          boundId == null ? null : listed.find((item) => Number(item.id) === boundId) || null;
        const defaultModel = bound
          ? toPublic(bound).modelValue
          : options[0]?.value || '';
        return { defaultModel, options };
      }
    } catch (error) {
      console.warn('[AiModelConfig] resolveUploadParseOptions failed, fallback to env:', error);
    }

    const fallback = envFallback('upload_parse');
    return {
      defaultModel: fallback.modelValue,
      options: fallback.modelValue
        ? [{ value: fallback.modelValue, label: fallback.model || fallback.modelValue }]
        : [],
    };
  }

  async resolveCredentialForModel(
    purpose: AiModelPurpose,
    modelInput?: string
  ): Promise<ResolvedRuntimeAiModel> {
    const runtime = await this.resolveRuntime(purpose);
    const parsed = parsePrefixedModelValue(modelInput);
    const requestedModel = String(parsed.model || modelInput || '').trim();

    if (!requestedModel) {
      return runtime;
    }

    try {
      const data = await loadCache();
      const match = data.profiles.find((item) => {
        if (!item.is_enabled) return false;
        const publicItem = toPublic(item);
        if (publicItem.modelValue === String(modelInput || '').trim()) return true;
        if (publicItem.modelName === requestedModel) return true;
        return false;
      });
      if (match) {
        const provider = normalizeLlmProviderName(match.provider, 'openai') || 'openai';
        const model = String(match.model_name || '').trim();
        return {
          source: 'database',
          profileId: Number(match.id),
          profileName: match.name,
          purpose,
          provider,
          model,
          modelValue: buildPrefixedModelValue(provider, model),
          baseUrl: normalizeBaseUrl(match.base_url),
          apiKey: String(match.api_key || '').trim(),
        };
      }
    } catch (error) {
      console.warn('[AiModelConfig] resolveCredentialForModel failed:', error);
    }

    return {
      ...runtime,
      model: requestedModel || runtime.model,
      modelValue: buildPrefixedModelValue(runtime.provider, requestedModel || runtime.model),
    };
  }

  
  /**
   * Other enabled upload_parse candidates (show_in_upload) excluding the primary model.
   * Used for one-shot failover when the primary model returns empty/timeout.
   */
  async listAlternateUploadParseModels(excludeModel?: string): Promise<ResolvedRuntimeAiModel[]> {
    const exclude = String(excludeModel || '').trim().toLowerCase();
    try {
      const data = await loadCache();
      const enabled = data.profiles.filter((item) => item.is_enabled === true && item.show_in_upload !== false);
      const out: ResolvedRuntimeAiModel[] = [];
      for (const match of enabled) {
        const provider = normalizeLlmProviderName(match.provider, 'openai') || 'openai';
        const model = String(match.model_name || '').trim();
        if (!model) continue;
        if (exclude && (model.toLowerCase() === exclude || buildPrefixedModelValue(provider, model).toLowerCase() === exclude)) {
          continue;
        }
        out.push({
          source: 'database',
          profileId: Number(match.id),
          profileName: match.name,
          purpose: 'upload_parse',
          provider,
          model,
          modelValue: buildPrefixedModelValue(provider, model),
          baseUrl: normalizeBaseUrl(match.base_url),
          apiKey: String(match.api_key || '').trim(),
        });
      }
      return out;
    } catch (error) {
      console.warn('[AiModelConfig] listAlternateUploadParseModels failed:', error);
      return [];
    }
  }

async testConnectivity(input: {
    profileId?: number | null;
    name?: string;
    modelName?: string;
    baseUrl?: string;
    apiKey?: string;
    provider?: string;
  }): Promise<{
    ok: boolean;
    latencyMs: number;
    model: string;
    baseUrl: string;
    provider: string;
    preview: string;
    message: string;
  }> {
    let modelName = String(input.modelName || '').trim();
    let baseUrl = String(input.baseUrl || '').trim().replace(/\/+$/, '');
    let apiKey = String(input.apiKey || '').trim();
    let provider = normalizeLlmProviderName(input.provider, 'openai') || 'openai';

    if (input.profileId != null) {
      const existing = await this.getProfileById(Number(input.profileId));
      if (!existing) {
        throw Object.assign(new Error('模型配置不存在'), { code: 'not_found' });
      }
      if (!modelName) modelName = String(existing.model_name || '').trim();
      if (!baseUrl) baseUrl = String(existing.base_url || '').trim().replace(/\/+$/, '');
      if (!apiKey) apiKey = String(existing.api_key || '').trim();
      if (!input.provider) provider = normalizeLlmProviderName(existing.provider, 'openai') || 'openai';
    }

    if (!modelName) throw Object.assign(new Error('modelName 不能为空'), { code: 'invalid_model' });
    if (!baseUrl) throw Object.assign(new Error('baseUrl 不能为空'), { code: 'invalid_base_url' });
    if (!apiKey) throw Object.assign(new Error('apiKey 不能为空'), { code: 'invalid_api_key' });

    // validate url
    assertHttpUrl(baseUrl);

    const llm = createLlmProvider(provider, modelName, {
      apiKey,
      baseURL: baseUrl,
    });
    if (!llm.generate) {
      throw Object.assign(new Error(`Provider ${provider} 不支持 generate 测试`), { code: 'unsupported_provider' });
    }

    const started = Date.now();
    try {
      const result = await llm.generate(
        'Return a short JSON object confirming connectivity. Fields: status, message, model.',
        'You are a connectivity test assistant. Return JSON only, no markdown.',
        {
          maxOutputTokens: 256,
          temperature: 0,
          responseMimeType: 'application/json',
        }
      );
      const latencyMs = Date.now() - started;
      const preview = String(result?.text || '').trim();
      if (!preview) {
        return {
          ok: false,
          latencyMs,
          model: modelName,
          baseUrl,
          provider,
          preview: '',
          message: '模型返回为空，请检查模型名或中继配置',
        };
      }
      return {
        ok: true,
        latencyMs,
        model: modelName,
        baseUrl,
        provider,
        preview: preview.slice(0, 500),
        message: '连通性测试通过',
      };
    } catch (error: any) {
      const latencyMs = Date.now() - started;
      const message = String(error?.message || error || '连通性测试失败');
      return {
        ok: false,
        latencyMs,
        model: modelName,
        baseUrl,
        provider,
        preview: '',
        message,
      };
    }
  }

}

export const aiModelConfigService = new AiModelConfigService();
