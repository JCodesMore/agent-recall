import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { opencodeProvider } from '../src/providers/opencode.mjs';
import { sourceRoots } from '../src/shared/paths.mjs';
import { fakeHome } from './helpers/home.mjs';
import { part, writeOpencodeDb } from './helpers/opencode.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

let home;
afterEach(() => home?.cleanup());

async function parseAll(sessions) {
  home = fakeHome().activate();
  writeOpencodeDb(home, sessions);
  const [source] = await opencodeProvider.discover(sourceRoots());
  return { source, parsed: await opencodeProvider.parse(source, null) };
}

const rows = parsed => parsed.messages.map(m => [m.sessionNativeId, m.seq, m.role, m.kind, m.text]);

test('missing database discovers no sources', async () => {
  home = fakeHome().activate();
  assert.deepEqual(await opencodeProvider.discover(sourceRoots()), []);
});

test('messages come out in order with tool summaries, outputs and a generated title', async () => {
  const { source, parsed } = await parseAll([{
    id: 'ses_main',
    title: 'Fix the flaky login test',
    directory: '/work/app',
    minute: 0,
    messages: [
      { id: 'msg_1', role: 'user', minute: 1, parts: [part.text('why does login fail? <system-reminder>noise</system-reminder>'), part.text('Continue if you have next steps', { synthetic: true })] },
      { id: 'msg_2', role: 'assistant', minute: 2, modelID: 'gpt-test', parts: [
        { type: 'step-start' },
        part.reasoning('thinking about it'),
        part.text('Let me run the tests.'),
        part.tool('bash', { command: 'npm test -- login' }, '1 failing: timeout in login.spec'),
        part.tool('read', { filePath: '/work/app/login.js' }, 'ENOENT', 'error'),
        part.tool('apply_patch', { patchText: '*** Begin Patch\n*** Update File: src/login.js\n@@\n-a\n+b\n*** End Patch' }, 'done'),
        part.tool('bash', { command: 'node scripts/recall.mjs search "login"' }, 'other conversation text'),
        part.text('Fixed the timeout.'),
      ] },
      { id: 'msg_3', role: 'user', minute: 3, parts: [part.file('shot.png', `data:image/png;base64,${PNG}`)] },
    ],
  }]);

  assert.deepEqual(rows(parsed), [
    ['ses_main', 0, 'user', 'text', 'why does login fail?'],
    ['ses_main', 1, 'assistant', 'text', 'Let me run the tests.'],
    ['ses_main', 2, 'assistant', 'tool', '$ npm test -- login'],
    ['ses_main', 3, 'tool', 'output', '1 failing: timeout in login.spec'],
    ['ses_main', 4, 'assistant', 'tool', 'read /work/app/login.js'],
    ['ses_main', 5, 'tool', 'output', 'ENOENT'],
    ['ses_main', 6, 'assistant', 'tool', 'edit src/login.js'],
    ['ses_main', 7, 'tool', 'output', 'done'],
    ['ses_main', 8, 'assistant', 'tool', '$ node scripts/recall.mjs search "login"'],
    ['ses_main', 9, 'assistant', 'text', 'Fixed the timeout.'],
    ['ses_main', 10, 'user', 'text', '[shot.png]'],
  ]);
  assert.deepEqual(parsed.messages[5].meta, { error: true });
  assert.deepEqual(parsed.messages[8].meta, { recall: true });

  const [session] = parsed.sessions;
  assert.deepEqual(
    [session.title, session.titleSource, session.firstPrompt, session.cwd, session.model, session.kind, session.archived],
    ['Fix the flaky login test', 'generated', 'why does login fail?', '/work/app', 'gpt-test', 'main', false],
  );
  assert.deepEqual(session.resume, { command: 'opencode', args: ['--session', 'ses_main'], cwd: '/work/app' });
  assert.deepEqual([session.createdAt, session.updatedAt], ['2026-01-05T10:00:00.000Z', '2026-01-05T10:03:00.000Z']);

  assert.equal(parsed.attachments.length, 1);
  const [attachment] = parsed.attachments;
  assert.deepEqual([attachment.seq, attachment.kind, attachment.mime, attachment.name], [10, 'image', 'image/png', 'shot.png']);
  const image = await opencodeProvider.readAttachment(source, attachment.locator);
  assert.equal(image.mime, 'image/png');
  assert.equal(image.data.toString('base64'), PNG);
});

test('subagent sessions point at their parent; placeholder titles fall back to the first prompt', async () => {
  const { parsed } = await parseAll([
    { id: 'ses_parent', title: 'New session - 2026-01-05T10:00:00.000Z', minute: 0, messages: [
      { id: 'msg_a', role: 'user', minute: 1, parts: [part.text('audit the auth module')] },
      { id: 'msg_b', role: 'assistant', minute: 2, parts: [part.tool('task', { description: 'Scan auth', prompt: 'List auth entry points', subagent_type: 'explore' }, 'task_id: ses_child')] },
    ] },
    { id: 'ses_child', parentId: 'ses_parent', agent: 'explore', title: 'Scan auth (@explore subagent)', minute: 2, messages: [
      { id: 'msg_c', role: 'user', minute: 2, parts: [part.text('List auth entry points')] },
      { id: 'msg_d', role: 'assistant', minute: 3, summary: true, parts: [part.text('Summary: two entry points.')] },
    ] },
  ]);

  const [parent, child] = parsed.sessions;
  assert.deepEqual([parent.title, parent.titleSource, parent.kind], ['audit the auth module', 'prompt', 'main']);
  assert.deepEqual(
    [child.nativeId, child.parentNativeId, child.kind, child.title, child.meta],
    ['ses_child', 'ses_parent', 'subagent', 'Scan auth (@explore subagent)', { agentType: 'explore' }],
  );
  assert.deepEqual(child.resume.args, ['--session', 'ses_parent']);
  assert.deepEqual(rows(parsed).slice(1), [
    ['ses_parent', 1, 'assistant', 'tool', 'agent (explore): Scan auth: List auth entry points'],
    ['ses_parent', 2, 'tool', 'output', 'task_id: ses_child'],
    ['ses_child', 0, 'user', 'text', 'List auth entry points'],
    ['ses_child', 1, 'assistant', 'summary', 'Summary: two entry points.'],
  ]);
});
