import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { VALIDATION } from '../config.mjs';

const PARENT_TRAVERSAL = '..';

// Use the canonical Windows Terminal execution-alias path rather than `wt.exe`
// on PATH, because PATH may resolve to a shadowing exe of the same name
// (e.g. WinGet-installed worktrunk by max-sixty).
const WT_ALIAS_PATH = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe')
  : null;

const FILE_MANAGER = Object.freeze({
  win32:  { cmd: 'explorer.exe', args: (p) => [p] },
  darwin: { cmd: 'open',         args: (p) => [p] },
  linux:  { cmd: 'xdg-open',     args: (p) => [p] },
});

const TERMINAL_WIN = Object.freeze({
  wt:  (cwd, id) => ({ cmd: WT_ALIAS_PATH, args: ['-d', cwd, 'claude', '--resume', id] }),
  // windowsVerbatimArguments: the title must be quoted so `start` doesn't
  // parse it as the executable name. Letting Node auto-quote eats the
  // quotes around the title.
  cmd: (cwd, id) => ({
    cmd: 'cmd.exe',
    args: ['/c', `start "Claude" cmd.exe /k "claude --resume ${id}"`],
    opts: { cwd, windowsVerbatimArguments: true },
  }),
});

const TERMINAL_DARWIN = (cwd, id) => ({
  cmd: 'osascript',
  args: ['-e', `tell application "Terminal" to do script "cd ${shellQuote(cwd)} && claude --resume ${id}"`, '-e', 'tell application "Terminal" to activate'],
});

const TERMINAL_LINUX = Object.freeze({
  gnome:   (cwd, id) => ({ cmd: 'gnome-terminal', args: [`--working-directory=${cwd}`, '--', 'bash', '-lc', `claude --resume ${id}; exec bash`] }),
  konsole: (cwd, id) => ({ cmd: 'konsole',        args: ['--workdir', cwd, '-e', 'bash', '-lc', `claude --resume ${id}; exec bash`] }),
  xterm:   (cwd, id) => ({ cmd: 'xterm',          args: ['-e', `cd ${shellQuote(cwd)} && claude --resume ${id}; exec bash`] }),
});

function shellQuote(s) {
  return `'${String(s).replaceAll("'", `'\\''`)}'`;
}

export function assertSessionId(id) {
  if (typeof id !== 'string' || !VALIDATION.SESSION_ID_REGEX.test(id)) {
    throw new Error('invalid sessionId');
  }
  return id;
}

export async function assertDirectory(p) {
  if (typeof p !== 'string' || p.length === 0) throw new Error('path required');
  if (!path.isAbsolute(p)) throw new Error('path must be absolute');
  if (p.split(/[\\/]/).includes(PARENT_TRAVERSAL)) throw new Error('path must not contain ..');
  const stat = await fs.stat(p);
  if (!stat.isDirectory()) throw new Error('path is not a directory');
  return p;
}

function detach(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { ...opts, detached: true, stdio: 'ignore' });
    } catch (err) {
      reject(err);
      return;
    }
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

export async function openFolder(absPath) {
  await assertDirectory(absPath);
  const entry = FILE_MANAGER[process.platform];
  if (!entry) throw new Error(`unsupported platform: ${process.platform}`);
  await detach(entry.cmd, entry.args(absPath));
  return { mode: entry.cmd };
}

async function fileExists(p) {
  if (!p) return false;
  try { await fs.access(p); return true; } catch { return false; }
}

async function tryEach(candidates) {
  let lastErr;
  for (const c of candidates) {
    try {
      await detach(c.cmd, c.args, c.opts);
      return c.cmd;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      lastErr = err;
    }
  }
  throw lastErr || new Error('no terminal available');
}

export async function resumeSession({ sessionId, cwd }) {
  assertSessionId(sessionId);
  await assertDirectory(cwd);

  if (process.platform === 'win32') {
    const candidates = [];
    if (await fileExists(WT_ALIAS_PATH)) candidates.push(TERMINAL_WIN.wt(cwd, sessionId));
    candidates.push(TERMINAL_WIN.cmd(cwd, sessionId));
    const mode = await tryEach(candidates);
    return { mode };
  }
  if (process.platform === 'darwin') {
    const t = TERMINAL_DARWIN(cwd, sessionId);
    await detach(t.cmd, t.args);
    return { mode: t.cmd };
  }
  if (process.platform === 'linux') {
    const mode = await tryEach([
      TERMINAL_LINUX.gnome(cwd, sessionId),
      TERMINAL_LINUX.konsole(cwd, sessionId),
      TERMINAL_LINUX.xterm(cwd, sessionId),
    ]);
    return { mode };
  }
  throw new Error(`unsupported platform: ${process.platform}`);
}
