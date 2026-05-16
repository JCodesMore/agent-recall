import fs from 'node:fs/promises';
import path from 'node:path';
import { INDEX_FILES } from '../config.mjs';
import { ensureIndexHome, indexHome } from '../paths.mjs';

function manifestPath() {
  return path.join(indexHome(), INDEX_FILES.MANIFEST);
}

export async function readManifest() {
  try {
    const raw = await fs.readFile(manifestPath(), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return { version: 1, files: {}, lastIndexedAt: null };
    throw err;
  }
}

export async function writeManifest(manifest) {
  await ensureIndexHome();
  manifest.lastIndexedAt = new Date().toISOString();
  const tmp = manifestPath() + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 0));
  await fs.rename(tmp, manifestPath());
}

export function fileSignature(stat) {
  return { mtime: stat.mtimeMs | 0, size: stat.size };
}

export function isUnchanged(prev, sig) {
  return prev && prev.mtime === sig.mtime && prev.size === sig.size;
}
