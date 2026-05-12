const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 3001);
const API_PROXY_TARGET = process.env.API_PROXY_TARGET || 'http://localhost:8787';
const BUILD_DIR = path.resolve(__dirname, '..', 'build');

function contentTypeFor(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
  };
  return types[extension] || 'application/octet-stream';
}

function sendText(response, statusCode, message) {
  response.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function safeJoin(root, requestPath) {
  const decodedPath = decodeURIComponent(requestPath.split('?')[0]);
  const normalizedPath = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, normalizedPath);
  return filePath.startsWith(root) ? filePath : root;
}

function proxyApiRequest(request, response) {
  const target = new URL(API_PROXY_TARGET);
  const proxyClient = target.protocol === 'https:' ? https : http;

  const proxyRequest = proxyClient.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: request.method,
      path: request.url,
      headers: {
        ...request.headers,
        host: target.host,
      },
    },
    (proxyResponse) => {
      response.writeHead(proxyResponse.statusCode || 502, proxyResponse.headers);
      proxyResponse.pipe(response);
    }
  );

  proxyRequest.on('error', (error) => {
    sendText(response, 502, `API proxy failed: ${error.message}`);
  });

  request.pipe(proxyRequest);
}

function serveStatic(request, response) {
  if (!fs.existsSync(BUILD_DIR)) {
    sendText(response, 503, 'Frontend build is missing. Run npm run build in frontend.');
    return;
  }

  const requestPath = request.url === '/' ? '/index.html' : request.url || '/index.html';
  let filePath = safeJoin(BUILD_DIR, requestPath);

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(BUILD_DIR, 'index.html');
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      sendText(response, 404, 'Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Cache-Control': 'no-store',
    });
    response.end(content);
  });
}

http
  .createServer((request, response) => {
    if ((request.url || '').startsWith('/api')) {
      proxyApiRequest(request, response);
      return;
    }
    serveStatic(request, response);
  })
  .listen(PORT, HOST, () => {
    console.log(`Frontend static server listening on http://${HOST}:${PORT}`);
    console.log(`Proxying /api to ${API_PROXY_TARGET}`);
  });
