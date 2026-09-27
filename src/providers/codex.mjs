import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { KINDS, LIMITS, PROVIDERS, RECALL_INVOCATION, ROLES, SYNC } from '../shared/config.mjs';
import { decodeDataUrl } from '../shared/attachments.mjs';
import { asIso } from '../shared/ids.mjs';
import { oneLine, stripTags } from '../shared/text.mjs';
import { parseJsonlSource, pushAttachment, pushMessage, sessionState, touch } from './builder.mjs';
import { cleanUserText } from './claude.mjs';
import { readJsonlAt } from './jsonl.mjs';
import { listDir } from './fsutil.mjs';
import { outputExcerpt, toolSummary } from './tools.mjs';

const PROVIDER = PROVIDERS.CODEX;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// rollout-<stamp>-<thread id>[_<segment id>].jsonl: a long thread continues in segment files.
const ROLLOUT_NAME = new RegExp(`^rollout-.*?(${UUID})(?:_(${UUID}))?\\.jsonl$`, 'i');
const STATE_DB = /^state_(\d+)\.sqlite$/;

// Large records never read: compaction snapshots (half of all bytes), world state, reasoning,
// generated images, model-context copies of messages, and item mirrors of tool calls.
const SKIPPABLE = [
  /^\{[^{]{0,200}"type":"(?:compacted|world_state)"/,
  /^\{[^{]{0,200}"type":"response_item","payload":\{"type":"(?:reasoning"|image_generation_call"|compaction"|message",(?:"id":"[^"]*",)?"role":"(?!user"))/,
  /^\{[^{]{0,200}"type":"event_msg","payload":\{"type":"item_completed"[^{]{0,300}"item":\{"type":"(?!UserMessage"|AgentMessage"|Plan")/,
];

// Context Codex and its hosts wrap around what the user typed. Removed before indexing.
const INJECTED_TAGS = ['environment_context', 'user_instructions', 'INSTRUCTIONS', 'recommended_plugins', 'turn_aborted',
  'in-app-browser-context', 'heartbeat', 'task-notification', 'codex_internal_context', 'subagent_notification', 'skill'];
const INJECTED_LINES = /^# AGENTS\.md instructions for .*$/gm;
// IDE, browser and file-mention context sits above this heading; the request follows it.
const REQUEST_HEADING = /^#{1,3} My request(?: for Codex)?:[ \t]*$/m;

const TOOL_CALLS = new Set(['function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call']);
const TOOL_OUTPUTS = new Set(['function_call_output', 'custom_tool_call_output']);
// Code-mode turns run JavaScript that calls tools; the shell commands inside are what matter.
const CODE_COMMAND = /tools\.exec_command\(\s*\{\s*cmd\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g;

export function cleanCodexUserText(raw) {
  let text = String(raw ?? '');
  if (/^\s*#/.test(text)) text = text.split(REQUEST_HEADING).at(-1);
  return cleanUserText(stripTags(text, INJECTED_TAGS).replace(INJECTED_LINES, ''));
}

function tryJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function jsString(literal) {
  const body = literal.slice(1, -1);
  return tryJson(`"${body}"`) ?? body;
}

function codeSummary(code) {
  const commands = [...String(code ?? '').matchAll(CODE_COMMAND)].map(match => jsString(match[1]));
  if (commands.length) return toolSummary('exec_command', { cmd: commands.join(' ; ') });
  if (/\*\*\* (?:Add|Update|Delete) File: /.test(code)) return toolSummary('apply_patch', String(code).replace(/\\n/g, '\n'));
  return toolSummary('js', code);
}

function callSummary(payload) {
  if (payload.type === 'local_shell_call') return toolSummary('local_shell', payload.action);
  if (payload.type === 'web_search_call') return toolSummary('web_search', payload.action);
  if (payload.type === 'custom_tool_call' && payload.name === 'exec') return codeSummary(payload.input);
  const namespace = typeof payload.namespace === 'string' && payload.namespace.startsWith('mcp__') ? `${payload.namespace}__` : '';
  return toolSummary(`${namespace}${payload.name ?? 'tool'}`, payload.type === 'custom_tool_call' ? payload.input : payload.arguments);
}

function outputText(output) {
  if (Array.isArray(output)) return output.map(part => (typeof part?.text === 'string' ? part.text : '')).join('\n');
  if (output && typeof output === 'object') return String(output.content ?? output.output ?? '');
  const text = String(output ?? '');
  // Shell results are stored as {"output": ..., "metadata": ...}.
  return text.startsWith('{"output":') ? String(tryJson(text)?.output ?? text) : text;
}

function blockText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(block => typeof block?.text === 'string' && block.type !== 'input_image').map(block => block.text).join('\n');
}

function handleCall(state, payload, ts, out) {
  const summary = callSummary(payload);
  const recall = RECALL_INVOCATION.test(summary);
  if (recall && payload.call_id) state.recallCalls.push(payload.call_id);
  pushMessage(state, out, { role: ROLES.ASSISTANT, kind: KINDS.TOOL, text: summary, ts, meta: recall ? { recall: true } : undefined });
}

function handleOutput(state, payload, ts, out) {
  const recall = state.recallCalls.indexOf(payload.call_id);
  if (recall !== -1) {
    state.recallCalls.splice(recall, 1);
    return;
  }
  pushMessage(state, out, { role: ROLES.TOOL, kind: KINDS.OUTPUT, text: outputExcerpt(outputText(payload.output)), ts });
}

// images: [{ dataUrl, locator }]. A message with only images still gets a line to anchor them.
function pushUser(state, out, { text, images, ts }) {
  const clean = cleanCodexUserText(text);
  if (!clean && images.length === 0) return;
  const seq = pushMessage(state, out, { role: ROLES.USER, text: clean || '[image]', ts });
  images.forEach((image, ordinal) => pushAttachment(state, out, { seq, ordinal, ...image }));
}

// Desktop user items carry local image paths; the pixels are in the model-context message
// just before them, so that record is read again by offset.
async function pendingImages(state) {
  const pending = state.pendingImages;
  if (!pending) return [];
  const record = await readJsonlAt(state.file, pending.offset);
  const content = record?.payload?.content ?? [];
  return pending.blocks.map(block => ({ dataUrl: content[block]?.image_url, locator: { offset: pending.offset, block } }));
}

function handleUserItem(state, item, position, ts, out) {
  const content = Array.isArray(item.content) ? item.content : [];
  const text = content.filter(block => block?.type === 'text').map(block => block.text).join('\n');
  const inline = [];
  content.forEach((block, index) => {
    if (block?.type === 'image' && typeof block.image_url === 'string') inline.push({ dataUrl: block.image_url, locator: { offset: position.offset, block: index } });
  });
  const wantsPending = !inline.length && content.some(block => block?.type === 'local_image') && state.pendingImages;
  if (!wantsPending) {
    state.pendingImages = null;
    pushUser(state, out, { text, images: inline, ts });
    return undefined;
  }
  return pendingImages(state).then(images => {
    state.pendingImages = null;
    pushUser(state, out, { text, images, ts });
  });
}

function handleEvent(state, payload, position, ts, out) {
  if (payload.type === 'item_completed') {
    const item = payload.item ?? {};
    if (item.type === 'UserMessage') return handleUserItem(state, item, position, ts, out);
    if (item.type === 'AgentMessage') pushMessage(state, out, { role: ROLES.ASSISTANT, text: blockText(item.content), ts });
    else if (item.type === 'Plan') pushMessage(state, out, { role: ROLES.ASSISTANT, text: item.text, ts });
    return undefined;
  }
  // Rollouts written before the item stream carry the same turns as plain events.
  if (payload.type === 'user_message') {
    const images = (Array.isArray(payload.images) ? payload.images : []).map((dataUrl, image) => ({ dataUrl, locator: { offset: position.offset, image } }));
    pushUser(state, out, { text: payload.message, images, ts });
  } else if (payload.type === 'agent_message') {
    pushMessage(state, out, { role: ROLES.ASSISTANT, text: payload.message, ts });
  }
  return undefined;
}

function handleResponseItem(state, payload, position, ts, out) {
  if (TOOL_CALLS.has(payload.type)) handleCall(state, payload, ts, out);
  else if (TOOL_OUTPUTS.has(payload.type)) handleOutput(state, payload, ts, out);
  else if (payload.type === 'message' && payload.role === 'user' && Array.isArray(payload.content)) {
    // Text comes from the user item that follows; only the image pixels are taken from here.
    const blocks = payload.content.flatMap((block, index) => (block?.type === 'input_image' ? [index] : []));
    state.pendingImages = blocks.length ? { offset: position.offset, blocks } : null;
  }
}

function originOf(source, originator) {
  if (source && typeof source === 'object') return 'subagent';
  if (source === 'cli' || source === 'exec') return source;
  if (/desktop|chrome/i.test(String(originator ?? ''))) return 'desktop';
  return source === 'vscode' ? 'ide' : 'cli';
}

function handleMeta(state, payload) {
  const id = typeof payload.id === 'string' && payload.id ? payload.id : null;
  if (state.ownId) {
    // A fork written before history references copies its parent's turns after the parent's meta.
    if (id && id !== state.ownId) state.copying = true;
    return;
  }
  state.ownId = id ?? state.threadId;
  state.nativeId = state.segment ? `${state.ownId}:${state.segment}` : state.ownId;
  state.historyStart = Number.isInteger(payload.subagent_history_start_ordinal) ? payload.subagent_history_start_ordinal : null;
  if (typeof payload.cwd === 'string' && payload.cwd) state.cwd = payload.cwd;
  if (payload.git?.branch) state.gitBranch = payload.git.branch;
  state.origin = originOf(payload.source, payload.originator);
  const spawn = payload.source?.subagent?.thread_spawn;
  if (spawn?.parent_thread_id && !state.segment) state.parentNativeId = spawn.parent_thread_id;
  if (payload.forked_from_id && !spawn) state.forkedFrom = payload.forked_from_id;
  const nickname = spawn?.agent_nickname ?? payload.agent_nickname ?? null;
  const role = spawn?.agent_role ?? payload.agent_role ?? null;
  const task = String(spawn?.agent_path ?? payload.agent_path ?? '').split('/').filter(Boolean).at(-1);
  if (nickname || role) state.agent = { nickname, role };
  // The task path names a spawned agent's job; its prompt is encrypted in newer rollouts.
  if (task) state.agentTitle = oneLine(`${task}${nickname ? ` (${nickname})` : ''}`, LIMITS.TITLE_MAX_CHARS);
}

const parser = {
  init(source) {
    const match = path.basename(source.path).match(ROLLOUT_NAME);
    const threadId = match?.[1] ?? path.basename(source.path, '.jsonl');
    const segment = match?.[2] ?? null;
    return sessionState({
      provider: PROVIDER,
      file: source.path,
      threadId,
      segment,
      nativeId: segment ? `${threadId}:${segment}` : threadId,
      ownId: null,
      parentNativeId: segment ? threadId : null,
      archived: source.meta?.archived === true,
      copying: false,
      historyStart: null,
      pendingImages: null,
      forkedFrom: null,
      agent: null,
      agentTitle: null,
      origin: null,
      cwd: null,
      gitBranch: null,
      model: null,
    });
  },

  skip(head) {
    return SKIPPABLE.some(pattern => pattern.test(head));
  },

  record(state, record, position, out) {
    const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
    if (record.type === 'session_meta') return handleMeta(state, payload);
    if (state.copying) {
      if (state.historyStart === null || !(record.ordinal >= state.historyStart)) return undefined;
      state.copying = false;
    }
    const ts = asIso(record.timestamp);
    touch(state, ts);
    if (record.type === 'turn_context') {
      if (typeof payload.cwd === 'string' && payload.cwd) state.cwd = payload.cwd;
      if (typeof payload.model === 'string' && payload.model) state.model = payload.model;
    } else if (record.type === 'response_item') {
      handleResponseItem(state, payload, position, ts, out);
    } else if (record.type === 'event_msg') {
      return handleEvent(state, payload, position, ts, out);
    }
    return undefined;
  },

  finish(state) {
    const [title, titleSource] = state.agentTitle ? [state.agentTitle, 'generated']
      : state.firstPrompt ? [state.firstPrompt, 'prompt']
        : [state.agent?.nickname ?? null, 'generated'];
    const meta = {};
    if (state.forkedFrom) meta.forkedFrom = state.forkedFrom;
    if (state.agent?.nickname) meta.agentNickname = state.agent.nickname;
    if (state.agent?.role) meta.agentRole = state.agent.role;
    if (state.segment) meta.segment = state.segment;
    const threadId = state.ownId ?? state.threadId;
    return [{
      nativeId: state.nativeId,
      parentNativeId: state.parentNativeId,
      kind: state.parentNativeId ? 'subagent' : 'main',
      title: title ?? null,
      titleSource: title ? titleSource : null,
      firstPrompt: state.firstPrompt,
      cwd: state.cwd,
      gitBranch: state.gitBranch,
      model: state.model,
      origin: state.origin ?? 'cli',
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      archived: state.archived,
      resume: { command: 'codex', args: ['resume', threadId], cwd: state.cwd },
      meta,
    }];
  },
};

async function rollouts(dir, meta) {
  const entries = await listDir(dir);
  const nested = await Promise.all(entries.map(async entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return rollouts(full, meta);
    return entry.isFile() && ROLLOUT_NAME.test(entry.name) ? [{ provider: PROVIDER, path: full, kind: 'jsonl', meta: { ...meta } }] : [];
  }));
  return nested.flat();
}

// Codex bumps the number in state_<n>.sqlite on schema resets; the highest is current.
async function stateDatabase(codexHome) {
  let best = null;
  for (const entry of await listDir(codexHome)) {
    const version = entry.isFile() ? Number(entry.name.match(STATE_DB)?.[1]) : NaN;
    if (Number.isFinite(version) && (!best || version > best.version)) best = { version, file: path.join(codexHome, entry.name) };
  }
  return best?.file ?? null;
}

function readThreads(file) {
  if (!file) return { threads: [], edges: [] };
  let db;
  try {
    db = new DatabaseSync(file, { readOnly: true, timeout: SYNC.BUSY_TIMEOUT_MS });
    const threads = db.prepare('SELECT * FROM threads').all();
    let edges = [];
    try {
      edges = db.prepare('SELECT parent_thread_id, child_thread_id FROM thread_spawn_edges').all();
    } catch {
      // older schema without spawn edges
    }
    return { threads, edges };
  } catch {
    return { threads: [], edges: [] };
  } finally {
    db?.close();
  }
}

// session_index.jsonl appends a row per rename; the newest row per thread wins.
async function threadNames(file) {
  const names = new Map();
  let text = '';
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    return names;
  }
  for (const line of text.split('\n')) {
    const row = tryJson(line);
    if (!row?.id || !row.thread_name) continue;
    const previous = names.get(row.id);
    if (!previous || String(row.updated_at ?? '') >= String(previous.updated_at ?? '')) names.set(row.id, row);
  }
  return names;
}

function spawnParent(source) {
  return typeof source === 'string' && source.startsWith('{') ? tryJson(source)?.subagent?.thread_spawn?.parent_thread_id ?? null : null;
}

// threads.title is usually the raw first message; it is a real title only when it differs
// from that message and is not wrapped context.
function storedTitle(row) {
  const title = String(row?.title ?? '').trim();
  if (!title || title === String(row.first_user_message ?? '').trim() || /^[<#[]/.test(title)) return null;
  return cleanCodexUserText(title) === title ? title : null;
}

export const codexProvider = {
  id: PROVIDER,

  async discover(roots) {
    const [active, archived] = await Promise.all([rollouts(roots.codexSessions, {}), rollouts(roots.codexArchived, { archived: true })]);
    return [...active, ...archived];
  },

  // Thread names, archive flags and spawn parents from Codex's state database and name index.
  async labels(roots) {
    const [{ threads, edges }, names] = await Promise.all([
      stateDatabase(roots.codexHome).then(readThreads),
      threadNames(roots.codexSessionIndex),
    ]);
    const rows = new Map(threads.map(row => [String(row.id), row]));
    const parents = new Map(edges.map(edge => [String(edge.child_thread_id), String(edge.parent_thread_id)]));
    const labels = [];
    for (const id of new Set([...rows.keys(), ...names.keys()])) {
      const row = rows.get(id);
      // Imported sessions can carry a raw first message as their name.
      const title = cleanCodexUserText(row?.name || names.get(id)?.thread_name) || storedTitle(row);
      labels.push({
        nativeId: id,
        title: title ? oneLine(title, LIMITS.TITLE_MAX_CHARS) : null,
        titleSource: title ? 'generated' : null,
        archived: row ? Number(row.archived) === 1 : null,
        parentNativeId: parents.get(id) ?? spawnParent(row?.source) ?? null,
      });
    }
    return labels;
  },

  parse(source, cursor) {
    return parseJsonlSource(source, cursor, parser);
  },

  async readAttachment(source, locator) {
    const record = await readJsonlAt(source.path, locator.offset);
    const payload = record?.payload ?? {};
    const dataUrl = Number.isInteger(locator.image) ? payload.images?.[locator.image]
      : payload.type === 'item_completed' ? payload.item?.content?.[locator.block]?.image_url
        : payload.content?.[locator.block]?.image_url;
    return typeof dataUrl === 'string' ? decodeDataUrl(dataUrl) : null;
  },
};
