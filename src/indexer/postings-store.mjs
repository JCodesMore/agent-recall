import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { INDEX_FILES } from '../config.mjs';
import { indexHome, ensureIndexHome } from '../paths.mjs';

function postingsPath() {
  return path.join(indexHome(), INDEX_FILES.POSTINGS);
}

export async function writePostings(postings) {
  await ensureIndexHome();
  const target = postingsPath();
  const tmp = target + '.tmp';
  const offsets = Object.create(null);
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(tmp, { encoding: 'utf8' });
    ws.once('error', reject);
    ws.once('finish', resolve);
    let pos = 0;
    for (const t of Object.keys(postings)) {
      const line = JSON.stringify({ t, e: postings[t] }) + '\n';
      offsets[t] = { o: pos, n: Buffer.byteLength(line, 'utf8') };
      ws.write(line);
      pos += offsets[t].n;
    }
    ws.end();
  });
  await fs.rename(tmp, target);
  return offsets;
}

export async function readPostingsBatch(offsets) {
  const out = new Map();
  if (!offsets || offsets.length === 0) return out;
  let fh;
  try {
    fh = await fs.open(postingsPath(), 'r');
    for (const { token, offset } of offsets) {
      const buf = Buffer.alloc(offset.n);
      await fh.read(buf, 0, offset.n, offset.o);
      const line = buf.toString('utf8').trimEnd();
      try {
        const rec = JSON.parse(line);
        out.set(token, rec.e || []);
      } catch { /* skip */ }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  } finally {
    if (fh) await fh.close();
  }
  return out;
}
