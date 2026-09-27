import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as recall from '../src/recall.mjs';
import { opencodeProvider } from '../src/providers/opencode.mjs';
import { sourceRoots } from '../src/shared/paths.mjs';
import { fakeHome } from './helpers/home.mjs';
import { ms, part, writeOpencodeDb } from './helpers/opencode.mjs';

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

test('a changed database re-indexes only the sessions that changed', async () => {
  home = fakeHome().activate();
  const file = writeOpencodeDb(home, [
    { id: 'ses_keep', title: 'Walrus migration', minute: 0, messages: [{ id: 'msg_k', role: 'user', minute: 1, parts: [part.text('plan the walrus migration')] }] },
    { id: 'ses_grow', title: 'Zeppelin cache', minute: 0, messages: [{ id: 'msg_g', role: 'user', minute: 1, parts: [part.text('tune the zeppelin cache')] }] },
    { id: 'ses_gone', title: 'Narwhal report', minute: 0, messages: [{ id: 'msg_n', role: 'user', minute: 1, parts: [part.text('draft the narwhal report')] }] },
  ]);
  await recall.sync();
  const [source] = await opencodeProvider.discover(sourceRoots());
  const { cursor } = await opencodeProvider.parse(source, null);

  const db = new DatabaseSync(file);
  db.prepare('INSERT INTO message VALUES (?, ?, ?, ?, ?)').run('msg_g2', 'ses_grow', ms(5), ms(5), JSON.stringify({ role: 'user', time: { created: ms(5) } }));
  db.prepare('INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)').run('msg_g2_p0', 'msg_g2', 'ses_grow', ms(5), ms(5), JSON.stringify(part.text('add a quokka eviction policy')));
  db.prepare("DELETE FROM session WHERE id = 'ses_gone'").run();
  db.close();

  const partial = await opencodeProvider.parse(source, cursor);
  assert.deepEqual([partial.partial, partial.sessions.map(s => s.nativeId), partial.removed], [true, ['ses_grow'], ['ses_gone']]);

  const synced = await recall.sync();
  assert.deepEqual([synced.indexed, synced.appended], [0, 1]);
  const ids = async query => (await recall.search(query, { sync: 'never' })).hits.map(hit => hit.id);
  assert.deepEqual(await ids('quokka eviction'), ['ses_grow']);
  assert.deepEqual(await ids('zeppelin cache'), ['ses_grow']);
  assert.deepEqual(await ids('walrus migration'), ['ses_keep']);
  assert.deepEqual(await ids('narwhal report'), []);
});

test('a partial update reads the same as a full rebuild, even when only a message changed', async () => {
  home = fakeHome().activate();
  const file = writeOpencodeDb(home, [{ id: 'ses_a', title: 'Walrus migration', messages: [
    { id: 'm1', role: 'user', minute: 1, parts: [part.text('plan the walrus migration')] },
    { id: 'm2', role: 'assistant', minute: 2, modelID: 'gpt-a', parts: [part.text('here is the plan')] },
  ] }]);
  await recall.sync();
  const db = new DatabaseSync(file);
  db.prepare("UPDATE message SET time_updated = ?, data = ? WHERE id = 'm2'")
    .run(ms(3), JSON.stringify({ role: 'assistant', time: { created: ms(2) }, modelID: 'gpt-b', summary: true }));
  db.close();
  fs.utimesSync(file, 1_800_000_000, 1_800_000_000);
  const snapshot = async () => {
    const { session } = await recall.show('ses_a', { sync: 'never' });
    const { messages } = await recall.read('ses_a', { all: true, outputs: true, sync: 'never' });
    return { model: session.model, messages: messages.map(m => [m.seq, m.role, m.kind, m.text]) };
  };
  await recall.sync();
  const partial = await snapshot();
  await recall.sync({ full: true });
  assert.deepEqual(partial, await snapshot());
  assert.deepEqual([partial.model, partial.messages[1][2]], ['gpt-b', 'summary']);
});

test('a database that lost a session to a newer copy takes it back when the copy goes', async () => {
  home = fakeHome().activate();
  const main = writeOpencodeDb(home, [{ id: 'ses_walrus', title: 'Walrus migration', messages: [
    { id: 'm1', role: 'user', minute: 1, parts: [part.text('plan the walrus migration')] },
  ] }]);
  const dev = path.join(path.dirname(main), 'opencode-dev.db');
  fs.copyFileSync(main, dev);
  fs.utimesSync(dev, 1_700_000_000, 1_700_000_000);
  fs.utimesSync(main, 1_700_000_100, 1_700_000_100);
  await recall.sync();

  // The older copy gains another session (a partial update without the shared one) but stays
  // older, then the owner is deleted.
  const db = new DatabaseSync(dev);
  db.prepare(`INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
    VALUES ('ses_zep', 'prj', 'slug', '/work/demo', 'Zeppelin cache', '1', ?, ?)`).run(ms(9), ms(9));
  db.close();
  fs.utimesSync(dev, 1_700_000_050, 1_700_000_050);
  await recall.sync();
  fs.rmSync(main);
  await recall.sync();
  await recall.sync();
  assert.deepEqual((await recall.search('walrus migration', { sync: 'never' })).hits.map(hit => hit.id), ['ses_walrus']);
});
