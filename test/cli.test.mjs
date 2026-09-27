import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { claude, fakeHome } from './helpers/home.mjs';

const CLI = fileURLToPath(new URL('../scripts/recall.mjs', import.meta.url));

function withHome(t) {
  const home = fakeHome();
  t.after(() => home.cleanup());
  home.jsonl('.claude/projects/-work-shop/cli-1.jsonl', [
    claude.user('The stripe webhook keeps timing out', 1, { cwd: '/work/shop' }),
    claude.assistant('Raised the handler timeout to 30 seconds.', 2),
  ]);
  const run = (...args) => {
    const env = { ...process.env, ...home.env, CLAUDE_CODE_SESSION_ID: '', CODEX_THREAD_ID: '' };
    const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
    return { code: result.status, out: result.stdout, err: result.stderr };
  };
  return run;
}

test('search then read, as text, each naming the next command', t => {
  const run = withHome(t);
  const search = run('search', 'stripe', 'webhook');
  assert.equal(search.code, 0);
  const handle = search.out.match(/read (\w+) --at (\d+)/);
  assert.ok(handle, search.out);
  const read = run('read', handle[1], '--at', handle[2]);
  assert.equal(read.code, 0);
  assert.match(read.out, /Raised the handler timeout/);
  assert.match(read.out, /-- end of conversation --/);
});

test('--json carries the schema version, and errors map to exit codes', t => {
  const run = withHome(t);
  const search = JSON.parse(run('search', '--json', 'stripe').out);
  assert.equal(search.schemaVersion, 3);
  assert.deepEqual([search.hits[0].id, search.completeness.complete], ['cli-1', true]);

  const missing = run('read', 'zzzzzzz', '--json');
  assert.deepEqual([missing.code, JSON.parse(missing.out).error.code], [3, 'not_found']);
  const typo = run('serch', 'stripe');
  assert.equal(typo.code, 2);
  assert.match(typo.err, /Did you mean search\?/);
});

test('--until with a bare date includes that whole day', t => {
  const run = withHome(t);
  const ids = (...flags) => JSON.parse(run('recent', '--json', ...flags).out).sessions.map(session => session.id);
  assert.deepEqual(ids('--until', '2026-01-05'), ['cli-1']);
  assert.deepEqual(ids('--until', '2026-01-04'), []);
  assert.deepEqual(ids('--since', '2026-01-06'), []);
});
