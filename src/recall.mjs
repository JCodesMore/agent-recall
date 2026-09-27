import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP, LIMITS, RETENTION, SYNC, VERSION } from './shared/config.mjs';
import { databasePath, sourceRoots } from './shared/paths.mjs';
import { parseQuery } from './search/query.mjs';
import { rankConversations } from './search/rank.mjs';
import { readTranscript, transcriptNotes } from './read/transcript.mjs';
import { exportTranscript } from './read/export.mjs';
import { getMeta, openIndex } from './index/db.mjs';
import { childSessions, findSession, rootResolver, sessionFilter } from './index/sessions.mjs';
import { syncIndex } from './index/sync.mjs';
import { providerById, PROVIDER_LIST } from './providers/registry.mjs';
import { claudeRetentionDays } from './providers/claude.mjs';

const CLI = fileURLToPath(new URL('../scripts/recall.mjs', import.meta.url));
const POLL_MS = 250;

export class RecallError extends Error {
  constructor(message, { code = 'error', hint = null, candidates = null } = {}) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.candidates = candidates;
  }
}

function startBackgroundSync() {
  try {
    spawn(process.execPath, [CLI, 'sync', '--quiet'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return true;
  } catch {
    return false;
  }
}

const parseJson = value => {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};

// The public shape of a session in every result. `detail` adds what `show` needs.
export function sessionView(row, { detail = false } = {}) {
  const view = {
    handle: row.handle,
    id: row.native_id,
    provider: row.provider,
    kind: row.kind,
    title: row.title,
    project: row.project,
    cwd: row.cwd,
    branch: row.git_branch,
    origin: row.origin,
    archived: Boolean(row.archived),
    created: row.created_at,
    updated: row.updated_at,
    messages: row.message_count,
    live: Number.isFinite(row.source_mtime) && Date.now() - row.source_mtime < SYNC.LIVE_WINDOW_MS,
    parentId: row.parent_native_id ?? null,
    segment: parseJson(row.meta)?.segment ?? null,
    resume: parseJson(row.resume),
  };
  if (detail) Object.assign(view, { model: row.model, firstPrompt: row.first_prompt, titleSource: row.title_source, source: row.source_path, meta: parseJson(row.meta) });
  return view;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Brings the index close enough to current before a query. The first run indexes everything
 * (with progress). Later runs spend at most FOREGROUND_BUDGET_MS and leave the rest to a
 * detached background sync, so an answer never waits on a large backlog.
 * Returns { lastSync, pending, warnings }.
 */
async function freshen({ sync = 'auto', onProgress } = {}) {
  const warnings = [];
  const status = () => {
    const db = openIndex({ readonly: true });
    if (!db) return { lastSync: null, sessions: 0 };
    try {
      return { lastSync: getMeta(db, 'last_sync_at'), sessions: db.prepare('SELECT count(*) AS n FROM sessions').get().n };
    } finally {
      db.close();
    }
  };
  let before = status();
  if (sync === 'never') {
    if (!before.lastSync) warnings.push('The index has never been built. Run: sync');
    return { ...before, pending: 0, warnings };
  }
  const first = !before.lastSync;
  const fresh = before.lastSync && Date.now() - Date.parse(before.lastSync) < SYNC.STALE_AFTER_MS;
  if (fresh && sync !== 'wait') return { ...before, pending: 0, warnings };

  const budgetMs = first || sync === 'wait' ? Infinity : SYNC.FOREGROUND_BUDGET_MS;
  let result = await syncIndex({ budgetMs, onProgress });
  const waitUntil = Date.now() + SYNC.LOCK_WAIT_MS;
  while (result.locked && (first || sync === 'wait') && Date.now() < waitUntil) {
    await sleep(POLL_MS);
    before = status();
    if (before.lastSync && !first) break;
    result = await syncIndex({ budgetMs, onProgress });
  }
  if (result.locked && !status().lastSync) warnings.push('Another process is building the index; results may be incomplete.');
  if (result.pending) {
    const started = startBackgroundSync();
    warnings.push(`${result.pending} changed source(s) are still being indexed${started ? ' in the background' : ''}; very recent messages may be missing.`);
  }
  for (const error of result.errors ?? []) warnings.push(`${error.provider}${error.source ? ` ${error.source}` : ''}: ${error.message}`);
  return { ...status(), pending: result.pending ?? 0, warnings };
}

function withIndex(work) {
  const db = openIndex({ readonly: true });
  if (!db) throw new RecallError('The index is empty.', { code: 'empty', hint: 'Run: sync' });
  try {
    return work(db);
  } finally {
    db.close();
  }
}

function currentSessionIds(options) {
  if (options.includeCurrent) return new Set();
  const ids = [process.env.CLAUDE_CODE_SESSION_ID, process.env.CODEX_THREAD_ID, ...(options.exclude ?? [])].filter(Boolean);
  return new Set(ids.map(String));
}

function resolveOrThrow(db, ref) {
  const found = findSession(db, ref);
  if (found.session) return found.session;
  if (found.candidates) {
    throw new RecallError(`"${ref}" matches ${found.candidates.length} sessions.`, {
      code: 'ambiguous',
      hint: 'Use one of the handles below.',
      candidates: found.candidates.map(row => sessionView(row)),
    });
  }
  throw new RecallError(`No session matches "${ref}".`, { code: 'not_found', hint: 'Search first, then use a handle from the results: search -- <words>' });
}

export async function search(text, options = {}) {
  const query = parseQuery(text);
  if (!query.terms.length) throw new RecallError('The query has no searchable words.', { code: 'usage', hint: 'Describe the topic, a file name, a command or an error message.' });
  const index = await freshen(options);
  const exclude = currentSessionIds(options);
  const result = withIndex(db => rankConversations(db, query, { ...options, exclude }));
  return {
    query: { text: query.raw, terms: query.terms.map(term => term.text) },
    hits: result.hits.map(hit => ({
      ...sessionView(hit.root),
      score: Math.round(hit.score * 1000) / 1000,
      coverage: Math.round(hit.coverage * 100) / 100,
      matched: hit.matched,
      missing: hit.missing,
      titleMatched: hit.titleMatched,
      matches: hit.matches.map(match => ({
        handle: match.session.handle,
        subagent: match.session.id === hit.root.id ? null : match.session.title ?? match.session.handle,
        seq: match.seq,
        role: match.role,
        kind: match.kind,
        at: match.at,
        snippet: match.snippet,
      })),
    })),
    considered: result.considered,
    excludedCurrent: [...exclude],
    index: { lastSync: index.lastSync, pending: index.pending },
    warnings: index.warnings,
  };
}

// Codex continues a long thread in segment files; each is indexed as its own session.
function nextSegment(db, session, children) {
  const own = parseJson(session.meta)?.segment;
  if (!own) return children.find(child => child.segment) ?? null;
  const parent = findSession(db, `${session.provider}:${session.parent_native_id}`).session;
  const siblings = parent ? childSessions(db, parent).map(row => sessionView(row)).filter(row => row.segment) : [];
  return siblings[siblings.findIndex(row => row.id === session.native_id) + 1] ?? null;
}

export async function read(ref, options = {}) {
  const index = await freshen(options);
  return withIndex(db => {
    const session = resolveOrThrow(db, ref);
    if (options.out) {
      const written = exportTranscript(db, session, options.out, options);
      return { session: sessionView(session), export: written, warnings: index.warnings };
    }
    const page = readTranscript(db, session, options);
    const root = rootResolver(db).root(session.id);
    const children = childSessions(db, session).map(row => sessionView(row));
    return {
      session: sessionView(session),
      root: root && root.id !== session.id ? sessionView(root) : null,
      subagents: children.filter(child => !child.segment),
      continuesIn: nextSegment(db, session, children),
      ...page,
      notes: transcriptNotes(db, session, page),
      warnings: index.warnings,
    };
  });
}

export async function show(ref, options = {}) {
  const index = await freshen(options);
  return withIndex(db => {
    const session = resolveOrThrow(db, ref);
    const root = rootResolver(db).root(session.id);
    const attachments = db.prepare('SELECT id, seq, kind, mime, bytes, name FROM attachments WHERE session_id = ? ORDER BY seq, ordinal').all(session.id);
    return {
      session: sessionView(session, { detail: true }),
      root: root && root.id !== session.id ? sessionView(root) : null,
      subagents: childSessions(db, session).map(row => sessionView(row)),
      attachments,
      warnings: index.warnings,
    };
  });
}

export async function recent(options = {}) {
  const index = await freshen(options);
  const limit = Math.min(Math.max(1, options.limit ?? LIMITS.RECENT_DEFAULT), LIMITS.SEARCH_MAX);
  const filter = sessionFilter(options);
  const exclude = currentSessionIds(options);
  const rows = withIndex(db => db.prepare(`
    SELECT s.*, src.path AS source_path, src.mtime AS source_mtime FROM sessions s JOIN sources src ON src.id = s.source_id
    WHERE s.parent_native_id IS NULL ${filter.sql} ORDER BY s.updated_at DESC LIMIT ?`).all(...filter.params, limit + exclude.size));
  return {
    sessions: rows.filter(row => !exclude.has(row.native_id)).slice(0, limit).map(row => sessionView(row)),
    index: { lastSync: index.lastSync, pending: index.pending },
    warnings: index.warnings,
  };
}

export async function sync(options = {}) {
  const result = await syncIndex({ full: options.full, providers: options.providers, onProgress: options.onProgress });
  return result;
}

export async function attachment(id, options = {}) {
  await freshen(options);
  const row = withIndex(db => db.prepare(`SELECT a.*, s.provider, src.path AS source_path, src.id AS source_id FROM attachments a
    JOIN sessions s ON s.id = a.session_id JOIN sources src ON src.id = s.source_id WHERE a.id = ?`).get(String(id)));
  if (!row) throw new RecallError(`No attachment "${id}".`, { code: 'not_found', hint: 'Attachment ids are listed by: show <handle>' });
  const provider = providerById(row.provider);
  const decoded = await provider?.readAttachment?.({ provider: row.provider, path: row.source_path }, JSON.parse(row.locator));
  if (!decoded) throw new RecallError(`Attachment "${id}" is no longer in its source file.`, { code: 'not_found' });
  const extension = (decoded.mime.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  const out = path.resolve(options.out ?? `${row.id}.${extension}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, decoded.data);
  return { id: row.id, mime: decoded.mime, bytes: decoded.data.length, path: out };
}

export async function doctor() {
  const roots = sourceRoots();
  const file = databasePath();
  const db = openIndex({ readonly: true });
  const providers = {};
  let lastSync = null;
  if (db) {
    try {
      lastSync = getMeta(db, 'last_sync_at');
      for (const row of db.prepare(`SELECT provider, count(*) AS sessions, sum(parent_native_id IS NULL) AS roots, sum(message_count) AS messages,
        max(updated_at) AS newest FROM sessions GROUP BY provider`).all()) providers[row.provider] = { ...row };
    } finally {
      db.close();
    }
  }
  const retention = await claudeRetentionDays(roots);
  const warnings = [];
  if (!process.versions.node || Number(process.versions.node.split('.')[0]) < APP.MIN_NODE.major) warnings.push(`Node ${APP.MIN_NODE.major}.${APP.MIN_NODE.minor}+ is required.`);
  if ((retention ?? RETENTION.CLAUDE_DEFAULT_DAYS) < RETENTION.WARN_BELOW_DAYS) {
    warnings.push(`Claude Code deletes transcripts after ${retention ?? RETENTION.CLAUDE_DEFAULT_DAYS} days. To keep history, set "cleanupPeriodDays": 36500 in ${roots.claudeSettings}.`);
  }
  if (!lastSync) warnings.push('The index has not been built yet. Run: sync');
  return {
    version: VERSION,
    node: process.versions.node,
    index: { path: file, bytes: fs.existsSync(file) ? fs.statSync(file).size : 0, lastSync },
    providers: Object.fromEntries(PROVIDER_LIST.map(provider => [provider.id, providers[provider.id] ?? { sessions: 0, roots: 0, messages: 0, newest: null }])),
    claudeRetentionDays: retention,
    warnings,
  };
}
