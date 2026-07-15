import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { syncHistory, syncIfStale } from '../src/sync.mjs';
import {
  getContext,
  getSession,
  getTranscript,
  recentSessions,
  recallStatus,
  searchHistory,
} from '../src/service.mjs';
import { openDatabase } from '../src/storage/database.mjs';
import { redactText, redactValue } from '../src/privacy/redactor.mjs';

let temp;
let roots;

async function writeJsonl(file, records) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${records.map(record => JSON.stringify(record)).join('\n')}\n`);
}

before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-recall-service-'));
  process.env.AGENT_RECALL_HOME = path.join(temp, 'data');
  const claudeRoot = path.join(temp, 'claude');
  const codexRoot = path.join(temp, 'codex');
  const opencodeDb = path.join(temp, 'opencode.db');

  await writeJsonl(path.join(claudeRoot, 'project-alpha', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jsonl'), [
    {
      type: 'user', sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', uuid: 'claude-user',
      timestamp: '2026-07-13T10:00:00Z', cwd: path.join(temp, 'project-alpha'),
      message: { role: 'user', content: 'Plan the database migration with API_KEY=top-secret-value' },
    },
    {
      type: 'assistant', sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', uuid: 'claude-answer',
      parentUuid: 'claude-user', timestamp: '2026-07-13T10:01:00Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'Use a transactional backfill.' }] },
    },
  ]);

  await writeJsonl(path.join(codexRoot, 'rollout-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.jsonl'), [
    { type: 'session_meta', timestamp: '2026-07-14T10:00:00Z', payload: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', cwd: path.join(temp, 'project-beta') } },
    { type: 'response_item', timestamp: '2026-07-14T10:01:00Z', payload: { type: 'message', role: 'user', id: 'codex-user', content: [{ type: 'input_text', text: 'Investigate OAuth token refresh failures' }] } },
    { type: 'response_item', timestamp: '2026-07-14T10:02:00Z', payload: { type: 'message', role: 'assistant', id: 'codex-answer', content: [{ type: 'output_text', text: 'The refresh lock must be shared.' }] } },
  ]);

  const db = new DatabaseSync(opencodeDb);
  db.exec(`
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, parent_id TEXT, slug TEXT, directory TEXT, title TEXT, version TEXT, time_created INTEGER, time_updated INTEGER, time_archived INTEGER);
    CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
    CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, time_created INTEGER, time_updated INTEGER, data TEXT);
  `);
  db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'ses_open', 'project-open', null, 'open-slug', path.join(temp, 'project_open').replaceAll('\\', '/'),
    'OpenCode cache work', '1.0.0', 1_752_400_000_000, 1_752_400_100_000, null,
  );
  db.prepare('INSERT INTO session VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    'ses_decoy', 'project-decoy', null, 'decoy-slug', path.join(temp, 'projectXopen').replaceAll('\\', '/'),
    'Decoy cache work', '1.0.0', 1_752_300_000_000, 1_752_300_100_000, null,
  );
  db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(
    'msg_open', 'ses_open', 1_752_400_010_000, 1_752_400_020_000,
    JSON.stringify({ role: 'user', time: { created: 1_752_400_010_000 } }),
  );
  db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run(
    'msg_decoy', 'ses_decoy', 1_752_300_010_000, 1_752_300_020_000,
    JSON.stringify({ role: 'user', time: { created: 1_752_300_010_000 } }),
  );
  db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)').run(
    'part_open', 'msg_open', 'ses_open', 1_752_400_010_000, 1_752_400_020_000,
    JSON.stringify({ type: 'text', text: 'Find the cache invalidation decision' }),
  );
  db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)').run(
    'part_decoy', 'msg_decoy', 'ses_decoy', 1_752_300_010_000, 1_752_300_020_000,
    JSON.stringify({ type: 'text', text: 'Find the cache invalidation decision' }),
  );
  db.close();

  roots = {
    claude: { root: claudeRoot },
    codex: { root: codexRoot, archiveRoot: null },
    opencode: { database: opencodeDb },
  };
});

after(async () => {
  delete process.env.AGENT_RECALL_HOME;
  await fs.rm(temp, { recursive: true, force: true });
});

test('redactor removes common credentials while preserving useful context', () => {
  const result = redactText('API_KEY=top-secret-value api_key=lowercase PASSWORD="correct horse battery staple" AWS_ACCESS_KEY_ID=AKIA1234567890123456 Authorization: Basic user:pass {"password":"json secret"}');
  assert.equal(result.redacted, 6);
  assert.match(result.text, /API_KEY=\[REDACTED\]/);
  assert.match(result.text, /Authorization: \[REDACTED\]/);
  assert.doesNotMatch(result.text, /top-secret-value|lowercase|correct horse|battery staple|AKIA1234567890123456|user:pass|json secret/);

  const metadata = redactValue({ nested: {
    authorization: 'metadata-secret',
    apiKey: 'bare-secret',
    shareUrl: 'https://share/secret',
    client_secret: 123456,
    accessToken: ['secret-array-value'],
    refresh_token: { value: 'secret-object-value' },
    aws_secret_access_key: true,
  } });
  const serializedMetadata = JSON.stringify(metadata);
  assert.doesNotMatch(serializedMetadata, /metadata-secret|bare-secret|share\/secret|123456|secret-array-value|secret-object-value/);
  assert.match(serializedMetadata, /\[REDACTED:client_secret\]/);

  const edgeCases = redactText([
    'Authorization: "Bearer quoted-secret"',
    'Authorization: Token alternate-secret',
    'X-API-Key: header-secret',
    'Cookie: session=browser-secret',
    'postgres://database-user:database-password@localhost/app',
    '-----BEGIN PRIVATE KEY-----\nunfinished-key-material',
  ].join('\n'));
  assert.doesNotMatch(edgeCases.text, /quoted-secret|alternate-secret|header-secret|browser-secret|database-password|unfinished-key-material/);
});

test('sync indexes all providers transactionally and skips unchanged sources', async () => {
  const first = await syncHistory({ roots, force: true });
  assert.equal(first.indexed, 3);
  assert.equal(first.sessions, 4);
  assert.equal(first.messages, 6);
  assert.ok(first.redactions >= 1);
  assert.deepEqual(first.errors, []);

  const second = await syncHistory({ roots });
  assert.equal(second.indexed, 0);
  assert.equal(second.skipped, 3);

  const db = await openDatabase();
  try {
    db.prepare("DELETE FROM metadata WHERE key = 'index_policy_version'").run();
  } finally {
    db.close();
  }
  await syncHistory({ roots, providers: ['claude'], force: true });
  const partialStatus = await recallStatus();
  assert.equal(partialStatus.indexPolicyVersion, null);
  await syncHistory({ roots });
  assert.equal((await recallStatus()).indexPolicyVersion, 'db1-redaction5-adapters5');
});

test('automatic refresh runs only when the index is at least ten minutes old', async () => {
  const fresh = await syncIfStale({ roots });
  assert.equal(fresh.refreshed, false);
  assert.equal(fresh.reason, 'fresh');

  let db = await openDatabase();
  try {
    db.prepare("UPDATE metadata SET value = ? WHERE key = 'last_sync_at'").run(
      new Date(Date.now() - 11 * 60 * 1_000).toISOString(),
    );
  } finally {
    db.close();
  }

  const stale = await syncIfStale({ roots });
  assert.equal(stale.refreshed, true);
  assert.equal(stale.sync.ok, true);

  db = await openDatabase();
  try {
    db.prepare("UPDATE metadata SET value = ? WHERE key = 'last_sync_at'").run(
      new Date(Date.now() - 11 * 60 * 1_000).toISOString(),
    );
    db.prepare('INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?)').run(
      'auto_sync_lease',
      JSON.stringify({ token: 'other-sync', expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    );
  } finally {
    db.close();
  }

  const leased = await syncIfStale({ roots });
  assert.equal(leased.refreshed, false);
  assert.equal(leased.reason, 'in-progress');

  db = await openDatabase();
  try {
    db.prepare("DELETE FROM metadata WHERE key = 'auto_sync_lease'").run();
  } finally {
    db.close();
  }
  await syncHistory({ roots });
});

test('search returns compact cross-provider hits and broad fallback', async () => {
  const migration = await searchHistory('database migration');
  assert.equal(migration.count, 1);
  assert.equal(migration.hits[0].session.provider, 'claude');
  assert.match(migration.hits[0].snippet, /database migration/);
  assert.doesNotMatch(JSON.stringify(migration), /top-secret-value/);
  assert.ok(!('sourcePath' in migration.hits[0].session));

  const broad = await searchHistory('transactional migration');
  assert.equal(broad.mode, 'lexical-broad-fallback');
  assert.equal(broad.count, 1);

  const zeroLimit = await searchHistory('database migration', { limit: 0 });
  assert.equal(zeroLimit.count, 1);

  const punctuation = await searchHistory('!');
  assert.equal(punctuation.schemaVersion, 1);
  assert.equal(punctuation.count, 0);

  const scoped = await searchHistory('cache invalidation', { cwd: path.join(temp, 'project_open') });
  assert.equal(scoped.count, 1);
  assert.equal(scoped.hits[0].session.nativeId, 'ses_open');
});

test('dense matching sessions do not suppress other matching conversations', async () => {
  const db = await openDatabase();
  try {
    const claude = db.prepare("SELECT session_key, source_path FROM sessions WHERE provider = 'claude' LIMIT 1").get();
    const codex = db.prepare("SELECT session_key, source_path FROM sessions WHERE provider = 'codex' LIMIT 1").get();
    const insert = db.prepare(`
      INSERT INTO messages(message_key, session_key, sequence, timestamp, role, content_type, text, source_path, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (let index = 0; index < 120; index += 1) {
      insert.run(`dense-claude-${index}`, claude.session_key, 1000 + index, '2026-07-14T11:00:00.000Z', 'assistant', 'text', `dense recall marker ${index}`, claude.source_path, '{}');
    }
    insert.run('dense-codex', codex.session_key, 1000, '2026-07-14T10:59:00.000Z', 'assistant', 'text', 'dense recall marker from another session', codex.source_path, '{}');
  } finally {
    db.close();
  }
  const result = await searchHistory('dense recall marker', { limit: 2 });
  assert.equal(result.count, 2);
  assert.deepEqual(new Set(result.hits.map(hit => hit.session.provider)), new Set(['claude', 'codex']));
});

test('context, metadata, and transcript drill down without dumping unrelated sessions', async () => {
  const result = await searchHistory('token refresh');
  const hit = result.hits[0];
  const context = await getContext(hit.hitId, { before: 1, after: 1 });
  assert.equal(context.messages.length, 2);
  assert.equal(context.messages.filter(message => message.matched).length, 1);
  assert.ok(context.messages.every(message => message.messageKey.startsWith('codex:')));

  const session = await getSession(hit.session.sessionKey);
  assert.equal(session.provider, 'codex');
  assert.deepEqual(session.resume.args, ['resume', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb']);
  assert.equal(session.sourcePath, undefined);

  const transcript = await getTranscript(hit.session.sessionKey, { limit: 1 });
  assert.equal(transcript.messages.length, 1);
  assert.equal(transcript.hasMore, true);
  assert.equal(transcript.nextOffset, 1);
  assert.equal(transcript.completeness.complete, true);

  assert.equal(await getContext(hit.hitId, { cwd: path.join(temp, 'project-alpha') }), null);
  assert.equal(await getSession(hit.session.sessionKey, { provider: 'claude' }), null);
  assert.equal(await getTranscript(hit.session.sessionKey, { cwd: path.join(temp, 'project-alpha') }), null);

  const db = await openDatabase();
  try {
    db.prepare("UPDATE sources SET diagnostics_json = ? WHERE provider = 'codex'").run(JSON.stringify({ malformed: 1 }));
  } finally {
    db.close();
  }
  const uncertain = await getTranscript(hit.session.sessionKey);
  assert.equal(uncertain.completeness.complete, null);
  assert.match(uncertain.completeness.note, /could not be attributed/);
  const resetDb = await openDatabase();
  try {
    resetDb.prepare("UPDATE sources SET diagnostics_json = '{}' WHERE provider = 'codex'").run();
  } finally {
    resetDb.close();
  }

  const zeroLimit = await getTranscript(hit.session.sessionKey, { limit: 0 });
  assert.ok(zeroLimit.messages.length > 0);
  assert.notEqual(zeroLimit.nextOffset, zeroLimit.offset);
});

test('recent and status expose timing and coverage without claiming persisted sessions are active', async () => {
  const recent = await recentSessions({ limit: 10 });
  assert.equal(recent.count, 4);
  assert.ok(recent.sessions.every(session => session.activity.state !== 'active'));

  const status = await recallStatus();
  assert.equal(status.providers.length, 3);
  assert.equal(status.providers.reduce((sum, provider) => sum + provider.sessions, 0), 4);
  assert.ok(status.lastSyncAt);
});

test('the index stores redacted text rather than duplicating raw credentials', async () => {
  const db = await openDatabase({ readonly: true });
  try {
    const row = db.prepare("SELECT text FROM messages WHERE message_key LIKE 'claude:claude-user:%'").get();
    assert.doesNotMatch(row.text, /top-secret-value/);
    assert.match(row.text, /\[REDACTED\]/);
  } finally {
    db.close();
  }
});

test('database rebuilds an older derived schema and refuses a future schema', async () => {
  const oldFile = path.join(temp, 'old-schema.db');
  let db = new DatabaseSync(oldFile);
  db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE obsolete(value TEXT);');
  db.prepare('INSERT INTO metadata VALUES (?, ?)').run('schema_version', '0');
  db.close();

  const rebuilt = await openDatabase({ file: oldFile });
  try {
    assert.equal(rebuilt.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get().value, '1');
    assert.equal(rebuilt.prepare("SELECT 1 FROM sqlite_master WHERE name = 'obsolete'").get(), undefined);
  } finally {
    rebuilt.close();
  }

  const futureFile = path.join(temp, 'future-schema.db');
  db = new DatabaseSync(futureFile);
  db.exec('CREATE TABLE metadata(key TEXT PRIMARY KEY, value TEXT NOT NULL);');
  db.prepare('INSERT INTO metadata VALUES (?, ?)').run('schema_version', '999');
  db.close();
  await assert.rejects(openDatabase({ file: futureFile }), /newer than supported/);
});
