import { KINDS, LIMITS } from '../shared/config.mjs';
import { stem, termHits, words } from '../shared/text.mjs';

const parseMeta = value => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

function loadMessages(db, sessionId, { outputs, tools }) {
  const kinds = [KINDS.TEXT, KINDS.SUMMARY];
  if (tools) kinds.push(KINDS.TOOL);
  if (outputs) kinds.push(KINDS.OUTPUT);
  return db.prepare(`SELECT seq, ts, role, kind, text, meta FROM messages WHERE session_id = ? AND kind IN (${kinds.map(() => '?').join(', ')}) ORDER BY seq`)
    .all(sessionId, ...kinds)
    .map(row => ({ ...row, meta: parseMeta(row.meta) }));
}

function isOutput(db, sessionId, seq) {
  return db.prepare('SELECT kind FROM messages WHERE session_id = ? AND seq = ?').get(sessionId, seq)?.kind === KINDS.OUTPUT;
}

function grepMatcher(pattern) {
  const needle = pattern.toLowerCase();
  const stems = new Set(words(pattern).map(stem));
  return text => text.toLowerCase().includes(needle) || (stems.size > 0 && termHits(text, stems).matched.size === stems.size);
}

// Indexes of matching messages plus `context` neighbours each side, in order.
function grepWindow(messages, pattern, context) {
  const matches = grepMatcher(pattern);
  const keep = new Set();
  const hits = [];
  messages.forEach((message, index) => {
    if (!matches(message.text)) return;
    hits.push(message.seq);
    for (let i = Math.max(0, index - context); i <= Math.min(messages.length - 1, index + context); i += 1) keep.add(i);
  });
  return { indexes: [...keep].sort((a, b) => a - b), hits };
}

// Messages from `start` until the character budget is spent; always at least one.
function takeBudget(messages, start, budget) {
  const page = [];
  let used = 0;
  for (let i = start; i < messages.length; i += 1) {
    const size = messages[i].text.length + LIMITS.READ_MESSAGE_OVERHEAD_CHARS;
    if (page.length && used + size > budget) break;
    page.push(messages[i]);
    used += size;
  }
  return page;
}

function startIndex(messages, { at, from, last }) {
  const indexOfSeq = seq => {
    const found = messages.findIndex(message => message.seq >= seq);
    return found === -1 ? messages.length : found;
  };
  if (Number.isInteger(at)) return Math.max(0, indexOfSeq(at) - LIMITS.READ_CONTEXT_BEFORE);
  if (Number.isInteger(from)) return indexOfSeq(from);
  if (Number.isInteger(last)) return Math.max(0, messages.length - last);
  return 0;
}

/**
 * One page of a session transcript. Paging is by message and never splits one; the result
 * says exactly which messages were shown and how to get the rest.
 *
 * options: { at, from, last, grep, maxChars, tools = true, outputs = false, all = false }
 */
export function readTranscript(db, session, options = {}) {
  const tools = options.tools ?? true;
  // A search can point at a tool output, and --grep should find text wherever it is.
  const outputs = options.outputs ?? (Boolean(options.grep) || (Number.isInteger(options.at) && isOutput(db, session.id, options.at)));
  const messages = loadMessages(db, session.id, { tools, outputs });
  const total = db.prepare('SELECT count(*) AS n FROM messages WHERE session_id = ?').get(session.id).n;
  const budget = options.all ? Infinity : Math.min(Math.max(LIMITS.READ_MIN_BUDGET_CHARS, options.maxChars ?? LIMITS.READ_BUDGET_CHARS), LIMITS.READ_MAX_BUDGET_CHARS);

  if (options.grep) {
    const { indexes, hits } = grepWindow(messages, options.grep, options.context ?? LIMITS.READ_GREP_CONTEXT);
    const selected = indexes.map(i => messages[i]);
    const page = takeBudget(selected, 0, budget);
    const cut = page.length < selected.length ? selected[page.length].seq : null;
    return { messages: page, shown: page.length, available: messages.length, total, grepHits: hits, nextFrom: null, grepNextFrom: cut, prevFrom: null };
  }

  const start = startIndex(messages, options);
  const page = options.last !== undefined && !options.maxChars
    ? messages.slice(start)
    : takeBudget(messages, start, budget);
  const end = start + page.length;
  return {
    messages: page,
    shown: page.length,
    available: messages.length,
    total,
    firstIndex: start,
    nextFrom: end < messages.length ? messages[end].seq : null,
    prevFrom: start > 0 && messages.length ? messages[Math.max(0, Math.min(start, messages.length) - Math.max(page.length, 1))].seq : null,
  };
}

// Notes an agent needs to judge completeness: truncated messages, compaction, parse losses.
export function transcriptNotes(db, session, page) {
  const notes = [];
  const capped = page.messages.filter(message => message.meta?.capped);
  if (capped.length) notes.push(`${capped.length} message(s) were longer than ${LIMITS.MESSAGE_MAX_CHARS} characters and are cut at that length.`);
  if (page.messages.some(message => message.kind === KINDS.SUMMARY)) notes.push('This session was compacted; a summary message stands in for the turns before it.');
  const diagnostics = parseMeta(db.prepare('SELECT diagnostics FROM sources WHERE id = ?').get(session.source_id)?.diagnostics);
  const lost = (diagnostics?.malformed ?? 0) + (diagnostics?.oversized ?? 0);
  if (lost) notes.push(`${lost} record(s) in the source file could not be read.`);
  return notes;
}
