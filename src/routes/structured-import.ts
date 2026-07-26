import express from 'express';
import multer from 'multer';
import fs from 'fs';
import fsPromises from 'fs/promises';
import { UPLOADS_TMP_DIR } from '../config/constants';
import { authMiddleware, requirePermission, AuthRequest } from '../middleware/auth';
import { getAllowedRegionIdsAsync } from '../utils/dataScope';
import { structuredImportService } from '../services/structured-import/StructuredImportService';
import {
  STRUCTURED_PACKAGE_ERROR_CODES,
  STRUCTURED_PACKAGE_ERROR_MESSAGES,
  STRUCTURED_PACKAGE_LIMITS,
  StructuredPackageError,
} from '../config/structuredPackage';

const router = express.Router();
const tempDir = UPLOADS_TMP_DIR;
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// Structured package import (.kirogov.zip) — no LLM on the request path.
const structuredImportUpload = multer({
  storage: multer.diskStorage({
    destination: tempDir,
    filename: (_req, file, cb) => {
      const safeName = String(file.originalname || 'package.kirogov.zip')
        .replace(/[^\w.\u4e00-\u9fff\-]+/g, '_')
        .slice(0, 120);
      cb(null, `${Date.now()}-${safeName}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.kirogov.zip')) {
      cb(null, true);
    } else {
      cb(new Error('only .kirogov.zip packages are accepted'));
    }
  },
  limits: {
    fileSize: STRUCTURED_PACKAGE_LIMITS.maxZipBytes,
    files: 1,
  },
});

const handleStructuredImportUpload: express.RequestHandler = (req, res, next) => {
  structuredImportUpload.single('file')(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      return res.status(status).json({
        error: error.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'invalid_upload',
        code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_TOO_LARGE,
        message: STRUCTURED_PACKAGE_ERROR_MESSAGES.ZIP_TOO_LARGE,
        maxBytes: STRUCTURED_PACKAGE_LIMITS.maxZipBytes,
      });
    }
    if (error) {
      return res.status(400).json({
        error: error.message || 'invalid_upload',
        code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID,
        message: error.message || STRUCTURED_PACKAGE_ERROR_MESSAGES.ZIP_INVALID,
      });
    }
    next();
  });
};

/**
 * POST /reports/structured-import
 * Upload a validated .kirogov.zip package and enqueue structured_import (no AI).
 */
router.post(
  '/reports/structured-import',
  authMiddleware,
  requirePermission('upload_reports'),
  handleStructuredImportUpload,
  async (req: AuthRequest, res) => {
    const tmpFilePath = req.file?.path;
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const regionId = Number(req.body.region_id);
      const year = Number(req.body.year);
      const unitNameRaw = req.body.unit_name ?? req.body.unitName;
      const unitName = typeof unitNameRaw === 'string' && unitNameRaw.trim() ? unitNameRaw.trim() : null;
      const file = req.file;

      if (!regionId || Number.isNaN(regionId) || !Number.isInteger(regionId)) {
        return res.status(400).json({ error: 'region_id 无效', code: 'INVALID_REGION' });
      }

      const allowedRegionIds = await getAllowedRegionIdsAsync(req.user);
      if (allowedRegionIds) {
        if (allowedRegionIds.length === 0 || !allowedRegionIds.includes(regionId)) {
          return res.status(403).json({ error: 'forbidden' });
        }
      }

      if (!year || Number.isNaN(year) || !Number.isInteger(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ error: 'year 无效', code: 'INVALID_YEAR' });
      }

      if (!file) {
        return res.status(400).json({
          error: 'file 不能为空',
          code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID,
          message: '请上传 .kirogov.zip 材料包',
        });
      }

      const originalName = String(file.originalname || 'package.kirogov.zip');
      const lower = originalName.toLowerCase();
      if (!lower.endsWith('.kirogov.zip')) {
        return res.status(400).json({
          error: 'invalid_extension',
          code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID,
          message: '仅支持 .kirogov.zip 材料包',
        });
      }

      const result = await structuredImportService.processImport({
        regionId,
        year,
        unitName,
        tempZipPath: file.path,
        originalName,
        size: file.size,
        createdBy: req.user.id ?? null,
      });

      return res.status(201).json({
        report_id: result.reportId,
        version_id: result.versionId,
        job_id: result.jobId,
        package_sha256: result.packageSha256,
        storage_path: result.storagePath,
        reused_version: result.reusedVersion,
        reused_job: result.reusedJob,
        ingestion_mode: result.ingestionMode,
      });
    } catch (error: any) {
      if (error?.message === 'region_not_found') {
        return res.status(404).json({ error: 'region not found' });
      }
      if (error instanceof StructuredPackageError) {
        return res.status(400).json({
          error: error.code,
          code: error.code,
          message: error.message,
          details: error.details ?? undefined,
        });
      }
      console.error('Structured import error:', error?.message || error);
      return res.status(500).json({
        error: 'structured_import_failed',
        message: '材料包导入失败，请稍后重试',
      });
    } finally {
      if (tmpFilePath) {
        await fsPromises.unlink(tmpFilePath).catch(() => undefined);
      }
    }
  }
);



export default router;
