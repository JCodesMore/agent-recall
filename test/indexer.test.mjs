import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildDelta } from '../src/indexer/delta.mjs';
import { readIndex } from '../src/indexer/inverted.mjs';
import { readManifest } from '../src/indexer/manifest.mjs';
import { INDEX_FILES } from '../src/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'projects');

let TMP;

before(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-search-test-'));
  process.env.CLAUDE_SEARCH_HOME = TMP;
});

after(async () => {
  delete process.env.CLAUDE_SEARCH_HOME;
  await fs.rm(TMP, { recursive: true, force: true });
});

test('first build indexes all transcript files', async () => {
  const stats = await buildDelta({ root: FIXTURES, force: true });
  assert.ok(stats.indexed >= 4, `expected at least 4 indexed, got ${stats.indexed}`);
  assert.equal(stats.skipped, 0);
  assert.ok(stats.docs > 0);
});

test('second build skips unchanged files and does not rewrite docs.ndjson', async () => {
  const docsFile = path.join(TMP, INDEX_FILES.DOCS);
  const beforeStat = await fs.stat(docsFile);
  const stats = await buildDelta({ root: FIXTURES });
  assert.equal(stats.indexed, 0, 'no files changed, none should be re-indexed');
  assert.ok(stats.skipped >= 4);
  const afterStat = await fs.stat(docsFile);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs, 'docs.ndjson must not be rewritten on a no-op pass');
});

test('index contains expected sessions and postings', async () => {
  const idx = await readIndex();
  const sids = Object.keys(idx.sessions);
  assert.ok(sids.includes('00000000-0000-0000-0000-000000000001'));
  assert.ok(sids.includes('00000000-0000-0000-0000-000000000003'));
  assert.ok(sids.includes('00000000-0000-0000-0000-000000000004'), 'subdir-only session must be in sessions');
  assert.ok(idx.postingsOffsets['ripgrep'], 'token "ripgrep" should be in postings');
  assert.ok(idx.postingsOffsets['pgbouncer'], 'token "pgbouncer" should be in postings');
  assert.equal(typeof idx.N, 'number');
  assert.ok(idx.N > 0);
  assert.ok(idx.avgdl > 0);
});

test('manifest tracks every transcript file', async () => {
  const m = await readManifest();
  const files = Object.keys(m.files);
  assert.ok(files.length >= 4);
  for (const f of files) {
    assert.equal(typeof m.files[f].mtime, 'number');
    assert.equal(typeof m.files[f].size, 'number');
    assert.ok(m.files[f].sessionId);
  }
});

test('modifying a file triggers reindex of only that file', async () => {
  const targetFile = path.join(FIXTURES, 'proj-d', '00000000-0000-0000-0000-000000000005.jsonl');
  const original = await fs.readFile(targetFile, 'utf8');
  try {
    const appendLine = JSON.stringify({
      type: 'user',
      sessionId: '00000000-0000-0000-0000-000000000005',
      uuid: 'du2',
      parentUuid: 'da1',
      timestamp: new Date().toISOString(),
      cwd: 'C:\\proj-d',
      message: { role: 'user', content: 'Appended question about Klingon localization.' },
    });
    await fs.writeFile(targetFile, original + appendLine + '\n');
    const stats = await buildDelta({ root: FIXTURES });
    assert.equal(stats.indexed, 1, 'only one file changed');
    assert.ok(stats.skipped >= 3, 'others should be skipped');
    const idx = await readIndex();
    assert.ok(idx.postingsOffsets['klingon'], 'new token should appear in postings');
  } finally {
    await fs.writeFile(targetFile, original);
    await buildDelta({ root: FIXTURES, force: true });
  }
});

test('tokens matching Object.prototype names do not break indexing', async () => {
  const dummyDir = path.join(FIXTURES, 'proj-proto');
  const dummyFile = path.join(dummyDir, '00000000-0000-0000-0000-000000000077.jsonl');
  await fs.mkdir(dummyDir, { recursive: true });
  const adversarial = 'constructor toString hasOwnProperty __proto__ valueOf';
  await fs.writeFile(dummyFile, JSON.stringify({
    type: 'user',
    sessionId: '00000000-0000-0000-0000-000000000077',
    uuid: 'pp1',
    parentUuid: null,
    timestamp: new Date().toISOString(),
    cwd: 'C:\\proj-proto',
    message: { role: 'user', content: `please look up ${adversarial} for me` },
  }) + '\n');
  try {
    await buildDelta({ root: FIXTURES });
    const idx = await readIndex();
    assert.ok(idx.postingsOffsets['constructor'], 'postingsOffsets[constructor] must be a real offset entry');
    assert.ok(idx.postingsOffsets['tostring'], 'postingsOffsets[tostring] must be a real offset entry');
  } finally {
    await fs.rm(dummyDir, { recursive: true, force: true });
    await buildDelta({ root: FIXTURES, force: true });
  }
});

test('deleted file removes its docs from index', async () => {
  const dummyDir = path.join(FIXTURES, 'proj-temp');
  const dummyFile = path.join(dummyDir, '00000000-0000-0000-0000-000000000099.jsonl');
  await fs.mkdir(dummyDir, { recursive: true });
  await fs.writeFile(dummyFile, JSON.stringify({
    type: 'user',
    sessionId: '00000000-0000-0000-0000-000000000099',
    uuid: 'tu1',
    parentUuid: null,
    timestamp: new Date().toISOString(),
    cwd: 'C:\\proj-temp',
    message: { role: 'user', content: 'temporary marker text uniqueWord4242' },
  }) + '\n');
  try {
    await buildDelta({ root: FIXTURES });
    let idx = await readIndex();
    assert.ok(idx.postingsOffsets['uniqueword4242'], 'temp doc indexed');
    await fs.rm(dummyDir, { recursive: true, force: true });
    await buildDelta({ root: FIXTURES });
    idx = await readIndex();
    assert.ok(!idx.postingsOffsets['uniqueword4242'], 'temp doc removed');
  } finally {
    await fs.rm(dummyDir, { recursive: true, force: true });
    await buildDelta({ root: FIXTURES, force: true });
  }
});
