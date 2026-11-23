import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { pipeline } from 'node:stream';
import zlib from 'node:zlib';
import { LIMITS } from '../shared/config.mjs';

const NEWLINE = 0x0a;
const CHUNK_BYTES = 1024 * 1024;

// Codex compresses finished rollouts to .jsonl.zst. Node gained zstd in 22.15; without it
// those files are left out rather than misread.
export const ZSTD_SUPPORTED = typeof zlib.createZstdDecompress === 'function';
export const isCompressed = file => file.endsWith('.zst');

// Yields a file's decoded bytes from `offset`. Offsets count decoded bytes, so a cursor or
// attachment locator means the same thing for plain and compressed files. A plain file's
// chunk is reused between reads: consumers copy what they keep before asking for more.
async function* bytesFrom(file, offset) {
  if (isCompressed(file)) {
    let skip = offset;
    const decoded = pipeline(createReadStream(file), zlib.createZstdDecompress(), () => {});
    for await (const piece of decoded) {
      if (skip >= piece.length) {
        skip -= piece.length;
        continue;
      }
      yield skip ? piece.subarray(skip) : piece;
      skip = 0;
    }
    return;
  }
  const handle = await fs.open(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    for (let position = offset; ;) {
      const { bytesRead } = await handle.read(chunk, 0, CHUNK_BYTES, position);
      if (bytesRead === 0) return;
      position += bytesRead;
      yield chunk.subarray(0, bytesRead);
    }
  } finally {
    await handle.close();
  }
}

export function emptyDiagnostics() {
  return { malformed: 0, oversized: 0, skipped: 0 };
}

function decode(buffer) {
  const text = buffer.toString('utf8');
  return text.endsWith('\r') ? text.slice(0, -1) : text;
}

function parseLine(buffer, diagnostics) {
  const text = decode(buffer);
  if (!text.trim()) return null;
  try {
    const record = JSON.parse(text);
    if (record && typeof record === 'object' && !Array.isArray(record)) return record;
  } catch {
    // counted below
  }
  diagnostics.malformed += 1;
  return null;
}

/**
 * Streams complete JSONL records from `offset`, calling onRecord(record, { line, offset }).
 * `skip(head)` sees the first bytes of a large line and may drop it unparsed. Returns the
 * byte offset and line number after the last complete record, so the next scan can resume
 * there when the file only grew. A trailing line without a newline is consumed only when it
 * parses, so a writer caught mid-line is re-read next time.
 */
export async function scanJsonl(file, { offset = 0, line = 0, skip, onRecord, diagnostics = emptyDiagnostics() }) {
  let consumed = offset;
  let lineNumber = line;
  let pending = [];
  let pendingBytes = 0;
  let dropping = false;

  const finishLine = async (buffer, lineStart) => {
    lineNumber += 1;
    if (buffer.length > LIMITS.JSONL_PEEK_THRESHOLD_BYTES && skip?.(buffer.subarray(0, LIMITS.JSONL_PEEK_BYTES).toString('latin1'))) {
      return;
    }
    const record = parseLine(buffer, diagnostics);
    if (record) await onRecord(record, { line: lineNumber, offset: lineStart });
  };

  for await (const data of bytesFrom(file, offset)) {
    let start = 0;
    for (let index = data.indexOf(NEWLINE, start); index !== -1; index = data.indexOf(NEWLINE, start)) {
      const lineStart = consumed;
      const piece = data.subarray(start, index);
      const lineBytes = pendingBytes + piece.length;
      consumed += lineBytes + 1;
      if (dropping) {
        dropping = false;
        lineNumber += 1;
      } else {
        // A view into the chunk is safe: it is parsed before the next read overwrites it.
        const buffer = pending.length ? Buffer.concat([...pending, piece], lineBytes) : piece;
        await finishLine(buffer, lineStart);
      }
      pending = [];
      pendingBytes = 0;
      start = index + 1;
    }
    const rest = data.subarray(start);
    if (rest.length) {
      if (dropping) {
        pendingBytes += rest.length;
      } else if (pendingBytes + rest.length > LIMITS.JSONL_MAX_LINE_BYTES) {
        dropping = true;
        diagnostics.oversized += 1;
        pending = [];
        pendingBytes += rest.length;
      } else {
        pending.push(Buffer.from(rest));
        pendingBytes += rest.length;
      }
    }
  }
  if (!dropping && pendingBytes) {
    const buffer = Buffer.concat(pending, pendingBytes);
    const probe = emptyDiagnostics();
    const record = parseLine(buffer, probe);
    if (record) {
      const lineStart = consumed;
      consumed += pendingBytes;
      lineNumber += 1;
      await onRecord(record, { line: lineNumber, offset: lineStart });
    }
  }
  return { offset: consumed, line: lineNumber, diagnostics };
}

// Reads the single record that starts at a byte offset (attachment retrieval).
export async function readJsonlAt(file, offset) {
  const parts = [];
  let total = 0;
  for await (const data of bytesFrom(file, offset)) {
    const end = data.indexOf(NEWLINE);
    parts.push(Buffer.from(end === -1 ? data : data.subarray(0, end)));
    total += data.length;
    if (end !== -1 || total > LIMITS.JSONL_MAX_LINE_BYTES) break;
  }
  return parseLine(Buffer.concat(parts), emptyDiagnostics());
}

export async function readHead(file, bytes) {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
