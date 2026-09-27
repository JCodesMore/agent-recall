import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { claude, fakeHome } from './helpers/home.mjs';
import * as recall from '../src/recall.mjs';
import { sourceRoots } from '../src/shared/paths.mjs';

delete process.env.CLAUDE_CODE_SESSION_ID;
delete process.env.CODEX_THREAD_ID;

const project = (slug, id) => `.claude/projects/${slug}/${id}.jsonl`;
const handles = result => result.hits.map(hit => hit.id);

function withHome(t) {
  const home = fakeHome().activate();
  t.after(() => home.cleanup());
  return home;
}

test('terms spread across different turns still find the conversation', async t => {
  const home = withHome(t);
  home.jsonl(project('-work-shop', 'aaaa-1'), [
    claude.user('The stripe webhook keeps timing out', 1, { cwd: '/work/shop' }),
    claude.assistant('Raised the handler timeout.', 2),
    claude.user('Also add retries with exponential backoff', 3, { cwd: '/work/shop' }),
    claude.assistant('Done.', 4),
  ]);
  home.jsonl(project('-work-other', 'bbbb-2'), [claude.user('Unrelated stripe invoice question', 1), claude.assistant('Sure.', 2)]);
  const result = await recall.search('stripe webhook backoff retries');
  assert.deepEqual(handles(result), ['aaaa-1', 'bbbb-2']);
  assert.deepEqual(result.hits[0].missing, []);
});

test('the calling session is excluded and recall requests rank below their target', async t => {
  const home = withHome(t);
  home.jsonl(project('-work-cloud', 'target-1'), [
    claude.user('Can we get AWS Bedrock credits for the startup program?', 1),
    claude.assistant('Apply through Activate; Bedrock credits come with it.', 2),
  ]);
  home.jsonl(project('-work-cloud', 'asker-2'), [
    claude.user('Find the conversation about AWS Bedrock credits', 1),
    claude.assistant([claude.toolUse('r1', 'Bash', { command: 'node scripts/recall.mjs search -- AWS Bedrock credits' })], 2),
    claude.toolResult('r1', 'target-1 Can we get AWS Bedrock credits', 3),
  ]);
  home.jsonl(project('-work-cloud', 'current-3'), [claude.user('Where were the AWS Bedrock credits discussed?', 1)]);
  process.env.CLAUDE_CODE_SESSION_ID = 'current-3';
  t.after(() => delete process.env.CLAUDE_CODE_SESSION_ID);
  const result = await recall.search('AWS Bedrock credits');
  assert.deepEqual(handles(result), ['target-1', 'asker-2']);
});

test('subagent work folds into its root conversation', async t => {
  const home = withHome(t);
  home.jsonl(project('-work-app', 'root-1'), [claude.user('Audit the auth flow', 1), claude.assistant('Spawning a reviewer.', 2)]);
  home.jsonl('.claude/projects/-work-app/root-1/subagents/agent-a1.jsonl', [
    claude.user('Check token refresh in oauthClient.ts', 3),
    claude.assistant('The refresh token is never rotated.', 4),
  ]);
  home.file('.claude/projects/-work-app/root-1/subagents/agent-a1.meta.json', JSON.stringify({ agentType: 'reviewer', description: 'Review token refresh' }));
  const result = await recall.search('refresh token rotated');
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0].id, 'root-1');
  assert.equal(result.hits[0].matches[0].subagent, 'Review token refresh');
  const shown = await recall.show('root-1');
  assert.deepEqual(shown.subagents.map(s => s.id), ['root-1:agent-a1']);
});

test('tool calls, file names and error output are searchable', async t => {
  const home = withHome(t);
  home.jsonl(project('-work-api', 'tools-1'), [
    claude.user('Run the tests', 1),
    claude.assistant([claude.toolUse('t1', 'Bash', { command: 'pnpm vitest run src/billing/invoice.test.ts' })], 2),
    claude.toolResult('t1', 'FAIL TypeError: Cannot read properties of undefined (reading totalCents)', 3),
    claude.assistant('Fixed it.', 4),
  ]);
  assert.deepEqual(handles(await recall.search('invoice.test.ts')), ['tools-1']);
  assert.deepEqual(handles(await recall.search('totalCents')), ['tools-1']);
});

test('titles from the desktop app and /rename win over the first prompt', async t => {
  const home = withHome(t);
  home.jsonl(project('-work-x', 'named-1'), [claude.user('hello there', 1), claude.assistant('Hi.', 2)]);
  home.jsonl(project('-work-x', 'renamed-2'), [claude.user('hi again', 1), claude.title('Quarterly roadmap', 'renamed-2')]);
  const labels = path.relative(home.home, sourceRoots().claudeDesktopSessions);
  home.file(path.join(labels, 'acct/org/local_1.json'), JSON.stringify({ cliSessionId: 'named-1', title: 'Harbor bundle tracker', titleSource: 'generated', isArchived: true }));
  const result = await recall.search('harbor bundle tracker');
  assert.equal(result.hits[0].title, 'Harbor bundle tracker');
  assert.equal(result.hits[0].archived, true);
  assert.equal((await recall.show('renamed-2')).session.title, 'Quarterly roadmap');
});

test('the current project is a boost, not a filter', async t => {
  const home = withHome(t);
  const here = path.join(home.root, 'work', 'atlas-app');
  home.jsonl(project('-elsewhere', 'far-1'), [claude.user('tile cache eviction policy', 1, { cwd: '/elsewhere/tiles' })]);
  home.jsonl(project('-map', 'near-2'), [claude.user('tile cache eviction policy', 1, { cwd: here })]);
  const result = await recall.search('tile cache eviction', { cwd: here });
  assert.deepEqual(handles(result), ['near-2', 'far-1']);
  const scoped = await recall.search('tile cache eviction', { project: 'tiles' });
  assert.deepEqual(handles(scoped), ['far-1']);
});

test('read pages through every message exactly once, and --out writes them all', async t => {
  const home = withHome(t);
  const records = [];
  for (let i = 0; i < 60; i += 1) {
    records.push(claude.user(`question ${i} ${'x'.repeat(900)}`, i), claude.assistant(`answer ${i} ${'y'.repeat(900)}`, i));
  }
  home.jsonl(project('-work-long', 'long-1'), records);
  const seen = [];
  let from = 0;
  for (let pages = 0; from !== null && pages < 50; pages += 1) {
    const page = await recall.read('long-1', { from, maxChars: 8000 });
    seen.push(...page.messages.map(m => m.seq));
    from = page.nextFrom;
  }
  assert.deepEqual(seen, Array.from({ length: 120 }, (_, i) => i));
  const out = path.join(home.root, 'export.md');
  const exported = await recall.read('long-1', { out });
  assert.equal(exported.export.messages, 120);
  assert.match(fs.readFileSync(out, 'utf8'), /answer 59/);
  const tail = await recall.read('long-1', { last: 2 });
  assert.deepEqual(tail.messages.map(m => m.seq), [118, 119]);
  const grep = await recall.read('long-1', { grep: 'question 42', context: 0 });
  assert.deepEqual(grep.grepHits, [84]);
});

test('sessions resolve by handle, native id, prefix and provider:id', async t => {
  const home = withHome(t);
  home.jsonl(project('-w', '7f3c9e21-aaaa'), [claude.user('ids test', 1)]);
  const { hits: [hit] } = await recall.search('ids test');
  for (const ref of [hit.handle, '7f3c9e21-aaaa', '7f3c9e', 'claude:7f3c9e21-aaaa']) {
    assert.equal((await recall.show(ref)).session.id, '7f3c9e21-aaaa', ref);
  }
  await assert.rejects(recall.show('nope-nope'), /No session matches/);
});

test('appended messages are indexed incrementally', async t => {
  const home = withHome(t);
  const file = project('-w', 'grow-1');
  home.jsonl(file, [claude.user('first topic zeppelin', 1)]);
  assert.deepEqual(handles(await recall.search('zeppelin')), ['grow-1']);
  home.append(file, [claude.user('second topic walrus', 2)]);
  const synced = await recall.sync();
  assert.equal(synced.appended, 1);
  assert.deepEqual(handles(await recall.search('walrus', { sync: 'never' })), ['grow-1']);
  assert.equal((await recall.show('grow-1')).session.messages, 2);
});
