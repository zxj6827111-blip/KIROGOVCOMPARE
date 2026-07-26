const fs = require('fs');
const path = require('path');

const legacySrcDir = path.join(__dirname, '..', 'src', 'public');
const frontendBuildDir = path.join(__dirname, '..', 'frontend', 'build');
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

async function copyDirRecursive(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(from, to);
    } else if (entry.isFile()) {
      await copyFileWithRetry(from, to);
    }
  }
}

async function main() {
  await fs.promises.mkdir(path.join(__dirname, '..', 'dist'), { recursive: true });

  const hasFrontendBuild = fs.existsSync(path.join(frontendBuildDir, 'index.html'));
  const primarySrcDir = hasFrontendBuild ? frontendBuildDir : legacySrcDir;
  const files = await listFiles(primarySrcDir);
  for (const file of files) {
    const destFile = path.join(destDir, file.relative);
    await copyFileWithRetry(file.src, destFile);
  }

  if (hasFrontendBuild && fs.existsSync(legacySrcDir)) {
    const legacyFiles = await listFiles(legacySrcDir);
    for (const file of legacyFiles) {
      if (file.relative.toLowerCase() === 'index.html') continue;
      const destFile = path.join(destDir, file.relative);
      await copyFileWithRetry(file.src, destFile);
    }
  }

  // Runtime JSON schemas (structured package import, annual report schemas, etc.)
  const schemaSrc = path.join(__dirname, '..', 'src', 'schemas');
  const schemaDest = path.join(__dirname, '..', 'dist', 'schemas');
  if (fs.existsSync(schemaSrc)) {
    await copyDirRecursive(schemaSrc, schemaDest);
  }
}

main().catch((error) => {
  console.error('[copy-public] failed:', error);
  process.exit(1);
});
