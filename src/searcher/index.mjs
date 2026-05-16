import { readIndex } from '../indexer/inverted.mjs';
import { readDocTexts } from '../indexer/docstore.mjs';
import { rankDocs } from './score.mjs';
import { snippet } from './snippet.mjs';
import { SEARCH_DEFAULTS } from '../config.mjs';

function buildResume(sessionId) {
  return `claude --resume ${sessionId}`;
}

function groupBySession(ranked) {
  const bySession = new Map();
  for (const r of ranked) {
    const sid = r.doc.sessionId;
    if (!bySession.has(sid)) bySession.set(sid, { sessionId: sid, hits: [], total: 0 });
    const g = bySession.get(sid);
    g.hits.push(r);
    g.total += r.score;
  }
  return [...bySession.values()].sort((a, b) => b.hits[0].score - a.hits[0].score);
}

export async function search(query, opts = {}) {
  const limit = Math.min(opts.limit || SEARCH_DEFAULTS.LIMIT, SEARCH_DEFAULTS.MAX_LIMIT);
  const format = opts.format || 'ansi';
  const indexParam = opts.index || (await readIndex());
  if (!query || !query.trim()) return [];
  const ranked = await rankDocs({ index: indexParam, query });
  if (ranked.length === 0) return [];

  const grouped = groupBySession(ranked);
  const survivors = [];
  for (const g of grouped) {
    if (survivors.length >= limit) break;
    const meta = indexParam.sessions[g.sessionId] || {};
    if (opts.project && meta.project && !meta.project.toLowerCase().includes(opts.project.toLowerCase())) continue;
    survivors.push({ g, meta });
  }
  const textIds = survivors.map(s => s.g.hits[0].doc.id);
  const texts = opts.texts || await readDocTexts(textIds);
  const out = [];
  for (const { g, meta } of survivors) {
    const top = g.hits[0];
    const text = texts.get(top.doc.id) || '';
    out.push({
      sessionId: g.sessionId,
      project: meta.project,
      projectDir: meta.projectDir,
      cwd: meta.cwd,
      firstPrompt: meta.firstPrompt,
      summary: meta.summary,
      title: meta.title,
      msgCount: meta.msgCount || 0,
      firstTs: meta.firstTs,
      lastTs: meta.lastTs,
      ts: top.doc.ts,
      role: top.doc.role,
      score: g.total,
      hitCount: g.hits.length,
      snippet: snippet(text, top.queryTokens, { format }),
      resumeCommand: buildResume(g.sessionId),
    });
  }
  return out;
}
