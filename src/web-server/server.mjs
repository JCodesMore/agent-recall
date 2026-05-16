import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { search } from '../searcher/index.mjs';
import { WEB, SEARCH_DEFAULTS } from '../config.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function contentType(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

async function listenOnFreePort(server, host, portMin, portMax) {
  for (let port = portMin; port <= portMax; port++) {
    try {
      await new Promise((resolve, reject) => {
        const onErr = (err) => { server.off('listening', onOk); reject(err); };
        const onOk = () => { server.off('error', onErr); resolve(); };
        server.once('error', onErr);
        server.once('listening', onOk);
        server.listen(port, host);
      });
      return port;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;
    }
  }
  throw new Error(`no free port in ${portMin}..${portMax}`);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

async function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const safe = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = path.normalize(path.join(PUBLIC_DIR, safe));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    send(res, 403, 'forbidden');
    return;
  }
  try {
    const data = await fs.readFile(resolved);
    send(res, 200, data, { 'Content-Type': contentType(resolved) });
  } catch (err) {
    if (err.code === 'ENOENT') send(res, 404, 'not found');
    else send(res, 500, `error: ${err.message}`);
  }
}

async function handleSearch(req, res, { index }) {
  try {
    const url = new URL(req.url, `http://${WEB.HOST}`);
    const q = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || SEARCH_DEFAULTS.LIMIT, 10);
    const project = url.searchParams.get('project') || undefined;
    const t0 = Date.now();
    const results = await search(q, { index, limit, project, format: 'html' });
    const elapsedMs = Date.now() - t0;
    const body = JSON.stringify({ query: q, count: results.length, elapsedMs, results });
    send(res, 200, body, { 'Content-Type': 'application/json; charset=utf-8' });
  } catch (err) {
    send(res, 500, JSON.stringify({ error: err.message }), { 'Content-Type': 'application/json; charset=utf-8' });
  }
}

export async function startServer({ index, initialQuery, host = WEB.HOST, portMin = WEB.PORT_MIN, portMax = WEB.PORT_MAX } = {}) {
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET') { send(res, 405, 'method not allowed'); return; }
    const url = req.url.split('?')[0];
    if (url === WEB.API_PATH) return handleSearch(req, res, { index });
    return serveStatic(req, res);
  });
  const port = await listenOnFreePort(server, host, portMin, portMax);
  const initialParam = initialQuery ? `?q=${encodeURIComponent(initialQuery)}` : '';
  return {
    server,
    host,
    port,
    url: `http://${host}:${port}/${initialParam}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}
