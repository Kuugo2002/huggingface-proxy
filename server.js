'use strict';

const http = require('node:http');
const https = require('node:https');
const { pipeline } = require('node:stream');

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

function filterHeaders(headers) {
  const excluded = new Set(HOP_BY_HOP);
  for (const name of (headers.connection || '').split(',')) {
    excluded.add(name.trim().toLowerCase());
  }
  return Object.fromEntries(Object.entries(headers).filter(([name, value]) =>
    value !== undefined && !excluded.has(name.toLowerCase())));
}

function positiveInteger(value, name, fallback, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > max) {
    throw new Error(`${name} must be an integer between 1 and ${max}`);
  }
  return Number(value);
}

function createProxyServer({
  upstream = 'https://huggingface.co',
  timeoutMs = 30_000,
  logger = console,
} = {}) {
  const target = new URL(upstream);
  if (!['http:', 'https:'].includes(target.protocol) || target.username ||
      target.password || target.pathname !== '/' || target.search || target.hash) {
    throw new Error('UPSTREAM_URL must be an HTTP(S) origin without credentials, path, query or fragment');
  }
  timeoutMs = positiveInteger(timeoutMs, 'UPSTREAM_TIMEOUT_MS', 30_000);
  const client = target.protocol === 'https:' ? https : http;
  const agent = new client.Agent({ keepAlive: true, maxSockets: 128, maxFreeSockets: 16 });

  const server = http.createServer((req, res) => {
    // The destination is fixed: request paths can never select another host.
    if (!req.url.startsWith('/') || req.url.startsWith('//')) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Invalid request path');
      return;
    }

    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': req.headers['access-control-request-headers'] ||
        'Content-Type, Authorization, Range',
      'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Location',
    };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...corsHeaders, vary: 'Access-Control-Request-Headers' });
      res.end();
      return;
    }

    const headers = filterHeaders(req.headers);
    headers.host = target.host;
    const proxyReq = client.request(target, {
      path: req.url,
      method: req.method,
      headers,
      agent,
    });
    let proxyRes;
    let timedOut = false;

    function fail(err) {
      if (res.destroyed) return;
      logger.error(`Upstream request failed: ${err.code || err.message}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(timedOut ? 504 : 502, {
        ...corsHeaders, 'content-type': 'text/plain; charset=utf-8',
      });
      res.end(timedOut ? 'Upstream request timed out' : 'Upstream request failed');
    }

    // An inactivity timeout allows long downloads while bounding stalled connections.
    proxyReq.setTimeout(timeoutMs, () => {
      timedOut = true;
      proxyReq.destroy(Object.assign(new Error('Upstream timeout'), { code: 'ETIMEDOUT' }));
    });
    proxyReq.on('error', fail);
    proxyReq.on('response', (response) => {
      proxyRes = response;
      const responseHeaders = filterHeaders(response.headers);
      if (responseHeaders.location) {
        try {
          const location = new URL(responseHeaders.location, target.origin + req.url);
          if (location.origin === target.origin) {
            responseHeaders.location = location.pathname + location.search + location.hash;
          }
        } catch {
          // Preserve unusual upstream Location values unchanged.
        }
      }
      res.writeHead(response.statusCode || 502, { ...responseHeaders, ...corsHeaders });
      pipeline(response, res, (err) => {
        if (err && !req.destroyed && !res.destroyed) fail(err);
      });
    });

    // Stop upstream work immediately if the client abandons an upload or download.
    req.on('aborted', () => proxyReq.destroy());
    res.on('close', () => {
      if (!res.writableFinished) {
        proxyReq.destroy();
        proxyRes?.destroy();
      }
    });
    pipeline(req, proxyReq, (err) => {
      if (err) proxyReq.destroy(err);
    });
  });

  server.on('close', () => agent.destroy());
  return server;
}

if (require.main === module) {
  try {
    const port = positiveInteger(process.env.PORT, 'PORT', 8015, 65535);
    const host = process.env.HOST || '0.0.0.0';
    const server = createProxyServer({
      upstream: process.env.UPSTREAM_URL || 'https://huggingface.co',
      timeoutMs: positiveInteger(process.env.UPSTREAM_TIMEOUT_MS, 'UPSTREAM_TIMEOUT_MS', 30_000),
    });
    server.on('error', (err) => {
      console.error(`Server failed: ${err.message}`);
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      console.log(`Proxy server listening on ${host}:${port}`);
    });
    let shuttingDown = false;
    function shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;
      server.close();
      setTimeout(() => server.closeAllConnections(), 10_000).unref();
    }
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error(`Invalid configuration: ${err.message}`);
    process.exitCode = 1;
  }
}

module.exports = { createProxyServer };
