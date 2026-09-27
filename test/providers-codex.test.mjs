import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { codexProvider } from '../src/providers/codex.mjs';
import { sourceRoots } from '../src/shared/paths.mjs';
import { codex } from './helpers/codex.mjs';
import { fakeHome } from './helpers/home.mjs';

let home;
afterEach(() => home?.cleanup());

const at = minute => new Date(Date.UTC(2026, 0, 5, 10, minute)).toISOString();
const ID = '019c0000-0000-7000-8000-000000000001';
const PARENT = '019c0000-0000-7000-8000-00000000000a';
const CHILD = '019c0000-0000-7000-8000-00000000000b';
const FORK = '019c0000-0000-7000-8000-00000000000c';
const SEGMENT = '019c0000-0000-7000-8000-00000000000d';
const PNG = 'data:image/png;base64,' + Buffer.from('png-bytes').toString('base64');
const JPEG = 'data:image/jpeg;base64,' + Buffer.from('jpeg-bytes').toString('base64');

const rollout = (id, records, dir = path.join('sessions', '2026', '01', '05')) => home.jsonl(path.join('.codex', dir, `rollout-2026-01-05T10-00-00-${id}.jsonl`), records);
const rows = parsed => parsed.messages.map(m => [m.sessionNativeId, m.seq, m.ts, m.role, m.kind, m.text]);
const texts = parsed => parsed.messages.map(m => m.text);
const sourceFor = async file => (await codexProvider.discover(sourceRoots())).find(source => source.path === file);

test('user turns come from items with injected context removed; tools are summarized once', async () => {
  home = fakeHome().activate();
  const request = '# Files mentioned by the user:\n\n## notes.md: /work/demo/notes.md\n\n## My request for Codex:\nwhy does login fail?\n';
  const file = rollout(ID, [
    codex.meta(ID),
    codex.turn(0),
    codex.input('developer', ['<permissions instructions>sandboxed</permissions instructions>'], 0),
    codex.input('user', ['# AGENTS.md instructions for /work/demo\n\n<INSTRUCTIONS>\nbe terse\n</INSTRUCTIONS>', '<environment_context>\n  <cwd>/work/demo</cwd>\n</environment_context>'], 0),
    codex.input('user', [request], 1),
    codex.user(request, 1),
    codex.custom('exec', 'text(await tools.exec_command({cmd:"npm test -- login", workdir:"/work/demo"}))', 'c1', 2),
    codex.command('npm test -- login', 2),
    codex.output('c1', [{ type: 'input_text', text: 'Script completed\nOutput:\n1 failing: token expired' }], 2, 'custom_tool_call_output'),
    codex.custom('apply_patch', '*** Begin Patch\n*** Update File: src/login.js\n@@\n-a\n+b\n*** End Patch', 'c2', 3),
    codex.output('c2', '{"output":"Success. Updated the following files:\\nM src/login.js","metadata":{"exit_code":0}}', 3, 'custom_tool_call_output'),
    codex.call('shell_command', { command: 'node scripts/recall.mjs search "login"' }, 'c3', 4),
    codex.output('c3', 'text quoted from another conversation', 4),
    codex.agent('Fixed the token expiry check.', 5),
    codex.input('assistant', ['Fixed the token expiry check.'], 5),
    codex.compacted('compactedonlyword '.repeat(5_000), 6),
    codex.compacted('compactedonlyword', 6),
    codex.user('# Context from my IDE setup:\n\n## Active file: src/login.js\n\n## My request for Codex:\nnow add a test', 8),
    codex.turn(8, 'gpt-test-2'),
  ]);

  const parsed = await codexProvider.parse(await sourceFor(file), null);

  assert.deepEqual(rows(parsed), [
    [ID, 0, at(1), 'user', 'text', 'why does login fail?'],
    [ID, 1, at(2), 'assistant', 'tool', '$ npm test -- login'],
    [ID, 2, at(2), 'tool', 'output', 'Script completed Output: 1 failing: token expired'],
    [ID, 3, at(3), 'assistant', 'tool', 'edit src/login.js'],
    [ID, 4, at(3), 'tool', 'output', 'Success. Updated the following files: M src/login.js'],
    [ID, 5, at(4), 'assistant', 'tool', '$ node scripts/recall.mjs search "login"'],
    [ID, 6, at(5), 'assistant', 'text', 'Fixed the token expiry check.'],
    [ID, 7, at(8), 'user', 'text', 'now add a test'],
  ]);
  assert.deepEqual(parsed.messages[5].meta, { recall: true });
  assert.deepEqual(parsed.sessions, [{
    nativeId: ID,
    parentNativeId: null,
    kind: 'main',
    title: 'why does login fail?',
    titleSource: 'prompt',
    firstPrompt: 'why does login fail?',
    cwd: '/work/demo',
    gitBranch: 'main',
    model: 'gpt-test-2',
    origin: 'cli',
    createdAt: at(0),
    updatedAt: at(8),
    archived: false,
    resume: { command: 'codex', args: ['resume', ID], cwd: '/work/demo' },
    meta: {},
  }]);
});

test('event-form turns and images from both forms are read, and attachments re-read', async () => {
  home = fakeHome().activate();
  const file = rollout(ID, [
    codex.meta(ID),
    codex.userEvent('look at this chart', 1, [PNG]),
    codex.agentEvent('It trends up.', 2),
    codex.input('user', ['<image name=[Image #1]>', 'and this one?'], 3, [JPEG]),
    codex.user('and this one?', 3, [{ type: 'local_image', path: 'C:/tmp/b.jpg' }]),
  ]);
  const source = await sourceFor(file);

  const parsed = await codexProvider.parse(source, null);

  assert.deepEqual(texts(parsed), ['look at this chart', 'It trends up.', 'and this one?']);
  assert.deepEqual(parsed.attachments.map(a => [a.seq, a.ordinal, a.mime, a.bytes]), [[0, 0, 'image/png', 9], [2, 0, 'image/jpeg', 10]]);
  const bytes = await Promise.all(parsed.attachments.map(a => codexProvider.readAttachment(source, a.locator)));
  assert.deepEqual(bytes.map(b => [b.mime, b.data.toString()]), [['image/png', 'png-bytes'], ['image/jpeg', 'jpeg-bytes']]);
});

test('an appended rollout resumes from the cursor and continues the sequence', async () => {
  home = fakeHome().activate();
  const relative = path.join('.codex', 'sessions', '2026', '01', '05', `rollout-2026-01-05T10-00-00-${ID}.jsonl`);
  home.jsonl(relative, [codex.meta(ID), codex.user('first question', 1), codex.agent('first answer', 2)]);
  const source = await sourceFor(path.join(home.home, relative));
  const first = await codexProvider.parse(source, null);

  home.append(relative, [codex.call('shell', { command: ['bash', '-lc', 'ls'] }, 'c9', 3), codex.output('c9', 'README.md', 3), codex.user('second question', 4)]);
  const second = await codexProvider.parse(source, first.cursor);

  assert.deepEqual(rows(second), [
    [ID, 2, at(3), 'assistant', 'tool', '$ ls'],
    [ID, 3, at(3), 'tool', 'output', 'README.md'],
    [ID, 4, at(4), 'user', 'text', 'second question'],
  ]);
  assert.equal(second.sessions[0].title, 'first question');
  assert.equal(second.sessions[0].updatedAt, at(4));
});

test('spawned agents get their parent, forks and segments are linked, copied history is skipped', async () => {
  home = fakeHome().activate();
  rollout(PARENT, [codex.meta(PARENT), codex.user('plan the migration', 1), codex.agent('Spawning a helper.', 2)]);
  const spawn = { thread_spawn: { parent_thread_id: PARENT, depth: 1, agent_path: '/root/schema_review', agent_nickname: 'Euler', agent_role: 'explorer' } };
  rollout(CHILD, [
    codex.meta(CHILD, { source: { subagent: spawn }, forked_from_id: PARENT, subagent_history_start_ordinal: 4 }, 0),
    codex.meta(PARENT, {}, 1),
    codex.user('plan the migration', 1, [], 2),
    codex.agent('Spawning a helper.', 2, 3),
    codex.event('thread_settings_applied', 3, 4),
    codex.agent('Two tables are orphaned.', 4, 5),
  ], 'archived_sessions');
  rollout(FORK, [codex.meta(FORK, { forked_from_id: PARENT, source: 'vscode', originator: 'Codex Desktop' }), codex.user('try the other approach', 5)]);
  rollout(`${PARENT}_${SEGMENT}`, [codex.meta(PARENT, {}, 10), codex.user('continue the migration', 6, [], 11)]);

  const sources = await codexProvider.discover(sourceRoots());
  const parsed = await Promise.all(sources.map(source => codexProvider.parse(source, null)));
  const summary = parsed.map(({ sessions: [s], messages }) => [s.nativeId, s.parentNativeId, s.kind, s.title, s.titleSource, s.origin, s.archived, s.meta, messages.map(m => m.text)])
    .sort((a, b) => a[0].localeCompare(b[0]));

  assert.deepEqual(summary, [
    [PARENT, null, 'main', 'plan the migration', 'prompt', 'cli', false, {}, ['plan the migration', 'Spawning a helper.']],
    [`${PARENT}:${SEGMENT}`, PARENT, 'subagent', 'continue the migration', 'prompt', 'cli', false, { segment: SEGMENT }, ['continue the migration']],
    [CHILD, PARENT, 'subagent', 'schema_review (Euler)', 'generated', 'subagent', true, { agentNickname: 'Euler', agentRole: 'explorer' }, ['Two tables are orphaned.']],
    [FORK, null, 'main', 'try the other approach', 'prompt', 'desktop', false, { forkedFrom: PARENT }, ['try the other approach']],
  ]);
});

test('labels take thread names, real stored titles, archive flags and spawn parents', async () => {
  home = fakeHome().activate();
  const roots = sourceRoots();
  const threads = (file, rowsToInsert) => {
    const db = new DatabaseSync(path.join(roots.codexHome, file));
    db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, source TEXT, title TEXT, first_user_message TEXT, name TEXT, archived INTEGER);
      CREATE TABLE thread_spawn_edges (parent_thread_id TEXT, child_thread_id TEXT PRIMARY KEY, status TEXT);`);
    const insert = db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const row of rowsToInsert) insert.run(...row);
    return db;
  };
  fs.mkdirSync(roots.codexHome, { recursive: true });
  threads('state_4.sqlite', [[ID, '', 'cli', 'stale', 'stale', 'Old schema name', 0]]).close();
  const db = threads('state_5.sqlite', [
    [ID, '', 'vscode', 'why does login fail?', 'why does login fail?', 'Renamed in app', 1],
    [PARENT, '', 'vscode', 'Summarize auth design', '# Files mentioned by the user:\n## a.md: /a.md\n## My request for Codex:\nsummarize', '', 0],
    [FORK, '', 'cli', '<environment_context>\n<cwd>/w</cwd>\n</environment_context>', '', '', 0],
    [CHILD, '', JSON.stringify({ subagent: { thread_spawn: { parent_thread_id: PARENT, agent_nickname: 'Euler' } } }), '', '', '', 0],
  ]);
  db.prepare('INSERT INTO thread_spawn_edges VALUES (?, ?, ?)').run(PARENT, CHILD, 'closed');
  db.close();
  home.jsonl(path.join('.codex', 'session_index.jsonl'), [
    { id: SEGMENT, thread_name: 'First name', updated_at: '2026-01-05T10:00:00Z' },
    { id: SEGMENT, thread_name: 'Only in the index', updated_at: '2026-01-05T11:00:00Z' },
  ]);

  const labels = (await codexProvider.labels(roots)).sort((a, b) => a.nativeId.localeCompare(b.nativeId));

  assert.deepEqual(labels, [
    { nativeId: ID, title: 'Renamed in app', titleSource: 'generated', archived: true, parentNativeId: null },
    { nativeId: PARENT, title: 'Summarize auth design', titleSource: 'generated', archived: false, parentNativeId: null },
    { nativeId: CHILD, title: null, titleSource: null, archived: false, parentNativeId: PARENT },
    { nativeId: FORK, title: null, titleSource: null, archived: false, parentNativeId: null },
    { nativeId: SEGMENT, title: 'Only in the index', titleSource: 'generated', archived: null, parentNativeId: null },
  ]);
});
