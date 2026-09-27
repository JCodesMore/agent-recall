import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, VERSION } from '../shared/config.mjs';
import { comparablePath } from '../shared/paths.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = '.agent-recall-install.json';
const LEGACY_NAME = 'conversation-recall';
// What an installed skill needs. Everything else in a target folder belongs to the user.
const SHIPPED = ['SKILL.md', 'LICENSE', 'package.json', 'agents', 'references', 'scripts/recall.mjs', 'src'];

function listFiles(relative) {
  const full = path.join(ROOT, relative);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [relative];
  return fs.readdirSync(full, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(ROOT, path.join(entry.parentPath, entry.name)));
}

function readMarker(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, MARKER), 'utf8'));
  } catch {
    return null;
  }
}

function linkTarget(dir) {
  try {
    return fs.lstatSync(dir).isSymbolicLink() ? fs.realpathSync(dir) : null;
  } catch {
    return null;
  }
}

export function defaultTargets(home = os.homedir()) {
  return {
    primary: path.join(home, '.agents', 'skills', APP.NAME),
    links: [path.join(home, '.claude', 'skills', APP.NAME)],
    legacy: [path.join(home, '.agents', 'skills', LEGACY_NAME), path.join(home, '.claude', 'skills', LEGACY_NAME)],
  };
}

// Copies shipped files into `dir`, removes files a previous install shipped that this one no
// longer does, and leaves every other file alone.
function installCopy(dir, files, actions, dryRun) {
  const previous = readMarker(dir);
  const owned = new Set((previous?.files ?? []).map(file => file.replaceAll('\\', '/')));
  const next = new Set(files.map(file => file.replaceAll('\\', '/')));
  actions.push({ action: previous ? 'update' : 'install', target: dir, files: files.length });
  if (dryRun) return;
  // v1 markers listed no files, but src/ was always entirely the installer's.
  if (previous && !previous.files) fs.rmSync(path.join(dir, 'src'), { recursive: true, force: true });
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), path.join(dir, file));
  }
  for (const stale of owned) {
    if (!next.has(stale)) fs.rmSync(path.join(dir, stale), { force: true });
  }
  fs.writeFileSync(path.join(dir, MARKER), `${JSON.stringify({ name: APP.NAME, version: 2, release: VERSION, files: [...next].sort() }, null, 2)}\n`);
}

function removeOwned(dir, actions, dryRun) {
  const marker = readMarker(dir);
  if (!marker) return;
  actions.push({ action: 'remove', target: dir });
  if (dryRun) return;
  for (const file of marker.files ?? []) fs.rmSync(path.join(dir, file), { force: true });
  fs.rmSync(path.join(dir, MARKER), { force: true });
  // v1 markers listed no files; the folder was entirely ours.
  if (!marker.files) fs.rmSync(dir, { recursive: true, force: true });
  else removeEmptyDirs(dir);
}

// Removes the link itself, never what it points to.
function removeLink(link) {
  try {
    fs.unlinkSync(link);
  } catch {
    fs.rmdirSync(link);
  }
}

function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name));
  if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

function isLink(dir) {
  try {
    return fs.lstatSync(dir).isSymbolicLink();
  } catch {
    return false;
  }
}

// Same folder after resolving links; a missing folder compares by its path.
function sameDir(a, b) {
  const real = dir => (fs.existsSync(dir) ? fs.realpathSync(dir) : dir);
  return comparablePath(real(a)) === comparablePath(real(b));
}

// A second skill folder (Claude's) becomes a link to the primary copy, so there is one copy
// to update. A link the user pointed elsewhere (a dev checkout) is left alone: nothing is
// ever written through it. Falls back to a copy where links are not allowed.
function installLink(link, primary, files, actions, dryRun) {
  if (isLink(link)) {
    if (sameDir(link, primary)) actions.push({ action: 'linked', target: link, to: primary });
    else actions.push({ action: 'skipped', target: link, reason: `it links to ${linkTarget(link) ?? 'a missing folder'}` });
    return;
  }
  if (fs.existsSync(link)) {
    installCopy(link, files, actions, dryRun);
    return;
  }
  actions.push({ action: 'link', target: link, to: primary });
  if (dryRun) return;
  fs.mkdirSync(path.dirname(link), { recursive: true });
  try {
    fs.symlinkSync(primary, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch {
    actions.pop();
    installCopy(link, files, actions, dryRun);
  }
}

function startFirstIndex(dir) {
  try {
    spawn(process.execPath, [path.join(dir, 'scripts', 'recall.mjs'), 'sync', '--quiet'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
    // The first search builds the index instead.
  }
}

/**
 * Installs the skill for every agent on this machine: a copy in ~/.agents/skills (Codex,
 * OpenCode, Cursor and others) and a link from ~/.claude/skills. Idempotent; keeps files it
 * did not write. `targets` replaces the defaults with explicit folders.
 */
export async function install({ targets, dryRun = false, uninstall = false, agentsOnly = false, home, index = true } = {}) {
  const files = SHIPPED.flatMap(listFiles);
  const defaults = defaultTargets(home);
  const explicit = targets?.map(target => path.resolve(target));
  const actions = [];

  if (uninstall) {
    for (const dir of explicit ?? [...defaults.links, defaults.primary, ...defaults.legacy]) {
      if (isLink(dir) && !explicit) {
        actions.push({ action: 'unlink', target: dir });
        if (!dryRun) removeLink(dir);
      } else removeOwned(dir, actions, dryRun);
    }
    return { dryRun, actions };
  }

  for (const dir of explicit ?? [defaults.primary]) {
    if (sameDir(dir, ROOT)) continue;
    installCopy(dir, files, actions, dryRun);
  }
  if (!explicit) {
    if (!agentsOnly) for (const link of defaults.links) installLink(link, defaults.primary, files, actions, dryRun);
    for (const legacy of defaults.legacy) removeOwned(legacy, actions, dryRun);
  }
  if (!dryRun && index) startFirstIndex(explicit?.[0] ?? defaults.primary);
  return { dryRun, actions, version: VERSION };
}

export function renderInstall(result) {
  const lines = result.actions.map(item => `${item.action}: ${item.target}${item.to ? ` -> ${item.to}` : ''}${item.reason ? ` (${item.reason})` : ''}`);
  if (!result.dryRun && result.actions.some(item => ['install', 'update', 'link', 'linked'].includes(item.action))) {
    lines.push('', `Agent Recall ${result.version} is installed. The first index is building in the background.`);
    lines.push('Start a new chat with your agent and ask something like: "what did we decide about X last week?"');
  }
  return lines.join('\n');
}
