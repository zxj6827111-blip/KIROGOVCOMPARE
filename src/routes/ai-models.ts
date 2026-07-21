import express from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import {
  AI_MODEL_PURPOSE_LABELS,
  AI_MODEL_PURPOSES,
  AiModelPurpose,
  aiModelConfigService,
} from '../services/AiModelConfigService';

const router = express.Router();

function canManageAiModels(user: AuthRequest['user']): boolean {
  const permissions = user?.permissions || {};
  return permissions.system_admin === true || permissions.manage_users === true;
}

function requireAiModelAdmin(req: AuthRequest, res: express.Response, next: express.NextFunction) {
  if (!canManageAiModels(req.user)) {
    return res.status(403).json({ error: 'forbidden', message: '仅管理员可管理 AI 模型配置' });
  }
  return next();
}

function parsePurpose(raw: unknown): AiModelPurpose | null {
  const value = String(raw || '').trim();
  return (AI_MODEL_PURPOSES as string[]).includes(value) ? (value as AiModelPurpose) : null;
}

router.use(authMiddleware);
router.use(requireAiModelAdmin);

router.get('/models', async (_req: AuthRequest, res) => {
  try {
    const [profiles, bindings] = await Promise.all([
      aiModelConfigService.listProfiles(),
      aiModelConfigService.listPurposeBindings(),
    ]);
    return res.json({
      profiles,
      purposes: AI_MODEL_PURPOSES.map((purpose) => ({
        purpose,
        label: AI_MODEL_PURPOSE_LABELS[purpose],
      })),
      bindings,
    });
  } catch (error: any) {
    console.error('[AI Models] list failed:', error);
    return res.status(500).json({ error: 'list_failed', message: error?.message || '加载失败' });
  }
});

router.post('/models', async (req: AuthRequest, res) => {
  try {
    const body = req.body || {};
    const profile = await aiModelConfigService.createProfile({
      name: body.name,
      modelName: body.modelName ?? body.model_name,
      baseUrl: body.baseUrl ?? body.base_url,
      apiKey: body.apiKey ?? body.api_key,
      provider: body.provider,
      isEnabled: body.isEnabled ?? body.is_enabled,
      showInUpload: body.showInUpload ?? body.show_in_upload,
      sortOrder: body.sortOrder ?? body.sort_order,
      actorUserId: req.user?.id ?? null,
    });
    return res.status(201).json({ profile });
  } catch (error: any) {
    const code = error?.code || 'create_failed';
    const status = code === 'invalid_base_url' || code === 'invalid_name' || code === 'invalid_model' || code === 'invalid_api_key' ? 400 : 500;
    return res.status(status).json({ error: code, message: error?.message || '创建失败' });
  }
});

router.put('/models/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'invalid_id', message: 'id 无效' });
    }

    const body = req.body || {};
    const profile = await aiModelConfigService.updateProfile(id, {
      name: body.name,
      modelName: body.modelName ?? body.model_name,
      baseUrl: body.baseUrl ?? body.base_url,
      apiKey: body.apiKey ?? body.api_key,
      provider: body.provider,
      isEnabled: body.isEnabled ?? body.is_enabled,
      showInUpload: body.showInUpload ?? body.show_in_upload,
      sortOrder: body.sortOrder ?? body.sort_order,
      actorUserId: req.user?.id ?? null,
    });
    return res.json({ profile });
  } catch (error: any) {
    const code = error?.code || 'update_failed';
    const status =
      code === 'not_found'
        ? 404
        : code === 'invalid_base_url' || code === 'invalid_name' || code === 'invalid_model' || code === 'invalid_api_key'
          ? 400
          : 500;
    return res.status(status).json({ error: code, message: error?.message || '更新失败' });
  }
});

router.delete('/models/:id', async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'invalid_id', message: 'id 无效' });
    }
    await aiModelConfigService.deleteProfile(id);
    return res.json({ ok: true });
  } catch (error: any) {
    const code = error?.code || 'delete_failed';
    const status = code === 'not_found' ? 404 : 500;
    return res.status(status).json({ error: code, message: error?.message || '删除失败' });
  }
});


router.post('/models/test', async (req: AuthRequest, res) => {
  try {
    const body = req.body || {};
    const profileIdRaw = body.profileId ?? body.profile_id ?? body.id;
    const profileId =
      profileIdRaw === undefined || profileIdRaw === null || profileIdRaw === ''
        ? null
        : Number(profileIdRaw);

    if (profileId != null && (!Number.isInteger(profileId) || profileId < 1)) {
      return res.status(400).json({ error: 'invalid_id', message: 'profileId 无效' });
    }

    const result = await aiModelConfigService.testConnectivity({
      profileId,
      name: body.name,
      modelName: body.modelName ?? body.model_name,
      baseUrl: body.baseUrl ?? body.base_url,
      apiKey: body.apiKey ?? body.api_key,
      provider: body.provider,
    });

    return res.status(result.ok ? 200 : 502).json(result);
  } catch (error: any) {
    const code = error?.code || 'test_failed';
    const status =
      code === 'not_found'
        ? 404
        : code === 'invalid_base_url' || code === 'invalid_model' || code === 'invalid_api_key'
          ? 400
          : 500;
    return res.status(status).json({
      ok: false,
      error: code,
      message: error?.message || '连通性测试失败',
    });
  }
});

router.put('/bindings/:purpose', async (req: AuthRequest, res) => {
  try {
    const purpose = parsePurpose(req.params.purpose);
    if (!purpose) {
      return res.status(400).json({ error: 'invalid_purpose', message: '用途无效' });
    }

    const rawProfileId = req.body?.profileId ?? req.body?.profile_id;
    let profileId: number | null = null;
    if (rawProfileId !== null && rawProfileId !== undefined && rawProfileId !== '' && rawProfileId !== 'env') {
      profileId = Number(rawProfileId);
      if (!Number.isInteger(profileId) || profileId < 1) {
        return res.status(400).json({ error: 'invalid_profile_id', message: 'profileId 无效' });
      }
    }

    await aiModelConfigService.setPurposeBinding(purpose, profileId, req.user?.id ?? null);
    const bindings = await aiModelConfigService.listPurposeBindings();
    return res.json({
      ok: true,
      binding: bindings.find((item) => item.purpose === purpose) || null,
      bindings,
    });
  } catch (error: any) {
    const code = error?.code || 'bind_failed';
    const status = code === 'not_found' || code === 'profile_disabled' || code === 'invalid_purpose' ? 400 : 500;
    return res.status(status).json({ error: code, message: error?.message || '绑定失败' });
  }
});

export default router;
