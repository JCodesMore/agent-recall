import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DATABASE } from './config.mjs';

export function dataHome() {
  if (process.env.AGENT_RECALL_HOME) return path.resolve(process.env.AGENT_RECALL_HOME);
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'agent-recall');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'agent-recall');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'agent-recall');
}

export function databasePath() {
  return path.join(dataHome(), DATABASE.FILE);
}

export async function ensureDataHome() {
  const dir = dataHome();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  if (process.platform !== 'win32') await fs.chmod(dir, 0o700);
  return dir;
}

export function displayPath(value) {
  if (!value) return null;
  const home = os.homedir();
  const normalized = path.normalize(value);
  if (normalized === home) return '~';
  if (normalized.startsWith(home + path.sep)) return `~${path.sep}${path.relative(home, normalized)}`;
  if (path.isAbsolute(normalized)) return `<external>${path.sep}${path.basename(normalized)}`;
  return normalized;
}

export async function safeReaddir(dir, options = {}) {
  try {
    return await fs.readdir(dir, options);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') return [];
    throw error;
  }
}

export async function safeStat(file) {
  try {
    return await fs.stat(file);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') return null;
    throw error;
  }
}
