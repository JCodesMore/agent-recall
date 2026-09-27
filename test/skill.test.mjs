import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { COMMAND_ALIASES, COMMANDS, parseArgs } from '../src/cli/args.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const skill = read('SKILL.md');

function frontmatter(text) {
  const block = text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';
  return Object.fromEntries(block.split('\n').map(line => line.match(/^([a-z-]+):\s*(.*)$/)).filter(Boolean).map(m => [m[1], m[2]]));
}

test('SKILL.md is the only skill and its frontmatter is valid', () => {
  const meta = frontmatter(skill);
  assert.equal(meta.name, 'agent-recall');
  assert.ok(meta.description.length > 50 && meta.description.length <= 1024);
  const others = fs.globSync('**/SKILL.md', { cwd: root, exclude: name => name === 'node_modules' || name === '.git' });
  assert.deepEqual(others, ['SKILL.md']);
});

test('every file SKILL.md links to exists', () => {
  for (const [, target] of skill.matchAll(/\]\(([^)#]+)\)/g)) assert.ok(fs.existsSync(path.join(root, target)), target);
});

test('every command SKILL.md shows parses against the CLI', () => {
  const lines = [...skill.matchAll(/recall\.mjs"?\s+([^\n`]+)/g)].map(match => match[1].trim());
  assert.ok(lines.length >= 4);
  for (const line of lines) {
    const [name, ...args] = line.replace(/<[^>]+>/g, 'x').split(/\s+/).filter(Boolean);
    if (name === '<command>' || name === 'x') continue;
    const command = COMMAND_ALIASES[name] ?? name;
    assert.ok(COMMANDS[command], `unknown command in SKILL.md: ${line}`);
    assert.doesNotThrow(() => parseArgs(command, args), line);
  }
  for (const [, inline] of skill.matchAll(/`((?:search|read|recent|show|attachment|doctor|sync)\b[^`]*)`/g)) {
    const [name, ...args] = inline.replace(/[[\]]/g, '').replace(/[A-Z]{2,}|<[^>]+>/g, 'x').split(/\s+/).filter(Boolean);
    assert.doesNotThrow(() => parseArgs(name, args), inline);
  }
});

test('manifests carry the package version and point at real files', () => {
  const { version } = JSON.parse(read('package.json'));
  const plugin = JSON.parse(read('.claude-plugin/plugin.json'));
  const market = JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(plugin.version, version);
  assert.equal(market.metadata.version, version);
  assert.equal(market.plugins[0].version, version);
  for (const dir of plugin.skills) assert.ok(fs.existsSync(path.join(root, dir, 'SKILL.md')));
  const hooks = read('hooks/hooks.json');
  for (const [, script] of hooks.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)/g)) assert.ok(fs.existsSync(path.join(root, script)), script);
});
