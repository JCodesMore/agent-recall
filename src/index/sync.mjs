import fs from 'node:fs';
import path from 'node:path';
import { SYNC } from '../shared/config.mjs';
import { hashHex } from '../shared/ids.mjs';
import { displayPath, ensureDataHome, sourceRoots } from '../shared/paths.mjs';
import { providersFor } from '../providers/registry.mjs';
import { readHead } from '../providers/jsonl.mjs';
import { statOrNull } from '../providers/fsutil.mjs';
import { getMeta, openIndex, setMeta, transaction } from './db.mjs';
import { createWriter } from './writer.mjs';

const lockPath = () => path.join(ensureDataHome(), 'sync.lock');

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

// Cross-process lock so concurrent agents never index the same files twice.
export function acquireLock() {
  const file = lockPath();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      fs.closeSync(fd);
      return () => fs.rmSync(file, { force: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let holder = null;
      try {
        holder = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // unreadable lock: treat as stale
      }
      const stale = !holder || Date.now() - holder.at > SYNC.LOCK_STALE_MS || !processAlive(holder.pid);
      if (!stale) return null;
      fs.rmSync(file, { force: true });
    }
  }
  return null;
}

async function statSource(source) {
  const stat = await statOrNull(source.path);
  if (!stat?.isFile()) return null;
  let extra = '';
  if (source.kind === 'sqlite') {
    const wal = await statOrNull(`${source.path}-wal`);
    extra = wal ? `wal:${wal.size}:${Math.trunc(wal.mtimeMs)}` : '';
  }
  return { size: stat.size, mtime: Math.trunc(stat.mtimeMs), extra };
}

// Fingerprint of a file's first bytes, stored as "<bytes>:<hash>" so a file that has grown
// past the old length is compared over the same prefix it was indexed with.
async function headHash(file, bytes) {
  const head = await readHead(file, bytes);
  return `${head.length}:${hashHex(head.toString('latin1')).slice(0, 24)}`;
}

async function sameHead(file, stored) {
  const bytes = Number.parseInt(stored ?? '', 10);
  return Number.isInteger(bytes) && (await headHash(file, bytes)) === stored;
}

function parseCursor(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

/**
 * Brings the index up to date with every provider store. Unchanged sources are skipped by
 * size and mtime; JSONL files that only grew are parsed from their last offset. With
 * `budgetMs`, stops starting new sources once the budget is spent and reports how many
 * remain, so a search can answer from a slightly stale index instead of waiting.
 */
export async function syncIndex({ providers, full = false, budgetMs = Infinity, onProgress, db: givenDb } = {}) {
  const release = acquireLock();
  if (!release) return { ok: true, locked: true, pending: null };
  const db = givenDb ?? openIndex();
  const started = Date.now();
  const stats = { ok: true, locked: false, indexed: 0, appended: 0, skipped: 0, removed: 0, pending: 0, errors: [], providers: {} };
  try {
    const roots = sourceRoots();
    const writer = createWriter(db);
    const known = new Map(db.prepare('SELECT id, path, provider, size, mtime, extra, head, cursor FROM sources').all().map(row => [row.path, row]));
    const selected = providersFor(providers);
    const work = [];

    for (const provider of selected) {
      const perProvider = { sources: 0, indexed: 0, errors: 0 };
      stats.providers[provider.id] = perProvider;
      let sources = [];
      try {
        sources = await provider.discover(roots);
      } catch (error) {
        perProvider.errors += 1;
        stats.errors.push({ provider: provider.id, message: `discovery failed: ${error.message}` });
        continue;
      }
      perProvider.sources = sources.length;
      const present = new Set(sources.map(source => source.path));
      const gone = [...known.values()].filter(row => row.provider === provider.id && !present.has(row.path));
      if (gone.length) {
        transaction(db, () => gone.forEach(row => writer.removeSource(row.path)));
        stats.removed += gone.length;
      }
      for (const source of sources) {
        const stat = await statSource(source);
        if (!stat) continue;
        const row = known.get(source.path);
        if (!full && row && row.size === stat.size && row.mtime === stat.mtime && row.extra === stat.extra) {
          stats.skipped += 1;
          continue;
        }
        work.push({ provider, source, stat, row });
      }
    }

    const totalBytes = work.reduce((sum, item) => sum + Math.max(0, item.stat.size - (item.row?.size ?? 0)), 0);
    let doneBytes = 0;
    let lastProgress = Date.now();
    let batch = [];
    let batchBytes = 0;
    const flush = () => {
      if (!batch.length) return;
      const now = new Date().toISOString();
      transaction(db, () => {
        for (const item of batch) {
          if (item.append) writer.appendSource(item.row.id, item.source, item.stat, item.parsed, now);
          else writer.replaceSource(item.source, item.stat, item.parsed, now);
        }
      });
      batch = [];
      batchBytes = 0;
    };

    for (let index = 0; index < work.length; index += 1) {
      if (Date.now() - started > budgetMs) {
        stats.pending = work.length - index;
        break;
      }
      const item = work[index];
      try {
        const cursor = parseCursor(item.row?.cursor);
        item.append = !full && item.source.kind === 'jsonl' && Boolean(cursor?.state) && item.stat.size >= item.row.size
          && cursor.offset <= item.stat.size && await sameHead(item.source.path, item.row.head);
        if (item.source.kind === 'jsonl') item.stat.head = await headHash(item.source.path, Math.min(SYNC.HEAD_BYTES, item.stat.size));
        item.parsed = await item.provider.parse(item.source, item.append ? cursor : null);
        batch.push(item);
        batchBytes += item.stat.size - (item.append ? item.row.size : 0);
        stats[item.append ? 'appended' : 'indexed'] += 1;
        stats.providers[item.provider.id].indexed += 1;
      } catch (error) {
        stats.providers[item.provider.id].errors += 1;
        stats.errors.push({ provider: item.provider.id, source: displayPath(item.source.path), message: error.message });
      }
      doneBytes += Math.max(0, item.stat.size - (item.row?.size ?? 0));
      if (batchBytes >= SYNC.BATCH_BYTES || batch.length >= 500) flush();
      if (onProgress && Date.now() - lastProgress >= SYNC.PROGRESS_INTERVAL_MS) {
        lastProgress = Date.now();
        onProgress({ done: index + 1, total: work.length, doneBytes, totalBytes });
      }
    }
    flush();

    for (const provider of selected) {
      if (!provider.labels) continue;
      try {
        const labels = await provider.labels(roots);
        transaction(db, () => writer.applyLabels(provider.id, labels));
      } catch (error) {
        stats.errors.push({ provider: provider.id, message: `labels failed: ${error.message}` });
      }
    }

    if (!stats.pending) setMeta(db, 'last_sync_at', new Date().toISOString());
    stats.ok = stats.errors.length === 0;
    stats.elapsedMs = Date.now() - started;
    return stats;
  } finally {
    if (!givenDb) db.close();
    release();
  }
}

export function lastSyncAt(db) {
  return getMeta(db, 'last_sync_at');
}
