/**
 * resolveAbsoluteStoragePath must honor the KIROGOV_DATA_DIR override for
 * project-root-relative "data/..." storage labels.
 *
 * Regression: acceptance runs with an isolated DATA_DIR wrote uploads into
 * KIROGOV_DATA_DIR, but the guard resolved "data/uploads/..." against
 * PROJECT_ROOT only, so classic PDF uploads failed with SOURCE_FILE_MISSING.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

describe('resolveAbsoluteStoragePath', () => {
  const originalDataDir = process.env.KIROGOV_DATA_DIR;
  let tmpDataDir: string;

  beforeEach(() => {
    tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kirogov-guard-test-'));
  });

  afterEach(() => {
    if (originalDataDir === undefined) {
      delete process.env.KIROGOV_DATA_DIR;
    } else {
      process.env.KIROGOV_DATA_DIR = originalDataDir;
    }
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
    jest.resetModules();
  });

  function loadServiceWithEnv(dataDirOverride?: string) {
    jest.resetModules();
    if (dataDirOverride === undefined) {
      delete process.env.KIROGOV_DATA_DIR;
    } else {
      process.env.KIROGOV_DATA_DIR = dataDirOverride;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../services/SourceFileGuardService') as typeof import('../services/SourceFileGuardService');
  }

  it('maps the data/ prefix onto the overridden DATA_DIR when the file exists there', () => {
    const rel = 'data/uploads/1/2023/sample.pdf';
    const physical = path.join(tmpDataDir, 'uploads', '1', '2023', 'sample.pdf');
    fs.mkdirSync(path.dirname(physical), { recursive: true });
    fs.writeFileSync(physical, 'pdf-bytes');

    const svc = loadServiceWithEnv(tmpDataDir);
    expect(path.resolve(svc.resolveAbsoluteStoragePath(rel))).toBe(path.resolve(physical));
    expect(svc.checkStoragePathExists(rel).ok).toBe(true);
  });

  it('falls back to PROJECT_ROOT resolution when the override does not contain the file', () => {
    const svc = loadServiceWithEnv(tmpDataDir);
    const { PROJECT_ROOT } = require('../config/constants') as typeof import('../config/constants');
    const rel = 'data/uploads/does-not-exist-anywhere.pdf';
    const result = svc.resolveAbsoluteStoragePath(rel);
    // Not found in the override; the legacy PROJECT_ROOT/cwd fallback answers.
    expect([path.resolve(PROJECT_ROOT, rel), path.resolve(process.cwd(), rel)]).toContain(
      path.resolve(result)
    );
    expect(svc.checkStoragePathExists(rel).ok).toBe(false);
  });

  it('keeps default behavior when KIROGOV_DATA_DIR is unset (DATA_DIR === <project>/data)', () => {
    const svc = loadServiceWithEnv(undefined);
    const constants = require('../config/constants') as typeof import('../config/constants');
    expect(path.resolve(constants.DATA_DIR)).toBe(path.resolve(constants.PROJECT_ROOT, 'data'));
    const absolute = path.join(tmpDataDir, 'abs.pdf');
    fs.writeFileSync(absolute, 'x');
    expect(svc.resolveAbsoluteStoragePath(absolute)).toBe(absolute);
  });
});
