import fs from 'node:fs/promises';
import path from 'node:path';
import { INDEX_FILES } from '../config.mjs';
import { indexHome, ensureIndexHome } from '../paths.mjs';
import { tokenize } from '../searcher/tokenize.mjs';
import { writeDocs } from './docstore.mjs';
import { writePostings } from './postings-store.mjs';

function indexPath() {
  return path.join(indexHome(), INDEX_FILES.INDEX);
}

function toNullProto(obj) {
  const out = Object.create(null);
  if (obj) for (const k of Object.keys(obj)) out[k] = obj[k];
  return out;
}

export async function readIndex() {
  try {
    const raw = await fs.readFile(indexPath(), 'utf8');
    const parsed = JSON.parse(raw);
    parsed.df = toNullProto(parsed.df);
    parsed.sessions = toNullProto(parsed.sessions);
    parsed.postingsOffsets = toNullProto(parsed.postingsOffsets);
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return emptyIndex();
    throw err;
  }
}

export async function writeIndex(index) {
  await ensureIndexHome();
  const tmp = indexPath() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify({
    version: index.version || 1,
    N: index.N,
    avgdl: index.avgdl,
    sessions: index.sessions,
    docs: index.docs,
    df: index.df,
    postingsOffsets: index.postingsOffsets,
  }));
  await fs.rename(tmp, indexPath());
}

function emptyIndex() {
  return {
    version: 1,
    docs: [],
    sessions: Object.create(null),
    postingsOffsets: Object.create(null),
    df: Object.create(null),
    N: 0,
    avgdl: 0,
  };
}

function buildPostings(docs) {
  const postings = Object.create(null);
  const df = Object.create(null);
  let totalDl = 0;
  for (const doc of docs) {
    const tokens = tokenize(doc.text);
    doc.dl = tokens.length;
    totalDl += tokens.length;
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, count] of tf) {
      if (postings[t] === undefined) postings[t] = [];
      postings[t].push([doc.id, count]);
      df[t] = (df[t] || 0) + 1;
    }
  }
  return {
    postings,
    df,
    N: docs.length,
    avgdl: docs.length > 0 ? totalDl / docs.length : 0,
  };
}

export async function assembleIndex({ docs, sessions }) {
  const { postings, df, N, avgdl } = buildPostings(docs);
  await writeDocs(docs);
  const postingsOffsets = await writePostings(postings);
  return {
    version: 1,
    docs: docs.map(d => ({
      id: d.id,
      sessionId: d.sessionId,
      file: d.file,
      role: d.role,
      ts: d.ts,
      dl: d.dl,
      isSidechain: d.isSidechain,
      isSubagent: d.isSubagent,
    })),
    sessions,
    postingsOffsets,
    df,
    N,
    avgdl,
  };
}
