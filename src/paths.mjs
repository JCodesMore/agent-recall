import fs from 'node:fs/promises';
import path from 'node:path';
import { PATHS, TRANSCRIPT } from './config.mjs';

export function indexHome() {
  return process.env.CLAUDE_SEARCH_HOME || PATHS.INDEX_HOME;
}

export async function ensureIndexHome() {
  const dir = indexHome();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function sessionIdFromFile(filePath) {
  const base = path.basename(filePath, TRANSCRIPT.JSONL_EXT);
  const m = base.match(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
  return m ? m[0] : base;
}

export function decodeProjectDir(name) {
  if (!name) return name;
  if (/^[A-Za-z]--/.test(name)) {
    const drive = name[0].toUpperCase();
    return `${drive}:\\${name.slice(3).replaceAll('-', '\\')}`;
  }
  return '/' + name.replaceAll('-', '/');
}

async function safeReaddir(dir, opts) {
  try { return await fs.readdir(dir, opts); }
  catch (err) { if (err.code === 'ENOENT') return []; throw err; }
}

async function findTranscriptsInProject(projectDir) {
  const entries = await safeReaddir(projectDir, { withFileTypes: true });
  const topLevel = [];
  const subagent = [];
  for (const e of entries) {
    const full = path.join(projectDir, e.name);
    if (e.isFile() && e.name.endsWith(TRANSCRIPT.JSONL_EXT)) {
      topLevel.push({ file: full, sessionId: sessionIdFromFile(full), project: projectDir, isSubagent: false });
    } else if (e.isDirectory()) {
      const subagentDir = path.join(full, TRANSCRIPT.SUBAGENT_DIR);
      const subEntries = await safeReaddir(subagentDir, { withFileTypes: true });
      for (const s of subEntries) {
        if (s.isFile() && s.name.startsWith(TRANSCRIPT.SUBAGENT_PREFIX) && s.name.endsWith(TRANSCRIPT.JSONL_EXT)) {
          subagent.push({
            file: path.join(subagentDir, s.name),
            sessionId: sessionIdFromFile(full),
            project: projectDir,
            isSubagent: true,
            subagentName: path.basename(s.name, TRANSCRIPT.JSONL_EXT),
          });
        }
      }
    }
  }
  return [...topLevel, ...subagent];
}

export async function listTranscripts({ root = PATHS.PROJECTS_ROOT } = {}) {
  const projects = await safeReaddir(root, { withFileTypes: true });
  const out = [];
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const projectDir = path.join(root, p.name);
    const files = await findTranscriptsInProject(projectDir);
    out.push(...files);
  }
  return out;
}

export function displayProject(projectDir) {
  const name = path.basename(projectDir);
  return decodeProjectDir(name);
}
