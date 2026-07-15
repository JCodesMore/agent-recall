import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { messageKey, sessionKey } from '../src/model/ids.mjs';
import { emptyDiagnostics, readJsonlRecords } from '../src/sources/source-adapter.mjs';

test('source-discriminated IDs prevent provider-native ID collisions', () => {
  assert.notEqual(sessionKey('codex', 'same-id', '/one.jsonl'), sessionKey('codex', 'same-id', '/two.jsonl'));
  assert.notEqual(messageKey('codex', 'same-id', '/one.jsonl', 0), messageKey('codex', 'same-id', '/two.jsonl', 0));
  assert.notEqual(messageKey('codex', 'same-id', '/one.jsonl', 0), messageKey('codex', 'same-id', '/one.jsonl', 1));
});

test('streaming JSONL reader skips oversized records and continues', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-recall-jsonl-'));
  const file = path.join(temp, 'large.jsonl');
  await fs.writeFile(file, [
    JSON.stringify({ type: 'first' }),
    JSON.stringify({ type: 'oversized', value: 'x'.repeat(200) }),
    JSON.stringify({ type: 'last' }),
  ].join('\n'));
  try {
    const diagnostics = emptyDiagnostics();
    const records = [];
    for await (const entry of readJsonlRecords(file, diagnostics, { maxLineChars: 64 })) records.push(entry);
    assert.deepEqual(records.map(entry => entry.record.type), ['first', 'last']);
    assert.equal(diagnostics.truncated, 1);
    assert.equal(diagnostics.skipped, 1);
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});
