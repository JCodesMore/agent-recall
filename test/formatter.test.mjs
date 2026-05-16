import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatResult, formatResults } from '../src/formatter/cli.mjs';
import { formatJson } from '../src/formatter/json.mjs';

const sample = {
  sessionId: '00000000-0000-0000-0000-000000000003',
  project: 'C:\\repos\\db',
  msgCount: 12,
  hitCount: 3,
  firstPrompt: 'Why does postgres fail under load?',
  summary: 'Diagnosed pgbouncer pool exhaustion under burst load.',
  title: null,
  firstTs: '2026-04-12T10:11:00Z',
  lastTs: '2026-04-12T10:42:31Z',
  ts: '2026-04-12T10:42:31Z',
  snippet: '…the \x1b[1;33mpgbouncer\x1b[0m pool ran out…',
  resumeCommand: 'claude --resume 00000000-0000-0000-0000-000000000003',
};

test('formatResult contains title, project, snippet, and resume command', () => {
  const out = formatResult(sample, 0);
  assert.ok(out.includes('1.'));
  assert.ok(out.includes('pgbouncer'), 'snippet visible');
  assert.ok(out.includes('claude --resume 00000000-0000-0000-0000-000000000003'));
  assert.ok(out.includes('C:\\repos\\db'));
  assert.ok(out.includes('12 msgs'));
});

test('formatResults shows header with count and elapsed', () => {
  const out = formatResults([sample], { query: 'pgbouncer', elapsedMs: 7 });
  assert.ok(out.includes('Found 1 session'));
  assert.ok(out.includes('pgbouncer'));
  assert.ok(out.includes('(7 ms)'));
});

test('formatResults shows a friendly empty-state', () => {
  const out = formatResults([], { query: 'asdfqwer' });
  assert.ok(out.toLowerCase().includes('no matches'));
  assert.ok(out.includes('asdfqwer'));
});

test('formatJson emits a parseable JSON envelope with query and results', () => {
  const out = formatJson([sample], { query: 'pgbouncer', elapsedMs: 5 });
  const parsed = JSON.parse(out);
  assert.equal(parsed.query, 'pgbouncer');
  assert.equal(parsed.elapsedMs, 5);
  assert.equal(parsed.count, 1);
  assert.equal(parsed.results[0].sessionId, sample.sessionId);
});
