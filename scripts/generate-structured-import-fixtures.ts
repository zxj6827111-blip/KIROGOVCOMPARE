/**
 * One-off helper for generating structured-import test fixtures.
 * NOT a product local parser — used only in tests/dev.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import archiver from 'archiver';
import { PROJECT_ROOT } from '../src/config/constants';

const FIXTURE_DIR = path.join(PROJECT_ROOT, 'tests', 'fixtures', 'structured-import');

const minimalParsedJson = {
  sections: [
    {
      type: 'table_2',
      title: '二、主动公开政府信息情况',
      activeDisclosureData: {
        regulations: { made: 0, valid: 1, repealed: 0 },
        normativeDocuments: { made: 2, valid: null, repealed: 0 },
        licensing: { processed: 0 },
        punishment: { processed: 3 },
        coercion: { processed: null },
        fees: { amount: 0 },
      },
    },
    {
      type: 'table_3',
      title: '三、收到和处理政府信息公开申请情况',
      tableData: {
        naturalPerson: {
          newReceived: 10,
          carriedOver: 0,
          results: {
            granted: 5,
            partialGrant: 0,
            denied: {
              stateSecret: 0,
              lawForbidden: 0,
              safetyStability: 0,
              thirdPartyRights: 0,
              internalAffairs: 0,
              processInfo: 0,
              enforcementCase: 0,
              adminQuery: 0,
            },
            unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
            notProcessed: {
              complaint: 0,
              repeat: 0,
              publication: 0,
              massiveRequests: 0,
              confirmInfo: 0,
            },
            other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
            totalProcessed: 5,
            carriedForward: 0,
          },
        },
        total: {
          newReceived: 10,
          carriedOver: 0,
          results: {
            granted: 5,
            partialGrant: 0,
            denied: {
              stateSecret: 0,
              lawForbidden: 0,
              safetyStability: 0,
              thirdPartyRights: 0,
              internalAffairs: 0,
              processInfo: 0,
              enforcementCase: 0,
              adminQuery: 0,
            },
            unableToProvide: { noInfo: 0, needCreation: 0, unclear: 0 },
            notProcessed: {
              complaint: 0,
              repeat: 0,
              publication: 0,
              massiveRequests: 0,
              confirmInfo: 0,
            },
            other: { overdueCorrection: 0, overdueFee: 0, otherReasons: 0 },
            totalProcessed: 5,
            carriedForward: 0,
          },
        },
      },
    },
    {
      type: 'table_4',
      title: '四、行政复议行政诉讼情况',
      reviewLitigationData: {
        review: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
        litigationDirect: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
        litigationPostReview: { maintain: 0, correct: 0, other: 0, unfinished: 0, total: 0 },
      },
    },
  ],
};

function sha256(buf: Buffer | string): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Minimal valid PDF */
function minimalPdf(): Buffer {
  const content = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 12 Tf 100 100 Td (Hello) Tj ET
endstream
endobj
xref
0 5
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000214 00000 n
trailer<< /Size 5 /Root 1 0 R >>
startxref
306
%%EOF
`;
  return Buffer.from(content, 'utf8');
}

function buildSourceJson(pdfHash: string, mdHash: string, overrides: Record<string, unknown> = {}): string {
  const base = {
    schema_version: '1.0',
    package_version: '1.0',
    generator: { name: 'kirogov-fixture-builder', version: '0.1.0' },
    source: {
      pdf_filename: 'source.pdf',
      markdown_filename: 'source.md',
      pdf_sha256: pdfHash,
      markdown_sha256: mdHash,
      organization_name: '测试机构',
      report_year: 2024,
      report_title: '测试年报',
    },
    parsed_json: minimalParsedJson,
    ...overrides,
  };
  // deep merge source if provided
  if (overrides.source) {
    base.source = { ...base.source, ...(overrides.source as object) };
  }
  if (overrides.parsed_json) {
    base.parsed_json = overrides.parsed_json as typeof minimalParsedJson;
  }
  return JSON.stringify(base, null, 2);
}

/** Fixed entry mtime so fixture bytes are deterministic: the test suite
 * regenerates fixtures into the committed directory on every run, and a
 * wall-clock timestamp would dirty git status after each `npm test`. */
const FIXTURE_ENTRY_DATE = new Date('2024-01-01T00:00:00Z');

async function zipFiles(
  outPath: string,
  files: Array<{ name: string; content: Buffer | string }>
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve());
    archive.on('error', reject);
    archive.pipe(output);
    for (const f of files) {
      archive.append(typeof f.content === 'string' ? Buffer.from(f.content, 'utf8') : f.content, {
        name: f.name,
        date: FIXTURE_ENTRY_DATE,
      });
    }
    archive.finalize();
  });
}

/** CRC32 for raw ZIP construction (path-traversal fixtures; archiver sanitizes names). */
function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

/**
 * Write a ZIP keeping entry names verbatim (including `../`), for security tests.
 */
async function writeRawZipWithNames(
  outPath: string,
  files: Array<{ name: string; content: Buffer | string }>
): Promise<void> {
  const zlib = await import('zlib');
  await fs.promises.mkdir(path.dirname(outPath), { recursive: true });

  type Built = {
    local: Buffer;
    nameBuf: Buffer;
    crc: number;
    compLen: number;
    uncompLen: number;
  };
  const built: Built[] = [];

  for (const f of files) {
    const data = typeof f.content === 'string' ? Buffer.from(f.content, 'utf8') : f.content;
    const nameBuf = Buffer.from(f.name, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    built.push({
      local: Buffer.concat([local, comp]),
      nameBuf,
      crc,
      compLen: comp.length,
      uncompLen: data.length,
    });
  }

  let offset = 0;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  for (const e of built) {
    locals.push(e.local);
    const central = Buffer.alloc(46 + e.nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.compLen, 20);
    central.writeUInt32LE(e.uncompLen, 24);
    central.writeUInt16LE(e.nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    e.nameBuf.copy(central, 46);
    centrals.push(central);
    offset += e.local.length;
  }

  const localAll = Buffer.concat(locals);
  const centralAll = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(built.length, 8);
  end.writeUInt16LE(built.length, 10);
  end.writeUInt32LE(centralAll.length, 12);
  end.writeUInt32LE(localAll.length, 16);
  end.writeUInt16LE(0, 20);
  await fs.promises.writeFile(outPath, Buffer.concat([localAll, centralAll, end]));
}

export async function generateStructuredImportFixtures(outDir: string = FIXTURE_DIR): Promise<string> {
  await fs.promises.mkdir(outDir, { recursive: true });
  const pdf = minimalPdf();
  const md = '# 测试年报\n\n正文内容用于结构化导入夹具。\n';
  const pdfHash = sha256(pdf);
  const mdHash = sha256(md);

  // valid
  await zipFiles(path.join(outDir, 'valid-sample.kirogov.zip'), [
    { name: 'source.pdf', content: pdf },
    { name: 'source.md', content: md },
    { name: 'source.json', content: buildSourceJson(pdfHash, mdHash) },
  ]);

  // wrong entry set: a stranger file replaces source.json (3 entries, so the
  // entry-set validation rejects it as ZIP_EXTRA_FILES before the missing check)
  await zipFiles(path.join(outDir, 'invalid-extra-file.kirogov.zip'), [
    { name: 'source.pdf', content: pdf },
    { name: 'source.md', content: md },
    { name: 'extra.txt', content: 'nope' },
  ]);

  // bad pdf hash
  await zipFiles(path.join(outDir, 'invalid-pdf-hash.kirogov.zip'), [
    { name: 'source.pdf', content: pdf },
    { name: 'source.md', content: md },
    {
      name: 'source.json',
      content: buildSourceJson('0'.repeat(64), mdHash),
    },
  ]);

  // invalid schema (missing schema_version)
  const badSchema = JSON.parse(buildSourceJson(pdfHash, mdHash));
  delete badSchema.schema_version;
  await zipFiles(path.join(outDir, 'invalid-schema.kirogov.zip'), [
    { name: 'source.pdf', content: pdf },
    { name: 'source.md', content: md },
    { name: 'source.json', content: JSON.stringify(badSchema) },
  ]);

  // path traversal — archiver normalizes names; write a raw ZIP central directory
  await writeRawZipWithNames(path.join(outDir, 'invalid-path-traversal.kirogov.zip'), [
    { name: '../source.pdf', content: pdf },
    { name: 'source.md', content: md },
    { name: 'source.json', content: buildSourceJson(pdfHash, mdHash) },
  ]);

  // also write standalone source.json for schema unit tests
  await fs.promises.writeFile(
    path.join(outDir, 'valid-source.json'),
    buildSourceJson(pdfHash, mdHash),
    'utf8'
  );
  await fs.promises.writeFile(path.join(outDir, 'valid-source.pdf'), pdf);
  await fs.promises.writeFile(path.join(outDir, 'valid-source.md'), md, 'utf8');

  return outDir;
}

if (require.main === module) {
  generateStructuredImportFixtures()
    .then((dir) => {
      console.log('Fixtures written to', dir);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
