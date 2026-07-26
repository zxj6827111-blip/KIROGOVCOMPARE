import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import yauzl, { Entry, ZipFile } from 'yauzl';
import {
  STRUCTURED_PACKAGE_ERROR_CODES,
  STRUCTURED_PACKAGE_LIMITS,
  STRUCTURED_PACKAGE_REQUIRED_FILES,
  StructuredPackageError,
  StructuredPackageRequiredFile,
} from '../../config/structuredPackage';

export interface ZipEntryMeta {
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
  isEncrypted: boolean;
  isSymlink: boolean;
}

export interface ZipInspectionResult {
  entries: ZipEntryMeta[];
  totalUncompressed: number;
  totalCompressed: number;
}

export interface ExtractedPackageFiles {
  extractDir: string;
  files: Record<StructuredPackageRequiredFile, string>;
  entryMeta: Record<StructuredPackageRequiredFile, ZipEntryMeta>;
}

const PDF_SIGNATURE = Buffer.from([0x25, 0x50, 0x44, 0x46]); // %PDF
const ZIP_LOCAL_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const ZIP_EMPTY_SIGNATURE = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
const ZIP_SPANNED_SIGNATURE = Buffer.from([0x50, 0x4b, 0x07, 0x08]);

/**
 * Map a raw yauzl error onto the most specific structured error code.
 *
 * This ONLY improves error attribution for the UI/ops — every security
 * decision is still made by our own checks (validateZipEntryName,
 * validateEntrySet, per-byte extraction caps). yauzl rejecting first simply
 * means we surface a more precise code than a blanket ZIP_CORRUPT; message
 * matching is never used to ACCEPT anything.
 */
export function classifyYauzlError(err: unknown): StructuredPackageError {
  const msg = String((err as Error | undefined)?.message || '').toLowerCase();
  let code: (typeof STRUCTURED_PACKAGE_ERROR_CODES)[keyof typeof STRUCTURED_PACKAGE_ERROR_CODES] =
    STRUCTURED_PACKAGE_ERROR_CODES.ZIP_CORRUPT;

  if (msg.includes('invalid relative path')) {
    // yauzl: "invalid relative path: ../evil" (backslashes are normalized first,
    // so this also covers "..\" traversal)
    code = STRUCTURED_PACKAGE_ERROR_CODES.ZIP_PATH_TRAVERSAL;
  } else if (msg.includes('absolute path')) {
    // yauzl: "absolute path: /etc/passwd" (also covers UNC \\srv\share names)
    code = STRUCTURED_PACKAGE_ERROR_CODES.ZIP_ABSOLUTE_PATH;
  } else if (msg.includes('invalid characters in filename') || msg.includes('backslash')) {
    code = STRUCTURED_PACKAGE_ERROR_CODES.ZIP_PATH_TRAVERSAL;
  } else if (msg.includes('strong encryption') || msg.includes('encrypted') || msg.includes('encryption')) {
    code = STRUCTURED_PACKAGE_ERROR_CODES.ZIP_ENCRYPTED;
  } else if (msg.includes('end of central directory record signature not found')) {
    // Local magic bytes matched (we pre-check them) but the central directory
    // is unreadable => truncated/corrupt archive.
    code = STRUCTURED_PACKAGE_ERROR_CODES.ZIP_CORRUPT;
  } else if (msg.includes('multi-disk') || msg.includes('spanned')) {
    code = STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID;
  }

  return new StructuredPackageError(code, undefined, { cause: (err as Error | undefined)?.message });
}

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (err, zip) => {
      if (err || !zip) {
        reject(classifyYauzlError(err));
        return;
      }
      resolve(zip);
    });
  });
}

function isWindowsDrivePath(name: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(name) || name.startsWith('\\\\');
}

function isAbsoluteZipPath(name: string): boolean {
  return name.startsWith('/') || name.startsWith('\\') || isWindowsDrivePath(name);
}

function hasPathTraversal(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts.some((p) => p === '..');
}

function hasSubdirectory(name: string): boolean {
  const normalized = name.replace(/\\/g, '/');
  return normalized.includes('/');
}

function isEncryptedEntry(entry: Entry): boolean {
  // Bit 0 of general purpose bit flag indicates encryption.
  return Boolean(entry.generalPurposeBitFlag & 0x1);
}

function isSymlinkEntry(entry: Entry): boolean {
  // External file attributes: upper 16 bits are Unix mode when made by Unix.
  const attrs = entry.externalFileAttributes >>> 16;
  if (!attrs) return false;
  // S_IFLNK = 0o120000
  return (attrs & 0o170000) === 0o120000;
}

function isDirectoryEntry(entry: Entry): boolean {
  const name = entry.fileName.replace(/\\/g, '/');
  if (name.endsWith('/')) return true;
  const attrs = entry.externalFileAttributes >>> 16;
  if (attrs && (attrs & 0o170000) === 0o040000) return true;
  return false;
}

function hasNestedArchiveExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return STRUCTURED_PACKAGE_LIMITS.nestedArchiveExtensions.some((ext) => lower.endsWith(ext));
}

function maxUncompressedForName(fileName: string): number {
  const lower = fileName.toLowerCase();
  if (lower === 'source.pdf') return STRUCTURED_PACKAGE_LIMITS.maxPdfBytes;
  if (lower === 'source.md') return STRUCTURED_PACKAGE_LIMITS.maxMarkdownBytes;
  if (lower === 'source.json') return STRUCTURED_PACKAGE_LIMITS.maxJsonBytes;
  return STRUCTURED_PACKAGE_LIMITS.maxJsonBytes;
}

/**
 * Reject unsafe entry names before any extraction.
 */
export function validateZipEntryName(fileName: string): void {
  if (!fileName || !fileName.trim()) {
    throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID, 'ZIP 条目文件名为空');
  }
  if (isAbsoluteZipPath(fileName)) {
    throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_ABSOLUTE_PATH);
  }
  if (hasPathTraversal(fileName)) {
    throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_PATH_TRAVERSAL);
  }
  if (hasSubdirectory(fileName)) {
    throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_SUBDIRECTORY);
  }
  // Null byte injection
  if (fileName.includes('\0')) {
    throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_PATH_TRAVERSAL, 'ZIP 路径包含非法字符');
  }
}

/**
 * Inspect ZIP central directory without extracting payloads.
 */
export async function inspectZipArchive(zipPath: string): Promise<ZipInspectionResult> {
  const stat = await fsp.stat(zipPath);
  if (stat.size <= 0) {
    throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID, 'ZIP 文件为空');
  }
  if (stat.size > STRUCTURED_PACKAGE_LIMITS.maxZipBytes) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.ZIP_TOO_LARGE,
      `ZIP 大小超过限制（最大 ${Math.floor(STRUCTURED_PACKAGE_LIMITS.maxZipBytes / 1024 / 1024)}MB）`
    );
  }

  // Quick magic-byte check
  const fd = await fsp.open(zipPath, 'r');
  try {
    const header = Buffer.alloc(4);
    await fd.read(header, 0, 4, 0);
    const isZip =
      header.equals(ZIP_LOCAL_SIGNATURE) ||
      header.equals(ZIP_EMPTY_SIGNATURE) ||
      header.equals(ZIP_SPANNED_SIGNATURE);
    if (!isZip) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID);
    }
  } finally {
    await fd.close();
  }

  const zip = await openZip(zipPath);
  const entries: ZipEntryMeta[] = [];
  let totalUncompressed = 0;
  let totalCompressed = 0;

  try {
    await new Promise<void>((resolve, reject) => {
      zip.readEntry();
      zip.on('entry', (entry: Entry) => {
        try {
          const isDirectory = isDirectoryEntry(entry);
          const encrypted = isEncryptedEntry(entry);
          const symlink = isSymlinkEntry(entry);
          const fileName = entry.fileName;

          if (encrypted) {
            throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_ENCRYPTED);
          }
          if (symlink) {
            throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_SYMLINK);
          }
          if (isDirectory) {
            throw new StructuredPackageError(
              STRUCTURED_PACKAGE_ERROR_CODES.ZIP_SUBDIRECTORY,
              '第一版材料包不允许目录条目'
            );
          }

          validateZipEntryName(fileName);

          if (hasNestedArchiveExtension(fileName)) {
            throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_NESTED_ARCHIVE);
          }

          const compressedSize = Number(entry.compressedSize || 0);
          const uncompressedSize = Number(entry.uncompressedSize || 0);

          if (uncompressedSize > maxUncompressedForName(fileName)) {
            throw new StructuredPackageError(
              STRUCTURED_PACKAGE_ERROR_CODES.ZIP_TOO_LARGE,
              `文件 ${fileName} 解压后超过大小限制`
            );
          }

          if (compressedSize > 0) {
            const ratio = uncompressedSize / compressedSize;
            if (ratio > STRUCTURED_PACKAGE_LIMITS.maxCompressionRatio) {
              throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_BOMB);
            }
          } else if (uncompressedSize > 1024 * 1024) {
            // Zero compressed size with large claimed uncompressed size
            throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_BOMB);
          }

          totalUncompressed += uncompressedSize;
          totalCompressed += compressedSize;
          if (totalUncompressed > STRUCTURED_PACKAGE_LIMITS.maxUncompressedTotalBytes) {
            throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_TOO_LARGE);
          }

          entries.push({
            fileName,
            compressedSize,
            uncompressedSize,
            isDirectory: false,
            isEncrypted: false,
            isSymlink: false,
          });

          zip.readEntry();
        } catch (error) {
          reject(error);
        }
      });
      zip.on('end', () => resolve());
      zip.on('error', (err) => {
        reject(classifyYauzlError(err));
      });
    });
  } finally {
    zip.close();
  }

  validateEntrySet(entries);

  return { entries, totalUncompressed, totalCompressed };
}

function validateEntrySet(entries: ZipEntryMeta[]): void {
  if (entries.length !== STRUCTURED_PACKAGE_LIMITS.maxFileCount) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.ZIP_FILE_COUNT,
      `ZIP 内文件数量为 ${entries.length}，必须恰好为 ${STRUCTURED_PACKAGE_LIMITS.maxFileCount} 个`
    );
  }

  const names = entries.map((e) => e.fileName);
  const lowerMap = new Map<string, string>();
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lowerMap.has(lower)) {
      const prev = lowerMap.get(lower)!;
      if (prev === name) {
        throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_DUPLICATE_NAME);
      }
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_CASE_CONFLICT);
    }
    lowerMap.set(lower, name);
  }

  const required = new Set(STRUCTURED_PACKAGE_REQUIRED_FILES.map((n) => n.toLowerCase()));
  for (const name of names) {
    if (!required.has(name.toLowerCase())) {
      throw new StructuredPackageError(
        STRUCTURED_PACKAGE_ERROR_CODES.ZIP_EXTRA_FILES,
        `不允许的文件: ${name}`
      );
    }
    // Enforce exact casing for required names
    if (!STRUCTURED_PACKAGE_REQUIRED_FILES.includes(name as StructuredPackageRequiredFile)) {
      throw new StructuredPackageError(
        STRUCTURED_PACKAGE_ERROR_CODES.ZIP_EXTRA_FILES,
        `文件名必须严格为 ${STRUCTURED_PACKAGE_REQUIRED_FILES.join(', ')}，当前为 ${name}`
      );
    }
  }

  for (const req of STRUCTURED_PACKAGE_REQUIRED_FILES) {
    if (!names.includes(req)) {
      if (req === 'source.pdf') {
        throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MISSING_SOURCE_PDF);
      }
      if (req === 'source.md') {
        throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MISSING_SOURCE_MD);
      }
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MISSING_SOURCE_JSON);
    }
  }
}

/**
 * Validate PDF magic bytes.
 */
export async function assertPdfSignature(filePath: string): Promise<void> {
  const fd = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(8);
    await fd.read(buf, 0, 8, 0);
    // Require full "%PDF-" magic (not merely "%PDF")
    if (!buf.subarray(0, 5).equals(Buffer.from('%PDF-', 'ascii'))) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.PDF_TYPE_INVALID);
    }
  } finally {
    await fd.close();
  }
}

/**
 * Markdown: reject binary-looking content and nested zip magic.
 */
export async function assertMarkdownContent(filePath: string): Promise<void> {
  const stat = await fsp.stat(filePath);
  if (stat.size <= 0) {
    throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MD_TYPE_INVALID, 'source.md 为空');
  }
  if (stat.size > STRUCTURED_PACKAGE_LIMITS.maxMarkdownBytes) {
    throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_TOO_LARGE, 'source.md 超过大小限制');
  }
  const fd = await fsp.open(filePath, 'r');
  try {
    const sampleSize = Math.min(stat.size, 4096);
    const buf = Buffer.alloc(sampleSize);
    await fd.read(buf, 0, sampleSize, 0);
    if (buf.subarray(0, 4).equals(ZIP_LOCAL_SIGNATURE) || buf.subarray(0, 4).equals(PDF_SIGNATURE)) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MD_TYPE_INVALID, 'source.md 文件签名异常');
    }
    // Reject high ratio of null / control bytes (excluding common whitespace)
    let binary = 0;
    for (let i = 0; i < buf.length; i++) {
      const c = buf[i];
      if (c === 0) binary += 2;
      else if (c < 9 || (c > 13 && c < 32)) binary += 1;
    }
    if (binary / Math.max(buf.length, 1) > 0.05) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MD_TYPE_INVALID, 'source.md 疑似二进制内容');
    }
  } finally {
    await fd.close();
  }
}

function extractEntryToFile(zip: ZipFile, entry: Entry, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, readStream) => {
      if (err || !readStream) {
        reject(classifyYauzlError(err));
        return;
      }
      const writeStream = fs.createWriteStream(destPath);
      let written = 0;
      let settled = false;
      const maxSize = maxUncompressedForName(entry.fileName);

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        readStream.destroy();
        writeStream.destroy();
        fs.unlink(destPath, () => undefined);
        reject(error);
      };

      readStream.on('data', (chunk: Buffer) => {
        written += chunk.length;
        if (written > maxSize) {
          fail(
            new StructuredPackageError(
              STRUCTURED_PACKAGE_ERROR_CODES.ZIP_TOO_LARGE,
              `解压 ${entry.fileName} 时超过大小限制`
            )
          );
        }
      });
      readStream.on('error', (e) => fail(e));
      writeStream.on('error', (e) => fail(e));
      writeStream.on('finish', () => {
        if (settled) return;
        settled = true;
        resolve();
      });
      readStream.pipe(writeStream);
    });
  });
}

/**
 * Safely extract the three required files into extractDir after inspectZipArchive validation.
 * Caller must clean up extractDir (use safeExtractStructuredPackage which always cleans on failure).
 */
export async function extractStructuredPackage(
  zipPath: string,
  extractDir: string
): Promise<ExtractedPackageFiles> {
  const inspection = await inspectZipArchive(zipPath);
  await fsp.mkdir(extractDir, { recursive: true });

  const zip = await openZip(zipPath);
  const files = {} as Record<StructuredPackageRequiredFile, string>;
  const entryMeta = {} as Record<StructuredPackageRequiredFile, ZipEntryMeta>;

  try {
    await new Promise<void>((resolve, reject) => {
      zip.readEntry();
      zip.on('entry', (entry: Entry) => {
        (async () => {
          try {
            const name = entry.fileName as StructuredPackageRequiredFile;
            const dest = path.join(extractDir, name);
            // Defense in depth: ensure dest stays under extractDir (path.relative is safer than startsWith on Windows)
            const resolvedDest = path.resolve(dest);
            const resolvedRoot = path.resolve(extractDir);
            const rel = path.relative(resolvedRoot, resolvedDest);
            if (rel.startsWith('..') || path.isAbsolute(rel)) {
              throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_PATH_TRAVERSAL);
            }
            await extractEntryToFile(zip, entry, dest);
            files[name] = dest;
            const meta = inspection.entries.find((e) => e.fileName === name);
            if (meta) entryMeta[name] = meta;
            zip.readEntry();
          } catch (error) {
            reject(error);
          }
        })();
      });
      zip.on('end', () => resolve());
      zip.on('error', (err) => {
        reject(classifyYauzlError(err));
      });
    });
  } finally {
    zip.close();
  }

  // Post-extract type checks
  await assertPdfSignature(files['source.pdf']);
  await assertMarkdownContent(files['source.md']);

  for (const req of STRUCTURED_PACKAGE_REQUIRED_FILES) {
    if (!files[req] || !fs.existsSync(files[req])) {
      if (req === 'source.pdf') {
        throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MISSING_SOURCE_PDF);
      }
      if (req === 'source.md') {
        throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MISSING_SOURCE_MD);
      }
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.MISSING_SOURCE_JSON);
    }
    const st = await fsp.stat(files[req]);
    if (st.size > maxUncompressedForName(req)) {
      throw new StructuredPackageError(STRUCTURED_PACKAGE_ERROR_CODES.ZIP_TOO_LARGE);
    }
  }

  return { extractDir, files, entryMeta };
}

/**
 * Extract with automatic cleanup of extractDir on failure.
 */
export async function safeExtractStructuredPackage(
  zipPath: string,
  extractDir: string
): Promise<ExtractedPackageFiles> {
  try {
    return await extractStructuredPackage(zipPath, extractDir);
  } catch (error) {
    await fsp.rm(extractDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Remove temporary extract directory (idempotent).
 */
export async function cleanupExtractDir(extractDir: string | null | undefined): Promise<void> {
  if (!extractDir) return;
  try {
    await fsp.rm(extractDir, { recursive: true, force: true });
  } catch (error: any) {
    console.warn(
      `[ZipSecurity] Failed to cleanup extract dir ${extractDir}:`,
      error?.message || error
    );
  }
}
