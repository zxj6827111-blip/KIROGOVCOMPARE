#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

try {
  require('dotenv').config();
} catch {
  // dotenv is optional for read-only environment inspection.
}

const DEFAULT_TIMEOUT_MS = 5000;
const SECRET_KEY_PATTERN = /(SECRET|TOKEN|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE|JWT|PGPASSWORD)/i;

function parseArgs(argv) {
  const args = {
    apiBase: process.env.OPS_API_BASE_URL || process.env.LLM_BASE_URL || process.env.API_BASE_URL || '',
    frontendUrl: process.env.OPS_FRONTEND_URL || process.env.FRONTEND_URL || '',
    timeoutMs: Number(process.env.OPS_HEALTH_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    json: false,
    strict: false,
    requireServices: false,
    skipNetwork: false,
  };

  for (const arg of argv) {
    if (arg === '--json') {
      args.json = true;
    } else if (arg === '--strict') {
      args.strict = true;
      args.requireServices = true;
    } else if (arg === '--require-services') {
      args.requireServices = true;
    } else if (arg === '--skip-network') {
      args.skipNetwork = true;
    } else if (arg.startsWith('--api-base=')) {
      args.apiBase = arg.slice('--api-base='.length);
    } else if (arg.startsWith('--frontend-url=')) {
      args.frontendUrl = arg.slice('--frontend-url='.length);
    } else if (arg.startsWith('--timeout-ms=')) {
      const timeout = Number(arg.slice('--timeout-ms='.length));
      if (Number.isFinite(timeout) && timeout > 0) {
        args.timeoutMs = timeout;
      }
    }
  }

  if (!args.apiBase) {
    args.apiBase = `http://127.0.0.1:${process.env.PORT || 8787}`;
  }
  if (!args.frontendUrl || isPlaceholderUrl(args.frontendUrl)) {
    args.frontendUrl = 'http://127.0.0.1:53002';
  }

  args.apiBase = normalizeBaseUrl(args.apiBase);
  args.frontendUrl = normalizeBaseUrl(args.frontendUrl);
  return args;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
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

function makeCheck(id, label, status, details, options = {}) {
  return {
    id,
    label,
    status,
    details: details || '',
    critical: Boolean(options.critical),
    meta: options.meta || undefined,
  };
}

function statusIcon(status) {
  if (status === 'pass') return 'PASS';
  if (status === 'warn') return 'WARN';
  if (status === 'skip') return 'SKIP';
  return 'FAIL';
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key);
}

function getEnvPresence(keys) {
  return keys.map((key) => ({
    key,
    present: Boolean(process.env[key]),
    secret: isSecretKey(key),
  }));
}

function commandExists(command) {
  const probe = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(probe, [command], { encoding: 'utf8', stdio: 'pipe' });
  return result.status === 0;
}

function getDirectorySummary(relativePath) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  const exists = fs.existsSync(absolutePath);
  if (!exists) {
    return { relativePath, absolutePath, exists, writable: false, readable: false };
  }

  let readable = false;
  let writable = false;
  try {
    fs.accessSync(absolutePath, fs.constants.R_OK);
    readable = true;
  } catch {
    readable = false;
  }
  try {
    fs.accessSync(absolutePath, fs.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  return { relativePath, absolutePath, exists, readable, writable };
}

async function fetchText(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    return { ok: response.ok, status: response.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function checkHttpEndpoint(checks, id, label, url, timeoutMs, critical) {
  try {
    const response = await fetchText(url, timeoutMs);
    const detail = `HTTP ${response.status}: ${response.text.slice(0, 300).replace(/\s+/g, ' ')}`;
    checks.push(makeCheck(id, label, response.ok ? 'pass' : 'fail', detail, { critical }));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    checks.push(makeCheck(id, label, critical ? 'fail' : 'warn', message, { critical }));
  }
}

async function checkDatabase(checks) {
  const requiredKeys = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = requiredKeys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    checks.push(makeCheck('db-env', 'PostgreSQL environment', 'fail', `Missing: ${missing.join(', ')}`, { critical: true }));
    checks.push(makeCheck('db-select', 'PostgreSQL SELECT 1', 'skip', 'Skipped because database environment is incomplete'));
    return;
  }

  let Pool;
  try {
    Pool = require('pg').Pool;
  } catch (error) {
    checks.push(makeCheck('db-client', 'PostgreSQL client package', 'fail', 'Cannot load pg package', { critical: true }));
    return;
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: Number(process.env.OPS_DB_TIMEOUT_MS || 3000),
    max: 1,
  });

  try {
    await pool.query('SELECT 1');
    checks.push(makeCheck('db-select', 'PostgreSQL SELECT 1', 'pass', 'Database connection is reachable'));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    checks.push(makeCheck('db-select', 'PostgreSQL SELECT 1', 'fail', message, { critical: true }));
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function checkRedis(checks) {
  const rateLimitStore = String(process.env.RATE_LIMIT_STORE || 'memory').toLowerCase();
  if (rateLimitStore !== 'redis') {
    checks.push(makeCheck('redis-ping', 'Redis ping', 'skip', 'RATE_LIMIT_STORE is not redis'));
    return;
  }

  let createClient;
  try {
    createClient = require('redis').createClient;
  } catch {
    checks.push(makeCheck('redis-client', 'Redis client package', 'fail', 'Cannot load redis package', { critical: true }));
    return;
  }

  const client = createClient({
    url: process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL || undefined,
    socket: process.env.RATE_LIMIT_REDIS_URL || process.env.REDIS_URL
      ? undefined
      : {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
      },
    database: Number(process.env.REDIS_DB || 0),
  });

  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.ping();
    checks.push(makeCheck('redis-ping', 'Redis ping', 'pass', 'Redis is reachable'));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    checks.push(makeCheck('redis-ping', 'Redis ping', 'fail', message, { critical: true }));
  } finally {
    await client.quit().catch(() => undefined);
  }
}

async function checkJobsSummary(checks) {
  const requiredKeys = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  if (requiredKeys.some((key) => !process.env[key])) {
    checks.push(makeCheck('jobs-summary', 'Jobs queue summary', 'skip', 'Skipped because database environment is incomplete'));
    return;
  }

  let Pool;
  try {
    Pool = require('pg').Pool;
  } catch {
    checks.push(makeCheck('jobs-summary', 'Jobs queue summary', 'skip', 'Cannot load pg package'));
    return;
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: Number(process.env.OPS_DB_TIMEOUT_MS || 3000),
    max: 1,
  });

  try {
    const result = await pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM jobs
      WHERE created_at >= NOW() - INTERVAL '24 hours'
      GROUP BY status
      ORDER BY status
    `);
    const summary = result.rows.map((row) => `${row.status}:${row.count}`).join(', ') || 'no jobs in last 24h';
    checks.push(makeCheck('jobs-summary', 'Jobs queue summary', 'pass', summary, {
      meta: { rows: result.rows },
    }));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    checks.push(makeCheck('jobs-summary', 'Jobs queue summary', 'warn', message));
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function checkPuppeteer(checks) {
  try {
    const puppeteer = require('puppeteer');
    const configured = process.env.PUPPETEER_EXECUTABLE_PATH || '';
    let executablePath = configured;
    if (!executablePath) {
      try {
        executablePath = puppeteer.executablePath();
      } catch {
        executablePath = '';
      }
    }
    const executableExists = executablePath ? fs.existsSync(executablePath) : false;
    checks.push(makeCheck(
      'puppeteer',
      'Puppeteer package and browser executable',
      executablePath && executableExists ? 'pass' : 'warn',
      executablePath
        ? `executable=${executablePath}, exists=${executableExists}`
        : 'Puppeteer loaded, but no executable path was resolved'
    ));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    checks.push(makeCheck('puppeteer', 'Puppeteer package and browser executable', 'warn', message));
  }
}

function checkNativePdfTools(checks) {
  const tools = [
    ['pdfinfo', 'Poppler pdfinfo'],
    ['pdftoppm', 'Poppler pdftoppm'],
    [process.platform === 'win32' ? 'magick.exe' : 'magick', 'ImageMagick magick'],
    [process.platform === 'win32' ? 'gswin64c.exe' : 'gs', 'Ghostscript'],
  ];

  for (const [command, label] of tools) {
    const available = commandExists(command);
    checks.push(makeCheck(
      `tool-${command.replace(/\W+/g, '-')}`,
      label,
      available ? 'pass' : 'warn',
      available ? `${command} is available` : `${command} is not on PATH`
    ));
  }
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const checks = [];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  checks.push(makeCheck(
    'node-version',
    'Node.js version',
    nodeMajor >= 20 ? 'pass' : 'warn',
    `current=${process.versions.node}, required>=20`
  ));

  const requiredEnv = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const recommendedEnv = [
    'PORT',
    'FRONTEND_URL',
    'JWT_SECRET',
    'CORS_ALLOWED_ORIGINS',
    'LLM_PROVIDER',
    'LLM_MODEL',
    'OPENAI_API_KEY',
  ];
  const missingRequired = requiredEnv.filter((key) => !process.env[key]);
  const missingRecommended = recommendedEnv.filter((key) => !process.env[key]);
  checks.push(makeCheck(
    'env-required',
    'Required environment keys',
    missingRequired.length === 0 ? 'pass' : 'fail',
    missingRequired.length === 0 ? 'All required DB keys are present' : `Missing: ${missingRequired.join(', ')}`,
    { critical: missingRequired.length > 0 }
  ));
  checks.push(makeCheck(
    'env-recommended',
    'Recommended environment keys',
    missingRecommended.length === 0 ? 'pass' : 'warn',
    missingRecommended.length === 0 ? 'All recommended keys are present' : `Missing or empty: ${missingRecommended.join(', ')}`
  ));

  const directories = ['data/uploads', 'data/uploads/tmp', 'data/exports/pdf', 'logs', 'tmp'];
  for (const relativePath of directories) {
    const info = getDirectorySummary(relativePath);
    const status = info.exists && info.readable && info.writable ? 'pass' : 'warn';
    checks.push(makeCheck(
      `dir-${relativePath.replace(/[\\/]/g, '-')}`,
      `Directory ${relativePath}`,
      status,
      info.exists
        ? `readable=${info.readable}, writable=${info.writable}`
        : 'Directory does not exist yet',
      { meta: { relativePath: info.relativePath, exists: info.exists, readable: info.readable, writable: info.writable } }
    ));
  }

  if (!args.skipNetwork) {
    await checkHttpEndpoint(
      checks,
      'backend-health',
      'Backend /api/health',
      `${args.apiBase}/api/health`,
      args.timeoutMs,
      args.requireServices
    );
    await checkHttpEndpoint(
      checks,
      'frontend-health',
      'Frontend /healthz',
      `${args.frontendUrl}/healthz`,
      args.timeoutMs,
      args.requireServices
    );
  } else {
    checks.push(makeCheck('backend-health', 'Backend /api/health', 'skip', 'Network checks disabled by --skip-network'));
    checks.push(makeCheck('frontend-health', 'Frontend /healthz', 'skip', 'Network checks disabled by --skip-network'));
  }

  await checkDatabase(checks);
  await checkRedis(checks);
  await checkJobsSummary(checks);
  checkPuppeteer(checks);
  checkNativePdfTools(checks);

  const failed = checks.filter((check) => check.status === 'fail');
  const warnings = checks.filter((check) => check.status === 'warn');
  const criticalFailed = failed.filter((check) => check.critical);
  const ok = args.strict ? criticalFailed.length === 0 && failed.length === 0 : criticalFailed.length === 0;

  const output = {
    ok,
    strict: args.strict,
    generatedAt: new Date().toISOString(),
    cwd: process.cwd(),
    platform: `${os.platform()} ${os.release()}`,
    config: {
      apiBase: args.apiBase,
      frontendUrl: args.frontendUrl,
      timeoutMs: args.timeoutMs,
      skipNetwork: args.skipNetwork,
      requireServices: args.requireServices,
    },
    envPresence: getEnvPresence([...requiredEnv, ...recommendedEnv]),
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === 'pass').length,
      warned: warnings.length,
      failed: failed.length,
      skipped: checks.filter((check) => check.status === 'skip').length,
      criticalFailed: criticalFailed.length,
    },
    checks,
  };

  if (args.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } else {
    console.log('KIROGOVCOMPARE health check');
    console.log(`Generated: ${output.generatedAt}`);
    console.log(`Backend: ${args.apiBase}`);
    console.log(`Frontend: ${args.frontendUrl}`);
    console.log('');
    for (const check of checks) {
      console.log(`[${statusIcon(check.status)}] ${check.label} - ${check.details}`);
    }
    console.log('');
    console.log(`Summary: passed=${output.summary.passed}, warnings=${output.summary.warned}, failed=${output.summary.failed}, skipped=${output.summary.skipped}`);
    if (!args.strict && (failed.length > 0 || warnings.length > 0)) {
      console.log('Note: default mode is read-only and non-strict. Use --strict --require-services for deployment gates.');
    }
  }

  process.exit(ok ? 0 : 1);
}

run().catch((error) => {
  const message = error && error.stack ? error.stack : String(error);
  console.error(message);
  process.exit(1);
});
