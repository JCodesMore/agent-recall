import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install } from '../src/install/install.mjs';

function tempHome(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-recall-install-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return home;
}

test('installs once for all agents, keeps foreign files and is idempotent', async t => {
  const home = tempHome(t);
  const primary = path.join(home, '.agents', 'skills', 'agent-recall');
  // An older install that the user added their own helper script to.
  fs.mkdirSync(path.join(primary, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(primary, 'src', 'sources'), { recursive: true });
  fs.writeFileSync(path.join(primary, '.agent-recall-install.json'), JSON.stringify({ name: 'agent-recall', version: 1 }));
  fs.writeFileSync(path.join(primary, 'src', 'sources', 'old.mjs'), 'old');
  fs.writeFileSync(path.join(primary, 'scripts', 'my-helper.mjs'), 'mine');

  const first = await install({ home, index: false });
  assert.deepEqual(first.actions.map(a => a.action), ['update', 'link']);
  assert.ok(fs.existsSync(path.join(primary, 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(primary, 'src', 'recall.mjs')));
  assert.ok(!fs.existsSync(path.join(primary, 'src', 'sources', 'old.mjs')));
  assert.equal(fs.readFileSync(path.join(primary, 'scripts', 'my-helper.mjs'), 'utf8'), 'mine');
  const claude = path.join(home, '.claude', 'skills', 'agent-recall');
  assert.ok(fs.existsSync(path.join(claude, 'SKILL.md')));

  const second = await install({ home, index: false });
  assert.deepEqual(second.actions.map(a => a.action), ['update', 'linked']);

  const removed = await install({ home, uninstall: true });
  assert.deepEqual(removed.actions.map(a => a.action), ['unlink', 'remove']);
  assert.deepEqual(fs.readdirSync(primary, { recursive: true }).map(p => p.split(path.sep).join('/')).sort(), ['scripts', 'scripts/my-helper.mjs']);
  assert.ok(!fs.existsSync(claude));
});

test('an installed copy runs', async t => {
  const home = tempHome(t);
  const target = path.join(home, 'skill');
  await install({ targets: [target], index: false });
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, [path.join(target, 'scripts', 'recall.mjs'), '--version'], { encoding: 'utf8' });
  assert.equal(out.trim(), JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
});

test('a Claude skill link pointing somewhere else is never written through', async t => {
  const home = tempHome(t);
  const checkout = path.join(home, 'dev-checkout');
  fs.mkdirSync(checkout);
  fs.writeFileSync(path.join(checkout, 'SKILL.md'), 'dev');
  fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(checkout, path.join(home, '.claude', 'skills', 'agent-recall'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = await install({ home, index: false });
  assert.deepEqual(result.actions.map(a => a.action), ['install', 'skipped']);
  assert.equal(fs.readFileSync(path.join(checkout, 'SKILL.md'), 'utf8'), 'dev');
  assert.deepEqual(fs.readdirSync(checkout), ['SKILL.md']);
});
