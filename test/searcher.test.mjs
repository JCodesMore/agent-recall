import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildDelta } from '../src/indexer/delta.mjs';
import { search } from '../src/searcher/index.mjs';
import { snippet, findMatches } from '../src/searcher/snippet.mjs';
import { tokenize } from '../src/searcher/tokenize.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'projects');

let TMP;

before(async () => {
  TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-search-search-'));
  process.env.CLAUDE_SEARCH_HOME = TMP;
  await buildDelta({ root: FIXTURES, force: true });
});

after(async () => {
  delete process.env.CLAUDE_SEARCH_HOME;
  await fs.rm(TMP, { recursive: true, force: true });
});

test('tokenize lowercases, drops short tokens, keeps unicode', () => {
  const t = tokenize('Hello, World! 🚀 日本語 ab a 12345');
  assert.deepEqual(t, ['hello', 'world', '日本語', 'ab', '12345']);
});

test('search returns ranked results for a known query', async () => {
  const results = await search('pgbouncer');
  assert.ok(results.length > 0, 'should find pgbouncer hits');
  assert.equal(results[0].sessionId, '00000000-0000-0000-0000-000000000003');
  assert.ok(results[0].snippet.toLowerCase().includes('pgbouncer'));
  assert.equal(results[0].resumeCommand, 'claude --resume 00000000-0000-0000-0000-000000000003');
});

test('search snippet highlights match with ANSI by default', async () => {
  const results = await search('ripgrep');
  assert.ok(results.length > 0);
  assert.ok(results[0].snippet.includes('\x1b['), 'ANSI escape expected in snippet');
});

test('snippet format=html uses <mark>', async () => {
  const results = await search('ripgrep', { format: 'html' });
  assert.ok(results[0].snippet.toLowerCase().includes('<mark>ripgrep</mark>'));
});

test('snippet format=plain has no markup', async () => {
  const results = await search('ripgrep', { format: 'plain' });
  assert.ok(!results[0].snippet.includes('\x1b['));
  assert.ok(!results[0].snippet.includes('<mark>'));
});

test('search returns msgCount and firstPrompt from session metadata', async () => {
  const results = await search('pgbouncer');
  const r = results[0];
  assert.ok(r.msgCount > 0);
  assert.ok(r.firstPrompt.startsWith('Why does postgres'));
  assert.equal(r.summary, 'Diagnosed pgbouncer pool exhaustion under burst load.');
});

test('search returns empty array for unknown query', async () => {
  const results = await search('zxqyzxqyzxqy');
  assert.deepEqual(results, []);
});

test('multi-token query ranks docs matching more tokens higher', async () => {
  const results = await search('pgbouncer pool exhaustion');
  assert.ok(results.length > 0);
  assert.equal(results[0].sessionId, '00000000-0000-0000-0000-000000000003');
});

test('groups hits by session, deduplicates session in result list', async () => {
  const results = await search('pgbouncer');
  const sids = results.map(r => r.sessionId);
  assert.equal(new Set(sids).size, sids.length, 'each session appears once');
});

test('findMatches returns positions for query tokens in text', () => {
  const text = 'Ripgrep is fast. Use ripgrep wisely.';
  const m = findMatches(text, ['ripgrep']);
  assert.equal(m.length, 2);
  assert.equal(text.slice(m[0].start, m[0].end).toLowerCase(), 'ripgrep');
});

test('snippet centers around first match with ellipsis', () => {
  const long = 'a '.repeat(100) + 'NEEDLE' + ' b'.repeat(100);
  const out = snippet(long, ['needle'], { format: 'plain' });
  assert.ok(out.includes('NEEDLE'));
  assert.ok(out.length < 250);
  assert.ok(out.startsWith('…') || out.startsWith('NEEDLE'));
});
