import { SEARCH_DEFAULTS } from '../config.mjs';
import { tokenizeWithPositions } from './tokenize.mjs';

export function findMatches(text, queryTokens) {
  const matches = [];
  const wanted = new Set(queryTokens.map(t => t.toLowerCase()));
  for (const tp of tokenizeWithPositions(text)) {
    if (wanted.has(tp.token)) matches.push(tp);
  }
  return matches;
}

function pickWindow(matches, textLen, radius = SEARCH_DEFAULTS.SNIPPET_RADIUS, maxLen = SEARCH_DEFAULTS.SNIPPET_MAX_LEN) {
  if (matches.length === 0) return { start: 0, end: Math.min(maxLen, textLen) };
  const first = matches[0];
  let start = Math.max(0, first.start - radius);
  let end = Math.min(textLen, first.end + radius);
  for (const m of matches) {
    if (m.end - start > maxLen) break;
    end = Math.min(textLen, Math.max(end, m.end + radius));
  }
  if (end - start > maxLen) end = start + maxLen;
  return { start, end };
}

function highlightWindow(text, matches, window, marks) {
  const { start, end } = window;
  const inRange = matches.filter(m => m.start >= start && m.end <= end);
  let cursor = start;
  let out = '';
  for (const m of inRange) {
    out += text.slice(cursor, m.start);
    out += marks.open + text.slice(m.start, m.end) + marks.close;
    cursor = m.end;
  }
  out += text.slice(cursor, end);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  return prefix + out + suffix;
}

export function snippet(text, queryTokens, { format = 'ansi' } = {}) {
  if (!text) return '';
  const marks = format === 'html'
    ? { open: SEARCH_DEFAULTS.HIGHLIGHT_HTML_OPEN, close: SEARCH_DEFAULTS.HIGHLIGHT_HTML_CLOSE }
    : format === 'plain'
    ? { open: '', close: '' }
    : { open: SEARCH_DEFAULTS.HIGHLIGHT_OPEN, close: SEARCH_DEFAULTS.HIGHLIGHT_CLOSE };
  const matches = findMatches(text, queryTokens);
  const window = pickWindow(matches, text.length);
  return highlightWindow(text, matches, window, marks).replace(/\s+/g, ' ').trim();
}
