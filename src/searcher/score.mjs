import { SCORING } from '../config.mjs';
import { tokenize } from './tokenize.mjs';
import { readPostingsBatch } from '../indexer/postings-store.mjs';

function bm25(tf, dfQ, N, dl, avgdl) {
  const k1 = SCORING.BM25_K1;
  const b = SCORING.BM25_B;
  const idf = Math.log(1 + (N - dfQ + 0.5) / (dfQ + 0.5));
  const norm = tf * (k1 + 1) / (tf + k1 * (1 - b + b * (dl / (avgdl || 1))));
  return idf * norm;
}

export function applyRoleBoost(score, doc) {
  if (doc.role === 'user') return score * SCORING.USER_ROLE_BOOST;
  return score;
}

export function applyRecency(score, ts, now = Date.now()) {
  if (!ts) return score;
  const ageDays = (now - Date.parse(ts)) / 86_400_000;
  const halfLife = SCORING.RECENCY_HALF_LIFE_DAYS;
  const decay = Math.pow(0.5, ageDays / halfLife);
  return score * (1 - SCORING.RECENCY_WEIGHT) + score * SCORING.RECENCY_WEIGHT * decay * 2;
}

export async function rankDocs({ index, query, now }) {
  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return [];

  const offsetsForQuery = [];
  for (const t of queryTokens) {
    const off = index.postingsOffsets[t];
    if (off) offsetsForQuery.push({ token: t, offset: off });
  }
  if (offsetsForQuery.length === 0) return [];

  const postingsByToken = await readPostingsBatch(offsetsForQuery);

  const tfByDoc = new Map();
  for (const [t, entries] of postingsByToken) {
    for (const [docId, count] of entries) {
      let m = tfByDoc.get(docId);
      if (!m) { m = new Map(); tfByDoc.set(docId, m); }
      m.set(t, count);
    }
  }

  const docById = new Map();
  for (const d of index.docs) docById.set(d.id, d);

  const results = [];
  const { N, avgdl, df } = index;
  for (const [docId, tfMap] of tfByDoc) {
    const doc = docById.get(docId);
    if (!doc) continue;
    let s = 0;
    for (const [t, tf] of tfMap) {
      s += bm25(tf, df[t], N, doc.dl, avgdl);
    }
    s = applyRoleBoost(s, doc);
    s = applyRecency(s, doc.ts, now);
    if (s > 0) results.push({ doc, score: s, queryTokens });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}
