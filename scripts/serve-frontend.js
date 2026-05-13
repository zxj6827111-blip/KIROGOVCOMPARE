'use strict';

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const app = express();
const host = process.env.FRONTEND_HOST || '0.0.0.0';
const port = Number(process.env.FRONTEND_PORT || 53002);
const backendOrigin = new URL(process.env.BACKEND_ORIGIN || 'http://127.0.0.1:8787');
const buildDir = path.resolve(
  process.env.FRONTEND_BUILD_DIR || path.join(__dirname, '..', 'frontend', 'build')
);
const indexFile = path.join(buildDir, 'index.html');
const proxyClient = backendOrigin.protocol === 'https:' ? https : http;

if (!fs.existsSync(indexFile)) {
  console.error(`[frontend] Missing build artifact: ${indexFile}`);
  process.exit(1);
}

app.disable('x-powered-by');

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, service: 'kirogovcompare-frontend' });
});

app.use('/api', (req, res) => {
  const targetUrl = new URL(req.originalUrl, backendOrigin);
  const forwardedFor = req.headers['x-forwarded-for'];
  const clientIp = req.socket.remoteAddress;
  const proxyHeaders = {
    ...req.headers,
    host: targetUrl.host,
    'x-forwarded-host': req.headers.host,
    'x-forwarded-proto': req.protocol,
    'x-forwarded-for': forwardedFor
      ? `${forwardedFor}, ${clientIp}`
      : clientIp,
  };

  const proxyReq = proxyClient.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetUrl.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: `${targetUrl.pathname}${targetUrl.search}`,
      headers: proxyHeaders,
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode || 502);

      Object.entries(proxyRes.headers).forEach(([key, value]) => {
        if (typeof value !== 'undefined') {
          res.setHeader(key, value);
        }
      });

      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (error) => {
    console.error('[frontend] API proxy error:', error.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'bad_gateway' });
    } else {
      res.end();
    }
  });

  req.on('aborted', () => {
    proxyReq.destroy();
  });

  req.pipe(proxyReq);
});

app.use(express.static(buildDir, { index: false }));

app.get('*', (req, res, next) => {
  res.sendFile(indexFile, (err) => {
    if (err) {
      next(err);
    }
  });
});

app.listen(port, host, () => {
  console.log(`[frontend] Serving ${buildDir} on http://${host}:${port}`);
  console.log(`[frontend] Proxying /api to ${backendOrigin.origin}`);
});
