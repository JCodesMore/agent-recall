import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAllSearchable, summarizeSession, readTranscript } from '../src/transcript-reader.mjs';
import { listTranscripts, sessionIdFromFile } from '../src/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'projects');

test('listTranscripts discovers top-level and subagent jsonl across projects', async () => {
  const files = await listTranscripts({ root: FIXTURES });
  const files_by_session = new Map();
  for (const f of files) files_by_session.set(`${f.sessionId}|${f.isSubagent}`, f);

  const sids = files.map(f => f.sessionId).sort();
  assert.deepEqual([...new Set(sids)].sort(), [
    '00000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000003',
    '00000000-0000-0000-0000-000000000004',
    '00000000-0000-0000-0000-000000000005',
  ]);
  assert.ok(files.some(f => f.isSubagent), 'should pick up subagent files');
  assert.ok(
    files.some(f => f.sessionId === '00000000-0000-0000-0000-000000000004' && f.isSubagent),
    'subdir-only session must be discovered'
  );
});

test('transcript-reader extracts text from string and array user content', async () => {
  const file = path.join(FIXTURES, 'proj-a', '00000000-0000-0000-0000-000000000001.jsonl');
  const recs = await readAllSearchable(file);
  const texts = recs.map(r => r.text);
  assert.ok(texts.some(t => t.includes('ripgrep')));
  assert.ok(texts.some(t => t.includes('case sensitivity')));
});

test('transcript-reader skips thinking blocks but keeps text blocks', async () => {
  const file = path.join(FIXTURES, 'proj-a', '00000000-0000-0000-0000-000000000001.jsonl');
  const recs = await readAllSearchable(file);
  const combined = recs.map(r => r.text).join('\n');
  assert.ok(!combined.includes('OPAQUE_ENCRYPTED'), 'thinking content must not be indexed');
  assert.ok(combined.includes('Ripgrep recurses by default'));
});

test('transcript-reader extracts tool_use input strings and tool_result content', async () => {
  const file = path.join(FIXTURES, 'proj-a', '00000000-0000-0000-0000-000000000002.jsonl');
  const recs = await readAllSearchable(file);
  const combined = recs.map(r => r.text).join('\n');
  assert.ok(combined.includes('node --test'));
  assert.ok(combined.includes('All 12 tests passed'));
});

test('transcript-reader extracts summary, ai-title, attachment text', async () => {
  const file = path.join(FIXTURES, 'proj-b', '00000000-0000-0000-0000-000000000003.jsonl');
  const recs = await readAllSearchable(file);
  const types = new Set(recs.map(r => r.type));
  assert.ok(types.has('summary'));
  assert.ok(types.has('ai-title'));
  assert.ok(types.has('attachment'));
  const combined = recs.map(r => r.text).join('\n');
  assert.ok(combined.includes('Postgres connection pooling investigation'));
  assert.ok(combined.includes('Diagnosed pgbouncer pool exhaustion'));
  assert.ok(combined.includes('max connections reached'));
});

test('summarizeSession picks first user prompt + summary + title + counts', async () => {
  const file = path.join(FIXTURES, 'proj-b', '00000000-0000-0000-0000-000000000003.jsonl');
  const recs = [];
  for await (const r of readTranscript(file)) recs.push(r);
  const s = summarizeSession(recs);
  assert.equal(s.summary, 'Diagnosed pgbouncer pool exhaustion under burst load.');
  assert.equal(s.title, 'Postgres connection pooling investigation');
  assert.ok(s.firstPrompt.startsWith('Why does postgres'));
  assert.equal(s.msgCount, 2);
  assert.ok(s.firstTs && s.lastTs);
});

test('sessionIdFromFile extracts UUID prefix regardless of suffix', () => {
  assert.equal(
    sessionIdFromFile('/x/00000000-0000-0000-0000-000000000003.jsonl'),
    '00000000-0000-0000-0000-000000000003'
  );
  assert.equal(
    sessionIdFromFile('/x/agent-research.jsonl'),
    'agent-research'
  );
});

test('unicode + emoji preserved through extraction', async () => {
  const file = path.join(FIXTURES, 'proj-d', '00000000-0000-0000-0000-000000000005.jsonl');
  const recs = await readAllSearchable(file);
  const combined = recs.map(r => r.text).join('\n');
  assert.ok(combined.includes('🚀'));
  assert.ok(combined.includes('日本語'));
  assert.ok(combined.includes('€'));
});
