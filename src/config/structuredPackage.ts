/**
 * Central limits and constants for structured package import (.kirogov.zip).
 * Do not scatter these numbers across services.
 */

export const STRUCTURED_PACKAGE_SCHEMA_VERSION = '1.0';
export const STRUCTURED_PACKAGE_VERSION = '1.0';

/** Fixed entry names inside the ZIP (first version). */
export const STRUCTURED_PACKAGE_REQUIRED_FILES = [
  'source.pdf',
  'source.md',
  'source.json',
] as const;

export type StructuredPackageRequiredFile = (typeof STRUCTURED_PACKAGE_REQUIRED_FILES)[number];

export const STRUCTURED_PACKAGE_LIMITS = {
  /** Max uploaded ZIP size (align with REPORT_UPLOAD_MAX_BYTES default 50MB). */
  maxZipBytes: Number(process.env.STRUCTURED_PACKAGE_MAX_ZIP_BYTES) || 50 * 1024 * 1024,
  /** Max total uncompressed size of all entries. */
  maxUncompressedTotalBytes:
    Number(process.env.STRUCTURED_PACKAGE_MAX_UNCOMPRESSED_BYTES) || 100 * 1024 * 1024,
  maxPdfBytes: Number(process.env.STRUCTURED_PACKAGE_MAX_PDF_BYTES) || 50 * 1024 * 1024,
  maxMarkdownBytes: Number(process.env.STRUCTURED_PACKAGE_MAX_MD_BYTES) || 10 * 1024 * 1024,
  maxJsonBytes: Number(process.env.STRUCTURED_PACKAGE_MAX_JSON_BYTES) || 10 * 1024 * 1024,
  /** Exactly three files in v1. */
  maxFileCount: 3,
  minFileCount: 3,
  /** compressed_size * ratio < uncompressed is rejected as zip bomb. */
  maxCompressionRatio: Number(process.env.STRUCTURED_PACKAGE_MAX_COMPRESSION_RATIO) || 100,
  /** Reject nested archive extensions. */
  nestedArchiveExtensions: ['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz'],
} as const;

export const STRUCTURED_PACKAGE_MIME = {
  pdf: 'application/pdf',
  markdown: 'text/markdown',
  json: 'application/json',
  zip: 'application/zip',
} as const;

export const STRUCTURED_PACKAGE_ERROR_CODES = {
  ZIP_INVALID: 'ZIP_INVALID',
  ZIP_CORRUPT: 'ZIP_CORRUPT',
  ZIP_ENCRYPTED: 'ZIP_ENCRYPTED',
  ZIP_PATH_TRAVERSAL: 'ZIP_PATH_TRAVERSAL',
  ZIP_ABSOLUTE_PATH: 'ZIP_ABSOLUTE_PATH',
  ZIP_SUBDIRECTORY: 'ZIP_SUBDIRECTORY',
  ZIP_SYMLINK: 'ZIP_SYMLINK',
  ZIP_TOO_LARGE: 'ZIP_TOO_LARGE',
  ZIP_BOMB: 'ZIP_BOMB',
  ZIP_FILE_COUNT: 'ZIP_FILE_COUNT',
  ZIP_DUPLICATE_NAME: 'ZIP_DUPLICATE_NAME',
  ZIP_CASE_CONFLICT: 'ZIP_CASE_CONFLICT',
  ZIP_NESTED_ARCHIVE: 'ZIP_NESTED_ARCHIVE',
  ZIP_EXTRA_FILES: 'ZIP_EXTRA_FILES',
  MISSING_SOURCE_PDF: 'MISSING_SOURCE_PDF',
  MISSING_SOURCE_MD: 'MISSING_SOURCE_MD',
  MISSING_SOURCE_JSON: 'MISSING_SOURCE_JSON',
  PDF_TYPE_INVALID: 'PDF_TYPE_INVALID',
  MD_TYPE_INVALID: 'MD_TYPE_INVALID',
  JSON_PARSE_FAILED: 'JSON_PARSE_FAILED',
  SCHEMA_VERSION_UNSUPPORTED: 'SCHEMA_VERSION_UNSUPPORTED',
  SCHEMA_VALIDATION_FAILED: 'SCHEMA_VALIDATION_FAILED',
  PDF_HASH_MISMATCH: 'PDF_HASH_MISMATCH',
  MD_HASH_MISMATCH: 'MD_HASH_MISMATCH',
  METADATA_YEAR_MISMATCH: 'METADATA_YEAR_MISMATCH',
  METADATA_ORG_MISMATCH: 'METADATA_ORG_MISMATCH',
  PARSED_JSON_INCOMPLETE: 'PARSED_JSON_INCOMPLETE',
  PACKAGE_DUPLICATE: 'PACKAGE_DUPLICATE',
  REPORT_IDENTITY_CONFLICT: 'REPORT_IDENTITY_CONFLICT',
} as const;

export type StructuredPackageErrorCode =
  (typeof STRUCTURED_PACKAGE_ERROR_CODES)[keyof typeof STRUCTURED_PACKAGE_ERROR_CODES];

/** User-facing Chinese messages for structured import errors. */
export const STRUCTURED_PACKAGE_ERROR_MESSAGES: Record<StructuredPackageErrorCode, string> = {
  ZIP_INVALID: 'ZIP 格式错误，无法识别为有效的压缩包',
  ZIP_CORRUPT: 'ZIP 文件已损坏或中央目录无效',
  ZIP_ENCRYPTED: '不支持加密的 ZIP 材料包',
  ZIP_PATH_TRAVERSAL: 'ZIP 包含非法路径（路径穿越）',
  ZIP_ABSOLUTE_PATH: 'ZIP 包含绝对路径，已拒绝',
  ZIP_SUBDIRECTORY: '第一版材料包不允许子目录，请将文件放在 ZIP 根目录',
  ZIP_SYMLINK: 'ZIP 包含符号链接或特殊文件，已拒绝',
  ZIP_TOO_LARGE: 'ZIP 或解压后体积超过限制',
  ZIP_BOMB: 'ZIP 压缩比异常，疑似 ZIP 炸弹',
  ZIP_FILE_COUNT: 'ZIP 内文件数量不符合要求（必须恰好 3 个文件）',
  ZIP_DUPLICATE_NAME: 'ZIP 内存在重复文件名',
  ZIP_CASE_CONFLICT: 'ZIP 内文件名仅大小写不同，已拒绝',
  ZIP_NESTED_ARCHIVE: '不允许嵌套压缩包',
  ZIP_EXTRA_FILES: 'ZIP 内存在不允许的额外文件',
  MISSING_SOURCE_PDF: '缺少 source.pdf',
  MISSING_SOURCE_MD: '缺少 source.md',
  MISSING_SOURCE_JSON: '缺少 source.json',
  PDF_TYPE_INVALID: 'source.pdf 不是有效的 PDF 文件',
  MD_TYPE_INVALID: 'source.md 内容类型无效',
  JSON_PARSE_FAILED: 'source.json 无法解析为合法 JSON',
  SCHEMA_VERSION_UNSUPPORTED: '不支持的 schema_version',
  SCHEMA_VALIDATION_FAILED: 'source.json 未通过 Schema 校验',
  PDF_HASH_MISMATCH: 'source.pdf 的 SHA256 与 source.json 声明不一致',
  MD_HASH_MISMATCH: 'source.md 的 SHA256 与 source.json 声明不一致',
  METADATA_YEAR_MISMATCH: '报告年份与材料包声明不一致',
  METADATA_ORG_MISMATCH: '机构名称与材料包声明不一致',
  PARSED_JSON_INCOMPLETE: 'parsed_json 结构不完整，无法物化',
  REPORT_IDENTITY_CONFLICT: '该地区该年度报告已存在，请稍后重试导入',
  PACKAGE_DUPLICATE: '相同材料包已导入，请勿重复提交',
};

export class StructuredPackageError extends Error {
  readonly code: StructuredPackageErrorCode;
  readonly details?: unknown;

  constructor(code: StructuredPackageErrorCode, message?: string, details?: unknown) {
    super(message || STRUCTURED_PACKAGE_ERROR_MESSAGES[code] || code);
    this.name = 'StructuredPackageError';
    this.code = code;
    this.details = details;
  }
}
