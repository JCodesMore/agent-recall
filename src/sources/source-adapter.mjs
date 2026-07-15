export function assertAdapter(adapter) {
  for (const method of ['discover', 'read']) {
    if (typeof adapter?.[method] !== 'function') {
      throw new TypeError(`Source adapter is missing ${method}()`);
    }
  }
  if (!adapter.provider) throw new TypeError('Source adapter is missing provider');
  return adapter;
}

export function sourceSignature(stat, extra = '') {
  return `${stat?.size ?? 0}:${Math.trunc(stat?.mtimeMs ?? 0)}:${extra}`;
}

export function emptyDiagnostics() {
  return { malformed: 0, truncated: 0, skipped: 0 };
}

function parseLine(raw, line, diagnostics) {
  const value = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  if (!value.trim()) return null;
  try {
    const record = JSON.parse(value);
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('Invalid record');
    return { record, line };
  } catch {
    diagnostics.malformed += 1;
    return null;
  }
}

export async function* readJsonlRecords(file, diagnostics, options = {}) {
  const maxLineChars = options.maxLineChars ?? LIMITS.JSONL_MAX_LINE_CHARS;
  const stream = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 64 * 1024 });
  let buffer = '';
  let line = 0;
  let droppingOversizedLine = false;

  for await (const chunk of stream) {
    let start = 0;
    for (let index = chunk.indexOf('\n', start); index !== -1; index = chunk.indexOf('\n', start)) {
      const segment = chunk.slice(start, index);
      line += 1;
      if (droppingOversizedLine) {
        droppingOversizedLine = false;
      } else if (buffer.length + segment.length > maxLineChars) {
        diagnostics.truncated += 1;
        diagnostics.skipped += 1;
      } else {
        const parsed = parseLine(buffer + segment, line, diagnostics);
        if (parsed) yield parsed;
      }
      buffer = '';
      start = index + 1;
    }

    const remainder = chunk.slice(start);
    if (droppingOversizedLine) continue;
    if (buffer.length + remainder.length > maxLineChars) {
      buffer = '';
      droppingOversizedLine = true;
      diagnostics.truncated += 1;
      diagnostics.skipped += 1;
    } else {
      buffer += remainder;
    }
  }

  if (!droppingOversizedLine && buffer) {
    line += 1;
    const parsed = parseLine(buffer, line, diagnostics);
    if (parsed) yield parsed;
  }
}

export async function readJsonlRecordAt(file, targetLine) {
  const diagnostics = emptyDiagnostics();
  for await (const item of readJsonlRecords(file, diagnostics)) {
    if (item.line === targetLine) return item.record;
    if (item.line > targetLine) return null;
  }
  return null;
}
import fs from 'node:fs';
import { LIMITS } from '../config.mjs';
