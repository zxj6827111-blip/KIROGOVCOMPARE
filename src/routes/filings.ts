import { Router, Response } from 'express';
import { authMiddleware, AuthRequest, requirePermission } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import { filingService } from '../services/filing/FilingService';
import { buildBlankAnnualReportForm } from '../services/filing/BlankTemplateService';
import { importFilingFormFromUrl } from '../services/filing/FilingHtmlImportService';
import { filingBatchUrlImportService } from '../services/filing/FilingBatchUrlImportService';

const router = Router();

function assertRegionAllowed(regionId: number, allowed: number[] | null): boolean {
  if (allowed === null) return true;
  return allowed.includes(regionId);
}

function sendServiceError(res: Response, error: any) {
  const code = error?.code || 'INTERNAL_ERROR';
  const map: Record<string, number> = {
    REGION_NOT_FOUND: 404,
    FILING_NOT_FOUND: 404,
    FILING_NOT_EDITABLE: 409,
    FILING_NOT_SUBMITTABLE: 409,
    FILING_NOT_REOPENABLE: 409,
    FILING_NOT_DELETABLE: 409,
    FILING_SUBMIT_IN_PROGRESS: 409,
    FILING_SUBMIT_CANCELLED: 409,
    INVALID_FORM: 400,
    INVALID_INPUT: 400,
    INVALID_URL: 400,
    URL_SECURITY_REJECTED: 400,
    URL_FETCH_FAILED: 502,
    URL_REDIRECT_LIMIT: 400,
    URL_REDIRECT_INVALID: 400,
    URL_UNSUPPORTED_CONTENT: 400,
    IMPORT_EMPTY: 422,
    IMPORT_SPA_UNSUPPORTED: 422,
    IMPORT_PDF_ONLY: 422,
    IMPORT_LIST_PAGE: 422,
    REPORT_RESOLVE_FAILED: 500,
    FORBIDDEN_SCOPE: 403,
    INVALID_YEAR: 400,
  };
  const status = map[code] || 500;
  res.status(status).json({
    error: error?.message || 'request_failed',
    code,
    details: error?.errors || error?.status || undefined,
  });
}

router.use(authMiddleware);

/** Blank 国办六章 template */
// Register static paths BEFORE "/filings/:id" to avoid param capture (e.g. id="blank-template").
router.get('/filings/blank-template', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const year = req.query.year ? Number(req.query.year) : undefined;
    const regionId = req.query.regionId ? Number(req.query.regionId) : undefined;
    let unitName = '';
    if (regionId) {
      const allowed = await getAllowedRegionIdsAsync(req.user);
      if (!assertRegionAllowed(regionId, allowed)) {
        return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
      }
      const pool = (await import('../config/database-llm')).default;
      const r = await pool.query(`SELECT name FROM regions WHERE id = $1 LIMIT 1`, [regionId]);
      unitName = r.rows[0]?.name || '';
    }
    res.json({
      form_json: buildBlankAnnualReportForm({ year, regionId, unitName }),
    });
  } catch (error: any) {
    console.error('[filings] blank-template', error);
    res.status(500).json({ error: error.message || 'blank_template_failed' });
  }
});

router.get('/filings', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const allowed = await getAllowedRegionIdsAsync(req.user);
    const year = req.query.year ? Number(req.query.year) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const regionId = req.query.regionId ? Number(req.query.regionId) : undefined;

    if (regionId && !assertRegionAllowed(regionId, allowed)) {
      return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
    }

    const items = await filingService.list({
      year: Number.isFinite(year) ? year : undefined,
      status,
      regionId: Number.isFinite(regionId) ? regionId : undefined,
      allowedRegionIds: allowed,
    });
    res.json({ items });
  } catch (error: any) {
    console.error('[filings] list', error);
    res.status(500).json({ error: error.message || 'list_failed' });
  }
});

router.post('/filings', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const regionId = Number(req.body?.regionId ?? req.body?.region_id);
    const year = Number(req.body?.year);
    if (!Number.isFinite(regionId) || !Number.isFinite(year)) {
      return res.status(400).json({ error: 'regionId 与 year 必填', code: 'INVALID_INPUT' });
    }
    if (year < 2000 || year > 2100) {
      return res.status(400).json({ error: 'year 不合法', code: 'INVALID_YEAR' });
    }

    const allowed = await getAllowedRegionIdsAsync(req.user);
    if (!assertRegionAllowed(regionId, allowed)) {
      return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
    }

    const result = await filingService.createOrGet({
      regionId,
      year,
      userId: req.user?.id,
    });
    res.status(result.created ? 201 : 200).json(result);
  } catch (error: any) {
    console.error('[filings] create', error);
    sendServiceError(res, error);
  }
});

/**
 * Batch URL → rule-based form_json preview (no AI).
 * Registered before "/filings/:id" so path is not captured as id.
 * Body: { urls: string | string[], defaultYear?: number }
 */
router.post('/filings/batch-import-from-url/preview', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const allowed = await getAllowedRegionIdsAsync(req.user);
    const defaultYear = req.body?.defaultYear != null ? Number(req.body.defaultYear) : undefined;
    const result = await filingBatchUrlImportService.preview({
      urls: req.body?.urls ?? req.body?.urlList ?? '',
      defaultYear: Number.isFinite(defaultYear) ? defaultYear : undefined,
      allowedRegionIds: allowed,
    });
    res.json(result);
  } catch (error: any) {
    console.error('[filings] batch-import preview', error);
    sendServiceError(res, error);
  }
});

/**
 * Confirm batch write into report_filings drafts (no auto-submit / no AI).
 * Body: { items: [{ url, regionId, year, form_json? }] }
 */
router.post('/filings/batch-import-from-url/apply', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const allowed = await getAllowedRegionIdsAsync(req.user);
    const items = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!items.length) {
      return res.status(400).json({ error: 'items 必填', code: 'INVALID_INPUT' });
    }
    if (items.length > 50) {
      return res.status(400).json({ error: '单次最多 50 条', code: 'INVALID_INPUT' });
    }
    const result = await filingBatchUrlImportService.apply({
      items,
      userId: req.user?.id,
      allowedRegionIds: allowed,
    });
    res.json(result);
  } catch (error: any) {
    console.error('[filings] batch-import apply', error);
    sendServiceError(res, error);
  }
});

router.get('/filings/:id', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const filing = await filingService.getById(id);
    if (!filing) return res.status(404).json({ error: 'not_found', code: 'FILING_NOT_FOUND' });

    const allowed = await getAllowedRegionIdsAsync(req.user);
    if (!assertRegionAllowed(filing.region_id, allowed)) {
      return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
    }
    res.json({ filing });
  } catch (error: any) {
    console.error('[filings] get', error);
    res.status(500).json({ error: error.message || 'get_failed' });
  }
});

router.put('/filings/:id', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const filing = await filingService.getById(id);
    if (!filing) return res.status(404).json({ error: 'not_found', code: 'FILING_NOT_FOUND' });

    const allowed = await getAllowedRegionIdsAsync(req.user);
    if (!assertRegionAllowed(filing.region_id, allowed)) {
      return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
    }

    const formJson = req.body?.form_json ?? req.body?.formJson;
    if (!formJson) {
      return res.status(400).json({ error: 'form_json 必填', code: 'INVALID_INPUT' });
    }

    const updated = await filingService.updateDraft(id, formJson, req.user?.id);
    res.json({ filing: updated });
  } catch (error: any) {
    console.error('[filings] update', error);
    sendServiceError(res, error);
  }
});

router.post('/filings/:id/format-text', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const filing = await filingService.getById(id);
    if (!filing) return res.status(404).json({ error: 'not_found', code: 'FILING_NOT_FOUND' });

    const allowed = await getAllowedRegionIdsAsync(req.user);
    if (!assertRegionAllowed(filing.region_id, allowed)) {
      return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
    }

    const updated = await filingService.formatText(id, req.user?.id);
    res.json({ filing: updated });
  } catch (error: any) {
    console.error('[filings] format-text', error);
    sendServiceError(res, error);
  }
});

/**
 * Rule-based import from public annual-report HTML URL (no AI).
 * apply=true writes into draft; default preview only.
 */
router.post('/filings/:id/import-from-url', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const filing = await filingService.getById(id);
    if (!filing) return res.status(404).json({ error: 'not_found', code: 'FILING_NOT_FOUND' });

    const allowed = await getAllowedRegionIdsAsync(req.user);
    if (!assertRegionAllowed(filing.region_id, allowed)) {
      return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
    }

    if (filing.status !== 'draft' && filing.status !== 'checks_failed') {
      return res.status(409).json({
        error: '仅草稿或勾稽未通过状态可导入',
        code: 'FILING_NOT_EDITABLE',
      });
    }

    const url = String(req.body?.url || '').trim();
    const apply = Boolean(req.body?.apply);
    if (!url) {
      return res.status(400).json({ error: 'url 必填', code: 'INVALID_INPUT' });
    }

    const imported = await importFilingFormFromUrl(url, {
      year: filing.year,
      regionId: filing.region_id,
      unitName: filing.region_name || filing.unit_name || '',
    });

    if (!apply) {
      return res.json({
        preview: true,
        form_json: imported.form_json,
        finalUrl: imported.finalUrl,
        stats: imported.stats,
      });
    }

    const updated = await filingService.updateDraft(id, imported.form_json, req.user?.id);
    return res.json({
      preview: false,
      filing: updated,
      form_json: updated.form_json,
      finalUrl: imported.finalUrl,
      stats: imported.stats,
    });
  } catch (error: any) {
    console.error('[filings] import-from-url', error);
    if (error?.code === 'IMPORT_EMPTY') {
      return res.status(422).json({
        error: error.message,
        code: error.code,
        stats: error.stats,
      });
    }
    sendServiceError(res, error);
  }
});

router.post('/filings/:id/submit', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const filing = await filingService.getById(id);
    if (!filing) return res.status(404).json({ error: 'not_found', code: 'FILING_NOT_FOUND' });

    const allowed = await getAllowedRegionIdsAsync(req.user);
    if (!assertRegionAllowed(filing.region_id, allowed)) {
      return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
    }

    // Optional: save latest form_json before submit
    if (req.body?.form_json || req.body?.formJson) {
      await filingService.updateDraft(id, req.body.form_json ?? req.body.formJson, req.user?.id);
    }

    const result = await filingService.submit(id, req.user?.id);
    const httpStatus = result.gate.passed ? 200 : 422;
    res.status(httpStatus).json({
      filing: result.filing,
      versionId: result.versionId,
      reportId: result.reportId,
      gate: {
        passed: result.gate.passed,
        failCount: result.gate.failCount,
        fails: result.gate.fails,
        warnings: result.gate.warnings,
        summary: result.gate.summary,
      },
    });
  } catch (error: any) {
    console.error('[filings] submit', error);
    sendServiceError(res, error);
  }
});

router.get('/filings/:id/check-result', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const filing = await filingService.getById(id);
    if (!filing) return res.status(404).json({ error: 'not_found', code: 'FILING_NOT_FOUND' });

    const allowed = await getAllowedRegionIdsAsync(req.user);
    if (!assertRegionAllowed(filing.region_id, allowed)) {
      return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
    }

    res.json({
      status: filing.status,
      last_check_run_id: filing.last_check_run_id,
      last_check_summary_json: filing.last_check_summary_json,
      draft_version_id: filing.draft_version_id,
      effective_version_id: filing.effective_version_id,
      report_id: filing.report_id,
      active_version_id: filing.active_version_id,
    });
  } catch (error: any) {
    console.error('[filings] check-result', error);
    res.status(500).json({ error: error.message || 'check_result_failed' });
  }
});

router.post('/filings/:id/reopen', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const filing = await filingService.getById(id);
    if (!filing) return res.status(404).json({ error: 'not_found', code: 'FILING_NOT_FOUND' });

    const allowed = await getAllowedRegionIdsAsync(req.user);
    if (!assertRegionAllowed(filing.region_id, allowed)) {
      return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
    }

    const updated = await filingService.reopen(id, req.user?.id);
    res.json({ filing: updated });
  } catch (error: any) {
    console.error('[filings] reopen', error);
    sendServiceError(res, error);
  }
});

router.delete('/filings/:id', requirePermission('file_reports'), async (req: AuthRequest, res) => {
  try {
    const id = Number(req.params.id);
    const filing = await filingService.getById(id);
    if (!filing) return res.status(404).json({ error: 'not_found', code: 'FILING_NOT_FOUND' });

    const allowed = await getAllowedRegionIdsAsync(req.user);
    if (!assertRegionAllowed(filing.region_id, allowed)) {
      return res.status(403).json({ error: '超出数据权限范围', code: 'FORBIDDEN_SCOPE' });
    }

    const result = await filingService.remove(id);
    res.json({ ok: true, ...result });
  } catch (error: any) {
    console.error('[filings] delete', error);
    sendServiceError(res, error);
  }
});

export default router;
