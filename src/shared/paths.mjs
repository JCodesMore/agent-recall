import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APP } from './config.mjs';

// AGENT_RECALL_SOURCE_HOME points every provider at a fake home; tests build real layouts there.
function sourceHome() {
  return process.env.AGENT_RECALL_SOURCE_HOME ? path.resolve(process.env.AGENT_RECALL_SOURCE_HOME) : os.homedir();
}

function isolated() {
  return Boolean(process.env.AGENT_RECALL_SOURCE_HOME);
}

function envDir(name) {
  return !isolated() && process.env[name] ? path.resolve(process.env[name]) : null;
}

// Per-platform application data directory (Claude desktop keeps its sessions here).
function appDataDir() {
  const home = sourceHome();
  if (process.platform === 'win32') return envDir('APPDATA') ?? path.join(home, 'AppData', 'Roaming');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support');
  return envDir('XDG_CONFIG_HOME') ?? path.join(home, '.config');
}

export function sourceRoots() {
  const home = sourceHome();
  const claudeHome = envDir('CLAUDE_CONFIG_DIR') ?? path.join(home, '.claude');
  const codexHome = envDir('CODEX_HOME') ?? path.join(home, '.codex');
  const dataHome = envDir('XDG_DATA_HOME') ?? path.join(home, '.local', 'share');
  const claudeDesktop = path.join(appDataDir(), 'Claude');
  return {
    home,
    claudeHome,
    claudeProjects: path.join(claudeHome, 'projects'),
    claudeSettings: path.join(claudeHome, 'settings.json'),
    claudeDesktopSessions: path.join(claudeDesktop, 'claude-code-sessions'),
    claudeCowork: path.join(claudeDesktop, 'local-agent-mode-sessions'),
    codexHome,
    codexSessions: path.join(codexHome, 'sessions'),
    codexArchived: path.join(codexHome, 'archived_sessions'),
    codexSessionIndex: path.join(codexHome, 'session_index.jsonl'),
    opencodeHome: path.join(dataHome, 'opencode'),
    cursorProjects: path.join(home, '.cursor', 'projects'),
    cursorChats: path.join(home, '.cursor', 'chats'),
    cursorState: path.join(appDataDir(), 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
  };
}

export function dataHome() {
  if (process.env.AGENT_RECALL_HOME) return path.resolve(process.env.AGENT_RECALL_HOME);
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), APP.NAME);
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', APP.NAME);
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), APP.NAME);
}

export function databasePath() {
  return path.join(dataHome(), APP.DB_FILE);
}

export function ensureDataHome() {
  const dir = dataHome();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

// Paths under home print as ~/...; the full path stays available with --json.
export function displayPath(value) {
  if (!value) return null;
  const home = os.homedir();
  const normalized = path.normalize(value);
  const lower = process.platform === 'win32' ? s => s.toLowerCase() : s => s;
  if (lower(normalized) === lower(home)) return '~';
  if (lower(normalized).startsWith(lower(home + path.sep))) return `~${path.sep}${normalized.slice(home.length + 1)}`;
  return normalized;
}

// Comparable form of a directory for project matching: forward slashes, no trailing slash,
// lower case on case-insensitive platforms.
export function comparablePath(value) {
  if (!value) return '';
  let text = String(value).replaceAll('\\', '/').replace(/\/+$/, '');
  if (/^[a-z]:/i.test(text)) text = text[0].toLowerCase() + text.slice(1);
  return process.platform === 'win32' || process.platform === 'darwin' ? text.toLowerCase() : text;
}

export function isWithin(child, parent) {
  const c = comparablePath(child);
  const p = comparablePath(parent);
  return Boolean(c && p) && (c === p || c.startsWith(`${p}/`));
}

export function projectName(cwd) {
  if (!cwd) return null;
  const parts = String(cwd).replace(/[\\/]+$/, '').split(/[\\/]/);
  return parts.at(-1) || null;
}
