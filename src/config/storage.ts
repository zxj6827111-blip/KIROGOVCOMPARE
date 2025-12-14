import * as fs from 'fs';
import * as path from 'path';

export interface StorageConfig {
  type: 'local' | 's3';
  path?: string;
  bucket?: string;
  region?: string;
}

const storageConfig: StorageConfig = {
  type: (process.env.STORAGE_TYPE as 'local' | 's3') || 'local',
  path: process.env.STORAGE_PATH || './uploads',
  bucket: process.env.S3_BUCKET,
  region: process.env.AWS_REGION,
};

// 确保本地存储目录存在
if (storageConfig.type === 'local' && storageConfig.path) {
  if (!fs.existsSync(storageConfig.path)) {
    fs.mkdirSync(storageConfig.path, { recursive: true });
  }
}

export default storageConfig;
