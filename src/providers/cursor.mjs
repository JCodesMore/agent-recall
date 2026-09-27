import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KINDS, LIMITS, PROVIDERS, RECALL_INVOCATION, ROLES, SYNC } from '../shared/config.mjs';
import { maxIso, minIso } from '../shared/ids.mjs';
import { oneLine } from '../shared/text.mjs';
import { parseJsonlSource, pushMessage, sessionState, touch } from './builder.mjs';
import { listDir, statOrNull } from './fsutil.mjs';
import { toolSummary } from './tools.mjs';

/**
 * Cursor agent transcripts: ~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl with
 * subagents in <id>/subagents/<child>.jsonl. Records are {role, message: {content: [...]}} with
 * no timestamps, cwd or titles; those come from the slug, file times, <timestamp> tags Cursor
 * puts in user turns, and the IDE's composerHeaders table (labels).
 */
const PROVIDER = PROVIDERS.CURSOR;

// Folder Cursor uses for a window with no workspace open.
const NO_WORKSPACE_SLUG = 'empty-window';
const QUERY = /<user_query>([\s\S]*?)(?:<\/user_query>|$)/g;
// Context Cursor injects around the query (<timestamp>, <attached_files>, <git_status>, ...).
const LEADING_BLOCK = /^\s*<([A-Za-z_][\w-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/;
const IMAGE_MARKER = /^\s*\[Image\]\s*$/gim;
// Prompts Cursor writes itself, as user queries, when a subagent or background task finishes.
const NOISE_PROMPTS = [/^Perform any necessary follow-up actions in response to /, /^Briefly inform the user about the task result/];
// "Friday, Sep 11, 2026, 9:25 PM (UTC-5)"
const STAMP = /<timestamp>\s*(?:\w+,\s*)?([A-Za-z]{3})\w*\s+(\d{1,2}),\s*(\d{4}),\s*(\d{1,2}):(\d{2})\s*([AP]M)\s*\(UTC(?:([+-])(\d{1,2})(?::?(\d{2}))?)?\)\s*<\/timestamp>/i;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const CLI_RESUME = 'cursor-agent';

// Cursor tool names mapped onto the names the shared summarizer knows.
const TOOL_ALIASES = new Map([
  ['readfile', 'read'], ['strreplace', 'str_replace'], ['delete', 'delete_file'], ['applypatch', 'apply_patch'], ['rg', 'grep'],
]);

export function stampIso(text) {
  const match = String(text ?? '').match(STAMP);
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toLowerCase());
  if (month === -1) return null;
  const hour = (Number(match[4]) % 12) + (match[6].toUpperCase() === 'PM' ? 12 : 0);
  const offsetMinutes = match[7] ? (match[7] === '-' ? -1 : 1) * (Number(match[8]) * 60 + Number(match[9] ?? 0)) : 0;
  const ms = Date.UTC(Number(match[3]), month, Number(match[2]), hour, Number(match[5])) - offsetMinutes * 60_000;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// What the user typed: the <user_query> body, or the text left after injected blocks.
export function userQuery(raw) {
  const text = String(raw ?? '');
  if (text.includes('<user_query>')) {
    return [...text.matchAll(QUERY)].map(match => match[1].trim())
      .filter(query => query && !NOISE_PROMPTS.some(pattern => pattern.test(query))).join('\n');
  }
  let rest = text.replace(IMAGE_MARKER, '');
  for (let match = rest.match(LEADING_BLOCK); match; match = rest.match(LEADING_BLOCK)) rest = rest.slice(match[0].length);
  return rest.trim();
}

function summarize(name, input) {
  const key = String(name ?? '').toLowerCase();
  const object = input && typeof input === 'object' ? input : {};
  if (key === 'callmcptool' || key === 'call_mcp_tool' || key === 'calldynamictool') {
    const server = object.server ?? object.namespace;
    if (server && object.toolName) return toolSummary(`mcp__${server}__${object.toolName}`, object.arguments);
  }
  if (key === 'websearch' && object.search_term) return toolSummary('web_search', { query: object.search_term });
  return toolSummary(TOOL_ALIASES.get(key) ?? name, input);
}

function handleUser(state, content, out) {
  const texts = content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text);
  const ts = texts.map(stampIso).find(Boolean) ?? null;
  touch(state, ts);
  const text = texts.map(userQuery).filter(Boolean).join('\n');
  const image = texts.some(value => /^\s*\[Image\]\s*$/im.test(value));
  if (text || image) pushMessage(state, out, { role: ROLES.USER, text: text || '[image]', ts });
}

function handleAssistant(state, content, out) {
  for (const block of content) {
    if (block?.type === 'text') pushMessage(state, out, { role: ROLES.ASSISTANT, text: block.text });
    else if (block?.type === 'tool_use') {
      const summary = summarize(block.name, block.input);
      const recall = RECALL_INVOCATION.test(summary);
      pushMessage(state, out, { role: ROLES.ASSISTANT, kind: KINDS.TOOL, text: summary, meta: recall ? { recall: true } : undefined });
    }
  }
}

const parser = {
  init(source) {
    const meta = source.meta ?? {};
    const stem = path.basename(source.path, '.jsonl');
    return sessionState({
      provider: PROVIDER,
      nativeId: meta.parentNativeId ? `${meta.parentNativeId}:${stem}` : stem,
      parentNativeId: meta.parentNativeId ?? null,
    });
  },

  record(state, record, position, out) {
    const content = record.message?.content;
    if (!Array.isArray(content)) return;
    if (record.role === 'user') handleUser(state, content, out);
    else if (record.role === 'assistant') handleAssistant(state, content, out);
  },

  // cwd and origin come from discovery, not the state, so a later sync can refine them.
  finish(state, source) {
    const meta = source.meta ?? {};
    const cwd = meta.cwd ?? null;
    const origin = meta.origin ?? 'ide';
    return [{
      nativeId: state.nativeId,
      parentNativeId: state.parentNativeId,
      kind: state.parentNativeId ? 'subagent' : 'main',
      title: state.firstPrompt,
      titleSource: state.firstPrompt ? 'prompt' : null,
      firstPrompt: state.firstPrompt,
      cwd,
      gitBranch: null,
      model: null,
      origin,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      archived: false,
      // Only CLI chats (~/.cursor/chats) can be resumed; IDE agent chats have no command.
      resume: origin === 'cli' ? { command: CLI_RESUME, args: ['--resume', state.parentNativeId ?? state.nativeId], cwd } : null,
      meta: {},
    }];
  },
};

// Transcripts carry no times: the first <timestamp> tag or file birth bounds the start, the
// file mtime the end.
function fileTimes(stat) {
  if (!stat) return { created: null, updated: null };
  const updated = stat.mtimeMs > 0 ? new Date(stat.mtimeMs).toISOString() : null;
  const born = stat.birthtimeMs > 0 && stat.birthtimeMs <= stat.mtimeMs ? stat.birthtimeMs : stat.mtimeMs;
  return { created: born > 0 ? new Date(born).toISOString() : null, updated };
}

const nameTokens = name => String(name).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const sameToken = process.platform === 'win32' || process.platform === 'darwin'
  ? (a, b) => a.toLowerCase() === b.toLowerCase()
  : (a, b) => a === b;

// Deepest directory under `dir` whose names spell tokens[index...]; hyphens and dots in real
// folder names make the slug ambiguous, so the filesystem decides.
async function probe(dir, tokens, index) {
  let best = { dir, used: index };
  if (index === tokens.length) return best;
  const candidates = [];
  for (const entry of await listDir(dir)) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const parts = nameTokens(entry.name);
    if (!parts.length || index + parts.length > tokens.length) continue;
    if (parts.every((part, offset) => sameToken(part, tokens[index + offset]))) candidates.push({ name: entry.name, size: parts.length });
  }
  candidates.sort((a, b) => b.size - a.size);
  for (const candidate of candidates) {
    const found = await probe(path.join(dir, candidate.name), tokens, index + candidate.size);
    if (found.used === tokens.length) return found;
    if (found.used > best.used) best = found;
  }
  return best;
}

// "c-Users-me-Projects-my-app" -> C:\Users\me\Projects\my-app. A folder that no longer exists
// keeps its unmatched tail as one hyphenated name.
export async function slugCwd(slug) {
  if (slug === NO_WORKSPACE_SLUG) return null;
  const tokens = nameTokens(slug);
  if (!tokens.length) return null;
  let root = path.sep;
  if (process.platform === 'win32') {
    if (!/^[a-z]$/i.test(tokens[0])) return null;
    root = `${tokens.shift().toUpperCase()}:\\`;
  }
  const found = await probe(root, tokens, 0);
  const rest = tokens.slice(found.used);
  return rest.length ? path.join(found.dir, rest.join('-')) : found.dir;
}

// Session ids that have a cursor-agent CLI chat store (~/.cursor/chats/<hash>/<id>/).
async function cliChatIds(chatsRoot) {
  const ids = new Set();
  if (!chatsRoot) return ids;
  for (const workspace of await listDir(chatsRoot)) {
    if (!workspace.isDirectory()) continue;
    for (const chat of await listDir(path.join(chatsRoot, workspace.name))) if (chat.isDirectory()) ids.add(chat.name);
  }
  return ids;
}

function jsonlSource(file, meta) {
  return { provider: PROVIDER, path: file, kind: 'jsonl', meta };
}

function parseValue(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

export const cursorProvider = {
  id: PROVIDER,

  async discover(roots) {
    const cliChats = await cliChatIds(roots.cursorChats);
    const projects = (await listDir(roots.cursorProjects)).filter(entry => entry.isDirectory());
    const perProject = await Promise.all(projects.map(async project => {
      const transcripts = path.join(roots.cursorProjects, project.name, 'agent-transcripts');
      const sessions = (await listDir(transcripts)).filter(entry => entry.isDirectory());
      if (!sessions.length) return [];
      const cwd = await slugCwd(project.name);
      const perSession = await Promise.all(sessions.map(async session => {
        const dir = path.join(transcripts, session.name);
        const origin = cliChats.has(session.name) ? 'cli' : 'ide';
        const [entries, children] = await Promise.all([listDir(dir), listDir(path.join(dir, 'subagents'))]);
        return [
          ...entries.filter(entry => entry.isFile() && entry.name === `${session.name}.jsonl`)
            .map(entry => jsonlSource(path.join(dir, entry.name), { cwd, origin })),
          ...children.filter(child => child.isFile() && child.name.endsWith('.jsonl'))
            .map(child => jsonlSource(path.join(dir, 'subagents', child.name), { cwd, origin, parentNativeId: session.name })),
        ];
      }));
      return perSession.flat();
    }));
    return perProject.flat();
  },

  // Titles, archive flags and workspace folders from the IDE's composer headers. Throws
  // rather than returning nothing when the store is unreadable, so old labels survive.
  // Cursor versions before composer headers keep no labels there; titles then come from prompts.
  async labels(roots) {
    if (!roots.cursorState || !(await statOrNull(roots.cursorState))) return [];
    const db = new DatabaseSync(roots.cursorState, { readOnly: true, timeout: SYNC.BUSY_TIMEOUT_MS });
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'composerHeaders'").get()) return [];
      const labels = [];
      for (const row of db.prepare('SELECT composerId, isArchived, isSubagent, subagentTypeName, value FROM composerHeaders').all()) {
        const value = parseValue(row.value) ?? {};
        const parent = row.isSubagent ? value.subagentInfo?.parentComposerId : null;
        const folder = value.workspaceIdentifier?.uri?.fsPath;
        const title = typeof value.name === 'string' && value.name.trim() ? oneLine(value.name, LIMITS.TITLE_MAX_CHARS) : null;
        labels.push({
          nativeId: parent ? `${parent}:${row.composerId}` : String(row.composerId),
          title,
          titleSource: title ? 'generated' : null,
          archived: Boolean(row.isArchived),
          cwd: typeof folder === 'string' && folder && !folder.endsWith('.code-workspace') ? folder : null,
          meta: row.subagentTypeName ? { agentType: row.subagentTypeName } : undefined,
        });
      }
      return labels;
    } finally {
      db.close();
    }
  },

  async parse(source, cursor) {
    const parsed = await parseJsonlSource(source, cursor, parser);
    const { created, updated } = fileTimes(await statOrNull(source.path));
    for (const session of parsed.sessions) {
      session.createdAt = minIso(session.createdAt, created);
      session.updatedAt = maxIso(session.updatedAt ?? session.createdAt, updated);
    }
    return parsed;
  },

  async readAttachment() {
    return null;
  },
};
