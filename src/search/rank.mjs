import { KINDS, LIMITS, RANKING, ROLES } from '../shared/config.mjs';
import { comparablePath, isWithin } from '../shared/paths.mjs';
import { snippet, termHits } from '../shared/text.mjs';
import { PASSAGE_FLAGS } from '../index/passages.mjs';
import { rootResolver, sessionFilter } from '../index/sessions.mjs';

const DAY_MS = 86_400_000;
const passageRank = `bm25(${RANKING.PASSAGE_WEIGHTS.join(', ')})`;
const sessionRank = `bm25(${RANKING.SESSION_WEIGHTS.join(', ')})`;

function idList(ids) {
  return [...ids].map(Number).filter(Number.isInteger).join(',') || '0';
}

function passageCandidates(db, query, filter) {
  return db.prepare(`
    SELECT p.id, p.session_id AS sessionId, p.first_seq AS firstSeq, p.last_seq AS lastSeq, p.ts, p.hash, p.flags, -f.rank AS score
    FROM passages_fts f JOIN passages p ON p.id = f.rowid JOIN sessions s ON s.id = p.session_id
    WHERE passages_fts MATCH ? AND f.rank MATCH '${passageRank}' ${filter.sql}
    ORDER BY f.rank LIMIT ${LIMITS.SEARCH_CANDIDATES}`).all(query.match, ...filter.params);
}

function sessionCandidates(db, query, filter) {
  return db.prepare(`
    SELECT s.id AS sessionId, -f.rank AS score
    FROM sessions_fts f JOIN sessions s ON s.id = f.rowid
    WHERE sessions_fts MATCH ? AND f.rank MATCH '${sessionRank}' ${filter.sql}
    ORDER BY f.rank LIMIT ${LIMITS.SESSION_CANDIDATES}`).all(query.match, ...filter.params);
}

// Which query terms each candidate row contains. Contentless FTS keeps no text, so each
// term is matched separately, restricted to the candidate rows.
function termCoverage(db, table, ids, terms) {
  const covered = new Map();
  if (!ids.size) return covered;
  const list = idList(ids);
  terms.forEach((term, index) => {
    for (const row of db.prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH ? AND rowid IN (${list})`).all(term.fts)) {
      if (!covered.has(row.rowid)) covered.set(row.rowid, new Set());
      covered.get(row.rowid).add(index);
    }
  });
  return covered;
}

function passageWeight(passage) {
  let score = passage.score;
  if (passage.flags & PASSAGE_FLAGS.RECALL) score *= RANKING.RECALL_PENALTY;
  if (passage.flags & PASSAGE_FLAGS.SUMMARY) score *= RANKING.SUMMARY_PENALTY;
  return score;
}

function recencyFactor(updatedAt, now) {
  const time = Date.parse(updatedAt ?? '');
  if (!Number.isFinite(time)) return 1;
  const ageDays = Math.max(0, (now - time) / DAY_MS);
  return 1 + RANKING.RECENCY_BOOST * 0.5 ** (ageDays / RANKING.RECENCY_HALF_LIFE_DAYS);
}

function inProject(session, cwd) {
  if (!cwd || !session.cwd) return false;
  if (isWithin(session.cwd, cwd) || isWithin(cwd, session.cwd)) return true;
  // Worktrees and clones of the same project share its folder name.
  const name = path => comparablePath(path).split('/').at(-1);
  return name(session.cwd) === name(cwd);
}

// Picks the message in a passage that best shows why it matched.
function bestMessage(db, passage, stems) {
  const rows = db.prepare(`SELECT seq, ts, role, kind, text FROM messages WHERE session_id = ? AND seq BETWEEN ? AND ? ORDER BY seq`)
    .all(passage.sessionId, passage.firstSeq, passage.lastSeq);
  let best = null;
  for (const row of rows) {
    const { hits, matched } = termHits(row.text, stems);
    const value = matched.size * 10 + Math.min(hits.length, 9) + (row.role === ROLES.USER && row.kind === KINDS.TEXT ? 0.5 : 0);
    if (!best || value > best.value) best = { value, row };
  }
  return best?.row ?? rows[0] ?? null;
}

/**
 * Ranks root conversations for a parsed query. Passages score by bm25; a conversation scores
 * by its best passages (from itself and its subagents), its title, how many query terms it
 * covers anywhere, the current project and recency. Copies of the same turn (forks, resumed
 * sessions) count once, for the oldest session that holds them.
 */
export function rankConversations(db, query, options = {}) {
  const limit = Math.min(Math.max(1, options.limit ?? LIMITS.SEARCH_DEFAULT), LIMITS.SEARCH_MAX);
  if (!query.terms.length) return { hits: [], considered: 0 };
  const filter = sessionFilter(options);
  const now = options.now ?? Date.now();
  const resolve = rootResolver(db);

  const passages = passageCandidates(db, query, filter);
  const titled = sessionCandidates(db, query, filter);
  for (const row of [...passages, ...titled]) resolve.load(row.sessionId);

  // Keep one copy of each duplicated passage: the one in the oldest session.
  const byHash = new Map();
  for (const passage of passages) {
    const current = byHash.get(passage.hash);
    const created = resolve.session(passage.sessionId)?.created_at ?? '';
    if (!current || created < (resolve.session(current.sessionId)?.created_at ?? '')) byHash.set(passage.hash, passage);
  }
  const unique = [...byHash.values()];
  const passageTerms = termCoverage(db, 'passages_fts', new Set(unique.map(p => p.id)), query.terms);
  const sessionTerms = termCoverage(db, 'sessions_fts', new Set(titled.map(s => s.sessionId)), query.terms);

  const groups = new Map();
  const groupFor = sessionId => {
    const root = resolve.root(sessionId);
    if (!root || options.exclude?.has(root.native_id)) return null;
    if (!groups.has(root.id)) groups.set(root.id, { root, passages: [], title: 0, terms: new Set() });
    return groups.get(root.id);
  };
  for (const passage of unique) {
    const group = groupFor(passage.sessionId);
    if (!group) continue;
    group.passages.push({ ...passage, weight: passageWeight(passage) });
    for (const term of passageTerms.get(passage.id) ?? []) group.terms.add(term);
  }
  for (const row of titled) {
    const group = groupFor(row.sessionId);
    if (!group) continue;
    group.title = Math.max(group.title, row.score);
    for (const term of sessionTerms.get(row.sessionId) ?? []) group.terms.add(term);
  }

  const scored = [...groups.values()].map(group => {
    group.passages.sort((a, b) => b.weight - a.weight);
    const [first = 0, ...rest] = group.passages.map(p => p.weight);
    const extra = RANKING.EXTRA_PASSAGE_WEIGHTS.reduce((sum, weight, i) => sum + weight * (rest[i] ?? 0), 0);
    const coverage = group.terms.size / query.terms.length;
    let score = (RANKING.BASE_SCORE + first + extra + RANKING.TITLE_WEIGHT * group.title) * (1 + RANKING.COVERAGE_WEIGHT * coverage ** 2);
    if (inProject(group.root, options.cwd)) score *= RANKING.CURRENT_PROJECT_BOOST;
    score *= recencyFactor(group.root.updated_at, now);
    return { ...group, coverage, score };
  }).sort((a, b) => b.score - a.score);

  const hits = scored.slice(0, limit).map(group => ({
    root: group.root,
    score: group.score,
    coverage: group.coverage,
    matched: query.terms.filter((_, i) => group.terms.has(i)).map(term => term.text),
    missing: query.terms.filter((_, i) => !group.terms.has(i)).map(term => term.text),
    titleMatched: group.title > 0,
    matches: group.passages.slice(0, LIMITS.MATCHES_PER_HIT).map(passage => {
      const message = bestMessage(db, passage, query.stems);
      const session = resolve.session(passage.sessionId);
      return {
        session,
        seq: message?.seq ?? passage.firstSeq,
        firstSeq: passage.firstSeq,
        lastSeq: passage.lastSeq,
        role: message?.role ?? null,
        kind: message?.kind ?? null,
        at: message?.ts ?? passage.ts,
        snippet: message ? snippet(message.text, query.stems) : '',
      };
    }),
  }));
  return { hits, considered: scored.length };
}
