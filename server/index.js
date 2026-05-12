'use strict';

// Zero-dependency HTTP server: serves the static frontend from /public and
// a JSON API at /api/*. Data comes from the in-memory cache which is
// refreshed in the background.

const http = require('http');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const cache = require('./cache');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(text);
}

function matchFilter(token, filter) {
  switch (filter) {
    case 'new':         // < 24h
      return token.ageBucket === 'new';
    case 'trending':    // WATCHLIST+ threshold
      return token.fps >= 60;
    case 'highscore':   // EARLY PUMP GEM
      return token.fps >= 80;
    case 'all':
    default:
      return true;
  }
}

function handleTokens(req, res, searchParams) {
  const snapshot = cache.getSnapshot();

  const filter = (searchParams.get('filter') || 'all').toLowerCase();
  const search = (searchParams.get('search') || '').trim().toLowerCase();
  const limit = Math.max(1, Math.min(config.maxResults, parseInt(searchParams.get('limit'), 10) || config.maxResults));

  let tokens = snapshot.tokens;
  if (filter !== 'all') tokens = tokens.filter((t) => matchFilter(t, filter));
  if (search) {
    tokens = tokens.filter((t) => {
      const hay = `${t.symbol} ${t.name} ${t.chain} ${t.dex}`.toLowerCase();
      return hay.includes(search);
    });
  }

  // Already sorted desc by fps in the cache; slice for safety.
  tokens = tokens.slice(0, limit);

  sendJson(res, 200, {
    updatedAt: snapshot.updatedAt,
    refreshes: snapshot.refreshes,
    refreshIntervalMs: config.refreshIntervalMs,
    tokenCount: tokens.length,
    totalAvailable: snapshot.tokens.length,
    lastError: snapshot.lastError,
    tokens
  });
}

function handleHealth(res) {
  const snapshot = cache.getSnapshot();
  sendJson(res, 200, {
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    refreshes: snapshot.refreshes,
    updatedAt: snapshot.updatedAt,
    cachedTokens: snapshot.tokens.length,
    lastError: snapshot.lastError
  });
}

// Basic static-file serving with a small safe-resolve check.
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const abs = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!abs.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  fs.stat(abs, (err, stat) => {
    if (err || !stat.isFile()) {
      sendText(res, 404, 'Not Found');
      return;
    }
    const ext = path.extname(abs).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'content-type': type,
      'content-length': stat.size,
      'cache-control': 'public, max-age=60'
    });
    fs.createReadStream(abs).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  // Build a WHATWG URL against a dummy origin — we only care about pathname/query.
  const parsed = new URL(req.url, 'http://localhost');
  const pathname = parsed.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/tokens') {
      return handleTokens(req, res, parsed.searchParams);
    }
    if (req.method === 'GET' && pathname === '/api/health') {
      return handleHealth(res);
    }
    if (req.method === 'GET') {
      return serveStatic(req, res, pathname);
    }
    sendText(res, 405, 'Method Not Allowed');
  } catch (err) {
    console.error('[server] unhandled error:', err);
    sendJson(res, 500, { error: 'internal_error', message: err.message });
  }
});

server.listen(config.port, () => {
  console.log(`[server] Token Pump Radar listening on http://localhost:${config.port}`);
  console.log(`[server] refresh interval: ${config.refreshIntervalMs} ms, cap ${config.maxResults} tokens`);
  cache.start();
});

function shutdown(sig) {
  console.log(`[server] ${sig} received, shutting down...`);
  cache.stop();
  server.close(() => process.exit(0));
  // Force exit if close hangs.
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
