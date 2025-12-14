import * as fs from 'fs';

const PDF_SIGNATURE = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export function validateFileSize(size: number): FileValidationResult {
  if (size <= 0) {
    return { valid: false, error: '文件大小无效' };
  }
  if (size > MAX_FILE_SIZE) {
    return { valid: false, error: `文件大小超过限制（最大${MAX_FILE_SIZE / 1024 / 1024}MB）` };
  }
  return { valid: true };
}

export function validateFileExtension(fileName: string): FileValidationResult {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext !== 'pdf') {
    return { valid: false, error: '仅支持PDF格式，请上传.pdf文件' };
  }
  return { valid: true };
}

export async function validateFileSignature(filePath: string): Promise<FileValidationResult> {
  try {
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);

    if (!buffer.equals(PDF_SIGNATURE)) {
      return { valid: false, error: '文件签名无效，不是有效的PDF文件' };
    }
    return { valid: true };
  } catch (error) {
    return { valid: false, error: '无法验证文件签名' };
  }
}

export async function validatePDFFile(
  filePath: string,
  fileName: string,
  fileSize: number
): Promise<FileValidationResult> {
  // 验证扩展名
  const extResult = validateFileExtension(fileName);
  if (!extResult.valid) return extResult;

  // 验证文件大小
  const sizeResult = validateFileSize(fileSize);
  if (!sizeResult.valid) return sizeResult;

  // 验证文件签名
  const sigResult = await validateFileSignature(filePath);
  if (!sigResult.valid) return sigResult;

  return { valid: true };
}
