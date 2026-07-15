import path from 'node:path';
import { APP, LIMITS, TOKENIZE } from './config.mjs';
import { classifyActivity, latestActivityEvent } from './activity.mjs';
import { displayPath } from './paths.mjs';
import { openDatabase } from './storage/database.mjs';

function clamp(value, fallback, max, min = 0) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number) || number < min) return fallback;
  return Math.min(number, max);
}

function normalizedPath(value) {
  return path.resolve(value).replaceAll('\\', '/').replace(/\/+$/, '');
}

function addCwdCondition(conditions, params, column, cwdValue) {
  const cwd = normalizedPath(cwdValue);
  const stored = `replace(${column}, '\\', '/')`;
  const left = process.platform === 'win32' ? `lower(${stored})` : stored;
  const exact = process.platform === 'win32' ? 'lower(?)' : '?';
  conditions.push(`(
    ${left} = ${exact} OR
    instr(${left}, ${exact} || '/') = 1
  )`);
  params.push(cwd, cwd);
}

function queryTokens(query) {
  const tokens = [];
  const seen = new Set();
  const regex = new RegExp(TOKENIZE.TOKEN_REGEX.source, TOKENIZE.TOKEN_REGEX.flags);
  for (const match of query.matchAll(regex)) {
    const token = match[0].toLowerCase();
    if (token.length < TOKENIZE.MIN_TOKEN_LEN || token.length > TOKENIZE.MAX_TOKEN_LEN || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }
  return tokens;
}

function ftsQuery(tokens, operator = 'AND') {
  return tokens.map(token => `"${token.replaceAll('"', '""')}"`).join(` ${operator} `);
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function compactSession(row, db) {
  const event = latestActivityEvent(db, row.provider, row.native_id);
  const resume = parseJson(row.resume_json, null);
  if (resume?.cwd) resume.cwd = displayPath(resume.cwd);
  return {
    sessionKey: row.session_key,
    provider: row.provider,
    nativeId: row.native_id,
    parentSessionKey: row.parent_session_key,
    title: row.title,
    summary: row.summary,
    project: row.project,
    cwd: displayPath(row.cwd),
    gitBranch: row.git_branch,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sourceUpdatedAt: row.source_updated_at,
    archived: Boolean(row.archived),
    messageCount: Number(row.message_count),
    resume,
    activity: classifyActivity(row, event),
  };
}

function excerpt(text, tokens, max = LIMITS.SNIPPET_MAX_CHARS) {
  if (!text) return '';
  const lower = text.toLowerCase();
  let first = Number.POSITIVE_INFINITY;
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index >= 0 && index < first) first = index;
  }
  if (!Number.isFinite(first)) first = 0;
  const radius = Math.floor(max / 2);
  const start = Math.max(0, first - radius);
  const end = Math.min(text.length, start + max);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).trim()}${end < text.length ? '...' : ''}`;
}

function candidateSql(options, matchQuery, limit) {
  const conditions = ['messages_fts MATCH ?'];
  const params = [matchQuery];
  if (options.provider) {
    conditions.push('s.provider = ?');
    params.push(options.provider);
  }
  if (options.cwd) {
    addCwdCondition(conditions, params, 's.cwd', options.cwd);
  }
  if (options.since) {
    conditions.push('coalesce(m.timestamp, s.updated_at) >= ?');
    params.push(new Date(options.since).toISOString());
  }
  if (options.until) {
    conditions.push('coalesce(m.timestamp, s.updated_at) <= ?');
    params.push(new Date(options.until).toISOString());
  }
  params.push(limit);
  return {
    sql: `
      SELECT * FROM (
        SELECT m.message_key, m.session_key, m.sequence, m.timestamp, m.role, m.text,
               messages_fts.rank AS rank, s.*,
               row_number() OVER (
                 PARTITION BY m.session_key
                 ORDER BY messages_fts.rank, coalesce(m.timestamp, s.updated_at) DESC
               ) AS session_rank
        FROM messages_fts
        JOIN messages m ON m.rowid = messages_fts.rowid
        JOIN sessions s ON s.session_key = m.session_key
        WHERE ${conditions.join(' AND ')}
      ) ranked
      WHERE session_rank = 1
      ORDER BY rank, coalesce(timestamp, updated_at) DESC
      LIMIT ?
    `,
    params,
  };
}

function queryCandidates(db, tokens, options, operator, limit) {
  const statement = candidateSql(options, ftsQuery(tokens, operator), limit);
  return db.prepare(statement.sql).all(...statement.params);
}

export async function searchHistory(query, options = {}) {
  const normalized = String(query || '').trim().slice(0, LIMITS.QUERY_MAX_CHARS);
  const tokens = queryTokens(normalized);
  if (tokens.length === 0) {
    return { schemaVersion: APP.CLI_SCHEMA_VERSION, query: normalized, mode: 'lexical', hits: [], count: 0 };
  }
  const limit = clamp(options.limit, LIMITS.SEARCH_DEFAULT, LIMITS.SEARCH_MAX, 1);
  const db = options.db || await openDatabase();
  const ownsDb = !options.db;
  const started = performance.now();
  try {
    let operator = 'AND';
    let rows = queryCandidates(db, tokens, options, operator, limit);
    if (rows.length === 0 && tokens.length > 1) {
      operator = 'OR';
      rows = queryCandidates(db, tokens, options, operator, limit);
    }

    const hits = rows.map(row => ({
      hitId: row.message_key,
      session: compactSession(row, db),
      occurredAt: row.timestamp,
      role: row.role,
      sequence: Number(row.sequence),
      score: Math.abs(Number(row.rank)),
      snippet: excerpt(row.text, tokens),
    }));
    return {
      schemaVersion: APP.CLI_SCHEMA_VERSION,
      query: normalized,
      mode: operator === 'AND' ? 'lexical' : 'lexical-broad-fallback',
      count: hits.length,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100,
      hits,
    };
  } finally {
    if (ownsDb) db.close();
  }
}

export async function getContext(hitId, options = {}) {
  const before = clamp(options.before, LIMITS.CONTEXT_BEFORE_DEFAULT, LIMITS.CONTEXT_MAX);
  const after = clamp(options.after, LIMITS.CONTEXT_AFTER_DEFAULT, LIMITS.CONTEXT_MAX);
  const db = options.db || await openDatabase();
  const ownsDb = !options.db;
  try {
    const conditions = ['m.message_key = ?'];
    const params = [hitId];
    if (options.provider) {
      conditions.push('s.provider = ?');
      params.push(options.provider);
    }
    if (options.cwd) addCwdCondition(conditions, params, 's.cwd', options.cwd);
    const target = db.prepare(`
      SELECT m.*, s.* FROM messages m JOIN sessions s USING(session_key)
      WHERE ${conditions.join(' AND ')}
    `).get(...params);
    if (!target) return null;
    const messages = db.prepare(`
      SELECT message_key, sequence, timestamp, role, content_type, text, model, metadata_json
      FROM messages
      WHERE session_key = ? AND sequence BETWEEN ? AND ?
      ORDER BY sequence
    `).all(target.session_key, Math.max(0, target.sequence - before), target.sequence + after);
    return {
      schemaVersion: APP.CLI_SCHEMA_VERSION,
      hitId,
      session: compactSession(target, db),
      messages: messages.map(message => ({
        messageKey: message.message_key,
        sequence: Number(message.sequence),
        timestamp: message.timestamp,
        role: message.role,
        contentType: message.content_type,
        text: message.text,
        model: message.model,
        truncated: Boolean(parseJson(message.metadata_json, {}).truncated),
        matched: message.message_key === hitId,
      })),
    };
  } finally {
    if (ownsDb) db.close();
  }
}

export async function getSession(sessionKey, options = {}) {
  const db = options.db || await openDatabase();
  const ownsDb = !options.db;
  try {
    const conditions = ['session_key = ?'];
    const params = [sessionKey];
    if (options.provider) {
      conditions.push('provider = ?');
      params.push(options.provider);
    }
    if (options.cwd) addCwdCondition(conditions, params, 'cwd', options.cwd);
    const row = db.prepare(`SELECT * FROM sessions WHERE ${conditions.join(' AND ')}`).get(...params);
    if (!row) return null;
    return {
      schemaVersion: APP.CLI_SCHEMA_VERSION,
      ...compactSession(row, db),
      sourcePath: options.includeSource ? displayPath(row.source_path) : undefined,
      metadata: parseJson(row.metadata_json, {}),
    };
  } finally {
    if (ownsDb) db.close();
  }
}

export async function getTranscript(sessionKey, options = {}) {
  const offset = clamp(options.offset, 0, Number.MAX_SAFE_INTEGER);
  const limit = clamp(options.limit, LIMITS.TRANSCRIPT_DEFAULT, LIMITS.TRANSCRIPT_MAX, 1);
  const db = options.db || await openDatabase();
  const ownsDb = !options.db;
  try {
    const conditions = ['session_key = ?'];
    const params = [sessionKey];
    if (options.provider) {
      conditions.push('provider = ?');
      params.push(options.provider);
    }
    if (options.cwd) addCwdCondition(conditions, params, 'cwd', options.cwd);
    const row = db.prepare(`SELECT * FROM sessions WHERE ${conditions.join(' AND ')}`).get(...params);
    if (!row) return null;
    const messages = db.prepare(`
      SELECT message_key, sequence, timestamp, role, content_type, text, model, metadata_json
      FROM messages WHERE session_key = ? ORDER BY sequence LIMIT ? OFFSET ?
    `).all(sessionKey, limit + 1, offset);
    const hasMore = messages.length > limit;
    if (hasMore) messages.pop();
    const sourceDiagnostics = parseJson(
      db.prepare('SELECT diagnostics_json FROM sources WHERE source_path = ?').get(row.source_path)?.diagnostics_json,
      {},
    );
    const truncatedMessages = Number(db.prepare(`
      SELECT count(*) AS count FROM messages
      WHERE session_key = ? AND json_extract(metadata_json, '$.truncated') = 1
    `).get(sessionKey)?.count || 0);
    const sourceHasUnmappedIssues = Boolean(sourceDiagnostics.truncated || sourceDiagnostics.malformed);
    return {
      schemaVersion: APP.CLI_SCHEMA_VERSION,
      session: compactSession(row, db),
      offset,
      limit,
      hasMore,
      nextOffset: hasMore ? offset + messages.length : null,
      completeness: {
        complete: truncatedMessages > 0 ? false : sourceHasUnmappedIssues ? null : true,
        truncatedMessages,
        sourceDiagnostics,
        note: sourceHasUnmappedIssues && truncatedMessages === 0
          ? 'The source contains malformed or oversized records that could not be attributed to one session.'
          : null,
      },
      messages: messages.map(message => ({
        messageKey: message.message_key,
        sequence: Number(message.sequence),
        timestamp: message.timestamp,
        role: message.role,
        contentType: message.content_type,
        text: message.text,
        model: message.model,
        truncated: Boolean(parseJson(message.metadata_json, {}).truncated),
      })),
    };
  } finally {
    if (ownsDb) db.close();
  }
}

export async function recentSessions(options = {}) {
  const limit = clamp(options.limit, 10, LIMITS.SEARCH_MAX, 1);
  const db = options.db || await openDatabase();
  const ownsDb = !options.db;
  try {
    const conditions = [];
    const params = [];
    if (options.provider) {
      conditions.push('provider = ?');
      params.push(options.provider);
    }
    if (options.cwd) {
      addCwdCondition(conditions, params, 'cwd', options.cwd);
    }
    params.push(limit);
    const rows = db.prepare(`
      SELECT * FROM sessions ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY coalesce(updated_at, source_updated_at, created_at) DESC LIMIT ?
    `).all(...params);
    return {
      schemaVersion: APP.CLI_SCHEMA_VERSION,
      count: rows.length,
      sessions: rows.map(row => compactSession(row, db)),
    };
  } finally {
    if (ownsDb) db.close();
  }
}

export async function recallStatus(options = {}) {
  const db = options.db || await openDatabase();
  const ownsDb = !options.db;
  try {
    const providerCounts = db.prepare(`
      SELECT providers.provider, count(s.session_key) AS sessions,
             coalesce(sum(s.message_count), 0) AS messages,
             max(s.source_updated_at) AS latest_source_update
      FROM (
        SELECT provider FROM sessions UNION SELECT provider FROM sources
      ) providers
      LEFT JOIN sessions s ON s.provider = providers.provider
      GROUP BY providers.provider ORDER BY providers.provider
    `).all();
    const sourceCounts = db.prepare(`
      SELECT provider, count(*) AS sources, max(indexed_at) AS last_indexed_at,
             sum(json_extract(diagnostics_json, '$.malformed')) AS malformed
      FROM sources GROUP BY provider ORDER BY provider
    `).all();
    const sourceMap = new Map(sourceCounts.map(row => [row.provider, row]));
    return {
      schemaVersion: APP.CLI_SCHEMA_VERSION,
      databaseSchemaVersion: Number(db.prepare('SELECT value FROM metadata WHERE key = ?').get('schema_version')?.value),
      indexPolicyVersion: db.prepare('SELECT value FROM metadata WHERE key = ?').get('index_policy_version')?.value ?? null,
      stalePolicySources: Number(db.prepare(`
        SELECT count(*) AS count FROM sources
        WHERE substr(signature, -length(?)) <> ?
      `).get(`:policy=${APP.INDEX_POLICY_VERSION}`, `:policy=${APP.INDEX_POLICY_VERSION}`)?.count || 0),
      lastSyncAt: db.prepare('SELECT value FROM metadata WHERE key = ?').get('last_sync_at')?.value ?? null,
      providers: providerCounts.map(row => ({
        provider: row.provider,
        sources: Number(sourceMap.get(row.provider)?.sources || 0),
        sessions: Number(row.sessions),
        messages: Number(row.messages || 0),
        malformed: Number(sourceMap.get(row.provider)?.malformed || 0),
        lastIndexedAt: sourceMap.get(row.provider)?.last_indexed_at || null,
        latestSourceUpdate: row.latest_source_update,
      })),
    };
  } finally {
    if (ownsDb) db.close();
  }
}
