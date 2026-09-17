import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { codexAdapter } from '../src/sources/codex.mjs';
import { openDatabase } from '../src/storage/database.mjs';
import { syncHistory } from '../src/sync.mjs';

const CHILD = '11111111-1111-4111-8111-111111111111';
const PARENT = '22222222-2222-4222-8222-222222222222';

async function fixture(t, records) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-recall-identity-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const active = path.join(root, 'sessions');
  const archived = path.join(root, 'archived_sessions');
  await fs.mkdir(active);
  await fs.mkdir(archived);
  const file = path.join(archived, `rollout-${CHILD}.jsonl`);
  await fs.writeFile(file, records.map(record => JSON.stringify(record)).join('\n') + '\n');
  return { root, file, active, roots: { codex: { root: active, archiveRoot: archived } } };
}

const message = {
  type: 'response_item',
  payload: { type: 'message', role: 'user', id: 'synthetic-message', content: [
    { type: 'input_text', text: 'Investigate the synthetic child task.' },
    { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' },
  ] },
};

test('Codex keeps child identity and lineage through inherited parent metadata', async t => {
  const source = { subagent: { thread_spawn: { parent_thread_id: PARENT } } };
  const { file } = await fixture(t, [
    { type: 'session_meta', payload: { id: CHILD, cwd: '/child', source, title: 'Child task' } },
    { type: 'session_meta', payload: { id: PARENT, cwd: '/parent', source: 'vscode', title: 'Parent task' } },
    message,
  ]);
  const result = await codexAdapter.read({ path: file, metadata: { archived: true } });
  const [session] = result.sessions;
  assert.equal(session.nativeId, CHILD);
  assert.equal(session.title, 'Child task');
  assert.equal(session.cwd, '/child');
  assert.equal(session.archived, true);
  assert.equal(session.metadata.parentNativeId, PARENT);
  assert.deepEqual(session.metadata.source, source);
  assert.deepEqual(session.resume.args, ['resume', CHILD]);
  assert.equal(result.messages.length, 1);
  assert.equal(result.attachments.length, 1);
  assert.equal(result.messages[0].sessionKey, session.sessionKey);
  assert.equal(result.attachments[0].sessionKey, session.sessionKey);
});

test('Codex accepts same-session updates and legacy IDs without adopting a parent', async t => {
  const { file } = await fixture(t, [
    { type: 'session_meta', payload: { session_id: CHILD, forked_from_id: PARENT } },
    { type: 'session_meta', payload: { id: PARENT, title: 'Inherited' } },
    { type: 'session_meta', payload: { id: CHILD, title: 'Updated child' } },
    message,
  ]);
  const result = await codexAdapter.read({ path: file, metadata: {} });
  assert.equal(result.sessions[0].nativeId, CHILD);
  assert.equal(result.sessions[0].title, 'Updated child');
  assert.equal(result.sessions[0].metadata.parentNativeId, PARENT);

  await fs.writeFile(file, JSON.stringify(message) + '\n');
  const legacy = await codexAdapter.read({ path: file, metadata: {} });
  assert.equal(legacy.sessions[0].nativeId, CHILD);
  assert.equal(legacy.sessions[0].metadata.parentNativeId, null);
});

test('sync repairs old cached IDs and preserves native identity after unarchive moves', async t => {
  const { root, file, active, roots } = await fixture(t, [
    { type: 'session_meta', payload: { id: CHILD, forked_from_id: PARENT } },
    { type: 'session_meta', payload: { id: PARENT } },
    message,
  ]);
  const db = await openDatabase({ file: path.join(root, 'recall.db') });
  try {
    const options = { db, providers: ['codex'], roots };
    await syncHistory(options);
    // Emulate an unchanged source cached by the previously shipped adapter.
    db.prepare("UPDATE sources SET signature = replace(signature, 'adapters9', 'adapters8')").run();
    db.prepare('UPDATE sessions SET native_id = ?').run(PARENT);
    const refreshed = await syncHistory(options);
    assert.equal(refreshed.indexed, 1);
    assert.deepEqual(refreshed.errors, []);
    const before = db.prepare('SELECT * FROM sessions').get();
    assert.equal(before.native_id, CHILD);
    assert.equal(JSON.parse(before.metadata_json).parentNativeId, PARENT);
    assert.equal((await syncHistory(options)).skipped, 1);

    await fs.rename(file, path.join(active, path.basename(file)));
    const moved = await syncHistory(options);
    assert.equal(moved.removed, 1);
    assert.equal(moved.indexed, 1);
    assert.equal(moved.sessions, 1);
    const after = db.prepare('SELECT * FROM sessions').get();
    assert.equal(after.native_id, CHILD);
    assert.equal(after.archived, 0);
    assert.notEqual(after.session_key, before.session_key);
    assert.equal(db.prepare('SELECT session_key FROM messages').get().session_key, after.session_key);
    assert.equal(db.prepare('SELECT session_key FROM attachments').get().session_key, after.session_key);
  } finally {
    db.close();
  }
});
