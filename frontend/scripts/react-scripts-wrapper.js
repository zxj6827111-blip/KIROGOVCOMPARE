'use strict';

const Module = require('module');
const path = require('path');

const command = process.argv[2];

if (!command) {
  console.error('[react-scripts-wrapper] Missing command. Usage: node scripts/react-scripts-wrapper.js <start|build|test>');
  process.exit(1);
}

class NoopForkTsCheckerWebpackPlugin {
  constructor(options = {}) {
    this.options = options;
  }

  apply() {
    // Intentionally disabled. We run `tsc --noEmit` separately in build.
  }

  static getCompilerHooks() {
    const hook = {
      tap() {
        // no-op
      },
      call() {
        // no-op
      },
    };

    return {
      start: hook,
      waiting: hook,
      canceled: hook,
      error: hook,
      issues: hook,
    };
  }
}

const disabledRequests = new Set([
  'fork-ts-checker-webpack-plugin',
  'react-dev-utils/ForkTsCheckerWebpackPlugin',
  'react-dev-utils/ForkTsCheckerWarningWebpackPlugin',
]);

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (disabledRequests.has(request)) {
    if (!process.env.CRA_WRAPPER_SILENT) {
      console.warn(`[react-scripts-wrapper] Disabled ${request} to avoid Windows spawn EPERM. Use "npm run typecheck" for TS checks.`);
    }
    return NoopForkTsCheckerWebpackPlugin;
  }

  return originalLoad.call(this, request, parent, isMain);
};

const scriptPath = path.join(__dirname, '..', 'node_modules', 'react-scripts', 'scripts', `${command}.js`);
require(scriptPath);
