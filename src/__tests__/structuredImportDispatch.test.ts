/**
 * Unit tests for structured_import worker dispatch safety (no LLM fallback).
 */
import fs from 'fs';
import path from 'path';

describe('LlmJobRunner structured_import dispatch', () => {
  test('source contains explicit structured_import branch and rejects unknown kinds', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/services/LlmJobRunner.ts'), 'utf8');
    expect(src).toMatch(/job\.kind === 'structured_import'/);
    expect(src).toMatch(/processStructuredImportJob/);
    expect(src).toMatch(/Unsupported job kind/);
    const processJobMatch = src.match(/private async processJob\(job: QueuedJob\): Promise<void> \{[\s\S]*?\n  \}/);
    expect(processJobMatch).toBeTruthy();
    const body = processJobMatch![0];
    expect(body).toMatch(/else if \(job\.kind === 'parse'\)/);
    expect(body).toMatch(/throw new Error\(`Unsupported job kind/);
    expect(src).toMatch(/'structured_import'/);
    expect(src).toMatch(/runStructuredImportJob/);
    const importFn = src.match(/private async processStructuredImportJob[\s\S]*?private async processParseJob/);
    expect(importFn).toBeTruthy();
    expect(importFn![0]).not.toMatch(/createLlmProvider/);
    expect(importFn![0]).not.toMatch(/provider\.parse/);
  });

  test('resolveAllowedKinds default list in source includes structured_import', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/services/LlmJobRunner.ts'), 'utf8');
    expect(src).toContain(
      "return new Set(['parse', 'materialize', 'checks', 'vision_review', 'compare', 'structured_import']);"
    );
  });
});

describe('structured import API route wiring', () => {
  test('structured-import route exposes POST /reports/structured-import', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/routes/structured-import.ts'), 'utf8');
    expect(src).toMatch(/\/reports\/structured-import/);
    expect(src).toMatch(/structuredImportService\.processImport/);
    expect(src).toMatch(/StructuredPackageError/);
    const reports = fs.readFileSync(path.join(process.cwd(), 'src/routes/reports.ts'), 'utf8');
    expect(reports).toMatch(/structuredImportRouter/);
  });

  test('migrations define artifacts and ingestion_mode in single schema module', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/db/structuredPackageSchema.ts'), 'utf8');
    expect(src).toMatch(/ingestion_mode/);
    expect(src).toMatch(/report_version_artifacts/);
    expect(src).toMatch(/package_sha256/);
    const reg = fs.readFileSync(path.join(process.cwd(), 'src/db/migrationRegistry.ts'), 'utf8');
    expect(reg).toMatch(/0002_structured_package_import/);
  });
});
