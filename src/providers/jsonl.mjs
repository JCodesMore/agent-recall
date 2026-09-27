import fs from 'node:fs/promises';
import { LIMITS } from '../shared/config.mjs';

const NEWLINE = 0x0a;
const CHUNK_BYTES = 1024 * 1024;

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
  const handle = await fs.open(file, 'r');
  let position = offset;
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

  try {
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, CHUNK_BYTES, position);
      if (bytesRead === 0) break;
      const data = chunk.subarray(0, bytesRead);
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
          // A view into `chunk` is safe: it is parsed before the next read overwrites it.
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
      position += bytesRead;
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
  } finally {
    await handle.close();
  }
  return { offset: consumed, line: lineNumber, diagnostics };
}

// Reads the single record that starts at a byte offset (attachment retrieval).
export async function readJsonlAt(file, offset) {
  const handle = await fs.open(file, 'r');
  try {
    const parts = [];
    let position = offset;
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    for (let total = 0; total <= LIMITS.JSONL_MAX_LINE_BYTES;) {
      const { bytesRead } = await handle.read(chunk, 0, CHUNK_BYTES, position);
      if (bytesRead === 0) break;
      const data = chunk.subarray(0, bytesRead);
      const end = data.indexOf(NEWLINE);
      parts.push(Buffer.from(end === -1 ? data : data.subarray(0, end)));
      if (end !== -1) break;
      position += bytesRead;
      total += bytesRead;
    }
    return parseLine(Buffer.concat(parts), emptyDiagnostics());
  } finally {
    await handle.close();
  }
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
