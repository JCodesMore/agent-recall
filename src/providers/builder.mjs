import { KINDS, LIMITS, ROLES } from '../shared/config.mjs';
import { attachmentId, parseDataUrl } from '../shared/attachments.mjs';
import { maxIso, minIso } from '../shared/ids.mjs';
import { oneLine } from '../shared/text.mjs';
import { emptyDiagnostics, scanJsonl } from './jsonl.mjs';

/**
 * Shared bookkeeping for building one normalized session. The state object is plain JSON so
 * a JSONL source can be resumed from its last offset: sync stores it and hands it back.
 *
 * Normalized output (what every provider returns from parse):
 *   sessions:    [{ nativeId, parentNativeId, kind: 'main'|'subagent', title, titleSource,
 *                   firstPrompt, cwd, gitBranch, model, origin, createdAt, updatedAt,
 *                   archived, resume: { command, args, cwd }, meta }]
 *   messages:    [{ sessionNativeId, seq, ts, role, kind, text, meta }]
 *   attachments: [{ sessionNativeId, seq, ordinal, id, kind, mime, bytes, sha256, name, locator }]
 *   cursor:      JSON handed back on the next parse of the same source
 *   partial:     true when only changed sessions are returned; `removed` lists deleted ids
 *                and `total` counts every session the source holds
 */
export function sessionState(base) {
  return {
    seq: 0,
    createdAt: null,
    updatedAt: null,
    firstPrompt: null,
    imageCounts: {},
    recallCalls: [],
    ...base,
  };
}

export function touch(state, ts) {
  state.createdAt = minIso(state.createdAt, ts);
  state.updatedAt = maxIso(state.updatedAt, ts);
}

export function pushMessage(state, out, { role, kind = KINDS.TEXT, text, ts = null, meta }) {
  const value = String(text ?? '').trim();
  if (!value) return null;
  const capped = value.length > LIMITS.MESSAGE_MAX_CHARS;
  const seq = state.seq;
  state.seq += 1;
  touch(state, ts);
  if (!state.firstPrompt && role === ROLES.USER && kind === KINDS.TEXT) state.firstPrompt = oneLine(value, LIMITS.TITLE_MAX_CHARS);
  const messageMeta = capped ? { ...meta, capped: value.length } : meta;
  out.messages.push({
    sessionNativeId: state.nativeId,
    seq,
    ts,
    role,
    kind,
    text: capped ? value.slice(0, LIMITS.MESSAGE_MAX_CHARS) : value,
    meta: messageMeta && Object.keys(messageMeta).length ? messageMeta : undefined,
  });
  return seq;
}

// Records an inline base64 image or file. Returns false when the payload is not usable.
export function pushAttachment(state, out, { seq, ordinal, dataUrl, locator, name = null }) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return false;
  const occurrence = state.imageCounts[parsed.sha256] ?? 0;
  state.imageCounts[parsed.sha256] = occurrence + 1;
  out.attachments.push({
    sessionNativeId: state.nativeId,
    seq,
    ordinal,
    id: attachmentId(state.provider, state.nativeId, parsed.sha256, occurrence),
    kind: parsed.mime.startsWith('image/') ? 'image' : 'file',
    mime: parsed.mime,
    bytes: parsed.byteLength,
    sha256: parsed.sha256,
    name,
    locator,
  });
  return true;
}

export function emptyOutput() {
  return { messages: [], attachments: [] };
}

/**
 * Runs a record-at-a-time parser over a JSONL source, resuming from `cursor` when given.
 * parser = { init(source) -> state, skip(head) -> bool, record(state, record, pos, out),
 *            finish(state, source) -> session[] }
 */
export async function parseJsonlSource(source, cursor, parser) {
  const state = cursor?.state ? structuredClone(cursor.state) : parser.init(source);
  const out = emptyOutput();
  const diagnostics = emptyDiagnostics();
  const result = await scanJsonl(source.path, {
    offset: cursor?.offset ?? 0,
    line: cursor?.line ?? 0,
    skip: parser.skip,
    diagnostics,
    onRecord: (record, position) => parser.record(state, record, position, out),
  });
  return {
    sessions: parser.finish(state, source),
    messages: out.messages,
    attachments: out.attachments,
    cursor: { offset: result.offset, line: result.line, state },
    diagnostics,
  };
}
