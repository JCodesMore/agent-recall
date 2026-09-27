import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KINDS, LIMITS, PROVIDERS, RECALL_INVOCATION, ROLES, SYNC } from '../shared/config.mjs';
import { decodeDataUrl } from '../shared/attachments.mjs';
import { asIso } from '../shared/ids.mjs';
import { oneLine, stripTags } from '../shared/text.mjs';
import { emptyOutput, pushAttachment, pushMessage, sessionState, touch } from './builder.mjs';
import { listDir } from './fsutil.mjs';
import { emptyDiagnostics } from './jsonl.mjs';
import { outputExcerpt, toolSummary } from './tools.mjs';

const PROVIDER = PROVIDERS.OPENCODE;

// opencode.db, plus per-channel databases such as opencode-dev.db.
const DATABASE_FILE = /^opencode.*\.db$/i;
// Harness text OpenCode injects into user parts.
const INJECTED_TAGS = ['system-reminder'];
// Placeholder titles OpenCode sets before it generates a real one.
const PLACEHOLDER_TITLE = /^(New|Child) session - \d{4}-\d{2}-\d{2}T/;

function parseData(text, diagnostics) {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch {
    // counted below
  }
  diagnostics.malformed += 1;
  return null;
}

// Session.model is JSON such as {"id":"gpt-5","providerID":"openai"} in current versions.
function sessionModel(value) {
  if (!value) return null;
  try {
    const model = JSON.parse(value);
    return typeof model === 'string' ? model : model?.id ?? model?.modelID ?? null;
  } catch {
    return String(value);
  }
}

function openDatabase(file) {
  return new DatabaseSync(file, { readOnly: true, timeout: SYNC.BUSY_TIMEOUT_MS });
}

function pushToolPart(state, out, part, ts) {
  const summary = toolSummary(part.tool, part.state?.input);
  const recall = RECALL_INVOCATION.test(summary);
  pushMessage(state, out, { role: ROLES.ASSISTANT, kind: KINDS.TOOL, text: summary, ts, meta: recall ? { recall: true } : undefined });
  // A recall lookup's output quotes other conversations, so it stays out of the index.
  if (recall) return;
  const status = part.state?.status;
  if (status === 'error') {
    pushMessage(state, out, { role: ROLES.TOOL, kind: KINDS.OUTPUT, text: outputExcerpt(part.state.error), ts, meta: { error: true } });
  } else if (status === 'completed') {
    pushMessage(state, out, { role: ROLES.TOOL, kind: KINDS.OUTPUT, text: outputExcerpt(part.state.output), ts });
  }
}

function handleUser(state, out, parts, ts) {
  const texts = [];
  const files = [];
  for (const { id, data } of parts) {
    if (data.type === 'text' && !data.synthetic && !data.ignored) texts.push(data.text);
    else if (data.type === 'file') files.push({ id, data });
    else if (data.type === 'subtask') {
      const input = { description: data.description, prompt: data.prompt, subagent_type: data.agent };
      pushMessage(state, out, { role: ROLES.USER, kind: KINDS.TOOL, text: toolSummary('task', input), ts });
    }
  }
  const text = stripTags(texts.join('\n'), INJECTED_TAGS);
  if (!text && files.length === 0) return;
  const label = files.length ? `[${files.map(file => file.data.filename || 'file').join(', ')}]` : '';
  const seq = pushMessage(state, out, { role: ROLES.USER, text: text || label, ts });
  files.forEach(({ id, data }, ordinal) => {
    pushAttachment(state, out, { seq, ordinal, dataUrl: data.url, locator: { part: id }, name: data.filename ?? null });
  });
}

function handleAssistant(state, out, message, parts, ts) {
  if (message.modelID) state.model = message.modelID;
  const kind = message.summary === true ? KINDS.SUMMARY : KINDS.TEXT;
  for (const { data } of parts) {
    const partTs = asIso(data.time?.start ?? data.state?.time?.start) ?? ts;
    if (data.type === 'text' && !data.synthetic && !data.ignored) {
      pushMessage(state, out, { role: ROLES.ASSISTANT, kind, text: data.text, ts: partTs });
    } else if (data.type === 'tool') {
      pushToolPart(state, out, data, partTs);
    }
  }
}

function partsByMessage(rows, diagnostics) {
  const byMessage = new Map();
  for (const row of rows) {
    const data = parseData(row.data, diagnostics);
    if (!data) continue;
    const list = byMessage.get(row.message_id) ?? [];
    list.push({ id: row.id, data });
    byMessage.set(row.message_id, list);
  }
  return byMessage;
}

function buildSession(row, queries, out, diagnostics) {
  const state = sessionState({
    provider: PROVIDER,
    nativeId: String(row.id),
    parentNativeId: row.parent_id ? String(row.parent_id) : null,
    model: sessionModel(row.model),
  });
  touch(state, asIso(row.time_created));
  touch(state, asIso(row.time_updated));
  const parts = partsByMessage(queries.parts.all(row.id), diagnostics);
  for (const messageRow of queries.messages.all(row.id)) {
    const message = parseData(messageRow.data, diagnostics);
    if (!message) continue;
    const ts = asIso(message.time?.created ?? messageRow.time_created);
    const messageParts = parts.get(messageRow.id) ?? [];
    if (message.role === 'user') handleUser(state, out, messageParts, ts);
    else if (message.role === 'assistant') handleAssistant(state, out, message, messageParts, ts);
    else diagnostics.skipped += 1;
  }
  const generated = row.title && !PLACEHOLDER_TITLE.test(row.title) ? oneLine(row.title, LIMITS.TITLE_MAX_CHARS) : null;
  const title = generated ?? state.firstPrompt;
  const cwd = row.directory || null;
  return {
    nativeId: state.nativeId,
    parentNativeId: state.parentNativeId,
    kind: state.parentNativeId ? 'subagent' : 'main',
    title: title ?? null,
    titleSource: generated ? 'generated' : title ? 'prompt' : null,
    firstPrompt: state.firstPrompt,
    cwd,
    gitBranch: null,
    model: state.model,
    origin: 'cli',
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    archived: row.time_archived !== null && row.time_archived !== undefined,
    resume: { command: 'opencode', args: ['--session', state.parentNativeId ?? state.nativeId], cwd },
    meta: state.parentNativeId && row.agent ? { agentType: row.agent } : {},
  };
}

export const opencodeProvider = {
  id: PROVIDER,

  async discover(roots) {
    const entries = await listDir(roots.opencodeHome);
    return entries
      .filter(entry => entry.isFile() && DATABASE_FILE.test(entry.name))
      .map(entry => ({ provider: PROVIDER, path: path.join(roots.opencodeHome, entry.name), kind: 'sqlite', meta: {} }))
      .sort((a, b) => a.path.localeCompare(b.path));
  },

  // The whole database is one source, re-checked when its size, mtime or WAL changes. With a
  // cursor only sessions whose version changed are returned (partial), plus removed ids, so a
  // running OpenCode does not cause a full re-index on every sync.
  // A busy or unreadable database throws, so sync reports it and keeps the previous index.
  async parse(source, cursor) {
    const db = openDatabase(source.path);
    try {
      const out = emptyOutput();
      const diagnostics = emptyDiagnostics();
      const queries = {
        messages: db.prepare('SELECT id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id'),
        parts: db.prepare('SELECT id, message_id, data FROM part WHERE session_id = ? ORDER BY message_id, id'),
      };
      const version = db.prepare("SELECT count(*) || ':' || coalesce(max(time_updated), 0) AS v FROM part WHERE session_id = ?");
      const previous = cursor?.state?.versions ?? null;
      const versions = {};
      const sessions = [];
      for (const row of db.prepare('SELECT * FROM session ORDER BY time_created, id').all()) {
        versions[row.id] = `${row.time_updated}:${row.title}:${row.time_archived}:${version.get(row.id).v}`;
        if (previous?.[row.id] === versions[row.id]) continue;
        sessions.push(buildSession(row, queries, out, diagnostics));
      }
      const removed = previous ? Object.keys(previous).filter(id => !(id in versions)) : [];
      return { sessions, messages: out.messages, attachments: out.attachments, cursor: { state: { versions } }, diagnostics, partial: Boolean(previous), removed };
    } finally {
      db.close();
    }
  },

  async readAttachment(source, locator) {
    const db = openDatabase(source.path);
    try {
      const row = db.prepare('SELECT data FROM part WHERE id = ?').get(String(locator?.part ?? ''));
      const data = row ? parseData(row.data, emptyDiagnostics()) : null;
      if (data?.type !== 'file') return null;
      return decodeDataUrl(data.url);
    } finally {
      db.close();
    }
  },
};
