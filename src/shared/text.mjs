import { LIMITS } from './config.mjs';

// Mirrors the FTS tokenizer (unicode61): runs of letters and digits.
const WORD = /[\p{L}\p{N}]+/gu;

export function words(text) {
  return String(text ?? '').toLowerCase().match(WORD) ?? [];
}

// Cheap stemmer for matching terms inside text we already loaded (snippets, --grep). The
// index itself uses the porter tokenizer; this only has to agree on common English endings.
export function stem(word) {
  let w = word.toLowerCase();
  if (w.length <= 3) return w;
  for (const suffix of ['ational', 'ization', 'ations', 'ation', 'ments', 'ment', 'ings', 'ing', 'edly', 'ies', 'ied', 'es', 'ed', 'ly', 's']) {
    if (w.length - suffix.length >= 3 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

export function truncate(text, max) {
  const value = String(text ?? '');
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

// JSON text with every non-ASCII character as a \u escape; parses back to the same value.
export function escapeNonAscii(json) {
  return json.replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function oneLine(text, max = LIMITS.TOOL_SUMMARY_MAX_CHARS) {
  return truncate(String(text ?? '').replace(/\s+/g, ' ').trim(), max);
}

export function stripTags(text, tags) {
  let value = typeof text === 'string' ? text : '';
  for (const tag of tags) {
    value = value.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'gi'), '');
  }
  return value.trim();
}

// Removes ANSI escapes and control characters so recalled text cannot drive the terminal.
export function terminalSafe(value) {
  return String(value ?? '')
    .replace(/\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)?)/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

// Positions of stemmed term hits in text, used to pick and centre snippets.
export function termHits(text, stems) {
  const hits = [];
  const matched = new Set();
  if (!stems.size) return { hits, matched };
  const regex = new RegExp(WORD.source, WORD.flags);
  for (const match of String(text ?? '').matchAll(regex)) {
    const s = stem(match[0]);
    for (const target of stems) {
      if (s === target || (target.length >= 4 && s.startsWith(target))) {
        hits.push(match.index);
        matched.add(target);
        break;
      }
    }
  }
  return { hits, matched };
}

// A window of text around the densest cluster of term hits.
export function snippet(text, stems, max = LIMITS.SNIPPET_CHARS) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  const { hits } = termHits(value, stems);
  let centre = 0;
  if (hits.length) {
    let best = 0;
    for (let i = 0; i < hits.length; i += 1) {
      let count = 0;
      for (let j = i; j < hits.length && hits[j] - hits[i] <= max * 0.8; j += 1) count += 1;
      if (count > best) {
        best = count;
        centre = hits[i] + Math.min(max * 0.3, (hits[Math.min(hits.length - 1, i + count - 1)] - hits[i]) / 2);
      }
    }
  }
  const start = Math.max(0, Math.min(value.length - max, Math.floor(centre - max * 0.3)));
  const end = Math.min(value.length, start + max);
  return `${start > 0 ? '…' : ''}${value.slice(start, end).trim()}${end < value.length ? '…' : ''}`;
}
