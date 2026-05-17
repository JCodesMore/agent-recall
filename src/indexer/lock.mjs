import fs from 'node:fs/promises';
import path from 'node:path';
import { INDEX_FILES, INDEXER } from '../config.mjs';
import { indexHome, ensureIndexHome } from '../paths.mjs';

function lockPath() {
  return path.join(indexHome(), INDEX_FILES.LOCK);
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'EPERM') return true;
    return false;
  }
}

async function tryCreateLock() {
  const fh = await fs.open(lockPath(), 'wx');
  try {
    await fh.write(String(process.pid));
  } finally {
    await fh.close();
  }
}

async function isStale() {
  let raw;
  try {
    raw = await fs.readFile(lockPath(), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
  const pid = parseInt(raw.trim(), 10);
  if (!isPidAlive(pid)) return true;
  try {
    const stat = await fs.stat(lockPath());
    if (Date.now() - stat.mtimeMs > INDEXER.LOCK_STALE_AFTER_MS) return true;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
  }
  return false;
}

export async function acquireLock() {
  await ensureIndexHome();
  try {
    await tryCreateLock();
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
  if (!(await isStale())) return false;
  try {
    await fs.unlink(lockPath());
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  try {
    await tryCreateLock();
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  }
}

export async function releaseLock() {
  try {
    await fs.unlink(lockPath());
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
