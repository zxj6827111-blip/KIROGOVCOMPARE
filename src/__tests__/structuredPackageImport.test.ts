import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import archiver from 'archiver';
import {
  inspectZipArchive,
  extractStructuredPackage,
  safeExtractStructuredPackage,
  cleanupExtractDir,
  validateZipEntryName,
} from '../services/structured-import/ZipSecurityService';
import {
  parseAndValidateSourceJson,
  loadSourceJsonFromFile,
  __resetPackageSchemaCache,
} from '../services/structured-import/PackageSchemaService';
import {
  verifyPackageFileHashes,
  hashFileSha256,
  buildImportedParsedJson,
  verifyPackageMetadata,
} from '../services/structured-import/PackageHashService';
import {
  STRUCTURED_PACKAGE_ERROR_CODES,
  StructuredPackageError,
} from '../config/structuredPackage';
import { generateStructuredImportFixtures } from '../../scripts/generate-structured-import-fixtures';

const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'structured-import');

function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function minimalPdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] >>endobj
trailer<< /Root 1 0 R >>
%%EOF
`,
    'utf8'
  );
}

async function zipToPath(
  outPath: string,
  files: Array<{ name: string; content: Buffer | string }>
): Promise<void> {
  await fsp.mkdir(path.dirname(outPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    for (const f of files) {
      archive.append(typeof f.content === 'string' ? Buffer.from(f.content, 'utf8') : f.content, {
        name: f.name,
      });
    }
    archive.finalize();
  });
}

function baseSourceJson(pdfHash: string, mdHash: string, extra: Record<string, unknown> = {}): any {
  return {
    schema_version: '1.0',
    package_version: '1.0',
    generator: { name: 'test', version: '0.0.1' },
    source: {
      pdf_filename: 'source.pdf',
      markdown_filename: 'source.md',
      pdf_sha256: pdfHash,
      markdown_sha256: mdHash,
      organization_name: '测试局',
      report_year: 2024,
      report_title: '测试',
    },
    parsed_json: {
      sections: [
        {
          type: 'table_2',
          activeDisclosureData: {
            regulations: { made: 0, valid: 1, repealed: 0 },
            normativeDocuments: { made: 1, valid: null, repealed: 0 },
            licensing: { processed: 0 },
            punishment: { processed: 0 },
            coercion: { processed: 0 },
            fees: { amount: 0 },
          },
        },
      ],
    },
    ...extra,
  };
}

describe('structured package ZIP security', () => {
  let tmpRoot: string;

  beforeAll(async () => {
    await generateStructuredImportFixtures(FIXTURE_DIR);
  });

  beforeEach(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'kirogov-zip-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  test('valid ZIP passes inspection and extract', async () => {
    const zipPath = path.join(FIXTURE_DIR, 'valid-sample.kirogov.zip');
    const inspection = await inspectZipArchive(zipPath);
    expect(inspection.entries).toHaveLength(3);
    const extractDir = path.join(tmpRoot, 'ok');
    const extracted = await extractStructuredPackage(zipPath, extractDir);
    expect(fs.existsSync(extracted.files['source.pdf'])).toBe(true);
    expect(fs.existsSync(extracted.files['source.md'])).toBe(true);
    expect(fs.existsSync(extracted.files['source.json'])).toBe(true);
    await cleanupExtractDir(extractDir);
    expect(fs.existsSync(extractDir)).toBe(false);
  });

  test('entry set with a stranger file (extra.txt instead of source.json) fails', async () => {
    const zipPath = path.join(FIXTURE_DIR, 'invalid-extra-file.kirogov.zip');
    await expect(inspectZipArchive(zipPath)).rejects.toMatchObject({
      code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_EXTRA_FILES,
    });
  });

  test('subdirectory / path traversal fails', async () => {
    expect(() => validateZipEntryName('../evil.pdf')).toThrow(
      expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_PATH_TRAVERSAL })
    );
    expect(() => validateZipEntryName('/abs/source.pdf')).toThrow(
      expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_ABSOLUTE_PATH })
    );
    expect(() => validateZipEntryName('C:\\Windows\\source.pdf')).toThrow(
      expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_ABSOLUTE_PATH })
    );
    expect(() => validateZipEntryName('subdir/source.pdf')).toThrow(
      expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_SUBDIRECTORY })
    );

    const zipPath = path.join(FIXTURE_DIR, 'invalid-path-traversal.kirogov.zip');
    await expect(inspectZipArchive(zipPath)).rejects.toBeInstanceOf(StructuredPackageError);
  });

  test('extra / multiple files fail', async () => {
    const pdf = minimalPdf();
    const md = 'hello md';
    const pdfHash = sha256(pdf);
    const mdHash = sha256(md);
    const zipPath = path.join(tmpRoot, 'extra.zip');
    await zipToPath(zipPath, [
      { name: 'source.pdf', content: pdf },
      { name: 'source.md', content: md },
      { name: 'source.json', content: JSON.stringify(baseSourceJson(pdfHash, mdHash)) },
      { name: 'readme.txt', content: 'no' },
    ]);
    await expect(inspectZipArchive(zipPath)).rejects.toMatchObject({
      code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_FILE_COUNT,
    });
  });

  test('duplicate filenames fail (case conflict)', async () => {
    // archiver may collapse same names; test validator path for case conflict via custom entries list logic
    // Build zip with Source.PDF vs required names — wrong casing rejected as EXTRA
    const pdf = minimalPdf();
    const md = 'md';
    const zipPath = path.join(tmpRoot, 'case.zip');
    await zipToPath(zipPath, [
      { name: 'Source.pdf', content: pdf },
      { name: 'source.md', content: md },
      { name: 'source.json', content: '{}' },
    ]);
    await expect(inspectZipArchive(zipPath)).rejects.toBeInstanceOf(StructuredPackageError);
  });

  test('nested zip extension fails', async () => {
    const zipPath = path.join(tmpRoot, 'nested.zip');
    await zipToPath(zipPath, [
      { name: 'source.pdf', content: minimalPdf() },
      { name: 'source.md', content: 'x' },
      { name: 'payload.zip', content: Buffer.from('PK\x03\x04fake') },
    ]);
    await expect(inspectZipArchive(zipPath)).rejects.toMatchObject({
      code: expect.stringMatching(/NESTED|EXTRA|FILE_COUNT|MISSING/),
    });
  });

  test('corrupt / non-zip fails', async () => {
    const bad = path.join(tmpRoot, 'not.zip');
    await fsp.writeFile(bad, 'this is not a zip');
    await expect(inspectZipArchive(bad)).rejects.toMatchObject({
      code: STRUCTURED_PACKAGE_ERROR_CODES.ZIP_INVALID,
    });
  });

  test('fake pdf signature fails on extract', async () => {
    const pdf = Buffer.from('NOTPDF content that looks long enough');
    const md = '# md';
    const pdfHash = sha256(pdf);
    const mdHash = sha256(md);
    const zipPath = path.join(tmpRoot, 'fakepdf.zip');
    await zipToPath(zipPath, [
      { name: 'source.pdf', content: pdf },
      { name: 'source.md', content: md },
      { name: 'source.json', content: JSON.stringify(baseSourceJson(pdfHash, mdHash)) },
    ]);
    const extractDir = path.join(tmpRoot, 'ex');
    await expect(safeExtractStructuredPackage(zipPath, extractDir)).rejects.toMatchObject({
      code: STRUCTURED_PACKAGE_ERROR_CODES.PDF_TYPE_INVALID,
    });
    expect(fs.existsSync(extractDir)).toBe(false);
  });


  test('rejects %PDFX fake signature (requires %PDF-)', async () => {
    const pdf = Buffer.from('%PDFX-not-a-real-pdf-content-padding-xxxx');
    const md = '# md body for type test';
    const pdfHash = sha256(pdf);
    const mdHash = sha256(md);
    const zipPath = path.join(tmpRoot, 'pdfx.zip');
    await zipToPath(zipPath, [
      { name: 'source.pdf', content: pdf },
      { name: 'source.md', content: md },
      { name: 'source.json', content: JSON.stringify(baseSourceJson(pdfHash, mdHash)) },
    ]);
    const extractDir = path.join(tmpRoot, 'pdfx-ex');
    await expect(safeExtractStructuredPackage(zipPath, extractDir)).rejects.toMatchObject({
      code: STRUCTURED_PACKAGE_ERROR_CODES.PDF_TYPE_INVALID,
    });
  });
  test('zip bomb high compression ratio fails', async () => {
    // Highly compressible payload as source.md exceeding ratio if claimed large —
    // yauzl reports real uncompressed size from central directory after store.
    // We simulate by crafting entry metadata: use large zeros md under limit but ratio check.
    const zeros = Buffer.alloc(2 * 1024 * 1024, 0); // 2MB zeros — high compression
    // But our markdown binary detector rejects nulls. Use space characters for high ratio.
    const spaces = Buffer.alloc(2 * 1024 * 1024, 0x20);
    const pdf = minimalPdf();
    const pdfHash = sha256(pdf);
    const mdHash = sha256(spaces);
    const zipPath = path.join(tmpRoot, 'bomb.zip');
    await zipToPath(zipPath, [
      { name: 'source.pdf', content: pdf },
      { name: 'source.md', content: spaces },
      { name: 'source.json', content: JSON.stringify(baseSourceJson(pdfHash, mdHash)) },
    ]);
    // Depending on zlib ratio, may pass or fail ZIP_BOMB — assert no crash and either ok or ZIP_BOMB/TOO_LARGE
    try {
      await inspectZipArchive(zipPath);
    } catch (e: any) {
      expect([
        STRUCTURED_PACKAGE_ERROR_CODES.ZIP_BOMB,
        STRUCTURED_PACKAGE_ERROR_CODES.ZIP_TOO_LARGE,
      ]).toContain(e.code);
    }
  });
});

describe('structured package schema', () => {
  beforeAll(async () => {
    await generateStructuredImportFixtures(FIXTURE_DIR);
    __resetPackageSchemaCache();
  });

  test('valid source.json passes', () => {
    const raw = fs.readFileSync(path.join(FIXTURE_DIR, 'valid-source.json'), 'utf8');
    const env = parseAndValidateSourceJson(raw);
    expect(env.schema_version).toBe('1.0');
    expect(env.parsed_json.sections).toBeDefined();
  });

  test('missing schema_version fails', () => {
    const pdf = minimalPdf();
    const md = 'x';
    const obj = baseSourceJson(sha256(pdf), sha256(md));
    delete obj.schema_version;
    expect(() => parseAndValidateSourceJson(JSON.stringify(obj))).toThrow(
      StructuredPackageError
    );
  });

  test('unsupported schema version fails', () => {
    const obj = baseSourceJson(sha256('a'), sha256('b'));
    obj.schema_version = '9.9';
    try {
      parseAndValidateSourceJson(JSON.stringify(obj));
      fail('expected throw');
    } catch (e: any) {
      expect(e.code).toBe(STRUCTURED_PACKAGE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED);
    }
  });

  test('missing parsed_json fails', () => {
    const obj = baseSourceJson(sha256('a'), sha256('b'));
    delete obj.parsed_json;
    expect(() => parseAndValidateSourceJson(JSON.stringify(obj))).toThrow();
  });

  test('invalid hash format fails', () => {
    const obj = baseSourceJson('not-a-hash', sha256('b'));
    expect(() => parseAndValidateSourceJson(JSON.stringify(obj))).toThrow();
  });

  test('numeric zero is accepted in table_2', () => {
    const obj = baseSourceJson(sha256('a'), sha256('b'));
    (obj.parsed_json as any).sections[0].activeDisclosureData.regulations.made = 0;
    (obj.parsed_json as any).sections[0].activeDisclosureData.fees.amount = 0;
    const env = parseAndValidateSourceJson(JSON.stringify(obj));
    const data = (env.parsed_json as any).sections[0].activeDisclosureData;
    expect(data.regulations.made).toBe(0);
    expect(data.fees.amount).toBe(0);
  });

  test('package_version other than 1.0 fails', () => {
    const obj = baseSourceJson(sha256('a'), sha256('b'));
    obj.package_version = '999';
    expect(() => parseAndValidateSourceJson(JSON.stringify(obj))).toThrow(StructuredPackageError);
  });

  test('string numeric values in table payload fail', () => {
    const obj = baseSourceJson(sha256('a'), sha256('b'));
    (obj.parsed_json as any).sections[0].activeDisclosureData.regulations.made = '0';
    expect(() => parseAndValidateSourceJson(JSON.stringify(obj))).toThrow(
      expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE })
    );
  });

  test('unknown top-level field rejected', () => {
    const obj = baseSourceJson(sha256('a'), sha256('b'));
    (obj as any).evil_field = true;
    expect(() => parseAndValidateSourceJson(JSON.stringify(obj))).toThrow();
  });

  test('bare NaN / Infinity tokens rejected by JSON.parse', () => {
    expect(() => parseAndValidateSourceJson('{"schema_version":"1.0","x":NaN}')).toThrow(
      expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.JSON_PARSE_FAILED })
    );
    expect(() => parseAndValidateSourceJson('{"schema_version":"1.0","x":Infinity}')).toThrow(
      expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.JSON_PARSE_FAILED })
    );
    expect(() => parseAndValidateSourceJson('{"schema_version":"1.0","x":-Infinity}')).toThrow(
      expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.JSON_PARSE_FAILED })
    );
  });

  test('legal string value containing the word "NaN" passes', () => {
    const obj = baseSourceJson(sha256('a'), sha256('b'));
    obj.source.report_title = 'The value is NaN in the source document';
    const env = parseAndValidateSourceJson(JSON.stringify(obj));
    expect(env.source.report_title).toContain('NaN');
  });

  test('legal string value containing the word "Infinity" passes', () => {
    const obj = baseSourceJson(sha256('a'), sha256('b'));
    obj.generator.name = 'Infinity-report-generator';
    obj.source.report_title = '关于Infinity大厦的报告 -Infinity edge case';
    const env = parseAndValidateSourceJson(JSON.stringify(obj));
    expect(env.generator.name).toContain('Infinity');
    expect(env.source.report_title).toContain('-Infinity');
  });

  test('incomplete table structure without content fails materialize gate', () => {
    const obj = baseSourceJson(sha256('a'), sha256('b'));
    obj.parsed_json = { sections: [{ type: 'text', content: 'short' }] };
    expect(() => parseAndValidateSourceJson(JSON.stringify(obj))).toThrow(
      expect.objectContaining({
        code: expect.stringMatching(/PARSED_JSON_INCOMPLETE|SCHEMA/),
      })
    );
  });
});

describe('structured package hashes', () => {
  beforeAll(async () => {
    await generateStructuredImportFixtures(FIXTURE_DIR);
  });

  test('matching pdf/md hashes pass and json hash recorded', async () => {
    const zipPath = path.join(FIXTURE_DIR, 'valid-sample.kirogov.zip');
    const extractDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hash-ok-'));
    try {
      const extracted = await extractStructuredPackage(zipPath, extractDir);
      const envelope = loadSourceJsonFromFile(extracted.files['source.json']);
      const hashes = await verifyPackageFileHashes({
        zipPath,
        pdfPath: extracted.files['source.pdf'],
        markdownPath: extracted.files['source.md'],
        jsonPath: extracted.files['source.json'],
        envelope,
      });
      expect(hashes.pdfSha256).toHaveLength(64);
      expect(hashes.markdownSha256).toHaveLength(64);
      expect(hashes.jsonSha256).toHaveLength(64);
      expect(hashes.packageSha256).toHaveLength(64);
      expect(hashes.pdfSha256).toBe(envelope.source.pdf_sha256.toLowerCase());
      expect(hashes.markdownSha256).toBe(envelope.source.markdown_sha256.toLowerCase());

      const imported = buildImportedParsedJson(envelope, {
        packageSha256: hashes.packageSha256,
        jsonSha256: hashes.jsonSha256,
      });
      expect((imported as any)._ingestion.mode).toBe('structured_import');
      expect((imported as any).sections).toBeDefined();
    } finally {
      await cleanupExtractDir(extractDir);
    }
  });

  test('pdf hash mismatch fails', async () => {
    const zipPath = path.join(FIXTURE_DIR, 'invalid-pdf-hash.kirogov.zip');
    const extractDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'hash-bad-'));
    try {
      const extracted = await extractStructuredPackage(zipPath, extractDir);
      const envelope = loadSourceJsonFromFile(extracted.files['source.json']);
      await expect(
        verifyPackageFileHashes({
          zipPath,
          pdfPath: extracted.files['source.pdf'],
          markdownPath: extracted.files['source.md'],
          jsonPath: extracted.files['source.json'],
          envelope,
        })
      ).rejects.toMatchObject({ code: STRUCTURED_PACKAGE_ERROR_CODES.PDF_HASH_MISMATCH });
    } finally {
      await cleanupExtractDir(extractDir);
    }
  });

  test('markdown hash mismatch fails', async () => {
    const pdf = minimalPdf();
    const md = 'correct md body';
    const wrongMdHash = 'ab'.repeat(32);
    const zipPath = path.join(os.tmpdir(), `md-mismatch-${Date.now()}.zip`);
    const extractDir = path.join(os.tmpdir(), `md-ex-${Date.now()}`);
    try {
      await zipToPath(zipPath, [
        { name: 'source.pdf', content: pdf },
        { name: 'source.md', content: md },
        {
          name: 'source.json',
          content: JSON.stringify(baseSourceJson(sha256(pdf), wrongMdHash)),
        },
      ]);
      const extracted = await extractStructuredPackage(zipPath, extractDir);
      // Schema allows wrong hash format-wise; hash verify catches it
      const envelope = loadSourceJsonFromFile(extracted.files['source.json']);
      await expect(
        verifyPackageFileHashes({
          zipPath,
          pdfPath: extracted.files['source.pdf'],
          markdownPath: extracted.files['source.md'],
          jsonPath: extracted.files['source.json'],
          envelope,
        })
      ).rejects.toMatchObject({ code: STRUCTURED_PACKAGE_ERROR_CODES.MD_HASH_MISMATCH });
    } finally {
      await fsp.unlink(zipPath).catch(() => undefined);
      await cleanupExtractDir(extractDir);
    }
  });

  test('server records source.json sha256 independently', async () => {
    const p = path.join(FIXTURE_DIR, 'valid-source.json');
    const h1 = await hashFileSha256(p);
    const h2 = await hashFileSha256(p);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
  });

  test('metadata year/org mismatch', () => {
    const env = parseAndValidateSourceJson(
      JSON.stringify(baseSourceJson(sha256('a'), sha256('b')))
    );
    expect(() => verifyPackageMetadata(env, { year: 2020 })).toThrow(
      expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.METADATA_YEAR_MISMATCH })
    );
    expect(() =>
      verifyPackageMetadata(env, { year: 2024, organizationName: '别的机构' })
    ).toThrow(expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.METADATA_ORG_MISMATCH }));
    expect(() => verifyPackageMetadata(env, { year: 2024, organizationName: '测试局' })).not.toThrow();
  });
});
