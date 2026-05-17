import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { search } from '../searcher/index.mjs';
import { readIndex } from '../indexer/inverted.mjs';
import { indexHome } from '../paths.mjs';
import { WEB, SEARCH_DEFAULTS, INDEX_FILES } from '../config.mjs';
import { openFolder, resumeSession } from './actions.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 8 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
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

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8' });
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch (err) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(req, res) {
  const urlPath = req.url.split('?')[0];
  const safe = urlPath === '/' ? '/index.html' : urlPath;
  const resolved = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(safe)));
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

function makeIndexCache(initialIndex) {
  const indexFile = path.join(indexHome(), INDEX_FILES.INDEX);
  let cached = initialIndex || null;
  let cachedMtimeMs = -1;
  let inflight = null;
  return async function getIndex() {
    let mtimeMs = 0;
    try { mtimeMs = (await fs.stat(indexFile)).mtimeMs; } catch {}
    if (cached && cachedMtimeMs === -1) { cachedMtimeMs = mtimeMs; return cached; }
    if (cached && mtimeMs && mtimeMs <= cachedMtimeMs) return cached;
    if (inflight) return inflight;
    inflight = (async () => {
      const next = await readIndex();
      cached = next;
      cachedMtimeMs = mtimeMs;
      return next;
    })();
    try { return await inflight; }
    finally { inflight = null; }
  };
}

async function handleSearch(req, res, { getIndex }) {
  try {
    const url = new URL(req.url, `http://${WEB.HOST}`);
    const q = url.searchParams.get('q') || '';
    const limit = parseInt(url.searchParams.get('limit') || SEARCH_DEFAULTS.LIMIT, 10);
    const project = url.searchParams.get('project') || undefined;
    const t0 = Date.now();
    const index = await getIndex();
    const results = await search(q, { index, limit, project, format: 'html' });
    const elapsedMs = Date.now() - t0;
    sendJson(res, 200, { query: q, count: results.length, elapsedMs, results });
  } catch (err) {
    sendJson(res, 500, { error: err.message });
  }
}

async function handleOpenFolder(req, res) {
  try {
    const body = await readJsonBody(req);
    const result = await openFolder(body.path);
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

async function handleResume(req, res) {
  try {
    const body = await readJsonBody(req);
    const result = await resumeSession({ sessionId: body.sessionId, cwd: body.cwd });
    sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    sendJson(res, 400, { error: err.message });
  }
}

export async function startServer({ index, initialQuery, host = WEB.HOST, portMin = WEB.PORT_MIN, portMax = WEB.PORT_MAX } = {}) {
  const getIndex = makeIndexCache(index);
  const server = http.createServer(async (req, res) => {
    const url = req.url.split('?')[0];
    if (req.method === 'GET') {
      if (url === WEB.API_PATH) return handleSearch(req, res, { getIndex });
      return serveStatic(req, res);
    }
    if (req.method === 'POST') {
      if (url === WEB.API_OPEN_FOLDER) return handleOpenFolder(req, res);
      if (url === WEB.API_RESUME) return handleResume(req, res);
      send(res, 404, 'not found');
      return;
    }
    send(res, 405, 'method not allowed');
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
