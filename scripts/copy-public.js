const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'src', 'public');
const destDir = path.join(__dirname, '..', 'dist', 'public');
const retryableCodes = new Set(['EPERM', 'EBUSY', 'EACCES', 'EMFILE', 'ENFILE']);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listFiles(dir, root = dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listFiles(absolute, root);
      files.push(...nested);
      continue;
    }
    if (entry.isFile()) {
      files.push({
        src: absolute,
        relative: path.relative(root, absolute),
      });
    }
  }

  return files;
}

async function buffersEqual(leftPath, rightPath) {
  try {
    const [left, right] = await Promise.all([
      fs.promises.readFile(leftPath),
      fs.promises.readFile(rightPath),
    ]);
    return left.equals(right);
  } catch {
    return false;
  }
}

async function copyFileWithRetry(srcFile, destFile, maxRetries = 6) {
  await fs.promises.mkdir(path.dirname(destFile), { recursive: true });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      await fs.promises.copyFile(srcFile, destFile);
      return;
    } catch (error) {
      const code = error && error.code ? error.code : '';
      const isRetryable = retryableCodes.has(code);
      const isLastAttempt = attempt === maxRetries;

      if ((code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') && (await buffersEqual(srcFile, destFile))) {
        console.warn(`[copy-public] skip locked unchanged file: ${destFile}`);
        return;
      }

      if (isRetryable && !isLastAttempt) {
        const waitMs = 120 * (attempt + 1);
        await sleep(waitMs);
        continue;
      }

      throw error;
    }
  }
}

async function main() {
  await fs.promises.mkdir(path.join(__dirname, '..', 'dist'), { recursive: true });
  const files = await listFiles(srcDir);
  for (const file of files) {
    const destFile = path.join(destDir, file.relative);
    await copyFileWithRetry(file.src, destFile);
  }
}

main().catch((error) => {
  console.error('[copy-public] failed:', error);
  process.exit(1);
});
