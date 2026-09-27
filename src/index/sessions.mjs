import path from 'node:path';
import { LIMITS, PROVIDERS } from '../shared/config.mjs';
import { comparablePath } from '../shared/paths.mjs';
import { refFromLink } from '../providers/registry.mjs';

const PROVIDER_IDS = new Set(Object.values(PROVIDERS));
const SESSION_COLUMNS = 's.*, src.path AS source_path, src.mtime AS source_mtime';

function escapeLike(value) {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

/**
 * SQL fragment restricting the `s` (sessions) alias by provider, project, time and archive
 * state. Returns { sql, params } with sql starting with AND, or empty.
 */
export function sessionFilter({ providers, project, since, until, archived = 'include' } = {}) {
  const clauses = [];
  const params = [];
  if (providers?.length) {
    clauses.push(`s.provider IN (${providers.map(() => '?').join(', ')})`);
    params.push(...providers);
  }
  if (project) {
    const looksLikePath = /[\\/]/.test(project) || path.isAbsolute(project);
    if (looksLikePath) {
      const key = comparablePath(path.resolve(project));
      clauses.push("(s.cwd_key = ? OR s.cwd_key LIKE ? ESCAPE '\\')");
      params.push(key, `${escapeLike(key)}/%`);
    } else {
      clauses.push("(s.project LIKE ? ESCAPE '\\' OR s.cwd_key LIKE ? ESCAPE '\\')");
      params.push(`%${escapeLike(project)}%`, `%/${escapeLike(project.toLowerCase())}%`);
    }
  }
  if (since) {
    clauses.push('s.updated_at >= ?');
    params.push(since);
  }
  if (until) {
    clauses.push('s.created_at <= ?');
    params.push(until);
  }
  if (archived === 'exclude') clauses.push('s.archived = 0');
  if (archived === 'only') clauses.push('s.archived = 1');
  return { sql: clauses.map(clause => `AND ${clause}`).join(' '), params };
}

// Caches session rows and walks parent links up to the root conversation.
export function rootResolver(db) {
  const byId = new Map();
  const byNative = new Map();
  const getById = db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions s JOIN sources src ON src.id = s.source_id WHERE s.id = ?`);
  const getByNative = db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions s JOIN sources src ON src.id = s.source_id WHERE s.provider = ? AND s.native_id = ?`);
  const remember = row => {
    if (!row) return null;
    byId.set(row.id, row);
    byNative.set(`${row.provider}\u0000${row.native_id}`, row);
    return row;
  };
  const load = id => byId.get(id) ?? remember(getById.get(id));
  const parentOf = row => {
    const key = `${row.provider}\u0000${row.parent_native_id}`;
    return byNative.has(key) ? byNative.get(key) : remember(getByNative.get(row.provider, row.parent_native_id)) ?? null;
  };
  return {
    load,
    session: id => load(id),
    root(id) {
      let row = load(id);
      for (let depth = 0; row?.parent_native_id && depth < LIMITS.MAX_PARENT_DEPTH; depth += 1) {
        const parent = parentOf(row);
        if (!parent) break;
        row = parent;
      }
      return row;
    },
  };
}

function normalizeRef(raw) {
  let ref = String(raw ?? '').trim();
  let provider = null;
  const linked = refFromLink(ref);
  if (linked) return linked;
  const prefixed = ref.match(/^([a-z]+):(.+)$/i);
  if (prefixed && PROVIDER_IDS.has(prefixed[1].toLowerCase())) {
    provider = prefixed[1].toLowerCase();
    ref = prefixed[2];
  }
  return { ref, provider };
}

/**
 * Finds a session by handle, native id, unique prefix of either, provider-qualified id,
 * provider link (codex://threads/<id>), or transcript path. Returns { session } or { candidates } when the
 * reference is ambiguous, or {} when nothing matches.
 */
export function findSession(db, raw) {
  const { ref, provider } = normalizeRef(raw);
  if (!ref) return {};
  const select = where => `SELECT ${SESSION_COLUMNS} FROM sessions s JOIN sources src ON src.id = s.source_id WHERE ${where}`;
  const scoped = provider ? ' AND s.provider = ?' : '';
  const scope = provider ? [provider] : [];
  const pick = rows => (rows.length === 1 ? { session: rows[0] } : rows.length > 1 ? { candidates: rows } : null);

  const exact = pick(db.prepare(select(`(s.handle = ? OR s.native_id = ?)${scoped}`)).all(ref, ref, ...scope));
  if (exact) return exact.session ? exact : { candidates: exact.candidates };

  if (/[\\/]/.test(ref)) {
    const byPath = db.prepare(select('src.path = ? ORDER BY s.kind DESC')).all(path.resolve(ref));
    if (byPath.length) return { session: byPath.find(row => row.kind === 'main') ?? byPath[0] };
  }

  if (ref.length < LIMITS.MIN_REF_PREFIX) return {};
  const like = `${escapeLike(ref.toLowerCase())}%`;
  const prefix = db.prepare(select(`(lower(s.handle) LIKE ? ESCAPE '\\' OR lower(s.native_id) LIKE ? ESCAPE '\\')${scoped} LIMIT 10`)).all(like, like, ...scope);
  return pick(prefix) ?? {};
}

export function childSessions(db, session) {
  return db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions s JOIN sources src ON src.id = s.source_id
    WHERE s.provider = ? AND s.parent_native_id = ? ORDER BY s.created_at`).all(session.provider, session.native_id);
}
