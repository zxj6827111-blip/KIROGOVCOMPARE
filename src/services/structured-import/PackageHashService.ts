import fs from 'fs';
import fsp from 'fs/promises';
import { calculateFileHash, calculateBufferHash } from '../../utils/fileHash';
import {
  STRUCTURED_PACKAGE_ERROR_CODES,
  StructuredPackageError,
} from '../../config/structuredPackage';
import type { PackageSourceEnvelope } from './PackageSchemaService';

const SHA256_HEX = /^[a-fA-F0-9]{64}$/;

export interface PackageHashResult {
  packageSha256: string;
  pdfSha256: string;
  markdownSha256: string;
  jsonSha256: string;
}

export function assertSha256Hex(value: string, label: string): string {
  const normalized = String(value || '').trim().toLowerCase();
  if (!SHA256_HEX.test(normalized)) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.SCHEMA_VALIDATION_FAILED,
      `${label} 不是合法的 SHA256（64 位十六进制）`
    );
  }
  return normalized;
}

export async function hashFileSha256(filePath: string): Promise<string> {
  const hash = await calculateFileHash(filePath);
  return hash.toLowerCase();
}

export async function hashBufferSha256(buffer: Buffer): Promise<string> {
  const hash = await calculateBufferHash(buffer);
  return hash.toLowerCase();
}

/**
 * Compute hashes for package ZIP and the three extracted files.
 * Validates declared pdf/md hashes in source envelope against actual files.
 */
export async function verifyPackageFileHashes(input: {
  zipPath: string;
  pdfPath: string;
  markdownPath: string;
  jsonPath: string;
  envelope: PackageSourceEnvelope;
}): Promise<PackageHashResult> {
  const [packageSha256, pdfSha256, markdownSha256, jsonSha256] = await Promise.all([
    hashFileSha256(input.zipPath),
    hashFileSha256(input.pdfPath),
    hashFileSha256(input.markdownPath),
    hashFileSha256(input.jsonPath),
  ]);

  const declaredPdf = assertSha256Hex(input.envelope.source.pdf_sha256, 'source.pdf_sha256');
  const declaredMd = assertSha256Hex(input.envelope.source.markdown_sha256, 'source.markdown_sha256');

  if (declaredPdf !== pdfSha256) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.PDF_HASH_MISMATCH,
      undefined,
      { declared: declaredPdf, actual: pdfSha256 }
    );
  }

  if (declaredMd !== markdownSha256) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.MD_HASH_MISMATCH,
      undefined,
      { declared: declaredMd, actual: markdownSha256 }
    );
  }

  return {
    packageSha256,
    pdfSha256,
    markdownSha256,
    jsonSha256,
  };
}

/**
 * Optional metadata cross-check against upload form fields.
 */
export function verifyPackageMetadata(
  envelope: PackageSourceEnvelope,
  expected: { year?: number | null; organizationName?: string | null }
): void {
  const declaredYear = envelope.source.report_year;
  if (
    expected.year != null &&
    declaredYear != null &&
    Number(declaredYear) !== Number(expected.year)
  ) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.METADATA_YEAR_MISMATCH,
      `报告年份不一致：表单为 ${expected.year}，材料包声明为 ${declaredYear}`
    );
  }

  const declaredOrg = envelope.source.organization_name;
  const expectedOrg = expected.organizationName;
  if (
    typeof expectedOrg === 'string' &&
    expectedOrg.trim() &&
    typeof declaredOrg === 'string' &&
    declaredOrg.trim() &&
    expectedOrg.trim() !== declaredOrg.trim()
  ) {
    throw new StructuredPackageError(
      STRUCTURED_PACKAGE_ERROR_CODES.METADATA_ORG_MISMATCH,
      `机构名称不一致：表单为「${expectedOrg.trim()}」，材料包声明为「${declaredOrg.trim()}」`
    );
  }
}

/**
 * Deep-clone parsed_json and attach non-business _ingestion metadata.
 * Does not mutate the original source.json on disk.
 */
export function buildImportedParsedJson(
  envelope: PackageSourceEnvelope,
  meta: {
    packageSha256: string;
    jsonSha256: string;
    importedAt?: string;
  }
): Record<string, unknown> {
  const cloned = JSON.parse(JSON.stringify(envelope.parsed_json)) as Record<string, unknown>;
  cloned._ingestion = {
    mode: 'structured_import',
    schema_version: envelope.schema_version,
    package_version: envelope.package_version,
    package_sha256: meta.packageSha256,
    source_json_sha256: meta.jsonSha256,
    imported_at: meta.importedAt || new Date().toISOString(),
    generator: {
      name: envelope.generator.name,
      version: envelope.generator.version,
    },
  };
  return cloned;
}

export async function readFileUtf8(filePath: string): Promise<string> {
  return fsp.readFile(filePath, 'utf8');
}

export function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}
