
import path from 'path';
import fs from 'fs';

function resolveProjectRoot(): string {
    // Try to find package.json in parent directories
    const candidate = path.resolve(__dirname, '..', '..');
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
        return candidate;
    }
    const candidate2 = path.resolve(__dirname, '..', '..', '..');
    if (fs.existsSync(path.join(candidate2, 'package.json'))) {
        return candidate2;
    }
    return process.cwd();
}

export const PROJECT_ROOT = resolveProjectRoot();
export const DATA_DIR = path.join(PROJECT_ROOT, 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
export const UPLOADS_TMP_DIR = path.join(UPLOADS_DIR, 'tmp');
