import fs from 'node:fs';
import readline from 'node:readline';
import { RECORD_TYPES, CONTENT_BLOCK_TYPES, ROLES, INDEXER } from './config.mjs';

function pickString(v) {
  return typeof v === 'string' ? v : '';
}

function extractFromContentArray(content) {
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    switch (block.type) {
      case CONTENT_BLOCK_TYPES.TEXT:
        parts.push(pickString(block.text));
        break;
      case CONTENT_BLOCK_TYPES.TOOL_USE:
        parts.push(pickString(block.name));
        if (block.input && typeof block.input === 'object') {
          for (const v of Object.values(block.input)) {
            if (typeof v === 'string') parts.push(v);
          }
        }
        break;
      case CONTENT_BLOCK_TYPES.TOOL_RESULT: {
        const c = block.content;
        if (typeof c === 'string') parts.push(c);
        else if (Array.isArray(c)) parts.push(...c.map(b => pickString(b?.text)));
        break;
      }
      default:
        break;
    }
  }
  return parts.filter(Boolean).join('\n');
}

function extractText(rec) {
  const msg = rec.message;
  if (!msg) {
    if (rec.type === RECORD_TYPES.ATTACHMENT) {
      const a = rec.attachment;
      if (!a) return '';
      const parts = [];
      if (typeof a.content === 'string' && a.content) parts.push(a.content);
      else if (Array.isArray(a.content)) parts.push(...a.content.filter(s => typeof s === 'string'));
      if (typeof a.stdout === 'string' && a.stdout) parts.push(a.stdout);
      if (typeof a.stderr === 'string' && a.stderr) parts.push(a.stderr);
      return parts.join('\n');
    }
    if (rec.type === RECORD_TYPES.SUMMARY) return pickString(rec.summary);
    if (rec.type === RECORD_TYPES.AI_TITLE) return pickString(rec.title);
    return '';
  }
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) return extractFromContentArray(msg.content);
  return '';
}

function classifyRole(rec) {
  if (rec.type === RECORD_TYPES.USER) return rec.isMeta ? ROLES.META : ROLES.USER;
  if (rec.type === RECORD_TYPES.ASSISTANT) return ROLES.ASSISTANT;
  if (rec.type === RECORD_TYPES.ATTACHMENT) return ROLES.ATTACHMENT;
  return rec.type || 'unknown';
}

function clampText(s) {
  return s.length > INDEXER.MAX_TEXT_PER_RECORD ? s.slice(0, INDEXER.MAX_TEXT_PER_RECORD) : s;
}

export function normalize(rec) {
  const text = clampText(extractText(rec));
  return {
    uuid: rec.uuid || null,
    parentUuid: rec.parentUuid || null,
    sessionId: rec.sessionId || null,
    role: classifyRole(rec),
    type: rec.type,
    ts: rec.timestamp || null,
    cwd: rec.cwd || null,
    gitBranch: rec.gitBranch || null,
    isSidechain: !!rec.isSidechain,
    isMeta: !!rec.isMeta,
    text,
  };
}

const SEARCHABLE_TYPES = new Set([
  RECORD_TYPES.USER,
  RECORD_TYPES.ASSISTANT,
  RECORD_TYPES.ATTACHMENT,
  RECORD_TYPES.SUMMARY,
  RECORD_TYPES.AI_TITLE,
]);

export function isSearchable(rec) {
  return SEARCHABLE_TYPES.has(rec.type) && rec.text && rec.text.length > 0;
}

export async function* readTranscript(filePath) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNo = 0;
  for await (const raw of rl) {
    lineNo++;
    if (!raw) continue;
    let rec;
    try { rec = JSON.parse(raw); }
    catch { continue; }
    const norm = normalize(rec);
    norm.lineNo = lineNo;
    yield norm;
  }
}

export async function readAllSearchable(filePath) {
  const out = [];
  for await (const rec of readTranscript(filePath)) {
    if (isSearchable(rec)) out.push(rec);
  }
  return out;
}

export function summarizeSession(records) {
  let firstPrompt = '';
  let summary = '';
  let title = '';
  let msgCount = 0;
  let firstTs = null;
  let lastTs = null;
  let cwd = null;
  for (const r of records) {
    if (r.ts) {
      if (!firstTs || r.ts < firstTs) firstTs = r.ts;
      if (!lastTs || r.ts > lastTs) lastTs = r.ts;
    }
    if (r.cwd) cwd = r.cwd;
    if (r.type === RECORD_TYPES.SUMMARY && !summary) summary = r.text;
    if (r.type === RECORD_TYPES.AI_TITLE && !title) title = r.text;
    if (r.role === ROLES.USER && !firstPrompt) firstPrompt = r.text;
    if (r.role === ROLES.USER || r.role === ROLES.ASSISTANT) msgCount++;
  }
  return { firstPrompt, summary, title, msgCount, firstTs, lastTs, cwd };
}
