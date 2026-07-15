#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const SKILL_SOURCE = path.join(ROOT, 'SKILL.md');
const TARGET_NAME = 'agent-recall';
const LEGACY_TARGET_NAME = 'conversation-recall';
const MARKER = '.agent-recall-install.json';

function parseArgs(argv) {
  const options = { dryRun: false, uninstall: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--uninstall') options.uninstall = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--target') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new Error('--target requires a path');
      options.target = value;
    }
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function defaultTargets() {
  return [
    path.join(os.homedir(), '.agents', 'skills', TARGET_NAME),
    path.join(os.homedir(), '.claude', 'skills', TARGET_NAME),
  ];
}

function legacyTargets() {
  return [
    path.join(os.homedir(), '.agents', 'skills', LEGACY_TARGET_NAME),
    path.join(os.homedir(), '.claude', 'skills', LEGACY_TARGET_NAME),
  ];
}

async function copyTree(target) {
  await fs.mkdir(target, { recursive: true });
  await fs.copyFile(SKILL_SOURCE, path.join(target, 'SKILL.md'));
  await fs.cp(path.join(ROOT, 'src'), path.join(target, 'src'), { recursive: true, force: true });
  await fs.mkdir(path.join(target, 'scripts'), { recursive: true });
  for (const script of ['recall.mjs']) {
    await fs.copyFile(path.join(ROOT, 'scripts', script), path.join(target, 'scripts', script));
  }
  await fs.copyFile(path.join(ROOT, 'LICENSE'), path.join(target, 'LICENSE'));
  await fs.writeFile(path.join(target, 'package.json'), `${JSON.stringify({ type: 'module', private: true }, null, 2)}\n`);
  await fs.writeFile(path.join(target, MARKER), `${JSON.stringify({ name: TARGET_NAME, version: 1 }, null, 2)}\n`);
}

async function prepareInstall(target) {
  let entries;
  try {
    entries = await fs.readdir(target);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  if (entries.length === 0) return;
  try {
    const marker = JSON.parse(await fs.readFile(path.join(target, MARKER), 'utf8'));
    if (![TARGET_NAME, LEGACY_TARGET_NAME].includes(marker.name)) throw new Error('wrong owner');
  } catch {
    throw new Error(`Refusing to install over a nonempty unowned target: ${target}`);
  }
}

async function installAtomically(target) {
  const parent = path.dirname(target);
  const suffix = `${process.pid}-${randomUUID()}`;
  const stage = path.join(parent, `.${path.basename(target)}.stage-${suffix}`);
  const backup = path.join(parent, `.${path.basename(target)}.backup-${suffix}`);
  await fs.mkdir(parent, { recursive: true });
  let backedUp = false;
  try {
    await copyTree(stage);
    try {
      await fs.rename(target, backup);
      backedUp = true;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    try {
      await fs.rename(stage, target);
    } catch (error) {
      if (backedUp) await fs.rename(backup, target);
      throw error;
    }
    if (backedUp) await fs.rm(backup, { recursive: true, force: true });
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

async function inspectInstall(target, expectedName, action) {
  let marker;
  try {
    marker = JSON.parse(await fs.readFile(path.join(target, MARKER), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      try {
        await fs.stat(target);
      } catch (statError) {
        if (statError.code === 'ENOENT') return false;
        throw statError;
      }
      throw new Error(`Refusing to ${action} unowned target without ${MARKER}: ${target}`);
    }
    throw new Error(`Refusing to ${action} target with an invalid ${MARKER}: ${target}`);
  }
  const expectedNames = Array.isArray(expectedName) ? expectedName : [expectedName];
  if (!expectedNames.includes(marker.name)) {
    throw new Error(`Refusing to ${action} target owned by ${marker.name || 'an unknown installer'}: ${target}`);
  }
  return true;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: node scripts/install.mjs [--dry-run] [--uninstall] [--target PATH] [--json]\n');
    return;
  }
  const usingDefaultTargets = !options.target;
  const targets = options.target ? [path.resolve(options.target)] : defaultTargets();
  const legacy = usingDefaultTargets ? legacyTargets() : [];
  const actions = [];
  if (!options.uninstall) {
    for (const target of targets) await prepareInstall(target);
    for (const target of legacy) {
      if (await inspectInstall(target, LEGACY_TARGET_NAME, 'migrate')) {
        actions.push({ action: 'remove-legacy', target });
      }
    }
    actions.unshift(...targets.map(target => ({ action: 'install', target })));
  } else {
    for (const target of targets) {
      const owners = usingDefaultTargets ? TARGET_NAME : [TARGET_NAME, LEGACY_TARGET_NAME];
      if (await inspectInstall(target, owners, 'remove')) actions.push({ action: 'remove', target });
    }
    for (const target of legacy) {
      if (await inspectInstall(target, LEGACY_TARGET_NAME, 'remove')) actions.push({ action: 'remove', target });
    }
  }
  if (!options.dryRun) {
    if (options.uninstall) {
      for (const { target } of actions) await fs.rm(target, { recursive: true });
    } else {
      for (const target of targets) await installAtomically(target);
      for (const { target } of actions.filter(item => item.action === 'remove-legacy')) {
        await fs.rm(target, { recursive: true });
      }
    }
  }
  const result = { schemaVersion: 1, dryRun: options.dryRun, actions };
  process.stdout.write(`${options.json ? JSON.stringify(result) : actions.map(item => `${item.action}: ${item.target}`).join('\n')}\n`);
}

main().catch(error => {
  const json = process.argv.includes('--json');
  const output = { schemaVersion: 1, error: { kind: 'install-error', message: error.message } };
  process.stderr.write(`${json ? JSON.stringify(output) : `error: ${error.message}`}\n`);
  process.exitCode = 1;
});
