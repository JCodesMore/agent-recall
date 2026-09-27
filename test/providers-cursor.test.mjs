import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cursorProvider, slugCwd } from '../src/providers/cursor.mjs';
import { sourceRoots } from '../src/shared/paths.mjs';
import { fakeHome } from './helpers/home.mjs';

let home;
afterEach(() => home?.cleanup());

// Records in the shape Cursor writes to ~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl.
const cursor = {
  user: (query, { stamp, context = '' } = {}) => ({
    role: 'user',
    message: { content: [{ type: 'text', text: `${stamp ? `<timestamp>${stamp}</timestamp>\n` : ''}${context}<user_query>\n${query}\n</user_query>` }] },
  }),
  context: text => ({ role: 'user', message: { content: [{ type: 'text', text }] } }),
  assistant: (...content) => ({ role: 'assistant', message: { content: content.map(item => (typeof item === 'string' ? { type: 'text', text: item } : item)) } }),
  tool: (name, input) => ({ type: 'tool_use', name, input }),
  ended: () => ({ type: 'turn_ended', status: 'success' }),
};

const MTIME = new Date('2026-01-05T11:00:00.000Z');

// Cursor's folder name for a workspace: path parts joined by '-', drive letter lower case.
function slugFor(dir) {
  const tokens = dir.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (process.platform === 'win32') tokens[0] = tokens[0].toLowerCase();
  return tokens.join('-');
}

const roots = sourceRoots;

function workspace(...parts) {
  const dir = path.join(home.home, ...parts);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync.native(dir);
}

function transcript(slug, id, records, child) {
  const relative = path.join('.cursor', 'projects', slug, 'agent-transcripts', id, child ? path.join('subagents', `${child}.jsonl`) : `${id}.jsonl`);
  const file = home.jsonl(relative, records);
  fs.utimesSync(file, MTIME, MTIME);
  return relative;
}

const rows = parsed => parsed.messages.map(m => [m.sessionNativeId, m.seq, m.ts, m.role, m.kind, m.text]);

test('user queries are unwrapped, injected context dropped and tools summarized', async () => {
  home = fakeHome().activate();
  const cwd = workspace('work', 'app');
  transcript(slugFor(cwd), 'aaa-111', [
    cursor.context('<git_status>\nclean tree\n</git_status>\n<agent_skills>\nskill list\n</agent_skills>'),
    cursor.user('why does login fail?', {
      stamp: 'Monday, Jan 5, 2026, 4:05 AM (UTC-6)',
      context: '<attached_files>\n<code_selection path="plan.md" lines="1-3">secret plan body</code_selection>\n</attached_files>\n',
    }),
    cursor.assistant(
      'Let me look.',
      cursor.tool('Shell', { command: 'npm test -- login', description: 'run tests', working_directory: cwd }),
      cursor.tool('ReadFile', { path: '/work/app/login.js' }),
      cursor.tool('StrReplace', { path: '/work/app/login.js', old_string: 'a', new_string: 'b' }),
      cursor.tool('ApplyPatch', '*** Begin Patch\n*** Update File: src/session.js\n@@\n-a\n+b\n*** End Patch'),
      cursor.tool('CallMcpTool', { server: 'user-Playwright', toolName: 'browser_navigate', arguments: { url: 'http://localhost:3000' } }),
      cursor.tool('WebSearch', { search_term: 'jwt clock skew', explanation: 'why' }),
      cursor.tool('Shell', { command: 'node scripts/recall.mjs search "login"' }),
    ),
    cursor.ended(),
    cursor.user('Perform any necessary follow-up actions in response to the subagent completion above.'),
    cursor.context('[Image]\n<image_files>\n1. C:/shots/a.png\n</image_files>\n<user_query>\nsee screenshot\n</user_query>'),
    cursor.assistant('Fixed the timeout.'),
  ]);

  const [source] = await cursorProvider.discover(roots());
  const parsed = await cursorProvider.parse(source, null);

  assert.deepEqual(rows(parsed), [
    ['aaa-111', 0, '2026-01-05T10:05:00.000Z', 'user', 'text', 'why does login fail?'],
    ['aaa-111', 1, null, 'assistant', 'text', 'Let me look.'],
    ['aaa-111', 2, null, 'assistant', 'tool', '$ npm test -- login'],
    ['aaa-111', 3, null, 'assistant', 'tool', 'read /work/app/login.js'],
    ['aaa-111', 4, null, 'assistant', 'tool', 'edit /work/app/login.js'],
    ['aaa-111', 5, null, 'assistant', 'tool', 'edit src/session.js'],
    ['aaa-111', 6, null, 'assistant', 'tool', 'user-Playwright.browser_navigate {"url":"http://localhost:3000"}'],
    ['aaa-111', 7, null, 'assistant', 'tool', 'web search: jwt clock skew'],
    ['aaa-111', 8, null, 'assistant', 'tool', '$ node scripts/recall.mjs search "login"'],
    ['aaa-111', 9, null, 'user', 'text', 'see screenshot'],
    ['aaa-111', 10, null, 'assistant', 'text', 'Fixed the timeout.'],
  ]);
  assert.deepEqual(parsed.messages[8].meta, { recall: true });
  assert.deepEqual(parsed.sessions, [{
    nativeId: 'aaa-111',
    parentNativeId: null,
    kind: 'main',
    title: 'why does login fail?',
    titleSource: 'prompt',
    firstPrompt: 'why does login fail?',
    cwd,
    gitBranch: null,
    model: null,
    origin: 'ide',
    createdAt: '2026-01-05T10:05:00.000Z',
    updatedAt: '2026-01-05T11:00:00.000Z',
    archived: false,
    resume: null,
    meta: {},
  }]);
  assert.deepEqual(parsed.diagnostics, { malformed: 0, oversized: 0, skipped: 0 });
});

test('subagents hang off their parent and CLI chats can be resumed', async () => {
  home = fakeHome().activate();
  const cwd = workspace('work', 'cli-app');
  const slug = slugFor(cwd);
  transcript(slug, 'bbb-222', [cursor.user('audit the repo'), cursor.assistant(cursor.tool('Task', { description: 'Explore', subagent_type: 'explore', prompt: 'map the modules' }))]);
  transcript(slug, 'bbb-222', [cursor.user('map the modules'), cursor.assistant('Three modules.')], 'ccc-333');
  fs.mkdirSync(path.join(home.home, '.cursor', 'chats', 'f00d', 'bbb-222'), { recursive: true });

  const sources = await cursorProvider.discover(roots());
  const sessions = [];
  for (const source of sources) sessions.push(...(await cursorProvider.parse(source, null)).sessions);

  assert.deepEqual(sessions.map(s => [s.nativeId, s.parentNativeId, s.kind, s.title, s.origin, s.resume]), [
    ['bbb-222', null, 'main', 'audit the repo', 'cli', { command: 'cursor-agent', args: ['--resume', 'bbb-222'], cwd }],
    ['bbb-222:ccc-333', 'bbb-222', 'subagent', 'map the modules', 'cli', { command: 'cursor-agent', args: ['--resume', 'bbb-222'], cwd }],
  ]);
});

test('the project slug decodes to a real folder, keeping hyphens and dots in names', async () => {
  home = fakeHome().activate();
  const cwd = workspace('work', 'my-app.v2');
  workspace('work', 'my');
  const gone = path.join(path.dirname(cwd), 'old-tool');

  assert.equal(await slugCwd(slugFor(cwd)), cwd);
  assert.equal(await slugCwd(slugFor(gone)), gone);
  assert.equal(await slugCwd('empty-window'), null);
});

test('an appended transcript resumes from the cursor', async () => {
  home = fakeHome().activate();
  const relative = transcript('empty-window', 'ddd-444', [cursor.user('first question'), cursor.assistant('first answer')]);
  const [source] = await cursorProvider.discover(roots());
  const first = await cursorProvider.parse(source, null);

  home.append(relative, [cursor.user('second question'), cursor.assistant('second answer')]);
  const second = await cursorProvider.parse(source, first.cursor);

  assert.deepEqual(rows(second).map(row => [row[1], row[5]]), [[2, 'second question'], [3, 'second answer']]);
  assert.equal(second.sessions[0].title, 'first question');
  assert.equal(second.sessions[0].cwd, null);
});

test('labels carry IDE titles, archive flags, workspaces and subagent parents', async () => {
  home = fakeHome().activate();
  fs.mkdirSync(path.dirname(roots().cursorState), { recursive: true });
  const db = new DatabaseSync(roots().cursorState);
  db.exec('CREATE TABLE composerHeaders (composerId TEXT PRIMARY KEY, isArchived INTEGER, isSubagent INTEGER, subagentTypeName TEXT, value TEXT)');
  const insert = db.prepare('INSERT INTO composerHeaders VALUES (?, ?, ?, ?, ?)');
  insert.run('eee-555', 1, 0, '', JSON.stringify({ name: 'Login timeout fix', workspaceIdentifier: { uri: { fsPath: '/work/app' } } }));
  insert.run('fff-666', 0, 1, 'explore', JSON.stringify({ name: 'Map modules', subagentInfo: { parentComposerId: 'eee-555' } }));
  insert.run('ggg-777', 0, 0, '', 'not json');
  db.close();

  assert.deepEqual(await cursorProvider.labels(roots()), [
    { nativeId: 'eee-555', title: 'Login timeout fix', titleSource: 'generated', archived: true, cwd: '/work/app', meta: undefined },
    { nativeId: 'eee-555:fff-666', title: 'Map modules', titleSource: 'generated', archived: false, cwd: null, meta: { agentType: 'explore' } },
    { nativeId: 'ggg-777', title: null, titleSource: null, archived: false, cwd: null, meta: undefined },
  ]);
});
