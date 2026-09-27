import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claude, fakeHome } from './helpers/home.mjs';

const CLI = fileURLToPath(new URL('../scripts/recall.mjs', import.meta.url));
const FAKE_SSH = fileURLToPath(new URL('./helpers/fake-ssh.mjs', import.meta.url));

// This computer plus "thirteen" (reachable) and "offline" (ssh cannot resolve it).
function network(t) {
  const here = fakeHome();
  const thirteen = fakeHome();
  t.after(() => [here, thirteen].forEach(home => home.cleanup()));
  here.jsonl('.claude/projects/-work-shop/here-1.jsonl', [
    claude.user('The stripe webhook keeps timing out', 1, { cwd: '/work/shop' }),
    claude.assistant('Raised the handler timeout to 30 seconds.', 2),
  ]);
  thirteen.jsonl('.claude/projects/-work-shop/away-1.jsonl', [
    claude.user('Add stripe webhook retries with backoff', 1, { cwd: '/work/shop' }),
    claude.assistant('Retries now back off from 2 to 64 seconds.', 2),
    claude.user('Also rename the café menu job; run it with --force', 3, { cwd: '/work/shop' }),
    claude.assistant('Renamed and pushed with --force.', 4),
  ]);
  thirteen.jsonl('.claude/projects/-work-shop/away-2.jsonl', [claude.user('Unrelated stripe invoice export', 1), claude.assistant('Exported.', 2)]);
  fs.mkdirSync(here.data, { recursive: true });
  fs.writeFileSync(path.join(here.data, 'peers.json'), JSON.stringify({
    peers: [
      { name: 'Twelve', recall: CLI, hostnames: [os.hostname()] },
      { name: 'thirteen', recall: CLI },
      { name: 'offline', recall: CLI },
    ],
  }));
  const env = {
    ...process.env, ...here.env, CLAUDE_CODE_SESSION_ID: '', CODEX_THREAD_ID: '',
    AGENT_RECALL_SSH: JSON.stringify([process.execPath, FAKE_SSH]),
    FAKE_SSH_HOSTS: JSON.stringify({ thirteen: { home: thirteen.home, data: thirteen.data } }),
  };
  return (...args) => {
    const input = typeof args.at(-1) === 'object' ? args.pop().input : undefined;
    const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env, input });
    return { code: result.status, out: result.stdout, err: result.stderr };
  };
}

test('search across computers tags remote hits, and read --peer opens them there', t => {
  const run = network(t);
  const result = JSON.parse(run('search', '--json', '--peers', 'thirteen', '--', 'stripe webhook').out);
  assert.deepEqual(result.hits.map(hit => [hit.id, hit.peer ?? 'here']).sort(), [['away-1', 'thirteen'], ['away-2', 'thirteen'], ['here-1', 'here']]);
  assert.deepEqual(result.computers.map(computer => [computer.name, computer.local, computer.ok, computer.count]), [['twelve', true, true, 1], ['thirteen', false, true, 2]]);
  assert.equal(result.completeness.complete, true);

  const text = run('search', '--peers', 'thirteen', '--', 'stripe', 'retries').out;
  const next = text.match(/read (\w+) --peer thirteen --at (\d+)/);
  assert.ok(next, text);
  assert.match(text, /\[claude \w+ @thirteen\]/);
  const read = run('read', next[1], '--peer', 'thirteen', '--at', next[2]);
  assert.equal(read.code, 0, read.err);
  assert.match(read.out, /Retries now back off from 2 to 64 seconds/);
  assert.match(read.out, /@thirteen/);
});

test('an unreachable computer is reported and the rest still answer', t => {
  const run = network(t);
  const result = JSON.parse(run('search', '--json', '--peers', 'all', '--', 'stripe webhook').out);
  assert.deepEqual(result.computers.map(computer => [computer.name, computer.ok]), [['twelve', true], ['thirteen', true], ['offline', false]]);
  assert.match(result.computers[2].error, /Could not resolve hostname offline/);
  assert.equal(result.completeness.complete, false);
  assert.equal(result.hits.length, 3);

  const recent = JSON.parse(run('recent', '--json', '--peers', 'thirteen').out);
  assert.deepEqual(recent.sessions.map(session => session.id).sort(), ['away-1', 'away-2', 'here-1']);
  const doctor = run('doctor', '--peers', 'all').out;
  assert.match(doctor, /computer thirteen: Agent Recall \S+ on Node/);
  assert.match(doctor, /computer offline: unreachable/);
});

test('peer names are checked, and a peer answers only read-only commands', t => {
  const run = network(t);
  const unknown = run('search', '--peers', 'nowhere', '--', 'stripe');
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /Unknown computer "nowhere". Set up: twelve, thirteen, offline/);
  const missing = run('read', 'zzzzzzz', '--peer', 'thirteen', '--json');
  assert.deepEqual([missing.code, JSON.parse(missing.out).error.code], [3, 'not_found']);

  const ask = argv => JSON.parse(spawnSync(process.execPath, [CLI, 'peer-request'], { encoding: 'utf8', input: JSON.stringify({ argv }) }).stdout).error?.message;
  assert.match(ask(['install']), /answers only: search, read, show, recent, doctor/);
  for (const argv of [['search', '--peers', 'all', '--', 'x'], ['search', '-peers', 'all', '--', 'x'], ['context', 'abc1234', '--out', 'x.md'], ['transcript', 'abc1234', '-output=x.md']]) {
    assert.match(ask(argv), /refuses --(peers|out)/, argv.join(' '));
  }
});

test('awkward values, stdin queries, non-ASCII text and remote errors survive the trip', t => {
  const run = network(t);
  const hit = JSON.parse(run('search', '--json', '--peers', 'thirteen', '--', 'café menu').out).hits.find(item => item.peer === 'thirteen');
  assert.equal(hit?.id, 'away-1');
  const grep = run('read', hit.handle, '--peer', 'thirteen', '--grep=--force');
  assert.equal(grep.code, 0, grep.err);
  assert.match(grep.out, /Renamed and pushed with --force/);
  const piped = JSON.parse(run('search', '--json', '--stdin', '--peers', 'thirteen', { input: "the café menu's job" }).out);
  assert.ok(piped.hits.some(item => item.id === 'away-1' && item.peer === 'thirteen'));

  const ambiguous = run('show', 'away', '--peer', 'thirteen');
  assert.equal(ambiguous.code, 2);
  assert.match(ambiguous.err, /thirteen: "away" matches 2 sessions/);
  assert.match(ambiguous.err, /@thirteen/);
  const show = run('show', hit.handle, '--peer', 'thirteen');
  assert.match(show.out, /transcript: .* \(on thirteen\)/);
  assert.match(show.out, new RegExp(`Next: read ${hit.handle} --peer thirteen`));
});
