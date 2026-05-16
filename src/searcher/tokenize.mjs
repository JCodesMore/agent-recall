import { TOKENIZE } from '../config.mjs';

export function tokenize(text) {
  if (!text) return [];
  const out = [];
  const re = new RegExp(TOKENIZE.TOKEN_REGEX.source, TOKENIZE.TOKEN_REGEX.flags);
  for (const m of text.matchAll(re)) {
    const t = m[0].toLowerCase();
    if (t.length < TOKENIZE.MIN_TOKEN_LEN) continue;
    if (t.length > TOKENIZE.MAX_TOKEN_LEN) continue;
    out.push(t);
  }
  return out;
}

export function tokenizeWithPositions(text) {
  if (!text) return [];
  const out = [];
  const re = new RegExp(TOKENIZE.TOKEN_REGEX.source, TOKENIZE.TOKEN_REGEX.flags);
  for (const m of text.matchAll(re)) {
    const raw = m[0];
    const lower = raw.toLowerCase();
    if (lower.length < TOKENIZE.MIN_TOKEN_LEN) continue;
    if (lower.length > TOKENIZE.MAX_TOKEN_LEN) continue;
    out.push({ token: lower, start: m.index, end: m.index + raw.length });
  }
  return out;
}
