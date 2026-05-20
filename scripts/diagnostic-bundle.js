#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SECRET_KEY_PATTERN = /(SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE|JWT|PGPASSWORD)/i;
const DEFAULT_LOG_LINES = 200;

function parseArgs(argv) {
  const args = {
    dryRun: false,
    zip: false,
    includeLogs: false,
    outDir: '',
    apiBase: process.env.OPS_API_BASE_URL || process.env.LLM_BASE_URL || process.env.API_BASE_URL || '',
    frontendUrl: process.env.OPS_FRONTEND_URL || process.env.FRONTEND_URL || '',
  };

  for (const arg of argv) {
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--zip') {
      args.zip = true;
    } else if (arg === '--include-logs') {
      args.includeLogs = true;
    } else if (arg.startsWith('--out=')) {
      args.outDir = arg.slice('--out='.length);
    } else if (arg.startsWith('--api-base=')) {
      args.apiBase = arg.slice('--api-base='.length);
    } else if (arg.startsWith('--frontend-url=')) {
      args.frontendUrl = arg.slice('--frontend-url='.length);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  if (!args.outDir) {
    args.outDir = path.join('.codex-temp', 'diagnostics', `kirogovcompare-diagnostic-${timestamp}`);
  }
  args.outDir = path.resolve(process.cwd(), args.outDir);
  args.apiBase = String(args.apiBase || `http://127.0.0.1:${process.env.PORT || 8787}`).replace(/\/+$/, '');
  if (!args.frontendUrl || isPlaceholderUrl(args.frontendUrl)) {
    args.frontendUrl = 'http://127.0.0.1:53002';
  }
  args.frontendUrl = String(args.frontendUrl).replace(/\/+$/, '');
  return args;
}

function isPlaceholderUrl(value) {
  try {
    const parsed = new URL(value);
    return ['your-domain.com', 'www.your-domain.com', 'example.com', 'www.example.com'].includes(
      parsed.hostname.toLowerCase()
    );
  } catch {
    return false;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
    timeout: options.timeoutMs || 30000,
  });

  return {
    command: [command, ...args].join(' '),
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error ? result.error.message : '',
  };
}

function writeText(root, relativePath, content) {
  const target = path.join(root, relativePath);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, content, 'utf8');
}

function writeJson(root, relativePath, value) {
  writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function summarizePackage(filePath) {
  const pkg = readJsonFile(filePath);
  if (!pkg) return { filePath, exists: false };
  return {
    filePath,
    exists: true,
    name: pkg.name,
    version: pkg.version,
    scripts: pkg.scripts || {},
    engines: pkg.engines || {},
    dependencies: Object.keys(pkg.dependencies || {}).sort(),
    devDependencies: Object.keys(pkg.devDependencies || {}).sort(),
  };
}

function parseEnvKeys(filePath) {
  if (!fs.existsSync(filePath)) return { filePath, exists: false, keys: [] };
  const keys = [];
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    keys.push({ key, secret: SECRET_KEY_PATTERN.test(key) });
  }
  return { filePath, exists: true, keys };
}

function copyIfExists(root, sourcePath, targetPath) {
  const absolute = path.resolve(process.cwd(), sourcePath);
  if (!fs.existsSync(absolute)) return false;
  ensureDir(path.dirname(path.join(root, targetPath)));
  fs.copyFileSync(absolute, path.join(root, targetPath));
  return true;
}

function directorySummary(relativePath) {
  const absolute = path.resolve(process.cwd(), relativePath);
  const summary = {
    relativePath,
    exists: fs.existsSync(absolute),
    files: 0,
    directories: 0,
    bytes: 0,
  };
  if (!summary.exists) return summary;

  const stack = [absolute];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        summary.directories += 1;
        stack.push(entryPath);
      } else if (entry.isFile()) {
        summary.files += 1;
        try {
          summary.bytes += fs.statSync(entryPath).size;
        } catch {
          // ignore racing files
        }
      }
    }
  }
  summary.megabytes = Number((summary.bytes / 1024 / 1024).toFixed(2));
  return summary;
}

function tailFile(filePath, maxLines) {
  if (!fs.existsSync(filePath)) return '';
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
}

function collectLogTails(root) {
  const logsDir = path.resolve(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) return [];
  const collected = [];
  const entries = fs.readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(log|err)$/i.test(entry.name))
    .slice(0, 10);

  for (const entry of entries) {
    const relativeTarget = path.join('logs-tail', `${entry.name}.tail.txt`);
    writeText(root, relativeTarget, tailFile(path.join(logsDir, entry.name), DEFAULT_LOG_LINES));
    collected.push(relativeTarget);
  }
  return collected;
}

function detectTool(command) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(probe, [command], { encoding: 'utf8', stdio: 'pipe' });
  return {
    command,
    available: result.status === 0,
    path: result.status === 0 ? (result.stdout || '').split(/\r?\n/).filter(Boolean)[0] || '' : '',
  };
}

function compressWithPowershell(sourceDir, zipPath) {
  if (process.platform !== 'win32') {
    return { skipped: true, reason: 'zip option currently uses PowerShell Compress-Archive on Windows' };
  }
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Compress-Archive -LiteralPath ${JSON.stringify(sourceDir)} -DestinationPath ${JSON.stringify(zipPath)} -Force`,
  ], {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 120000,
  });
  return {
    skipped: false,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error ? result.error.message : '',
    zipPath,
  };
}

function collectPlannedItems(args) {
  return [
    'git/status.txt',
    'git/log-oneline-10.txt',
    'git/diff-name-only.txt',
    'packages/root-package-summary.json',
    'packages/frontend-package-summary.json',
    'env/env-example.txt',
    'env/env-key-presence.json',
    'directories/summary.json',
    'tools/pdf-tools.json',
    'health/health-check.json',
    args.includeLogs ? 'logs-tail/*.tail.txt' : 'logs excluded by default',
    'manifest.json',
  ];
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plannedItems = collectPlannedItems(args);

  if (args.dryRun) {
    console.log('KIROGOVCOMPARE diagnostic bundle dry run');
    console.log(`Output directory: ${args.outDir}`);
    console.log('Planned collection:');
    plannedItems.forEach((item) => console.log(`- ${item}`));
    console.log('');
    console.log('Excluded by default: .env values, secrets, node_modules, dist/build/coverage, data payload files, uploads, PDF/ZIP/screenshots/HTML dumps, full logs, backups.');
    return;
  }

  ensureDir(args.outDir);

  const commands = {
    status: runCommand('git', ['status', '--short', '--branch', '--untracked-files=all']),
    log: runCommand('git', ['log', '--oneline', '-10']),
    diffNameOnly: runCommand('git', ['diff', '--name-only']),
    lsOthers: runCommand('git', ['ls-files', '--others', '--exclude-standard']),
  };

  writeText(args.outDir, 'git/status.txt', commands.status.stdout + commands.status.stderr);
  writeText(args.outDir, 'git/log-oneline-10.txt', commands.log.stdout + commands.log.stderr);
  writeText(args.outDir, 'git/diff-name-only.txt', commands.diffNameOnly.stdout + commands.diffNameOnly.stderr);
  writeText(args.outDir, 'git/untracked-exclude-standard.txt', commands.lsOthers.stdout + commands.lsOthers.stderr);

  writeJson(args.outDir, 'packages/root-package-summary.json', summarizePackage(path.resolve(process.cwd(), 'package.json')));
  writeJson(args.outDir, 'packages/frontend-package-summary.json', summarizePackage(path.resolve(process.cwd(), 'frontend', 'package.json')));

  copyIfExists(args.outDir, '.env.example', path.join('env', 'env-example.txt'));
  writeJson(args.outDir, 'env/env-key-presence.json', {
    envExample: parseEnvKeys(path.resolve(process.cwd(), '.env.example')),
    localEnvKeysOnly: parseEnvKeys(path.resolve(process.cwd(), '.env')),
  });

  const directories = ['data', 'data/uploads', 'data/exports/pdf', 'uploads', 'logs', 'tmp', 'output', 'backups'];
  writeJson(args.outDir, 'directories/summary.json', directories.map(directorySummary));

  const tools = ['node', 'npm', 'git', 'pdfinfo', 'pdftoppm', process.platform === 'win32' ? 'magick.exe' : 'magick', process.platform === 'win32' ? 'gswin64c.exe' : 'gs'];
  writeJson(args.outDir, 'tools/pdf-tools.json', tools.map(detectTool));

  const healthArgs = [
    'scripts/health-check.js',
    '--json',
    '--skip-network',
    `--api-base=${args.apiBase}`,
    `--frontend-url=${args.frontendUrl}`,
  ];
  const health = runCommand(process.execPath, healthArgs, { timeoutMs: 45000 });
  writeText(args.outDir, 'health/health-check.json', health.stdout || JSON.stringify(health, null, 2));
  if (health.stderr) {
    writeText(args.outDir, 'health/health-check.stderr.txt', health.stderr);
  }

  const collectedLogTails = args.includeLogs ? collectLogTails(args.outDir) : [];

  const manifest = {
    generatedAt: new Date().toISOString(),
    cwd: process.cwd(),
    platform: `${os.platform()} ${os.release()}`,
    node: process.version,
    outputDir: args.outDir,
    zipRequested: args.zip,
    includeLogs: args.includeLogs,
    collectedLogTails,
    exclusions: [
      '.env values',
      'secrets and tokens',
      'node_modules',
      'dist/build/coverage',
      'data payload files and uploads',
      'PDF/ZIP/screenshots/HTML dumps',
      'full logs',
      'backups',
    ],
  };
  writeJson(args.outDir, 'manifest.json', manifest);

  let zipResult = null;
  if (args.zip) {
    zipResult = compressWithPowershell(args.outDir, `${args.outDir}.zip`);
    writeJson(args.outDir, 'zip-result.json', zipResult);
  }

  console.log('Diagnostic bundle generated.');
  console.log(`Directory: ${args.outDir}`);
  if (zipResult && !zipResult.skipped) {
    console.log(`Zip: ${zipResult.zipPath}`);
  } else if (zipResult && zipResult.skipped) {
    console.log(`Zip skipped: ${zipResult.reason}`);
  }
}

main();
