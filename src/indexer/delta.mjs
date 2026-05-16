import fs from 'node:fs/promises';
import path from 'node:path';
import { readManifest, writeManifest, fileSignature, isUnchanged } from './manifest.mjs';
import { readIndex, writeIndex, assembleIndex } from './inverted.mjs';
import { readAllDocs } from './docstore.mjs';
import { listTranscripts, displayProject } from '../paths.mjs';
import { readTranscript, isSearchable, summarizeSession } from '../transcript-reader.mjs';
import { INDEXER, TRANSCRIPT } from '../config.mjs';

function truncate(text) {
  if (typeof text !== 'string') return '';
  return text.length > INDEXER.MAX_TEXT_PER_RECORD
    ? text.slice(0, INDEXER.MAX_TEXT_PER_RECORD)
    : text;
}

function makeDocId(sessionId, file, lineNo) {
  return `${path.basename(file, TRANSCRIPT.JSONL_EXT)}:${lineNo}`;
}

async function parseFileToDocs(fileInfo, startId) {
  const records = [];
  for await (const r of readTranscript(fileInfo.file)) records.push(r);
  const summary = summarizeSession(records);
  const docs = [];
  for (const r of records) {
    if (!isSearchable(r)) continue;
    docs.push({
      id: makeDocId(fileInfo.sessionId, fileInfo.file, r.lineNo),
      sessionId: fileInfo.sessionId,
      file: fileInfo.file,
      role: r.role,
      ts: r.ts,
      text: truncate(r.text),
      isSidechain: r.isSidechain,
      isSubagent: fileInfo.isSubagent,
    });
  }
  const sessionMeta = {
    sessionId: fileInfo.sessionId,
    project: displayProject(fileInfo.project),
    projectDir: fileInfo.project,
    cwd: summary.cwd || fileInfo.project,
    firstTs: summary.firstTs,
    lastTs: summary.lastTs,
    msgCount: summary.msgCount,
    firstPrompt: summary.firstPrompt,
    summary: summary.summary,
    title: summary.title,
  };
  return { docs, sessionMeta };
}

function mergeSessionMeta(existing, incoming) {
  if (!existing) return incoming;
  return {
    ...existing,
    project: incoming.project || existing.project,
    projectDir: incoming.projectDir || existing.projectDir,
    cwd: incoming.cwd || existing.cwd,
    firstTs: !existing.firstTs || (incoming.firstTs && incoming.firstTs < existing.firstTs) ? incoming.firstTs : existing.firstTs,
    lastTs: !existing.lastTs || (incoming.lastTs && incoming.lastTs > existing.lastTs) ? incoming.lastTs : existing.lastTs,
    msgCount: (existing.msgCount || 0) + (incoming.msgCount || 0),
    firstPrompt: existing.firstPrompt || incoming.firstPrompt,
    summary: existing.summary || incoming.summary,
    title: existing.title || incoming.title,
  };
}

export async function buildDelta({ root, force = false } = {}) {
  const manifest = force ? { version: 1, files: {}, lastIndexedAt: null } : await readManifest();
  const prevIndex = force ? null : await readIndex();
  const currentFiles = await listTranscripts({ root });

  const seenAbs = new Set();
  const reuseDocs = [];
  const reuseSessions = new Map();

  if (prevIndex) {
    const docsByFile = new Map();
    for (const d of prevIndex.docs) {
      if (!docsByFile.has(d.file)) docsByFile.set(d.file, []);
      docsByFile.get(d.file).push(d);
    }
    const reuseFiles = [];
    for (const f of currentFiles) {
      const prev = manifest.files[f.file];
      let stat;
      try { stat = await fs.stat(f.file); } catch { continue; }
      const sig = fileSignature(stat);
      if (isUnchanged(prev, sig)) {
        seenAbs.add(f.file);
        reuseFiles.push(f);
        const prevSession = prevIndex.sessions[f.sessionId];
        if (prevSession) reuseSessions.set(f.sessionId, prevSession);
      }
    }
    if (reuseFiles.length > 0) {
      const oldTexts = await readAllDocs();
      for (const f of reuseFiles) {
        const oldDocs = docsByFile.get(f.file) || [];
        for (const d of oldDocs) {
          reuseDocs.push({ ...d, text: oldTexts.get(d.id) ?? '' });
        }
      }
    }
  }

  const newDocs = [];
  const newSessions = new Map(reuseSessions);
  const newManifestFiles = {};
  let indexedFiles = 0;
  let skippedFiles = 0;

  for (const f of currentFiles) {
    let stat;
    try { stat = await fs.stat(f.file); } catch { continue; }
    const sig = fileSignature(stat);
    newManifestFiles[f.file] = { ...sig, sessionId: f.sessionId };
    if (seenAbs.has(f.file)) {
      skippedFiles++;
      continue;
    }
    const { docs, sessionMeta } = await parseFileToDocs(f);
    newDocs.push(...docs);
    const merged = mergeSessionMeta(newSessions.get(f.sessionId), sessionMeta);
    newSessions.set(f.sessionId, merged);
    indexedFiles++;
  }

  const allDocs = [...reuseDocs, ...newDocs];
  const sessionsObj = Object.create(null);
  for (const [k, v] of newSessions) sessionsObj[k] = v;

  const removed = (prevIndex?.docs.length || 0) - reuseDocs.length;

  const newIndex = await assembleIndex({ docs: allDocs, sessions: sessionsObj });
  await writeIndex(newIndex);
  await writeManifest({ version: 1, files: newManifestFiles, lastIndexedAt: null });

  return {
    indexed: indexedFiles,
    skipped: skippedFiles,
    removed: Math.max(0, removed),
    docs: allDocs.length,
    sessions: Object.keys(sessionsObj).length,
  };
}
