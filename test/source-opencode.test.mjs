import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LIMITS } from '../src/config.mjs';
import { opencodeAdapter } from '../src/sources/opencode.mjs';

let temp;
let databasePath;
const PNG_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-recall-opencode-'));
  databasePath = path.join(temp, 'opencode-test.db');
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, directory TEXT,
        title TEXT, summary TEXT, version TEXT, model TEXT, git_branch TEXT, time_created INTEGER,
        time_updated INTEGER, time_archived INTEGER
      );
      CREATE TABLE message (
        id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
        time_created INTEGER, time_updated INTEGER, data TEXT
      );
      CREATE TABLE credential (service TEXT, secret TEXT);
    `);
    const session = db.prepare(`
      INSERT INTO session
        (id, project_id, parent_id, slug, directory, title, summary, version, git_branch, model,
         time_created, time_updated, time_archived)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    session.run(
      'ses-parent', 'project-1', null, 'parent-slug', 'C:\\work\\parent', 'Parent session',
      'Parent summary', '1.2.3', 'main', JSON.stringify({ id: 'session-model', providerID: 'openai', variant: 'high' }),
      1_700_000_000_000, 1_700_000_010_000, null,
    );
    session.run(
      'ses-child', 'project-1', 'ses-parent', 'child-slug', 'C:\\work\\child', 'Child session',
      null, '1.2.3', 'feature/test', null, 1_700_000_020_000, 1_700_000_040_000, 1_700_000_050_000,
    );

    const message = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)');
    message.run('msg-2', 'ses-parent', 1_700_000_003_000, 1_700_000_004_000, JSON.stringify({
      role: 'assistant',
      parentID: 'msg-1',
      time: { created: 1_700_000_003_000, completed: 1_700_000_004_000 },
      modelID: 'claude-sonnet-test',
      providerID: 'anthropic',
      agent: 'build',
    }));
    message.run('msg-1', 'ses-parent', 1_700_000_001_000, 1_700_000_002_000, JSON.stringify({
      role: 'user',
      time: { created: 1_700_000_001_000 },
      model: { providerID: 'anthropic', modelID: 'claude-sonnet-test' },
    }));
    message.run('msg-child', 'ses-child', 1_700_000_030_000, 1_700_000_031_000, JSON.stringify({
      role: 'user', time: { created: 1_700_000_030_000 }, modelID: 'gpt-test',
    }));
    message.run('msg-3', 'ses-parent', 1_700_000_005_000, 1_700_000_006_000, JSON.stringify({
      role: 'assistant', parentID: 'msg-2', time: { created: 1_700_000_005_000 }, modelID: 'session-model',
    }));

    const part = db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)');
    part.run('part-user-b', 'msg-1', 'ses-parent', 1_700_000_001_200, 1_700_000_001_200,
      JSON.stringify({ type: 'subtask', prompt: 'Delegate this prompt', time: { start: 1_700_000_001_200 } }));
    part.run('part-user-a', 'msg-1', 'ses-parent', 1_700_000_001_100, 1_700_000_001_100,
      JSON.stringify({ type: 'text', text: 'Find the regression', time: { start: 1_700_000_001_100 } }));
    part.run('part-user-image', 'msg-1', 'ses-parent', 1_700_000_001_300, 1_700_000_001_300,
      JSON.stringify({ type: 'file', mime: 'image/png', filename: 'fixture.png', url: `data:image/png;base64,${PNG_DATA}` }));
    part.run('part-reasoning', 'msg-2', 'ses-parent', 1_700_000_003_100, 1_700_000_003_100,
      JSON.stringify({ type: 'reasoning', text: 'REASONING_CANARY' }));
    part.run('part-tool', 'msg-2', 'ses-parent', 1_700_000_003_200, 1_700_000_003_200,
      JSON.stringify({ type: 'tool', state: { output: 'TOOL_CANARY' } }));
    part.run('part-file', 'msg-2', 'ses-parent', 1_700_000_003_300, 1_700_000_003_300,
      JSON.stringify({ type: 'file', text: 'FILE_CANARY' }));
    part.run('part-snapshot', 'msg-2', 'ses-parent', 1_700_000_003_400, 1_700_000_003_400,
      JSON.stringify({ type: 'snapshot', text: 'SNAPSHOT_CANARY' }));
    part.run('part-patch', 'msg-2', 'ses-parent', 1_700_000_003_500, 1_700_000_003_500,
      JSON.stringify({ type: 'patch', text: 'PATCH_CANARY' }));
    part.run('part-step', 'msg-2', 'ses-parent', 1_700_000_003_600, 1_700_000_003_600,
      JSON.stringify({ type: 'step-start', text: 'STEP_CANARY' }));
    part.run('part-answer', 'msg-2', 'ses-parent', 1_700_000_003_700, 1_700_000_003_700,
      JSON.stringify({ type: 'text', text: 'The fix is ready', time: { start: 1_700_000_003_700 } }));
    part.run('part-child', 'msg-child', 'ses-child', 1_700_000_030_100, 1_700_000_030_100,
      JSON.stringify({ type: 'text', text: 'x'.repeat(LIMITS.TEXT_MAX_CHARS + 10) }));
    part.run('part-followup', 'msg-3', 'ses-parent', 1_700_000_005_100, 1_700_000_005_100,
      JSON.stringify({ type: 'text', text: 'Follow-up answer' }));
    db.prepare('INSERT INTO credential VALUES (?, ?)').run('opencode', 'CREDENTIAL_CANARY');
  } finally {
    db.close();
  }
});

after(async () => {
  delete process.env.OPENCODE_DB;
  await fs.rm(temp, { recursive: true, force: true });
});

test('discover finds override databases and includes WAL changes in the signature', async () => {
  process.env.OPENCODE_DB = databasePath;
  const [initial] = await opencodeAdapter.discover({ root: path.join(temp, 'missing') });
  assert.equal(initial.provider, 'opencode');
  assert.equal(initial.path, databasePath);
  assert.equal(initial.metadata.walSize, 0);

  await fs.writeFile(`${databasePath}-wal`, 'wal-canary');
  const [withWal] = await opencodeAdapter.discover();
  assert.notEqual(withWal.signature, initial.signature);
  assert.equal(withWal.metadata.walSize, 10);
  await fs.rm(`${databasePath}-wal`);
  delete process.env.OPENCODE_DB;
});

test('discover finds opencode databases under a root and tolerates missing roots and overrides', async () => {
  const found = await opencodeAdapter.discover({ root: temp });
  assert.deepEqual(found.map(item => item.path), [databasePath]);
  assert.deepEqual(await opencodeAdapter.discover({ root: path.join(temp, 'does-not-exist') }), []);
  process.env.OPENCODE_DB = path.join(temp, 'missing.db');
  assert.deepEqual(await opencodeAdapter.discover({ root: temp }), []);
  delete process.env.OPENCODE_DB;
});

test('read reconstructs sessions and searchable messages without reading sensitive content', () => {
  const result = opencodeAdapter.read({ path: databasePath });
  assert.equal(result.sessions.length, 2);
  assert.equal(result.messages.length, 4);
  assert.deepEqual(result.diagnostics, { malformed: 0, truncated: 1, skipped: 0 });
  assert.equal(result.attachments.length, 1);
  assert.deepEqual(opencodeAdapter.readAttachment(result.attachments[0]).data, Buffer.from(PNG_DATA, 'base64'));

  const parent = result.sessions.find(session => session.nativeId === 'ses-parent');
  const child = result.sessions.find(session => session.nativeId === 'ses-child');
  assert.match(parent.sessionKey, /^opencode:ses-parent:/);
  assert.equal(parent.summary, 'Parent summary');
  assert.equal(parent.project, 'project-1');
  assert.equal(parent.cwd, 'C:\\work\\parent');
  assert.equal(parent.gitBranch, 'main');
  assert.equal(parent.model, 'session-model');
  assert.equal(parent.createdAt, '2023-11-14T22:13:20.000Z');
  assert.deepEqual(parent.resume, {
    command: 'opencode', args: ['--session', 'ses-parent'], cwd: 'C:\\work\\parent',
  });
  assert.deepEqual(parent.metadata, { projectId: 'project-1', slug: 'parent-slug', version: '1.2.3' });
  assert.equal(child.parentSessionKey, parent.sessionKey);
  assert.equal(child.archived, true);

  const [user, assistant, followup] = result.messages.filter(message => message.sessionKey === parent.sessionKey);
  assert.match(user.messageKey, /^opencode:msg-1:/);
  assert.equal(user.sequence, 0);
  assert.equal(user.role, 'user');
  assert.equal(user.text, 'Find the regression\nDelegate this prompt');
  assert.equal(user.model, 'claude-sonnet-test');
  assert.equal(assistant.parentMessageKey, user.messageKey);
  assert.equal(assistant.sequence, 1);
  assert.equal(assistant.text, 'The fix is ready');
  assert.equal(assistant.sourceLocator, 'message:msg-2');
  assert.equal(assistant.metadata.providerId, 'anthropic');
  assert.equal(followup.parentMessageKey, assistant.messageKey);

  const truncated = result.messages.find(message => message.nativeId === 'msg-child');
  assert.equal(truncated.text.length, LIMITS.TEXT_MAX_CHARS);
  assert.equal(truncated.metadata.truncated, true);
  const serialized = JSON.stringify(result);
  for (const canary of [
    'REASONING_CANARY', 'TOOL_CANARY', 'FILE_CANARY', 'SNAPSHOT_CANARY',
    'PATCH_CANARY', 'STEP_CANARY', 'CREDENTIAL_CANARY',
  ]) assert.ok(!serialized.includes(canary), `${canary} must not be returned`);
});

test('read uses a read-only connection and closes it', () => {
  const before = new DatabaseSync(databasePath, { readOnly: true });
  const beforeCanary = before.prepare('SELECT secret FROM credential').get().secret;
  before.close();

  opencodeAdapter.read({ path: databasePath });

  const afterDb = new DatabaseSync(databasePath);
  try {
    assert.equal(afterDb.prepare('SELECT secret FROM credential').get().secret, beforeCanary);
    afterDb.prepare('INSERT INTO credential VALUES (?, ?)').run('proof', 'connection-was-closed');
  } finally {
    afterDb.close();
  }
});

test('read reports unsupported schemas with the required table names', async () => {
  const invalidPath = path.join(temp, 'opencode-invalid.db');
  const db = new DatabaseSync(invalidPath);
  db.exec('CREATE TABLE unrelated (id TEXT)');
  db.close();
  assert.throws(
    () => opencodeAdapter.read({ path: invalidPath }),
    error => /session, message, and part/.test(error.message) && error.message.includes(invalidPath),
  );
});
