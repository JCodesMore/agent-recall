import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildDelta } from '../src/indexer/delta.mjs';
import { readIndex } from '../src/indexer/inverted.mjs';
import { startServer } from '../src/web-server/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'projects');

let TMP;
let server;
let baseUrl;

before(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-search-web-'));
  process.env.CLAUDE_SEARCH_HOME = TMP;
  await buildDelta({ root: FIXTURES, force: true });
  const index = await readIndex();
  const info = await startServer({ index });
  server = info;
  baseUrl = `http://${info.host}:${info.port}`;
});

after(async () => {
  if (server) await server.close();
  delete process.env.CLAUDE_SEARCH_HOME;
  await fs.rm(TMP, { recursive: true, force: true });
});

test('GET / serves the search UI', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(body.includes('<title>claude-search</title>'));
  assert.ok(body.includes('id="search-form"'));
});

test('GET /api/search returns JSON results for a known query', async () => {
  const res = await fetch(`${baseUrl}/api/search?q=pgbouncer`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.query, 'pgbouncer');
  assert.ok(data.count > 0);
  assert.equal(data.results[0].sessionId, '00000000-0000-0000-0000-000000000003');
  assert.ok(data.results[0].snippet.toLowerCase().includes('<mark>pgbouncer</mark>'));
});

test('GET /api/search?q= returns empty results, not 500', async () => {
  const res = await fetch(`${baseUrl}/api/search?q=`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.count, 0);
});

test('GET /missing returns 404', async () => {
  const res = await fetch(`${baseUrl}/does-not-exist`);
  assert.equal(res.status, 404);
});

test('directory traversal attempt is refused', async () => {
  const res = await fetch(`${baseUrl}/../config.mjs`);
  assert.ok(res.status === 403 || res.status === 404, `expected 403/404, got ${res.status}`);
});
