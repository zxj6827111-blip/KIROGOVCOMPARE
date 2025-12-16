import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { reportUploadService } from '../services/ReportUploadService';

const router = express.Router();

const tempDir = path.join(process.cwd(), 'data', 'uploads', 'tmp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: tempDir,
    filename: (_req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 PDF 文件'));
    }
  },
});

router.post('/reports', upload.single('file'), async (req, res) => {
  try {
    const regionId = Number(req.body.region_id);
    const year = Number(req.body.year);
    const file = req.file;

    if (!regionId || Number.isNaN(regionId) || !Number.isInteger(regionId)) {
      return res.status(400).json({ error: 'region_id 无效' });
    }

    if (!year || Number.isNaN(year) || !Number.isInteger(year)) {
      return res.status(400).json({ error: 'year 无效' });
    }

    if (!file) {
      return res.status(400).json({ error: 'file 不能为空' });
    }

    if (file.mimetype !== 'application/pdf' && !file.originalname.toLowerCase().endsWith('.pdf')) {
      fs.unlink(file.path, () => undefined);
      return res.status(400).json({ error: '仅支持 PDF 文件' });
    }

    const result = await reportUploadService.processUpload({
      regionId,
      year,
      tempFilePath: file.path,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    });

    const statusCode = result.reusedVersion ? 409 : 201;
    return res.status(statusCode).json({
      report_id: result.reportId,
      version_id: result.versionId,
      job_id: result.jobId,
      file_hash: result.fileHash,
      storage_path: result.storagePath,
      reused_version: result.reusedVersion,
      reused_job: result.reusedJob,
    });
  } catch (error: any) {
    if (error?.message === 'region_not_found') {
      return res.status(404).json({ error: 'region 不存在' });
    }
    if (error?.message === 'version_not_created') {
      return res.status(500).json({ error: 'report version 创建失败' });
    }

    if (typeof error?.message === 'string' && error.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: '记录已存在' });
    }

    if (error instanceof multer.MulterError) {
      return res.status(400).json({ error: `上传错误: ${error.message}` });
    }

    console.error('Upload error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
