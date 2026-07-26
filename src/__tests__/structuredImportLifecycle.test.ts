/**
 * Lifecycle and policy tests for structured_import fixes (P0/P1).
 */
import fs from 'fs';
import path from 'path';
import {
  parseAndValidateSourceJson,
  assertParsedJsonMaterializable,
} from '../services/structured-import/PackageSchemaService';
import {
  STRUCTURED_PACKAGE_ERROR_CODES,
  StructuredPackageError,
} from '../config/structuredPackage';

function baseEnvelope(parsed_json: any): any {
  return {
    schema_version: '1.0',
    package_version: '1.0',
    generator: { name: 't', version: '0.0.1' },
    source: {
      pdf_filename: 'source.pdf',
      markdown_filename: 'source.md',
      pdf_sha256: 'ab'.repeat(32),
      markdown_sha256: 'cd'.repeat(32),
      organization_name: 'x',
      report_year: 2024,
    },
    parsed_json,
  };
}

describe('structured import lifecycle policy (source)', () => {
  test('executeImportJob does not attach jobId to parse_run finalize', () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/structured-import/StructuredImportService.ts'),
      'utf8'
    );
    expect(src).toMatch(/jobId:\s*null/);
    expect(src).toMatch(/enqueueFollowupJobs:\s*false/);
    expect(src).toMatch(/kind = 'materialize'/);

    // staging isolation
    expect(src).toMatch(/\.staging/);
    expect(src).toMatch(/publishStagingDir/);
    expect(src).toMatch(/stagingAbs/);
    // must not delete finalAbs on failure path as shared cleanup
    expect(src).toMatch(/never delete finalAbs|Never delete|never touch a published/i);
    // scoped idempotency
    expect(src).toMatch(/r\.region_id/);
    expect(src).toMatch(/r\.year/);
    // worker re-hash
    expect(src).toMatch(/hashFileSha256/);
    expect(src).toMatch(/PDF_HASH_MISMATCH/);
  });

  test('structured_import handler succeeds only after executeImportJob', () => {
    const runner = fs.readFileSync(path.join(process.cwd(), 'src/services/LlmJobRunner.ts'), 'utf8');
    expect(runner).toMatch(/runStructuredImportJob/);
    const fn = runner.match(/private async processStructuredImportJob[\s\S]*?private async processParseJob/);
    expect(fn).toBeTruthy();
    expect(fn![0]).toMatch(/runStructuredImportJob/);
    expect(fn![0]).not.toMatch(/createLlmProvider/);

    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/services/structured-import/runStructuredImportJob.ts'),
      'utf8'
    );
    const execIdx = src.indexOf('executeImportJob');
    const succIdx = src.indexOf("status = 'succeeded'");
    expect(execIdx).toBeGreaterThan(-1);
    expect(succIdx).toBeGreaterThan(execIdx);
    expect(src).not.toMatch(/createLlmProvider/);
  })

  test('route accepts only .kirogov.zip', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/routes/structured-import.ts'), 'utf8');
    expect(src).toMatch(/endsWith\('\.kirogov\.zip'\)/);
    // should not accept bare .zip in structured filter
    const filter = src.match(/const structuredImportUpload[\s\S]*?const handleStructuredImportUpload/);
    expect(filter).toBeTruthy();
    expect(filter![0]).not.toMatch(/name\.endsWith\('\.zip'\)/);
  });

  test('migration registry marks 0002 as irreversible by design', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/db/migrationRegistry.ts'), 'utf8');
    expect(src).toMatch(/0002_structured_package_import/);
    expect(src).toMatch(/reversible:\s*false/);
    expect(src).toMatch(/Irreversible/i);
  });
});

describe('structured import schema business fields', () => {
  test('rejects junk-only tableData without applicant keys', () => {
    const env = baseEnvelope({
      sections: [{ type: 'table_3', tableData: { junk: 'x' } }],
    });
    // junk string fails numeric leaf first, or missing applicant keys
    expect(() => parseAndValidateSourceJson(JSON.stringify(env))).toThrow(StructuredPackageError);
  });

  test('rejects boolean numeric leaves', () => {
    const env = baseEnvelope({
      sections: [
        {
          type: 'table_2',
          activeDisclosureData: {
            regulations: { made: true, valid: 1, repealed: 0 },
            normativeDocuments: { made: 0 },
            licensing: { processed: 0 },
            punishment: { processed: 0 },
            coercion: { processed: 0 },
            fees: { amount: 0 },
          },
        },
      ],
    });
    expect(() => parseAndValidateSourceJson(JSON.stringify(env))).toThrow(
      expect.objectContaining({ code: STRUCTURED_PACKAGE_ERROR_CODES.PARSED_JSON_INCOMPLETE })
    );
  });

  test('rejects empty business object {anything:true} as table_2', () => {
    const env = baseEnvelope({
      sections: [{ type: 'table_2', activeDisclosureData: { anything: true } }],
    });
    expect(() => parseAndValidateSourceJson(JSON.stringify(env))).toThrow(StructuredPackageError);
  });

  test('accepts minimal valid table_2 with zeros', () => {
    const env = baseEnvelope({
      sections: [
        {
          type: 'table_2',
          activeDisclosureData: {
            regulations: { made: 0, valid: 1, repealed: 0 },
            normativeDocuments: { made: 2, valid: null, repealed: 0 },
            licensing: { processed: 0 },
            punishment: { processed: 0 },
            coercion: { processed: 0 },
            fees: { amount: 0 },
          },
        },
      ],
    });
    expect(() => parseAndValidateSourceJson(JSON.stringify(env))).not.toThrow();
  });
});
