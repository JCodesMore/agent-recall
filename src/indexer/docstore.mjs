import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { INDEX_FILES } from '../config.mjs';
import { indexHome, ensureIndexHome } from '../paths.mjs';

function docsPath() {
  return path.join(indexHome(), INDEX_FILES.DOCS);
}

export async function writeDocs(docs) {
  await ensureIndexHome();
  const target = docsPath();
  const tmp = target + '.tmp';
  await new Promise((resolve, reject) => {
    const ws = createWriteStream(tmp, { encoding: 'utf8' });
    ws.once('error', reject);
    ws.once('finish', resolve);
    for (const d of docs) {
      ws.write(JSON.stringify({ id: d.id, text: d.text }) + '\n');
    }
    ws.end();
  });
  await fs.rename(tmp, target);
}

export async function readAllDocs() {
  const out = new Map();
  try {
    const stream = createReadStream(docsPath(), { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        out.set(rec.id, rec.text);
      } catch { /* skip malformed */ }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return out;
}

export async function readDocTexts(ids) {
  const want = new Set(ids);
  const out = new Map();
  if (want.size === 0) return out;
  try {
    const stream = createReadStream(docsPath(), { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try {
        const rec = JSON.parse(line);
        if (want.has(rec.id)) {
          out.set(rec.id, rec.text);
          if (out.size === want.size) break;
        }
      } catch { /* skip malformed */ }
    }
    rl.close();
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  return out;
}
