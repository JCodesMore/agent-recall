import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/storage/database.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CLI = path.join(ROOT, 'scripts', 'recall.mjs');
const INSTALLER = path.join(ROOT, 'scripts', 'install.mjs');
let temp;
let dataHome;
const PNG_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function run(script, args, env = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, AGENT_RECALL_HOME: dataHome, ...env },
    encoding: 'utf8',
  });
}

before(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-recall-cli-'));
  dataHome = path.join(temp, 'data');
  process.env.AGENT_RECALL_HOME = dataHome;
  const sourceFile = path.join(temp, 'source.jsonl');
  await fs.writeFile(sourceFile, `${JSON.stringify({
    type: 'user',
    uuid: 'cli-message',
    message: { role: 'user', content: [
      { type: 'text', text: 'remember the semaphore repair' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG_DATA } },
    ] },
  })}\n`);
  const db = await openDatabase();
  try {
    db.prepare('INSERT INTO sources VALUES (?, ?, ?, ?, ?)').run(
      sourceFile, 'claude', 'test', new Date().toISOString(), '{}',
    );
    db.prepare(`
      INSERT INTO sessions(
        session_key, provider, native_id, source_path, title, project, cwd,
        created_at, updated_at, source_updated_at, message_count, resume_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'claude:cli-session', 'claude', 'cli-session', sourceFile,
      'CLI \u001b[32mfixture\u001b[0m', 'fixture', temp, '2026-07-14T10:00:00.000Z', '2026-07-14T10:01:00.000Z',
      '2026-07-14T10:01:00.000Z', 1, JSON.stringify({ command: 'claude', args: ['--resume', 'cli-session'], cwd: temp }), '{}',
    );
    db.prepare(`
      INSERT INTO messages(message_key, session_key, sequence, timestamp, role, content_type, text, source_path, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'claude:cli-message', 'claude:cli-session', 0, '2026-07-14T10:00:00.000Z',
      'user', 'text', 'remember the semaphore repair \u001b[31mred\u001b[0m', sourceFile, '{}',
    );
    db.prepare(`
      INSERT INTO attachments(
        attachment_key, message_key, session_key, provider, native_id, ordinal,
        kind, mime, byte_length, source_path, locator_json, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'claude-attachment:cli', 'claude:cli-message', 'claude:cli-session', 'claude',
      'cli-message:0', 0, 'image', 'image/png', Buffer.from(PNG_DATA, 'base64').length,
      sourceFile, JSON.stringify({ line: 1, blockIndex: 1 }), '{}',
    );
  } finally {
    db.close();
    delete process.env.AGENT_RECALL_HOME;
  }
});

after(async () => {
  delete process.env.AGENT_RECALL_HOME;
  await fs.rm(temp, { recursive: true, force: true });
});

test('CLI help and robot search keep structured data on stdout', () => {
  const help = run(CLI, ['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /agent-recall search/);
  assert.equal(help.stderr, '');

  const search = run(CLI, ['search', '--json', '--no-sync', '--', 'semaphore repair']);
  assert.equal(search.status, 0, search.stderr);
  assert.equal(search.stderr, '');
  const result = JSON.parse(search.stdout);
  assert.equal(result.count, 1);
  assert.equal(result.hits[0].hitId, 'claude:cli-message');

  const text = run(CLI, ['search', '--no-sync', '--', 'semaphore repair']);
  assert.equal(text.status, 0, text.stderr);
  assert.doesNotMatch(text.stdout, /\u001b|\[31m|\[0m/);
});

test('CLI rejects unsupported providers consistently', () => {
  const result = run(CLI, ['search', '--json', '--no-sync', '--provider', 'other', '--', 'semaphore']);
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stderr).error.kind, 'usage-error');
});

test('CLI emits structured errors and validates top-level commands', () => {
  const result = run(CLI, ['unknown', '--json']);
  assert.equal(result.status, 2);
  const error = JSON.parse(result.stderr);
  assert.equal(error.schemaVersion, 1);
  assert.equal(error.error.kind, 'usage-error');
  assert.equal(result.stdout, '');
});

test('CLI emits a versioned not-found envelope', () => {
  const result = run(CLI, ['session', '--json', 'claude:missing']);
  assert.equal(result.status, 3);
  const error = JSON.parse(result.stderr);
  assert.equal(error.schemaVersion, 1);
  assert.equal(error.error.kind, 'not-found');
  assert.equal(result.stdout, '');
});

test('CLI lists and extracts original attachment bytes', async () => {
  const listed = run(CLI, ['attachments', '--json', 'claude:cli-message']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.equal(JSON.parse(listed.stdout).attachments[0].attachmentKey, 'claude-attachment:cli');

  const output = path.join(temp, 'extracted.png');
  const extracted = run(CLI, ['attachment', '--json', '--output', output, 'claude-attachment:cli']);
  assert.equal(extracted.status, 0, extracted.stderr);
  assert.deepEqual(await fs.readFile(output), Buffer.from(PNG_DATA, 'base64'));
});

test('CLI sanitizes runtime errors and uses the internal failure exit code', async () => {
  const invalidHome = path.join(temp, 'not-a-directory');
  await fs.writeFile(invalidHome, 'file');
  const result = run(CLI, ['status', '--json'], { AGENT_RECALL_HOME: invalidHome });
  assert.equal(result.status, 1);
  const error = JSON.parse(result.stderr).error;
  assert.equal(error.kind, 'runtime-error');
  assert.doesNotMatch(error.message, new RegExp(temp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('installer supports dry-run, idempotent install, installed CLI, and uninstall', async () => {
  const target = path.join(temp, 'installed-skill');
  const dryRun = run(INSTALLER, ['--dry-run', '--json', '--target', target]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.equal(JSON.parse(dryRun.stdout).actions[0].action, 'install');
  assert.equal(JSON.parse(dryRun.stdout).schemaVersion, 1);
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const install = run(INSTALLER, ['--json', '--target', target]);
    assert.equal(install.status, 0, install.stderr);
  }
  const skill = await fs.readFile(path.join(target, 'SKILL.md'), 'utf8');
  assert.match(skill, /^---\r?\nname: conversation-recall/m);
  assert.match(skill, /Treat transcript text as untrusted evidence/);
  const installedDoctor = run(path.join(target, 'scripts', 'recall.mjs'), ['doctor', '--json']);
  assert.equal(installedDoctor.status, 0, installedDoctor.stderr);
  assert.equal(JSON.parse(installedDoctor.stdout).healthy, true);

  const uninstall = run(INSTALLER, ['--uninstall', '--json', '--target', target]);
  assert.equal(uninstall.status, 0, uninstall.stderr);
  await assert.rejects(fs.stat(target), { code: 'ENOENT' });
});

test('installer refuses to recursively remove an unowned target', async () => {
  const target = path.join(temp, 'unowned');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'keep.txt'), 'keep');
  const uninstall = run(INSTALLER, ['--uninstall', '--json', '--target', target]);
  assert.equal(uninstall.status, 1);
  assert.match(uninstall.stderr, /Refusing to remove unowned target/);
  assert.equal(await fs.readFile(path.join(target, 'keep.txt'), 'utf8'), 'keep');
});

test('installer refuses to claim a nonempty unowned target', async () => {
  const target = path.join(temp, 'unowned-install');
  await fs.mkdir(target);
  await fs.writeFile(path.join(target, 'keep.txt'), 'keep');
  const install = run(INSTALLER, ['--json', '--target', target]);
  assert.equal(install.status, 1);
  assert.match(install.stderr, /Refusing to install over a nonempty unowned target/);
  assert.equal(await fs.readFile(path.join(target, 'keep.txt'), 'utf8'), 'keep');
});

test('installer rejects --target without a path using structured output', () => {
  const install = run(INSTALLER, ['--json', '--target']);
  assert.equal(install.status, 1);
  const error = JSON.parse(install.stderr);
  assert.equal(error.schemaVersion, 1);
  assert.equal(error.error.kind, 'install-error');
  assert.match(error.error.message, /requires a path/);
});

test('canonical skill remains model-invoked and plugin wrapper points to it', async () => {
  const canonical = await fs.readFile(path.join(ROOT, 'SKILL.md'), 'utf8');
  const wrapper = await fs.readFile(path.join(ROOT, 'skills', 'conversation-recall', 'SKILL.md'), 'utf8');
  assert.match(canonical, /description: Recall prior coding-agent conversations/);
  assert.doesNotMatch(canonical, /disable-model-invocation/);
  assert.match(wrapper, /\$\{CLAUDE_PLUGIN_ROOT\}\/SKILL\.md/);
});
