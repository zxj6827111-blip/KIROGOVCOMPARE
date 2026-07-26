/**
 * yauzl error mapping tests for the structured-import ZIP security layer.
 *
 * classifyYauzlError() translates raw yauzl failures into precise
 * StructuredPackageError codes, and inspectZipArchive() routes every yauzl
 * error path through it. These tests craft raw ZIP bytes by hand (archiver
 * would sanitize hostile file names) so the real yauzl code paths fire, and
 * they pin the security invariant: more precise error codes never turn a
 * rejection into an acceptance.
 */
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  classifyYauzlError,
  inspectZipArchive,
} from '../services/structured-import/ZipSecurityService';
import {
  STRUCTURED_PACKAGE_ERROR_CODES,
  StructuredPackageError,
  StructuredPackageErrorCode,
} from '../config/structuredPackage';

const CODES = STRUCTURED_PACKAGE_ERROR_CODES;

interface RawZipEntry {
  /** Entry name written verbatim (latin1 bytes) into local + central headers. */
  name: string;
  /** Raw bytes stored after the local file header. */
  data: Buffer;
  /** General purpose bit flag; bit 0 marks traditional encryption. */
  flags?: number;
  /** Defaults to data.length (STORED). */
  compressedSize?: number;
  /** Defaults to data.length (STORED). */
  uncompressedSize?: number;
}

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const EOCD_SIZE = 22;

/**
 * Minimal raw ZIP writer (STORED entries only). Unlike archiver it performs
 * no file name sanitization, so hostile entry names reach yauzl unchanged.
 * CRC32 stays 0: inspection never opens entry data, so it is never checked.
 */
function buildRawZip(entries: RawZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'latin1');
    const flags = entry.flags ?? 0;
    const compressedSize = entry.compressedSize ?? entry.data.length;
    const uncompressedSize = entry.uncompressedSize ?? entry.data.length;

    const local = Buffer.alloc(LOCAL_HEADER_SIZE);
    local.writeUInt32LE(0x04034b50, 0); // PK\x03\x04
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8); // compression method 0 = STORED
    local.writeUInt16LE(0, 10); // last mod time
    local.writeUInt16LE(0, 12); // last mod date
    local.writeUInt32LE(0, 14); // crc32
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    const central = Buffer.alloc(CENTRAL_HEADER_SIZE);
    central.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed to extract
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10); // compression method 0 = STORED
    central.writeUInt16LE(0, 12); // last mod time
    central.writeUInt16LE(0, 14); // last mod date
    central.writeUInt32LE(0, 16); // crc32
    central.writeUInt32LE(compressedSize, 20);
    central.writeUInt32LE(uncompressedSize, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra field length
    central.writeUInt16LE(0, 32); // file comment length
    central.writeUInt16LE(0, 34); // disk number start
    central.writeUInt16LE(0, 36); // internal file attributes
    central.writeUInt32LE(0, 38); // external file attributes (0: regular file)
    central.writeUInt32LE(offset, 42); // relative offset of local header

    localParts.push(local, nameBytes, entry.data);
    centralParts.push(central, nameBytes);
    offset += LOCAL_HEADER_SIZE + nameBytes.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(EOCD_SIZE);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4); // number of this disk
  eocd.writeUInt16LE(0, 6); // disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // records on this disk
  eocd.writeUInt16LE(entries.length, 10); // total records
  eocd.writeUInt32LE(centralDirectory.length, 12); // central directory size
  eocd.writeUInt32LE(offset, 16); // central directory offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

function storedEntry(name: string, content: string): RawZipEntry {
  return { name, data: Buffer.from(content, 'utf8') };
}

/** source.md + source.json companions so hostile zips still carry 3 entries. */
function companionEntries(): RawZipEntry[] {
  return [
    storedEntry('source.md', '# markdown body'),
    storedEntry('source.json', '{"ok":true}'),
  ];
}

function validPackageEntries(): RawZipEntry[] {
  return [storedEntry('source.pdf', '%PDF-1.4 stub'), ...companionEntries()];
}

describe('classifyYauzlError', () => {
  it.each<[string, StructuredPackageErrorCode]>([
    ['invalid relative path: ../../evil.pdf', CODES.ZIP_PATH_TRAVERSAL],
    ['absolute path: /etc/passwd', CODES.ZIP_ABSOLUTE_PATH],
    ['absolute path: //srv/share/a.pdf', CODES.ZIP_ABSOLUTE_PATH],
    ['invalid characters in fileName: evil\\name.pdf', CODES.ZIP_PATH_TRAVERSAL],
    ['file name must not contain a backslash', CODES.ZIP_PATH_TRAVERSAL],
    ['strong encryption is not supported', CODES.ZIP_ENCRYPTED],
    ['entry is encrypted, and options.decrypt !== false', CODES.ZIP_ENCRYPTED],
    ['unsupported encryption header', CODES.ZIP_ENCRYPTED],
    [
      'End of central directory record signature not found. Either not a zip file, or file is truncated.',
      CODES.ZIP_CORRUPT,
    ],
    ['multi-disk zip files are not supported: found disk number: 1', CODES.ZIP_INVALID],
    ['spanned zip files are not supported', CODES.ZIP_INVALID],
    ['compressed/uncompressed size mismatch for stored file: 17 != 17', CODES.ZIP_CORRUPT],
    ['weird failure', CODES.ZIP_CORRUPT],
  ])('maps %j to %s', (message, expectedCode) => {
    const mapped = classifyYauzlError(new Error(message));
    expect(mapped).toBeInstanceOf(StructuredPackageError);
    expect(mapped.code).toBe(expectedCode);
  });

  it('maps an undefined error to ZIP_CORRUPT', () => {
    const mapped = classifyYauzlError(undefined);
    expect(mapped).toBeInstanceOf(StructuredPackageError);
    expect(mapped.code).toBe(CODES.ZIP_CORRUPT);
  });
});

describe('inspectZipArchive yauzl error mapping (raw crafted zips)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-error-mapping-'));
  });

  afterEach(async () => {
    await fsp.rm(tmpDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  });

  async function writeZipFile(fileName: string, bytes: Buffer): Promise<string> {
    const zipPath = path.join(tmpDir, fileName);
    await fsp.writeFile(zipPath, bytes);
    return zipPath;
  }

  /**
   * Security invariant: hostile packages must keep rejecting with a
   * StructuredPackageError; precise mapping never lets anything through.
   */
  async function expectInspectRejects(
    zipPath: string,
    expectedCode: StructuredPackageErrorCode
  ): Promise<void> {
    const pending = inspectZipArchive(zipPath);
    await expect(pending).rejects.toBeInstanceOf(StructuredPackageError);
    await expect(pending).rejects.toHaveProperty('code', expectedCode);
  }

  it('sanity: accepts a well-formed package built by the raw writer', async () => {
    const zipPath = await writeZipFile('valid.zip', buildRawZip(validPackageEntries()));
    const result = await inspectZipArchive(zipPath);
    expect(result.entries.map((e) => e.fileName).sort()).toEqual([
      'source.json',
      'source.md',
      'source.pdf',
    ]);
    expect(result.totalUncompressed).toBeGreaterThan(0);
  });

  it("rejects '../evil.pdf' traversal with ZIP_PATH_TRAVERSAL", async () => {
    const zipPath = await writeZipFile(
      'traversal-slash.zip',
      buildRawZip([storedEntry('../evil.pdf', 'malicious'), ...companionEntries()])
    );
    await expectInspectRejects(zipPath, CODES.ZIP_PATH_TRAVERSAL);
  });

  it("rejects '..\\..\\evil.pdf' backslash traversal with ZIP_PATH_TRAVERSAL", async () => {
    const zipPath = await writeZipFile(
      'traversal-backslash.zip',
      buildRawZip([storedEntry('..\\..\\evil.pdf', 'malicious'), ...companionEntries()])
    );
    await expectInspectRejects(zipPath, CODES.ZIP_PATH_TRAVERSAL);
  });

  it("rejects '/etc/passwd' absolute path with ZIP_ABSOLUTE_PATH", async () => {
    const zipPath = await writeZipFile(
      'absolute-posix.zip',
      buildRawZip([storedEntry('/etc/passwd', 'malicious'), ...companionEntries()])
    );
    await expectInspectRejects(zipPath, CODES.ZIP_ABSOLUTE_PATH);
  });

  it("rejects UNC '\\\\srv\\share\\a.pdf' with ZIP_ABSOLUTE_PATH", async () => {
    const zipPath = await writeZipFile(
      'absolute-unc.zip',
      buildRawZip([storedEntry('\\\\srv\\share\\a.pdf', 'malicious'), ...companionEntries()])
    );
    await expectInspectRejects(zipPath, CODES.ZIP_ABSOLUTE_PATH);
  });

  it('rejects a well-formed traditionally encrypted entry with ZIP_ENCRYPTED', async () => {
    const payload = Buffer.from('encrypted payload', 'utf8');
    const encrypted: RawZipEntry = {
      name: 'source.pdf',
      // Traditional PKWARE encryption prepends a 12-byte header, so a valid
      // STORED encrypted entry has compressedSize === uncompressedSize + 12.
      data: Buffer.concat([Buffer.alloc(12, 0xaa), payload]),
      flags: 0x0001,
      uncompressedSize: payload.length,
    };
    const zipPath = await writeZipFile(
      'encrypted-real.zip',
      buildRawZip([encrypted, ...companionEntries()])
    );
    await expectInspectRejects(zipPath, CODES.ZIP_ENCRYPTED);
  });

  it('rejects a malformed encrypted entry (equal sizes) with ZIP_CORRUPT', async () => {
    // Encryption bit set but compressedSize === uncompressedSize: yauzl flags
    // the stored-size mismatch first, so the package counts as malformed.
    const malformed: RawZipEntry = {
      name: 'source.pdf',
      data: Buffer.from('encrypted payload', 'utf8'),
      flags: 0x0001,
    };
    const zipPath = await writeZipFile(
      'encrypted-malformed.zip',
      buildRawZip([malformed, ...companionEntries()])
    );
    await expectInspectRejects(zipPath, CODES.ZIP_CORRUPT);
  });

  it('rejects a package with a truncated end of central directory with ZIP_CORRUPT', async () => {
    const bytes = buildRawZip(validPackageEntries());
    expect(bytes.length).toBeGreaterThan(EOCD_SIZE + 30);
    const zipPath = await writeZipFile('truncated.zip', bytes.subarray(0, bytes.length - 30));
    await expectInspectRejects(zipPath, CODES.ZIP_CORRUPT);
  });

  it('rejects plain text bytes with ZIP_INVALID before yauzl runs', async () => {
    const zipPath = await writeZipFile('not-a-zip.zip', Buffer.from('hello not a zip', 'utf8'));
    await expectInspectRejects(zipPath, CODES.ZIP_INVALID);
  });
});
